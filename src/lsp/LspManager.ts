import * as vscode from 'vscode';
import {
  LanguageClient, type LanguageClientOptions, type ServerOptions,
  ErrorAction, CloseAction, Trace,
} from 'vscode-languageclient/node';
import { BslAnalyzerService } from './analyzer/BslAnalyzerService';
import { BslAnalyzerStatusBar } from './analyzer/BslAnalyzerStatusBar';

export type LspMode = 'bsl-analyzer' | 'off';

/**
 * Управляет жизненным циклом LSP-клиента.
 * Поддерживает внешний сервер bsl-analyzer и полное отключение LSP.
 */
export class LspManager implements vscode.Disposable {
  private client: LanguageClient | undefined;
  private readonly analyzerService: BslAnalyzerService;
  private readonly statusBar: BslAnalyzerStatusBar;
  private readonly traceChannel: vscode.OutputChannel;
  private lifecycleQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly outputChannel: vscode.OutputChannel,
  ) {
    this.analyzerService = new BslAnalyzerService(context, outputChannel);
    this.statusBar = new BslAnalyzerStatusBar();
    this.traceChannel = vscode.window.createOutputChannel('BSL LSP Trace');

    this.analyzerService.onBeforeSwap = async () => {
      outputChannel.appendLine('[lsp] Остановка перед обновлением бинарника…');
      await this.stopClient();
    };
  }

  /** Текущий режим из настроек */
  get mode(): LspMode {
    return vscode.workspace.getConfiguration('v8vscedit.lsp').get<LspMode>('mode', 'bsl-analyzer');
  }

  /** Запустить LSP по текущей настройке */
  async start(): Promise<void> {
    return this.enqueueLifecycle(() => this.startCurrentMode());
  }

  async stop(): Promise<void> {
    return this.enqueueLifecycle(() => this.stopClient());
  }

  async restart(): Promise<void> {
    return this.enqueueLifecycle(async () => {
      await this.stopClient();
      await this.startCurrentMode();
    });
  }

  private async startCurrentMode(): Promise<void> {
    const m = this.mode;
    this.outputChannel.appendLine(`[lsp] Режим: ${m}`);

    if (this.client) {
      await this.stopClient();
    }

    if (m === 'off') {
      this.statusBar.setState('stopped', 'Отключен в настройках');
      return;
    }
    await this.startBslAnalyzer();
  }

  private async stopClient(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    if (client?.needsStop()) {
      try {
        await client.stop();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.outputChannel.appendLine(`[lsp] Не удалось штатно остановить клиент: ${msg}`);
      }
    } else if (client) {
      this.outputChannel.appendLine('[lsp] Клиент не был запущен, остановка не требуется');
    }
    this.statusBar.setState('stopped');
  }

  /** Проверить обновления bsl-analyzer. */
  async checkForUpdate(): Promise<void> {
    const updated = await this.analyzerService.checkForUpdate();
    if (updated) {
      await this.restart();
    }
  }

  /** Регистрирует команды и подписки, связанные с LSP */
  registerCommands(): void {
    const { context } = this;

    context.subscriptions.push(
      this.analyzerService, this.statusBar, this.traceChannel,
    );

    context.subscriptions.push(
      vscode.commands.registerCommand('v8vscedit.bslAnalyzer.restart', () => this.restart()),
      vscode.commands.registerCommand('v8vscedit.bslAnalyzer.showOutput', () => this.outputChannel.show()),
      vscode.commands.registerCommand('v8vscedit.bslAnalyzer.update', () => this.checkForUpdate()),
      vscode.commands.registerCommand('v8vscedit.bslAnalyzer.showMenu', () => this.showMenu()),
      { dispose: () => { void this.stopClient(); } },
    );

    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('v8vscedit.lsp') || e.affectsConfiguration('v8vscedit.bslAnalyzer')) {
          void this.restart();
        }
      }),
    );
  }

  /** Запустить + запланировать фоновую проверку обновлений */
  startWithAutoUpdate(): void {
    void this.start();

    if (this.mode === 'bsl-analyzer' &&
        vscode.workspace.getConfiguration('v8vscedit.bslAnalyzer').get<boolean>('autoUpdate', true)) {
      setTimeout(() => { void this.checkForUpdate(); }, 30_000);
    }
  }

  dispose(): void {
    void this.stopClient();
  }

  // ── Приватные методы ────────────────────────────────────────────────────

  private enqueueLifecycle(action: () => Promise<void>): Promise<void> {
    const next = this.lifecycleQueue.then(action, action);
    this.lifecycleQueue = next.catch(() => undefined);
    return next;
  }

  private async startBslAnalyzer(): Promise<void> {
    this.statusBar.setState('downloading');
    const ready = await this.analyzerService.ensureBinary();
    if (!ready) {
      this.statusBar.setState('error', 'Бинарник не найден');
      return;
    }

    this.statusBar.setState('starting');
    const execPath = this.analyzerService.getExecutablePath();
    this.outputChannel.appendLine(`[lsp] bsl-analyzer: ${execPath}`);

    const serverOptions: ServerOptions = {
      command: execPath,
      args: ['lsp'],
      options: {
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          LANG: process.env.LANG,
          LC_ALL: process.env.LC_ALL,
          RUST_LOG: 'info',
          RUST_BACKTRACE: '1',
          RUST_MIN_STACK: '16777216',
        },
      },
    };

    let crashCount = 0;
    const MAX_CRASHES = 3;

    const clientOptions: LanguageClientOptions = {
      documentSelector: [
        { scheme: 'file', language: 'bsl' },
      ],
      synchronize: {
        fileEvents: vscode.workspace.createFileSystemWatcher('**/*.bsl'),
      },
      outputChannel: this.outputChannel,
      traceOutputChannel: this.traceChannel,
      errorHandler: {
        error: () => ({ action: ErrorAction.Continue }),
        closed: () => {
          crashCount++;
          this.outputChannel.appendLine(`[lsp] Сервер упал (${String(crashCount)}/${String(MAX_CRASHES)})`);
          if (crashCount >= MAX_CRASHES) {
            this.statusBar.setState('error', `Сервер упал ${String(crashCount)} раз`);
            return { action: CloseAction.DoNotRestart };
          }
          this.statusBar.setState('starting', `Перезапуск (${String(crashCount)}/${String(MAX_CRASHES)})…`);
          return { action: CloseAction.Restart };
        },
      },
    };

    this.client = new LanguageClient('bsl-analyzer', 'BSL Analyzer', serverOptions, clientOptions);

    try {
      await this.client.setTrace(Trace.Verbose);
      await this.client.start();
      crashCount = 0;
      this.statusBar.setState('running');
      const version = this.analyzerService.installedVersion;
      if (version) {
        this.statusBar.setVersion(version);
      }
      this.outputChannel.appendLine(`[lsp] bsl-analyzer запущен (${version ?? 'custom'})`);
    } catch (err) {
      this.client = undefined;
      const msg = err instanceof Error ? err.message : String(err);
      this.statusBar.setState('error', msg);
      this.outputChannel.appendLine(`[lsp] Ошибка запуска bsl-analyzer: ${msg}`);
      vscode.window.showErrorMessage(`BSL Analyzer: ошибка запуска: ${msg}`);
    }
  }

  private async showMenu(): Promise<void> {
    const m = this.mode;
    const items: vscode.QuickPickItem[] = [
      { label: '$(debug-restart) Перезапустить', description: `Режим: ${m}` },
      { label: '$(output) Показать лог', description: 'Канал вывода LSP' },
    ];
    if (m === 'bsl-analyzer') {
      items.splice(1, 0, {
        label: '$(cloud-download) Проверить обновления',
        description: `Текущая: ${this.analyzerService.installedVersion ?? '—'}`,
      });
    }
    const pick = await vscode.window.showQuickPick(items, { title: 'BSL Language Server' });
    if (!pick) {
      return;
    }
    if (pick.label.includes('Перезапустить')) {
      await this.restart();
    } else if (pick.label.includes('обновления')) {
      await this.checkForUpdate();
    } else if (pick.label.includes('лог')) {
      this.outputChannel.show();
    }
  }
}
