import * as vscode from 'vscode';
import { MetadataTreeProvider } from '../../tree/MetadataTreeProvider';

type TreeSearchMessage =
  | { readonly type: 'command'; readonly command: string }
  | { readonly type: 'search'; readonly value: string }
  | { readonly type: 'clearSearch' };

interface TreeSearchViewServices {
  readonly treeProvider: MetadataTreeProvider;
  readonly setTreeMessage: (message: string | undefined) => void;
}

/**
 * Панель быстрых действий отделяет кнопки и поиск от TreeView,
 * чтобы навигатор оставался только деревом метаданных.
 */
export class TreeSearchViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'v8vsceditActions';

  private view: vscode.WebviewView | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly services: TreeSearchViewServices
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((message: TreeSearchMessage) => {
      void this.handleMessage(message);
    });
  }

  private async handleMessage(message: TreeSearchMessage): Promise<void> {
    if (message.type === 'command') {
      await vscode.commands.executeCommand(message.command);
      return;
    }

    if (message.type === 'clearSearch') {
      this.applySearch('');
      this.postSearchState('');
      return;
    }

    this.applySearch(message.value);
  }

  private applySearch(value: string): void {
    const query = value.trim();
    this.services.treeProvider.setSearchQuery(query);

    const hasSearch = query.length > 2;
    void vscode.commands.executeCommand('setContext', 'v8vscedit.hasTreeSearch', hasSearch);
    this.services.setTreeMessage(hasSearch ? `Поиск: ${query}` : undefined);
  }

  private postSearchState(value: string): void {
    void this.view?.webview.postMessage({ type: 'searchState', value });
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const initialSearch = escapeHtml(this.services.treeProvider.getSearchQuery());
    const updateIconLight = webview.asWebviewUri(vscode.Uri.joinPath(
      this.extensionUri,
      'src',
      'icons',
      'light',
      'externalDataSource.svg'
    ));
    const updateIconDark = webview.asWebviewUri(vscode.Uri.joinPath(
      this.extensionUri,
      'src',
      'icons',
      'dark',
      'externalDataSource.svg'
    ));

    return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      padding: 8px 12px 10px;
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }

    .actions {
      display: flex;
      align-items: center;
      gap: 3px;
      margin-bottom: 7px;
    }

    button {
      width: 26px;
      height: 26px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      border: 1px solid transparent;
      color: var(--vscode-icon-foreground);
      background: transparent;
      border-radius: 4px;
      font: inherit;
      cursor: pointer;
    }

    button:hover {
      background: var(--vscode-toolbar-hoverBackground);
      outline: 1px solid var(--vscode-toolbar-hoverOutline, transparent);
    }

    .icon {
      width: 16px;
      height: 16px;
      display: block;
      color: var(--vscode-icon-foreground);
    }

    .theme-icon {
      width: 16px;
      height: 16px;
      display: block;
    }

    .vscode-dark .theme-icon.light,
    .vscode-high-contrast .theme-icon.light,
    .vscode-light .theme-icon.dark {
      display: none;
    }

    .search {
      position: relative;
    }

    input {
      width: 100%;
      height: 24px;
      box-sizing: border-box;
      padding: 3px 25px 3px 8px;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 12px;
      font: inherit;
      outline: none;
    }

    input:focus {
      border-color: var(--vscode-focusBorder);
    }

    .clear {
      position: absolute;
      top: 1px;
      right: 1px;
      width: 22px;
      height: 22px;
      padding: 0;
      border-radius: 11px;
      font-size: 15px;
      line-height: 1;
    }
  </style>
</head>
<body>
  <div class="actions">
    <button type="button" data-command="v8vscedit.importConfigurations" title="Импортировать конфигурации из базы" aria-label="Импортировать конфигурации из базы">
      ${cloudDownloadIcon()}
    </button>
    <button type="button" data-command="v8vscedit.updateChangedConfigurations" title="Обновить изменённые конфигурации" aria-label="Обновить изменённые конфигурации">
      <img class="theme-icon light" src="${updateIconLight}" alt="">
      <img class="theme-icon dark" src="${updateIconDark}" alt="">
    </button>
    <button type="button" data-command="v8vscedit.runThinClient" title="Запустить тонкий клиент" aria-label="Запустить тонкий клиент">
      ${runIcon()}
    </button>
    <button type="button" data-command="v8vscedit.runConfigurator" title="Запустить конфигуратор" aria-label="Запустить конфигуратор">
      ${toolsIcon()}
    </button>
  </div>
  <div class="search">
    <input id="search" type="search" value="${initialSearch}" placeholder="Поиск в навигаторе" aria-label="Поиск в навигаторе">
    <button id="clear" class="clear" type="button" title="Очистить поиск" aria-label="Очистить поиск">×</button>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const search = document.getElementById('search');
    const clear = document.getElementById('clear');
    let searchTimer = undefined;

    const postSearch = (value) => {
      vscode.postMessage({ type: 'search', value });
    };

    const scheduleSearch = () => {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => postSearch(search.value), 2000);
    };

    for (const button of document.querySelectorAll('[data-command]')) {
      button.addEventListener('click', () => {
        vscode.postMessage({ type: 'command', command: button.dataset.command });
      });
    }

    search.addEventListener('input', () => {
      scheduleSearch();
    });

    clear.addEventListener('click', () => {
      window.clearTimeout(searchTimer);
      search.value = '';
      vscode.postMessage({ type: 'clearSearch' });
      search.focus();
    });

    window.addEventListener('message', (event) => {
      if (event.data?.type === 'searchState') {
        search.value = event.data.value;
      }
    });
  </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i += 1) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function cloudDownloadIcon(): string {
  return `<svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
    <path fill="currentColor" d="M5.5 14h5v-1h-5v1ZM8 12l3-3h-2V5H7v4H5l3 3Z"/>
    <path fill="currentColor" d="M12.5 6.1A4.5 4.5 0 0 0 3.9 4.7 3.3 3.3 0 0 0 4.3 11H5v-1h-.7a2.3 2.3 0 0 1-.1-4.6l.4-.1.1-.4a3.5 3.5 0 0 1 6.8 1l.1.8.8.1A1.6 1.6 0 0 1 12.2 10H11v1h1.2a2.6 2.6 0 0 0 .3-4.9Z"/>
  </svg>`;
}

function runIcon(): string {
  return `<svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
    <path fill="currentColor" d="M4 2.5v11l9-5.5-9-5.5Zm1 1.8L11.1 8 5 11.7V4.3Z"/>
  </svg>`;
}

function toolsIcon(): string {
  return `<svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
    <path fill="currentColor" d="M14.1 4.1 12 6.2l-2.2-2.1L12 1.9A4 4 0 0 0 7.1 6.8L2 11.9A1.5 1.5 0 1 0 4.1 14l5.1-5.1a4 4 0 0 0 4.9-4.8ZM3.4 13.3a.5.5 0 1 1-.7-.7.5.5 0 0 1 .7.7Z"/>
  </svg>`;
}
