import * as vscode from 'vscode';
import { WebviewHtmlFactory } from './webview/WebviewHtmlFactory';

export type ConnectionMode = 'connect' | 'create';

export interface RepositoryBinding {
  readonly repoPath: string;
  readonly repoUser: string;
  /** Пароль в webview не передаётся — только признак того, что он уже задан. */
  readonly repoPasswordSet: boolean;
}

export interface RepositoryConnectionFormData {
  readonly repoPath: string;
  readonly repoUser: string;
  readonly repoPassword: string;
  readonly forceBindAlreadyBindedUser?: boolean;
  readonly forceReplaceCfg?: boolean;
  readonly allowConfigurationChanges?: boolean;
  readonly changesAllowedRule?: string;
  readonly changesNotRecommendedRule?: string;
  readonly noBind?: boolean;
}

export interface RepositoryConnectionSubmitResult {
  readonly mode: ConnectionMode;
  readonly repoPath: string;
  readonly repoUser: string;
  readonly repoPassword: string;
  readonly forceBindAlreadyBindedUser?: boolean;
  readonly forceReplaceCfg?: boolean;
  readonly allowConfigurationChanges?: boolean;
  readonly changesAllowedRule?: string;
  readonly changesNotRecommendedRule?: string;
  readonly noBind?: boolean;
}

type RepositoryConnectionMessage =
  | { readonly type: 'command'; readonly command: 'submit'; readonly payload: RepositoryConnectionFormData }
  | { readonly type: 'command'; readonly command: 'cancel' }
  | { readonly type: 'request'; readonly requestId: string; readonly name: 'browseRepoPath' };

/**
 * Провайдер панели подключения/создания хранилища 1С.
 * Использует Vue-приложение для рендеринга формы.
 */
export class RepositoryConnectionViewProvider implements vscode.Disposable {
  static readonly viewType = 'v8vsceditRepositoryConnectionPanel';

  private panel: vscode.WebviewPanel | undefined;
  private currentMode: ConnectionMode = 'connect';
  private resolvePromise: ((value: RepositoryConnectionSubmitResult | undefined) => void) | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri
  ) {}

  /**
   * Показывает панель подключения к хранилищу.
   * @returns Promise с данными формы или undefined при отмене.
   */
  show(
    mode: ConnectionMode,
    target: string,
    initialBinding?: RepositoryBinding
  ): Promise<RepositoryConnectionSubmitResult | undefined> {
    this.currentMode = mode;

    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active);
      return new Promise((resolve) => {
        this.resolvePromise = resolve;
      });
    }

    this.panel = vscode.window.createWebviewPanel(
      RepositoryConnectionViewProvider.viewType,
      mode === 'connect' ? 'Подключение к хранилищу' : 'Создание хранилища',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: false }
    );

    this.panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist', 'ui')],
    };

    const factory = new WebviewHtmlFactory(this.extensionUri);
    this.panel.webview.html = factory.renderVueWebviewHtml({
      webview: this.panel.webview,
      title: mode === 'connect' ? 'Подключение к хранилищу' : 'Создание хранилища',
      entry: 'repository-connection',
      viewKind: 'repository-connection',
      initialState: {
        mode,
        target,
        initialBinding: initialBinding ?? null,
      },
      csp: { allowStyles: true },
    });

    this.panel.webview.onDidReceiveMessage((message: RepositoryConnectionMessage) => {
      void this.handleMessage(message);
    });

    this.panel.onDidDispose(() => {
      this.resolvePromise?.(undefined);
      this.panel = undefined;
    });

    return new Promise((resolve) => {
      this.resolvePromise = resolve;
    });
  }

  dispose(): void {
    this.panel?.dispose();
  }

  private async handleMessage(message: RepositoryConnectionMessage): Promise<void> {
    switch (message.type) {
      case 'command':
        switch (message.command) {
          case 'submit': {
            const result: RepositoryConnectionSubmitResult = {
              mode: this.currentMode,
              ...message.payload,
            };
            this.resolvePromise?.(result);
            this.panel?.dispose();
            this.panel = undefined;
            break;
          }
          case 'cancel': {
            this.resolvePromise?.(undefined);
            this.panel?.dispose();
            this.panel = undefined;
            break;
          }
        }
        break;

      case 'request': {
        const selected = await vscode.window.showOpenDialog({
          canSelectFolders: true,
          canSelectFiles: false,
          title: 'Выберите путь к хранилищу',
        });
        if (selected?.[0]) {
          void this.panel?.webview.postMessage({
            type: 'reply',
            requestId: message.requestId,
            payload: { repoPath: selected[0].fsPath },
          });
        }
        break;
      }
    }
  }
}
