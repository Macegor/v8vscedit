import * as vscode from 'vscode';
import type {
  SaveStandaloneServerSettingsInput,
  StandaloneServerService,
  StandaloneServerSettingsSnapshot,
} from '../../../infra/standalone';
import { WebviewHtmlFactory } from '../webview/WebviewHtmlFactory';

type StandaloneServerMessage =
  | { readonly type: 'refresh' }
  | ({ readonly type: 'save' } & SaveStandaloneServerSettingsInput);

/**
 * Webview-панель настройки автономного сервера 1С.
 */
export class StandaloneServerViewProvider implements vscode.Disposable {
  static readonly viewType = 'v8vsceditStandaloneServerPanel';

  private panel: vscode.WebviewPanel | undefined;

  constructor(
    private readonly service: StandaloneServerService,
    private readonly outputChannel: vscode.OutputChannel,
    private readonly onDidSave: () => void,
    private readonly extensionUri: vscode.Uri
  ) {}

  show(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active);
      this.postState(this.service.getSettingsSnapshot(false));
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      StandaloneServerViewProvider.viewType,
      'Автономный сервер',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    this.panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist', 'ui')],
    };
    this.panel.webview.html = new WebviewHtmlFactory(this.extensionUri).renderVueWebviewHtml({
      webview: this.panel.webview,
      title: 'Автономный сервер',
      entry: 'standalone',
      viewKind: 'standalone',
      initialState: this.service.getSettingsSnapshot(false),
      csp: { allowStyles: true },
    });
    this.panel.webview.onDidReceiveMessage((message: StandaloneServerMessage) => {
      void this.handleMessage(message);
    });
    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });
  }

  dispose(): void {
    this.panel?.dispose();
  }

  private async handleMessage(message: StandaloneServerMessage): Promise<void> {
    try {
      if (message.type === 'refresh') {
        this.postState(this.service.getSettingsSnapshot(true));
        this.postStatus('idle', '');
        return;
      }

      const snapshot = this.service.save({
        ibsrvPath: message.ibsrvPath,
        platformPath: message.platformPath,
        databasePath: message.databasePath,
        httpAddress: message.httpAddress,
        httpPort: message.httpPort,
        httpBase: message.httpBase,
        name: message.name,
        distributeLicenses: message.distributeLicenses,
        scheduleJobs: message.scheduleJobs,
      });
      this.postState(snapshot);
      this.postStatus('success', 'Настройки автономного сервера сохранены.');
      this.onDidSave();
      await vscode.window.showInformationMessage('Настройки автономного сервера сохранены.');
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      this.outputChannel.appendLine(`[standalone][error] ${text}`);
      this.postStatus('error', text);
      await vscode.window.showErrorMessage(`Не удалось сохранить настройки автономного сервера.\n${text}`);
    }
  }

  private postState(snapshot: StandaloneServerSettingsSnapshot): void {
    void this.panel?.webview.postMessage({
      type: 'state',
      state: snapshot,
    });
  }

  private postStatus(kind: 'idle' | 'success' | 'error', message: string): void {
    void this.panel?.webview.postMessage({
      type: 'status',
      kind,
      message,
    });
  }
}

