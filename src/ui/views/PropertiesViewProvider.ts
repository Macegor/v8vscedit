import * as vscode from 'vscode';
import type { MetadataNode } from '../tree/TreeNode';
import type { PropertiesViewController } from './properties/PropertiesViewController';
import { WebviewHtmlFactory } from './webview/WebviewHtmlFactory';
import type { PropertiesViewState } from './properties/_types';

interface PropertiesCommandMessage {
  readonly type: 'command';
  readonly command: string;
  readonly payload?: Record<string, unknown>;
}

type PropertiesMessage = PropertiesCommandMessage;

/** Провайдер панели свойств объекта метаданных. Использует Vue-приложение для рендеринга. */
export class PropertiesViewProvider implements vscode.Disposable {
  static readonly viewType = 'v8vsceditPropertiesPanel';

  private panel: vscode.WebviewPanel | undefined;
  private activeNode: MetadataNode | undefined;
  private readonly htmlFactory: WebviewHtmlFactory;

  constructor(
    private readonly controller: PropertiesViewController,
    private readonly extensionUri: vscode.Uri
  ) {
    this.htmlFactory = new WebviewHtmlFactory(extensionUri);
  }

  show(node: MetadataNode): void {
    this.activeNode = node;
    this.controller.setActiveNode(node);

    if (this.panel) {
      this.panel.title = this.buildTitle(node);
      this.refreshHtml();
      this.panel.reveal(this.panel.viewColumn ?? vscode.ViewColumn.Active, false);
    } else {
      this.panel = vscode.window.createWebviewPanel(
        PropertiesViewProvider.viewType,
        this.buildTitle(node),
        { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
        { enableScripts: true, retainContextWhenHidden: true }
      );
      this.panel.webview.options = {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist', 'ui')],
      };
      this.refreshHtml();
      this.panel.webview.onDidReceiveMessage((message: PropertiesMessage | { readonly type?: string }) => {
        this.handleMessage(message);
      });
      this.panel.onDidDispose(() => {
        this.panel = undefined;
        this.activeNode = undefined;
        this.controller.clearActiveNode();
      });
    }
  }

  refresh(): void {
    if (this.panel) {
      this.activeNode = this.controller.getActiveNode();
      this.refreshHtml();
    }
  }

  /** Обновляет активный узел и заголовок панели после переименования. */
  replaceActiveNode(node: MetadataNode): void {
    this.activeNode = node;
    if (this.panel) {
      this.panel.title = this.buildTitle(node);
    }
  }

  dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
    this.activeNode = undefined;
    this.controller.clearActiveNode();
  }

  private buildTitle(node: MetadataNode): string {
    return `${node.textLabel} — Свойства`;
  }

  private refreshHtml(): void {
    if (!this.panel) {
      return;
    }

    const state = this.controller.getViewState();
    this.panel.webview.html = this.htmlFactory.renderVueWebviewHtml({
      webview: this.panel.webview,
      title: state?.title ?? 'Свойства',
      entry: 'properties',
      viewKind: 'properties',
      initialState: state satisfies PropertiesViewState | null,
      csp: { allowStyles: true },
    });
  }

  private handleMessage(message: PropertiesMessage | { readonly type?: string }): void {
    if (!('command' in message)) {
      return;
    }
    if (message.command === 'propertyChanged') {
      const payload = message.payload as { key?: string; controlId?: string; value: unknown };
      this.controller.handlePropertyChange(payload.key ?? payload.controlId ?? '', payload.value);
      return;
    }
    void this.controller.handleWebviewMessage({
      type: message.command,
      ...(message.payload ?? {}),
    });
  }
}
