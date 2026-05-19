import * as vscode from 'vscode';
import type { StandaloneServerStatus } from '../../../infra/standalone';
import type { MetadataTreeProvider } from '../../tree/MetadataTreeProvider';
import { WebviewHtmlFactory } from '../webview/WebviewHtmlFactory';

type TreeSearchMessage =
  | { readonly type: 'command'; readonly command: string }
  | { readonly type: 'request'; readonly requestId: string; readonly name: string; readonly payload?: unknown };

interface TreeSearchViewServices {
  readonly treeProvider: MetadataTreeProvider;
  readonly setTreeMessage: (message: string | undefined) => void;
  readonly isProjectInitialized: () => boolean;
  readonly getStandaloneServerStatus: () => StandaloneServerStatus;
}

interface TreeSearchState {
  readonly searchQuery: string;
  readonly initialized: boolean;
  readonly serverStatus: { state: string; port?: number; pid?: number; name?: string };
}

/**
 * Панель быстрых действий и поиска по дереву метаданных.
 * Использует Vue-приложение для рендеринга.
 */
export class TreeSearchViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'v8vsceditActions';

  private view: vscode.WebviewView | undefined;
  private htmlFactory: WebviewHtmlFactory;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly services: TreeSearchViewServices
  ) {
    this.htmlFactory = new WebviewHtmlFactory(extensionUri);
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist', 'ui')],
    };

    webviewView.webview.html = this.buildHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((message: TreeSearchMessage) => {
      void this.handleMessage(message);
    });
  }

  refresh(): void {
    if (this.view) {
      this.view.webview.html = this.buildHtml(this.view.webview);
    }
  }

  private buildHtml(webview: vscode.Webview): string {
    const state: TreeSearchState = {
      searchQuery: this.services.treeProvider.getSearchQuery(),
      initialized: this.services.isProjectInitialized(),
      serverStatus: this.mapServerStatus(this.services.getStandaloneServerStatus()),
    };

    return this.htmlFactory.renderVueWebviewHtml({
      webview,
      title: 'Действия',
      entry: 'tree-search',
      viewKind: 'tree-search',
      initialState: state,
      csp: { allowStyles: true },
    });
  }

  private mapServerStatus(status: StandaloneServerStatus): TreeSearchState['serverStatus'] {
    return {
      state: status.state,
      port: status.settings.httpPort,
      pid: status.pid ?? undefined,
      name: status.settings.name,
    };
  }

  private async handleMessage(message: TreeSearchMessage): Promise<void> {
    if (message.type === 'command') {
      if (message.command === 'v8vscedit.clearSearch') {
        this.applySearch('');
        return;
      }
      try {
        await vscode.commands.executeCommand(message.command);
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        await vscode.window.showErrorMessage(`Команда не выполнена: ${text}`);
      }
      return;
    }

    if (message.name === 'search') {
      const query = typeof message.payload === 'string'
        ? message.payload
        : (message.payload as { query?: string }).query ?? '';
      this.applySearch(query);

      void this.view?.webview.postMessage({
        type: 'searchState',
        value: query,
      });
    }
  }

  private applySearch(value: string): void {
    const query = value.trim();
    this.services.treeProvider.setSearchQuery(query);

    const hasSearch = query.length > 2;
    void vscode.commands.executeCommand('setContext', 'v8vscedit.hasTreeSearch', hasSearch);
    this.services.setTreeMessage(hasSearch ? `Поиск: ${query}` : undefined);
  }
}
