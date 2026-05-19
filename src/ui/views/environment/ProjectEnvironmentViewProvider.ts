import * as vscode from 'vscode';
import type {
  ProjectEnvironmentService,
  ProjectEnvironmentSnapshot,
  SaveProjectEnvironmentInput,
} from '../../../infra/environment';
import { WebviewHtmlFactory } from '../webview/WebviewHtmlFactory';

type ProjectEnvironmentMessage =
  | { readonly type: 'refresh' }
  | ({ readonly type: 'save' } & SaveProjectEnvironmentInput);

/**
 * Webview-панель выбора платформы 1С и рабочей информационной базы проекта.
 */
export class ProjectEnvironmentViewProvider implements vscode.Disposable {
  static readonly viewType = 'v8vsceditEnvironmentPanel';

  private panel: vscode.WebviewPanel | undefined;
  private loadingTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly service: ProjectEnvironmentService,
    private readonly outputChannel: vscode.OutputChannel,
    private readonly extensionUri: vscode.Uri
  ) {}

  show(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active);
      this.loadSnapshot(false);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      ProjectEnvironmentViewProvider.viewType,
      'Настройки проекта',
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
      title: 'Настройки проекта',
      entry: 'environment',
      viewKind: 'environment',
      initialState: this.service.getInitialSnapshot(),
      csp: { allowStyles: true },
    });
    this.panel.webview.onDidReceiveMessage((message: ProjectEnvironmentMessage) => {
      void this.handleMessage(message);
    });
    this.panel.onDidDispose(() => {
      if (this.loadingTimer) {
        clearTimeout(this.loadingTimer);
        this.loadingTimer = undefined;
      }
      this.panel = undefined;
    });
    this.loadSnapshot(false);
  }

  dispose(): void {
    if (this.loadingTimer) {
      clearTimeout(this.loadingTimer);
      this.loadingTimer = undefined;
    }
    this.panel?.dispose();
  }

  refresh(): void {
    this.loadSnapshot(true);
  }

  private async handleMessage(message: ProjectEnvironmentMessage): Promise<void> {
    try {
      if (message.type === 'refresh') {
        this.postStatus('loading', 'Обновляю списки баз и платформ...');
        this.refresh();
        return;
      }

      const snapshot = this.service.save({
        platformPath: message.platformPath,
        baseId: message.baseId,
        dbUser: message.dbUser,
        dbPassword: message.dbPassword,
      });
      this.postState(snapshot);
      this.postStatus('success', 'Настройки сохранены в env.json.');
      await vscode.window.showInformationMessage('Настройки запуска 1С сохранены в env.json.');
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      this.outputChannel.appendLine(`[environment][error] ${text}`);
      this.postStatus('error', text);
      await vscode.window.showErrorMessage(`Не удалось сохранить настройки запуска.\n${text}`);
    }
  }

  private postState(snapshot: ProjectEnvironmentSnapshot): void {
    void this.panel?.webview.postMessage({
      type: 'state',
      state: snapshot,
    });
  }

  private postStatus(kind: 'idle' | 'loading' | 'success' | 'error', message: string): void {
    void this.panel?.webview.postMessage({
      type: 'status',
      kind,
      message,
    });
  }

  private loadSnapshot(forceRefresh: boolean): void {
    if (this.loadingTimer) {
      clearTimeout(this.loadingTimer);
    }

    this.postStatus('loading', forceRefresh
      ? 'Обновляю списки баз и платформ...'
      : 'Загружаю списки баз и платформ...'
    );
    this.loadingTimer = setTimeout(() => {
      this.loadingTimer = undefined;
      try {
        this.postState(this.service.getSnapshot(forceRefresh));
        this.postStatus('idle', '');
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        this.outputChannel.appendLine(`[environment][error] ${text}`);
        this.postStatus('error', text);
      }
    }, 0);
  }
}

