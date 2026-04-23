import * as path from 'path';
import * as vscode from 'vscode';
import {
  LanguageClient, LanguageClientOptions, ServerOptions,
  TransportKind, ErrorAction, CloseAction, Trace,
} from 'vscode-languageclient/node';
import { BslAnalyzerService } from './analyzer/BslAnalyzerService';
import { BslAnalyzerStatusBar } from './analyzer/BslAnalyzerStatusBar';

export type LspMode = 'built-in' | 'bsl-analyzer' | 'off';

/**
 * Управляет жизненным циклом LSP-клиента.
 * Поддерживает два режима: встроенный (tree-sitter) и внешний (bsl-analyzer).
 */
export class LspManager implements vscode.Disposable {
  private client: LanguageClient | undefined;
  private readonly analyzerService: BslAnalyzerService;
  private readonly statusBar: BslAnalyzerStatusBar;
  private readonly traceChannel: vscode.OutputChannel;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly outputChannel: vscode.OutputChannel,
    /** URI-схема виртуальной ФС (для встроенного LSP) */
    private readonly onecScheme: string,
  ) {
    this.analyzerService = new BslAnalyzerService(context, outputChannel);
    this.statusBar = new BslAnalyzerStatusBar();
    this.traceChannel = vscode.window.createOutputChannel('BSL LSP Trace');

    this.analyzerService.onBeforeSwap = async () => {
      if (this.client) {
        outputChannel.appendLine('[lsp] Остановка перед обновлением бинарника…');
        await this.client.stop();
        this.client = undefined;
      }
    };
  }

  /** Текущий режим из настроек */
  get mode(): LspMode {
    return vscode.workspace.getConfiguration('v8vscedit.lsp').get<LspMode>('mode', 'bsl-analyzer');
  }

  /** Запустить LSP по текущей настройке */
  async start(): Promise<void> {
    const m = this.mode;
    this.outputChannel.appendLine(`[lsp] Режим: ${m}`);

    if (m === 'off') {
      this.statusBar.setState('stopped', 'Отключен в настройках');
      return;
    }
    if (m === 'bsl-analyzer') {
      await this.startBslAnalyzer();
    } else {
      await this.startBuiltIn();
    }
  }

  async stop(): Promise<void> {
    if (this.client) {
      await this.client.stop();
      this.client = undefined;
    }
    this.statusBar.setState('stopped');
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  /** Проверить обновления bsl-analyzer (если режим соответствует) */
  async checkForUpdate(): Promise<void> {
    const updated = await this.analyzerService.checkForUpdate();
    if (updated) await this.restart();
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
      { dispose: () => { this.client?.stop(); } },
    );

    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('v8vscedit.lsp') || e.affectsConfiguration('v8vscedit.bslAnalyzer')) {
          this.restart();
        }
      }),
    );
  }

  /** Запустить + запланировать фоновую проверку обновлений */
  startWithAutoUpdate(): void {
    this.start();

    if (this.mode === 'bsl-analyzer' &&
        vscode.workspace.getConfiguration('v8vscedit.bslAnalyzer').get<boolean>('autoUpdate', true)) {
      setTimeout(() => this.checkForUpdate(), 30_000);
    }
  }

  dispose(): void {
    this.client?.stop();
  }

  // ── Приватные методы ────────────────────────────────────────────────────

  private async startBuiltIn(): Promise<void> {
    this.statusBar.setState('starting');
    const serverModule = this.context.asAbsolutePath(path.join('dist', 'server.js'));

    const serverOptions: ServerOptions = {
      run: { module: serverModule, transport: TransportKind.ipc },
      debug: {
        module: serverModule,
        transport: TransportKind.ipc,
        options: { execArgv: ['--nolazy', '--inspect=6009'] },
      },
    };

    const clientOptions: LanguageClientOptions = {
      documentSelector: [
        { scheme: 'file', language: 'bsl' },
        { scheme: this.onecScheme, language: 'bsl' },
      ],
      synchronize: {
        fileEvents: vscode.workspace.createFileSystemWatcher('**/*.bsl'),
      },
      outputChannel: this.outputChannel,
      traceOutputChannel: this.traceChannel,
    };

    this.client = new LanguageClient('bsl-language-server', 'BSL Built-in', serverOptions, clientOptions);

    try {
      await this.client.start();
      this.statusBar.setState('running');
      this.statusBar.setVersion('built-in');
      this.outputChannel.appendLine('[lsp] Встроенный LSP запущен');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.statusBar.setState('error', msg);
      this.outputChannel.appendLine(`[lsp] Ошибка запуска встроенного LSP: ${msg}`);
    }
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
          ...process.env,
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
          this.outputChannel.appendLine(`[lsp] Сервер упал (${crashCount}/${MAX_CRASHES})`);
          if (crashCount >= MAX_CRASHES) {
            this.statusBar.setState('error', `Сервер упал ${crashCount} раз`);
            return { action: CloseAction.DoNotRestart };
          }
          this.statusBar.setState('starting', `Перезапуск (${crashCount}/${MAX_CRASHES})…`);
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
      if (version) this.statusBar.setVersion(version);
      this.outputChannel.appendLine(`[lsp] bsl-analyzer запущен (${version || 'custom'})`);
    } catch (err) {
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
        description: `Текущая: ${this.analyzerService.installedVersion || '—'}`,
      });
    }
    const pick = await vscode.window.showQuickPick(items, { title: 'BSL Language Server' });
    if (!pick) return;
    if (pick.label.includes('Перезапустить')) await this.restart();
    else if (pick.label.includes('обновления')) await this.checkForUpdate();
    else if (pick.label.includes('лог')) this.outputChannel.show();
  }
}
