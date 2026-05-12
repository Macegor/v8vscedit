import * as vscode from 'vscode';
import { WebviewHtmlFactory } from './webview/WebviewHtmlFactory';

export interface RepositoryCommitFormData {
  readonly comment: string;
  readonly recursive: boolean;
  readonly keepLocked: boolean;
  readonly force: boolean;
}

type RepositoryCommitMessage =
  | { readonly type: 'command'; readonly command: 'submit'; readonly payload: RepositoryCommitFormData }
  | { readonly type: 'command'; readonly command: 'cancel' };

/**
 * Провайдер панели помещения изменений в хранилище 1С.
 * Использует Vue-приложение для рендеринга формы.
 */
export class RepositoryCommitViewProvider implements vscode.Disposable {
  static readonly viewType = 'v8vsceditRepositoryCommitPanel';

  private panel: vscode.WebviewPanel | undefined;
  private resolvePromise: ((value: RepositoryCommitFormData | undefined) => void) | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri
  ) {}

  /**
   * Показывает панель коммита в хранилище.
   * @returns Promise с данными формы или undefined при отмене.
   */
  show(
    targetLabel: string,
    initiallyLocked: boolean
  ): Promise<RepositoryCommitFormData | undefined> {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active);
      return new Promise((resolve) => {
        this.resolvePromise = resolve;
      });
    }

    this.panel = vscode.window.createWebviewPanel(
      RepositoryCommitViewProvider.viewType,
      'Помещение в хранилище',
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
      title: 'Помещение в хранилище',
      entry: 'repository-commit',
      viewKind: 'repository-commit',
      initialState: {
        targetLabel,
        initiallyLocked,
      },
      csp: { allowStyles: true },
    });

    this.panel.webview.onDidReceiveMessage((message: RepositoryCommitMessage) => {
      this.handleMessage(message);
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

  private handleMessage(message: RepositoryCommitMessage): void {
    this.resolvePromise?.(message.command === 'submit' ? message.payload : undefined);
    this.panel?.dispose();
    this.panel = undefined;
  }
}
