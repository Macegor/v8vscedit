import * as vscode from 'vscode';
import {
  LanguageClient, type LanguageClientOptions, type ServerOptions,
  ErrorAction, CloseAction, Trace, State,
  DocumentFormattingRequest,
  DocumentRangeFormattingRequest,
  type TextEdit as LspTextEdit,
} from 'vscode-languageclient/node';
import { BslAnalyzerService } from './analyzer/BslAnalyzerService';
import { BslAnalyzerStatusBar } from './analyzer/BslAnalyzerStatusBar';

export type LspMode = 'bsl-analyzer' | 'off';

const BSL_DOCUMENT_SELECTOR: { scheme: string; language: string }[] = [
  { scheme: 'file', language: 'bsl' },
];

/**
 * Управляет жизненным циклом LSP-клиента.
 * Поддерживает внешний сервер bsl-analyzer и полное отключение LSP.
 */
export class LspManager implements vscode.Disposable {
  private client: LanguageClient | undefined;
  /**
   * «Поколение» активного клиента. Инкрементируется при каждом stop/start.
   * errorHandler конкретного клиента запоминает своё поколение и сравнивает
   * с этим полем: события от устаревшего клиента (например, авто-рестарт
   * vscode-languageclient после ручного restart) игнорируются — так
   * предотвращается запуск второго параллельного процесса bsl-analyzer.
   */
  private clientGeneration = 0;
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
    // Любой авто-рестарт уже не должен относиться к актуальному состоянию.
    this.clientGeneration++;
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

  async ensureAnalyzerBinary(): Promise<boolean> {
    return this.analyzerService.ensureBinary();
  }

  getAnalyzerExecutablePath(): string {
    return this.analyzerService.getExecutablePath();
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

  async formatRange(
    document: vscode.TextDocument,
    range: vscode.Range,
    options?: vscode.FormattingOptions,
  ): Promise<boolean> {
    const tokenSource = new vscode.CancellationTokenSource();
    try {
      const edits = await this.provideDocumentRangeFormattingEdits(
        document,
        range,
        options ?? getFormattingOptions(vscode.window.activeTextEditor),
        tokenSource.token
      );
      if (edits.length === 0) {
        return false;
      }
      const workspaceEdit = new vscode.WorkspaceEdit();
      for (const edit of edits) {
        workspaceEdit.replace(document.uri, edit.range, edit.newText);
      }
      return await vscode.workspace.applyEdit(workspaceEdit);
    } finally {
      tokenSource.dispose();
    }
  }

  // ── Приватные методы ────────────────────────────────────────────────────

  private async provideDocumentFormattingEdits(
    document: vscode.TextDocument,
    options: vscode.FormattingOptions,
    token: vscode.CancellationToken
  ): Promise<vscode.TextEdit[]> {
    const client = this.getRunningClient();
    if (!client) {
      return [];
    }
    try {
      const result = await client.sendRequest(DocumentFormattingRequest.type, {
        textDocument: { uri: document.uri.toString() },
        options: toLspFormattingOptions(options),
      }, token);
      return toVscodeTextEdits(result ?? []);
    } catch (err) {
      this.logFormattingError('formatting', err);
      return [];
    }
  }

  private async provideDocumentRangeFormattingEdits(
    document: vscode.TextDocument,
    range: vscode.Range,
    options: vscode.FormattingOptions,
    token: vscode.CancellationToken
  ): Promise<vscode.TextEdit[]> {
    const client = this.getRunningClient();
    if (!client) {
      return [];
    }
    try {
      const result = await client.sendRequest(DocumentRangeFormattingRequest.type, {
        textDocument: { uri: document.uri.toString() },
        range: toLspRange(range),
        options: toLspFormattingOptions(options),
      }, token);
      return toVscodeTextEdits(result ?? []);
    } catch (err) {
      this.logFormattingError('rangeFormatting', err);
      return [];
    }
  }

  private getRunningClient(): LanguageClient | undefined {
    return this.client?.state === State.Running && this.client.isRunning()
      ? this.client
      : undefined;
  }

  private logFormattingError(method: string, err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err);
    this.outputChannel.appendLine(`[lsp] Ошибка ${method}: ${msg}`);
  }

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

    // Поколение этого клиента фиксируется на момент создания. Если к моменту
    // срабатывания errorHandler поколение сменилось (был stop/restart),
    // значит клиент устарел — его авто-рестарт нужно подавить, чтобы не
    // плодить параллельные процессы. Перезапуск идёт только через
    // lifecycleQueue (метод restart()).
    const generation = ++this.clientGeneration;
    const isCurrent = (): boolean => this.clientGeneration === generation;

    const clientOptions: LanguageClientOptions = {
      documentSelector: BSL_DOCUMENT_SELECTOR,
      synchronize: {
        fileEvents: vscode.workspace.createFileSystemWatcher('**/*.bsl'),
      },
      outputChannel: this.outputChannel,
      traceOutputChannel: this.traceChannel,
      errorHandler: {
        error: () => ({ action: ErrorAction.Continue }),
        closed: () => {
          if (!isCurrent()) {
            // Событие от устаревшего клиента — не рестартуем и не трогаем статус-бар.
            return { action: CloseAction.DoNotRestart };
          }
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
      // Старт не удался — снимаем «актуальность» этого клиента, чтобы его
      // запоздавший closed-обработчик не инициировал авто-рестарт битого процесса.
      this.clientGeneration++;
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

function getFormattingOptions(editor: vscode.TextEditor | undefined): vscode.FormattingOptions {
  return {
    tabSize: asNumber(editor?.options.tabSize, 4),
    insertSpaces: asBoolean(editor?.options.insertSpaces, true),
  };
}

function asNumber(value: string | number | undefined, fallback: number): number {
  return typeof value === 'number' ? value : fallback;
}

function asBoolean(value: string | boolean | undefined, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function toLspFormattingOptions(options: vscode.FormattingOptions): { tabSize: number; insertSpaces: boolean } {
  return {
    tabSize: asNumber(options.tabSize, 4),
    insertSpaces: options.insertSpaces,
  };
}

function toLspRange(range: vscode.Range): {
  start: { line: number; character: number };
  end: { line: number; character: number };
} {
  return {
    start: { line: range.start.line, character: range.start.character },
    end: { line: range.end.line, character: range.end.character },
  };
}

function toVscodeTextEdits(edits: readonly LspTextEdit[]): vscode.TextEdit[] {
  return edits.map((edit) => vscode.TextEdit.replace(
    new vscode.Range(
      edit.range.start.line,
      edit.range.start.character,
      edit.range.end.line,
      edit.range.end.character
    ),
    edit.newText
  ));
}
