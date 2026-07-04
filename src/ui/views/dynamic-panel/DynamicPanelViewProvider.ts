import * as vscode from 'vscode';
import { WebviewHtmlFactory } from '../webview/WebviewHtmlFactory';
import { resolveWebviewLocalResourceRoots } from '../webview/webviewResourceRoots';
import type { DynamicPanelController, DynamicPanelHost } from './DynamicPanelController';
import type { DynamicPanelState } from './_types';

interface WebviewMessage {
  readonly type: 'ready' | 'refresh' | 'command' | 'request';
  readonly command?: string;
  readonly payload?: unknown;
  readonly requestId?: string;
  readonly name?: string;
}

/**
 * WebView-провайдер контекстной (динамической) панели.
 * Контент решает {@link DynamicPanelController}, провайдер — лишь транспорт.
 */
export class DynamicPanelViewProvider
  implements vscode.WebviewViewProvider, vscode.Disposable, DynamicPanelHost {
  static readonly viewType = 'v8vsceditDynamicPanel';

  private view: vscode.WebviewView | undefined;
  private readonly htmlFactory: WebviewHtmlFactory;
  private pendingState: DynamicPanelState | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly controller: DynamicPanelController
  ) {
    this.htmlFactory = new WebviewHtmlFactory(extensionUri);
    this.controller.attachHost(this);
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: resolveWebviewLocalResourceRoots(this.extensionUri, { includeIcons: false }),
    };

    webviewView.webview.html = this.buildHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((message: WebviewMessage) => {
      void this.handleMessage(message);
    });

    webviewView.onDidDispose(() => {
      this.view = undefined;
    });
  }

  /** Реализация {@link DynamicPanelHost.postState}. */
  postState(state: DynamicPanelState): void {
    if (!this.view) {
      this.pendingState = state;
      return;
    }
    void this.view.webview.postMessage({ type: 'state', state });
  }

  /** Показать панель в UI (если она свёрнута/закрыта). */
  async reveal(): Promise<void> {
    if (this.view) {
      this.view.show(true);
      return;
    }
    await vscode.commands.executeCommand(`${DynamicPanelViewProvider.viewType}.focus`);
  }

  dispose(): void {
    this.controller.detachHost();
  }

  private buildHtml(webview: vscode.Webview): string {
    return this.htmlFactory.renderVueWebviewHtml({
      webview,
      title: 'Контекстная панель',
      entry: 'dynamic-panel',
      viewKind: 'dynamic-panel',
      initialState: this.controller.getCurrentState(),
      csp: { allowStyles: true, allowImages: true },
    });
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    if (message.type === 'ready') {
      const state = this.pendingState ?? this.controller.getCurrentState();
      this.pendingState = undefined;
      this.postState(state);
      return;
    }

    if (message.type === 'command' && message.command) {
      await this.controller.handleWebviewCommand(message.command, message.payload);
    }
  }
}
