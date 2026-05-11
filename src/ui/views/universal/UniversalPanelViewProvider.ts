import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type {
  GitMetadataStatusService,
  MetadataGitDecorationStatus,
  MetadataGitDecorationTarget,
} from '../../../infra/git/GitMetadataStatusService';
import type { StandaloneServerStatus } from '../../../infra/standalone';
import { META_TYPES, type MetaKind } from '../../../domain/MetaTypes';
import type { ModuleSlot } from '../../../domain/ModuleSlot';
import { getObjectLocationFromXml } from '../../../infra/fs/MetaPathResolver';
import { getIconUris } from '../../tree/presentation/icon';
import type { MetadataTreeProvider } from '../../tree/MetadataTreeProvider';
import type { MetadataNode } from '../../tree/TreeNode';

type UniversalPanelMessage =
  | { readonly type: 'command'; readonly command: string; readonly nodeId?: string }
  | { readonly type: 'selectNode'; readonly nodeId: string }
  | { readonly type: 'nodeDefault'; readonly nodeId: string }
  | { readonly type: 'loadChildren'; readonly nodeId: string }
  | { readonly type: 'toggleNode'; readonly nodeId: string; readonly open: boolean }
  | { readonly type: 'search'; readonly value: string }
  | { readonly type: 'clearSearch' };

interface UniversalPanelServices {
  readonly state: vscode.Memento;
  readonly treeProvider: MetadataTreeProvider;
  readonly setTreeMessage: (message: string | undefined) => void;
  readonly isProjectInitialized: () => boolean;
  readonly getStandaloneServerStatus: () => StandaloneServerStatus;
  readonly getProcessingState: () => UniversalPanelProcessingState;
  readonly gitMetadataStatusService: GitMetadataStatusService;
  readonly refreshActionsView: () => void;
}

export interface UniversalPanelProcessingState {
  readonly active: boolean;
  readonly title?: string;
  readonly message?: string;
}

interface TreeAction {
  readonly command: string;
  readonly title: string;
  readonly icon: string;
}

/**
 * Соответствие слотов модулей командам открытия.
 * Является единственным местом, где слот → команда расширения.
 */
const MODULE_SLOT_ACTIONS: Partial<Record<ModuleSlot, { command: string; title: string }>> = {
  Object:       { command: 'v8vscedit.openObjectModule',    title: 'Открыть модуль объекта'   },
  Manager:      { command: 'v8vscedit.openManagerModule',   title: 'Открыть модуль менеджера' },
  ValueManager: { command: 'v8vscedit.openConstantModule',  title: 'Открыть модуль константы' },
  RecordSet:    { command: 'v8vscedit.openRecordSetModule', title: 'Открыть модуль записи'    },
  Service:      { command: 'v8vscedit.openServiceModule',   title: 'Открыть модуль сервиса'   },
  CommonModule: { command: 'v8vscedit.openCommonModuleCode', title: 'Открыть модуль'          },
  CommonCommand:{ command: 'v8vscedit.openCommandModule',   title: 'Открыть модуль команды'   },
  CommonForm:   { command: 'v8vscedit.openFormModule',      title: 'Открыть модуль формы'     },
  ChildForm:    { command: 'v8vscedit.openFormModule',      title: 'Открыть модуль формы'     },
  ChildCommand: { command: 'v8vscedit.openCommandModule',   title: 'Открыть модуль команды'   },
};

const CHILDREN_RENDER_CHUNK_SIZE = 250;
const FORM_EDITOR_VIEW_TYPE = 'v8vscedit.formEditor';

/**
 * Универсальная панель объединяет быстрые операции и HTML-представление
 * текущего дерева метаданных. Это ОСНОВНОЙ навигатор — нативный TreeView
 * является резервным и не должен использоваться как основной интерфейс.
 */
export class UniversalPanelViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewType = 'v8vsceditUniversal';
  private static readonly selectedNodeStateKey = 'v8vscedit.universalPanel.selectedNodeKey';

  private view: vscode.WebviewView | undefined;
  private readonly nodeById = new Map<string, MetadataNode>();
  private readonly nodeKeyById = new Map<string, string>();
  private nodeIdByNode = new WeakMap<MetadataNode, string>();
  private readonly openNodeKeys = new Set<string>();
  private readonly treeListener: vscode.Disposable;
  private selectedNodeKey: string | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly services: UniversalPanelServices
  ) {
    this.selectedNodeKey = services.state.get<string>(UniversalPanelViewProvider.selectedNodeStateKey);
    this.treeListener = this.services.treeProvider.onDidChangeTreeData((node) => {
      void this.refreshChangedNode(node);
    });
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((message: UniversalPanelMessage) => {
      void this.handleMessage(message);
    });
  }

  refresh(): void {
    if (this.view) {
      this.view.webview.html = this.getHtml(this.view.webview);
    }
  }

  dispose(): void {
    this.treeListener.dispose();
  }

  private async handleMessage(message: UniversalPanelMessage): Promise<void> {
    if (this.services.getProcessingState().active) {
      return;
    }

    if (message.type === 'search') {
      this.applySearch(message.value);
      return;
    }

    if (message.type === 'clearSearch') {
      this.applySearch('');
      void this.view?.webview.postMessage({ type: 'searchState', value: '' });
      return;
    }

    const node = 'nodeId' in message && message.nodeId ? this.nodeById.get(message.nodeId) : undefined;
    if (message.type === 'toggleNode') {
      this.rememberNodeState(message.nodeId, message.open);
      await this.clearSelectedNode();
      return;
    }

    if (message.type === 'loadChildren') {
      await this.postNodeChildren(message.nodeId, node);
      return;
    }

    if (message.type === 'selectNode') {
      await this.selectNode(message.nodeId, node);
      return;
    }

    if (message.type === 'nodeDefault') {
      await this.executeNodeDefault(node);
      return;
    }

    await this.executeCommand(message.command, node);
  }

  private applySearch(value: string): void {
    const query = value.trim();
    this.services.treeProvider.setSearchQuery(query);
    const hasSearch = query.length > 2;
    void vscode.commands.executeCommand('setContext', 'v8vscedit.hasTreeSearch', hasSearch);
    this.services.setTreeMessage(hasSearch ? `Поиск: ${query}` : undefined);
    this.services.refreshActionsView();
  }

  private async executeNodeDefault(node: MetadataNode | undefined): Promise<void> {
    if (!node?.xmlPath) {
      return;
    }

    if (this.isFormEditorNode(node)) {
      await this.openFormEditor(node);
      return;
    }

    await vscode.commands.executeCommand('v8vscedit.showProperties', node);
  }

  private async executeCommand(command: string, node: MetadataNode | undefined): Promise<void> {
    try {
      if (node) {
        await vscode.commands.executeCommand(command, node);
      } else {
        await vscode.commands.executeCommand(command);
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      await vscode.window.showErrorMessage(`Команда не выполнена: ${text}`);
    }
  }

  private rememberNodeState(nodeId: string, open: boolean): void {
    const nodeKey = this.nodeKeyById.get(nodeId);
    if (!nodeKey) {
      return;
    }

    if (open) {
      this.openNodeKeys.add(nodeKey);
      return;
    }

    this.openNodeKeys.delete(nodeKey);
    for (const key of [...this.openNodeKeys]) {
      if (key.startsWith(`${nodeKey}/`)) {
        this.openNodeKeys.delete(key);
      }
    }
  }

  private async postNodeChildren(nodeId: string, node: MetadataNode | undefined): Promise<void> {
    if (!node || !this.view) {
      return;
    }

    this.rememberNodeState(nodeId, true);
    const parentKey = this.nodeKeyById.get(nodeId) ?? '';
    const children = this.services.treeProvider.getChildren(node);
    await this.view.webview.postMessage({
      type: 'childrenLoading',
      nodeId,
      total: children.length,
    });

    for (let start = 0; start < children.length; start += CHILDREN_RENDER_CHUNK_SIZE) {
      const chunk = children.slice(start, start + CHILDREN_RENDER_CHUNK_SIZE);
      const html = chunk
        .map((child, index) => this.renderTreeNode(
          this.view?.webview,
          child,
          this.getNodeDepth(nodeId) + 1,
          `${nodeId}_${String(start + index)}`,
          parentKey
        ))
        .join('');
      await this.view.webview.postMessage({
        type: 'childrenChunk',
        nodeId,
        html,
        append: start > 0,
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }

    await this.view.webview.postMessage({
      type: 'childrenLoaded',
      nodeId,
    });
  }

  private async selectNode(nodeId: string, node: MetadataNode | undefined): Promise<void> {
    const nodeKey = this.nodeKeyById.get(nodeId);
    if (!nodeKey) {
      return;
    }

    this.selectedNodeKey = nodeKey;
    this.openSelectedAncestors(nodeKey);
    await this.services.state.update(UniversalPanelViewProvider.selectedNodeStateKey, nodeKey);
    await this.executeTreeItemCommand(node);
  }

  private async executeTreeItemCommand(node: MetadataNode | undefined): Promise<void> {
    if (node && this.isFormEditorNode(node)) {
      return;
    }

    const command = node?.command;
    if (!command) {
      return;
    }

    await this.executeCommand(command.command, node);
  }

  private async clearSelectedNode(): Promise<void> {
    if (!this.selectedNodeKey) {
      return;
    }

    this.selectedNodeKey = undefined;
    await this.services.state.update(UniversalPanelViewProvider.selectedNodeStateKey, undefined);
  }

  private openSelectedAncestors(nodeKey: string): void {
    const parts = nodeKey.split('/');
    for (let index = 1; index < parts.length; index += 1) {
      this.openNodeKeys.add(parts.slice(0, index).join('/'));
    }
  }

  private async refreshChangedNode(node: MetadataNode | undefined | null): Promise<void> {
    if (!this.view) {
      return;
    }

    if (!node || this.services.treeProvider.getSearchQuery()) {
      this.refresh();
      return;
    }

    const rendered = this.findRenderedNodeOrAncestor(node);
    if (!rendered) {
      return;
    }

    const parentKey = this.getParentNodeKey(rendered.nodeId);
    const html = this.renderTreeNode(
      this.view.webview,
      rendered.node,
      this.getNodeDepth(rendered.nodeId),
      rendered.nodeId,
      parentKey
    );
    await this.view.webview.postMessage({
      type: 'nodeReplaced',
      nodeId: rendered.nodeId,
      html,
    });
  }

  private findRenderedNodeOrAncestor(node: MetadataNode): { node: MetadataNode; nodeId: string } | undefined {
    let current = node;
    for (;;) {
      const nodeId = this.nodeIdByNode.get(current);
      if (nodeId) {
        return { node: current, nodeId };
      }

      const parent = this.services.treeProvider.getParent(current);
      if (!this.isImmediateMetadataNode(parent)) {
        return undefined;
      }
      current = parent;
    }
  }

  private isImmediateMetadataNode(value: vscode.ProviderResult<MetadataNode>): value is MetadataNode {
    return Boolean(value) && typeof (value as { then?: unknown }).then !== 'function';
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const initialized = this.services.isProjectInitialized();
    const searchQuery = escapeHtml(this.services.treeProvider.getSearchQuery());
    const serverStatus = this.services.getStandaloneServerStatus();
    const processingState = this.services.getProcessingState();
    const bodyClass = [
      initialized ? 'initialized' : 'uninitialized',
      processingState.active ? 'processing' : '',
    ].filter(Boolean).join(' ');
    this.nodeById.clear();
    this.nodeKeyById.clear();
    this.nodeIdByNode = new WeakMap<MetadataNode, string>();

    return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      margin: 0;
      padding: 0;
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }

    .shell {
      display: flex;
      flex-direction: column;
      min-height: 100vh;
    }

    .processing .shell {
      filter: blur(2px);
      opacity: .62;
      pointer-events: none;
      user-select: none;
    }

    .processing-overlay {
      position: fixed;
      inset: 0;
      z-index: 20;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 20px;
      box-sizing: border-box;
      background: color-mix(in srgb, var(--vscode-sideBar-background) 64%, transparent);
    }

    .processing .processing-overlay {
      display: flex;
    }

    .processing-card {
      max-width: 240px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      color: var(--vscode-foreground);
      text-align: center;
    }

    .processing-spinner {
      width: 28px;
      height: 28px;
      border: 2px solid color-mix(in srgb, var(--vscode-foreground) 18%, transparent);
      border-top-color: var(--vscode-progressBar-background, var(--vscode-focusBorder));
      border-radius: 50%;
      animation: processing-spin 900ms linear infinite;
    }

    .processing-title {
      font-weight: 600;
      line-height: 1.25;
    }

    .processing-message {
      color: var(--vscode-descriptionForeground);
      line-height: 1.3;
    }

    @keyframes processing-spin {
      to {
        transform: rotate(360deg);
      }
    }

    .operations {
      flex: 0 0 auto;
      padding: 8px 10px 9px;
    }

    .actions,
    .standalone-actions {
      display: flex;
      align-items: center;
      gap: 3px;
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

    button:disabled {
      cursor: default;
      opacity: .5;
    }

    .icon {
      width: 16px;
      height: 16px;
      display: block;
      color: var(--vscode-icon-foreground);
    }

    .primary-action {
      width: 100%;
      height: auto;
      min-height: 30px;
      padding: 5px 10px;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      border-color: var(--vscode-button-border, transparent);
      justify-content: center;
    }

    .primary-action:hover {
      background: var(--vscode-button-hoverBackground);
    }

    .search {
      position: relative;
      margin-top: 8px;
      min-height: 26px;
    }

    input {
      width: 100%;
      height: 26px;
      box-sizing: border-box;
      padding: 0 30px 0 10px;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 5px;
      font: inherit;
      line-height: 24px;
      outline: none;
    }

    input:focus {
      border-color: var(--vscode-focusBorder);
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: -1px;
    }

    input::placeholder {
      color: var(--vscode-input-placeholderForeground);
      opacity: 1;
    }

    .clear {
      position: absolute;
      top: 1px;
      right: 4px;
      width: 24px;
      height: 24px;
    }

    .standalone {
      display: flex;
      flex-direction: column;
      gap: 5px;
      padding: 7px 0;
      margin-top: 7px;
      border-top: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border));
      border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border));
    }

    .standalone-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 7px;
      min-height: 18px;
    }

    .standalone-title {
      min-width: 0;
      font-weight: 600;
      color: var(--vscode-sideBarTitle-foreground, var(--vscode-foreground));
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .standalone-state {
      flex: 0 0 auto;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
    }

    .standalone-state.running {
      color: var(--vscode-testing-iconPassed, var(--vscode-descriptionForeground));
    }

    .standalone-state.stale,
    .standalone-state.unresponsive {
      color: var(--vscode-inputValidation-warningForeground, var(--vscode-descriptionForeground));
    }

    .standalone-state.busy {
      color: var(--vscode-progressBar-background, var(--vscode-descriptionForeground));
    }

    .initialization {
      display: none;
      flex-direction: column;
      gap: 8px;
    }

    .uninitialized .actions,
    .uninitialized .standalone,
    .uninitialized .search,
    .uninitialized .navigator {
      display: none;
    }

    .uninitialized .initialization {
      display: flex;
    }

    .init-title {
      font-weight: 600;
      color: var(--vscode-sideBarTitle-foreground, var(--vscode-foreground));
    }

    .init-text {
      color: var(--vscode-descriptionForeground);
      line-height: 1.35;
    }

    .navigator {
      flex: 1 1 auto;
      min-height: 0;
      overflow: auto;
      padding: 6px 4px 12px 0;
    }

    .tree-node {
      min-width: 0;
    }

    .tree-row,
    .tree-summary {
      min-height: 24px;
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 0 4px 0 0;
      box-sizing: border-box;
      user-select: none;
    }

    .tree-row:hover,
    .tree-summary:hover {
      background: var(--vscode-list-hoverBackground);
    }

    .tree-row.selected,
    .tree-summary.selected {
      background: var(--vscode-list-hoverBackground);
    }

    .tree-summary {
      position: relative;
      list-style: none;
      cursor: default;
      overflow: hidden;
    }

    .tree-summary::-webkit-details-marker {
      display: none;
    }

    details[data-loading="true"] > .tree-summary::after {
      content: '';
      position: absolute;
      inset: 0;
      pointer-events: none;
      background:
        linear-gradient(
          100deg,
          transparent 0%,
          color-mix(in srgb, var(--vscode-list-highlightForeground, var(--vscode-focusBorder)) 0%, transparent) 28%,
          color-mix(in srgb, var(--vscode-list-highlightForeground, var(--vscode-focusBorder)) 26%, transparent) 46%,
          color-mix(in srgb, var(--vscode-list-highlightForeground, var(--vscode-focusBorder)) 0%, transparent) 64%,
          transparent 100%
        );
      transform: translateX(-100%);
      animation: tree-loading-shimmer 980ms ease-in-out infinite;
    }

    details[data-loading="true"] > .tree-summary .tree-label {
      color: color-mix(in srgb, var(--vscode-foreground) 72%, var(--vscode-descriptionForeground));
    }

    @keyframes tree-loading-shimmer {
      to {
        transform: translateX(100%);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      details[data-loading="true"] > .tree-summary::after {
        animation: none;
        transform: none;
        background: color-mix(in srgb, var(--vscode-list-highlightForeground, var(--vscode-focusBorder)) 12%, transparent);
      }
    }

    .tree-toggle {
      width: 16px;
      height: 16px;
      flex: 0 0 16px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--vscode-icon-foreground);
    }

    .tree-toggle::before {
      content: '';
      width: 0;
      height: 0;
      border-top: 4px solid transparent;
      border-bottom: 4px solid transparent;
      border-left: 5px solid currentColor;
    }

    details[open] > .tree-summary .tree-toggle::before {
      transform: rotate(90deg);
    }

    .tree-spacer {
      width: 16px;
      flex: 0 0 16px;
    }

    .tree-icon {
      width: 16px;
      height: 16px;
      min-width: 16px;
      min-height: 16px;
      max-width: 16px;
      max-height: 16px;
      flex: 0 0 16px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    .tree-icon-img {
      width: 16px;
      height: 16px;
      min-width: 16px;
      min-height: 16px;
      max-width: 16px;
      max-height: 16px;
      display: block;
      object-fit: contain;
    }

    .tree-label {
      min-width: 0;
      flex: 1 1 auto;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      line-height: 24px;
      cursor: default;
    }

    .tree-row.git-added .tree-label,
    .tree-summary.git-added .tree-label {
      color: var(--vscode-gitDecoration-addedResourceForeground, var(--vscode-foreground));
    }

    .tree-row.git-modified .tree-label,
    .tree-summary.git-modified .tree-label {
      color: var(--vscode-gitDecoration-modifiedResourceForeground, var(--vscode-foreground));
    }

    .tree-row.git-deleted .tree-label,
    .tree-summary.git-deleted .tree-label {
      color: var(--vscode-gitDecoration-deletedResourceForeground, var(--vscode-foreground));
      text-decoration: line-through;
    }

    .empty {
      padding: 10px;
      color: var(--vscode-descriptionForeground);
      line-height: 1.35;
    }

    .state-icons {
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      gap: 3px;
      margin-left: 6px;
    }

    .inline-actions {
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      gap: 2px;
      margin-left: 4px;
      opacity: 0;
      pointer-events: none;
      transform: translateX(3px);
      transition: opacity 120ms ease-out, transform 120ms ease-out;
    }

    .tree-row:hover .inline-actions,
    .tree-summary:hover .inline-actions,
    .tree-row:focus-within .inline-actions,
    .tree-summary:focus-within .inline-actions {
      opacity: 1;
      pointer-events: auto;
      transform: translateX(0);
    }

    .inline-action {
      width: 22px;
      height: 22px;
      flex: 0 0 22px;
      border-radius: 5px;
    }

    .inline-action .icon {
      width: 14px;
      height: 14px;
      min-width: 14px;
      min-height: 14px;
      max-width: 14px;
      max-height: 14px;
      flex: 0 0 14px;
    }

    .state-icon {
      width: 16px;
      height: 16px;
      min-width: 16px;
      min-height: 16px;
      max-width: 16px;
      max-height: 16px;
      flex: 0 0 16px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--vscode-icon-foreground);
    }

    .state-icon-img {
      width: 16px;
      height: 16px;
      min-width: 16px;
      min-height: 16px;
      max-width: 16px;
      max-height: 16px;
      display: block;
      object-fit: contain;
    }

    .git-badge {
      min-width: 15px;
      height: 15px;
      padding: 0 3px;
      box-sizing: border-box;
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 600;
      line-height: 15px;
    }

    .git-badge.added {
      color: var(--vscode-gitDecoration-addedResourceForeground, var(--vscode-foreground));
      background: color-mix(in srgb, var(--vscode-gitDecoration-addedResourceForeground, #2ea043) 18%, transparent);
    }

    .git-badge.modified {
      color: var(--vscode-gitDecoration-modifiedResourceForeground, var(--vscode-foreground));
      background: color-mix(in srgb, var(--vscode-gitDecoration-modifiedResourceForeground, #d29922) 18%, transparent);
    }

    .git-badge.deleted {
      color: var(--vscode-gitDecoration-deletedResourceForeground, var(--vscode-foreground));
      background: color-mix(in srgb, var(--vscode-gitDecoration-deletedResourceForeground, #f85149) 18%, transparent);
    }

    .context-menu {
      position: fixed;
      z-index: 10;
      min-width: 190px;
      max-width: 320px;
      padding: 4px 0;
      border: 1px solid var(--vscode-menu-border, var(--vscode-panel-border));
      border-radius: 8px;
      color: var(--vscode-menu-foreground, var(--vscode-foreground));
      background: var(--vscode-menu-background, var(--vscode-editorWidget-background));
      box-shadow: 0 4px 12px var(--vscode-widget-shadow, rgba(0, 0, 0, .35));
      overflow: hidden;
    }

    .context-menu[hidden] {
      display: none;
    }

    .context-menu button {
      width: calc(100% - 8px);
      height: 26px;
      justify-content: flex-start;
      margin: 1px 4px;
      padding: 0 10px;
      border: 0;
      border-radius: 5px;
      color: inherit;
      text-align: left;
    }

    .context-menu button:hover {
      color: var(--vscode-menu-selectionForeground, var(--vscode-list-activeSelectionForeground));
      background: var(--vscode-menu-selectionBackground, var(--vscode-list-activeSelectionBackground));
      outline: none;
    }
  </style>
</head>
<body class="${bodyClass}">
  <div class="shell">
    <section class="operations" aria-label="Операции">
      <section class="initialization" aria-label="Инициализация проекта">
        <div class="init-title">Проект не инициализирован</div>
        <div class="init-text">Будут созданы env.json и минимальные каталоги src/cf, src/cfe.</div>
        <button class="primary-action" type="button" data-command="v8vscedit.initializeProject">Инициализировать проект</button>
      </section>
      ${this.renderOperations(webview, serverStatus)}
      <div class="search">
        <input id="search" type="text" value="${searchQuery}" placeholder="Поиск по метаданным" aria-label="Поиск по метаданным" autocomplete="off" spellcheck="false">
        <button id="clear" class="clear" type="button" title="Очистить поиск" aria-label="Очистить поиск">${closeIcon()}</button>
      </div>
    </section>
    <section class="navigator" aria-label="Навигатор метаданных">
      ${this.renderTree(webview)}
    </section>
    <div id="contextMenu" class="context-menu" hidden></div>
  </div>
  ${this.renderProcessingOverlay(processingState)}
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const search = document.getElementById('search');
    const clear = document.getElementById('clear');
    const contextMenu = document.getElementById('contextMenu');
    let searchTimer = undefined;
    let labelClickTimer = undefined;

    const sendSearch = () => {
      vscode.postMessage({ type: 'search', value: search ? search.value : '' });
    };

    const bindTree = (root) => {
      root.querySelectorAll('[data-command]').forEach((button) => {
        if (button.dataset.bound === 'true') return;
        button.dataset.bound = 'true';
        button.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          vscode.postMessage({
            type: 'command',
            command: button.dataset.command,
            nodeId: button.dataset.nodeId,
          });
        });
      });

      root.querySelectorAll('[data-node-row]').forEach((row) => {
        if (row.dataset.contextBound === 'true') return;
        row.dataset.contextBound = 'true';
        row.addEventListener('click', (event) => {
          if (event.target?.closest?.('.tree-toggle')) return;
          event.preventDefault();
          selectRow(row);
          vscode.postMessage({ type: 'selectNode', nodeId: row.dataset.nodeId });
        });
        row.addEventListener('keydown', (event) => {
          if (event.target?.closest?.('.tree-toggle')) return;
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          event.stopPropagation();
        });
        row.addEventListener('contextmenu', (event) => {
          const actions = parseActions(row.dataset.actions);
          if (actions.length === 0) return;
          event.preventDefault();
          event.stopPropagation();
          showContextMenu(event.clientX, event.clientY, row.dataset.nodeId, actions);
        });
      });

      root.querySelectorAll('[data-node-default]').forEach((label) => {
        if (label.dataset.bound === 'true') return;
        label.dataset.bound = 'true';
        label.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          window.clearTimeout(labelClickTimer);
          const nodeId = label.dataset.nodeDefault;
          const row = label.closest('[data-node-row]');
          if (row) selectRow(row);
          vscode.postMessage({ type: 'selectNode', nodeId });
        });
        label.addEventListener('dblclick', (event) => {
          event.preventDefault();
          event.stopPropagation();
          window.clearTimeout(labelClickTimer);
          vscode.postMessage({ type: 'nodeDefault', nodeId: label.dataset.nodeDefault });
        });
      });

      root.querySelectorAll('details[data-node-id]').forEach((details) => {
        if (details.dataset.bound === 'true') return;
        details.dataset.bound = 'true';
        const toggle = details.querySelector(':scope > summary .tree-toggle');
        toggle?.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          details.open = !details.open;
        });
        toggle?.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          event.stopPropagation();
          details.open = !details.open;
        });
        details.addEventListener('toggle', () => {
          clearSelection();
          vscode.postMessage({ type: 'toggleNode', nodeId: details.dataset.nodeId, open: details.open });
          if (!details.open || details.dataset.loaded === 'true' || details.dataset.loading === 'true') return;
          details.dataset.loading = 'true';
          details.setAttribute('aria-busy', 'true');
          vscode.postMessage({ type: 'loadChildren', nodeId: details.dataset.nodeId });
        });
      });
    };

    const parseActions = (raw) => {
      try {
        const parsed = JSON.parse(String(raw || '[]'));
        return Array.isArray(parsed)
          ? parsed.filter((item) => typeof item?.command === 'string' && typeof item?.title === 'string')
          : [];
      } catch {
        return [];
      }
    };

    const hideContextMenu = () => {
      if (!contextMenu) return;
      contextMenu.hidden = true;
      contextMenu.replaceChildren();
    };

    const selectRow = (row) => {
      document.querySelectorAll('[data-node-row].selected').forEach((item) => {
        item.classList.remove('selected');
        item.setAttribute('aria-selected', 'false');
      });
      row.classList.add('selected');
      row.setAttribute('aria-selected', 'true');
    };

    const clearSelection = () => {
      document.querySelectorAll('[data-node-row].selected').forEach((item) => {
        item.classList.remove('selected');
        item.setAttribute('aria-selected', 'false');
      });
    };

    const scrollSelectedIntoView = () => {
      document.querySelector('[data-node-row].selected')?.scrollIntoView({ block: 'center' });
    };

    const showContextMenu = (x, y, nodeId, actions) => {
      if (!contextMenu) return;
      contextMenu.replaceChildren();
      actions.forEach((action) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = action.title;
        button.addEventListener('click', () => {
          hideContextMenu();
          vscode.postMessage({ type: 'command', command: action.command, nodeId });
        });
        contextMenu.appendChild(button);
      });
      contextMenu.hidden = false;
      const width = contextMenu.offsetWidth;
      const height = contextMenu.offsetHeight;
      contextMenu.style.left = Math.max(4, Math.min(x, window.innerWidth - width - 4)) + 'px';
      contextMenu.style.top = Math.max(4, Math.min(y, window.innerHeight - height - 4)) + 'px';
    };

    bindTree(document);
    scrollSelectedIntoView();

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message?.type === 'searchState' && search) {
        search.value = message.value;
        return;
      }
      if (message?.type === 'childrenLoading') {
        const details = document.querySelector('details[data-node-id="' + CSS.escape(String(message.nodeId)) + '"]');
        const container = details?.querySelector(':scope > .tree-children');
        if (details) {
          details.dataset.loading = 'true';
          details.setAttribute('aria-busy', 'true');
        }
        if (container) container.replaceChildren();
        return;
      }
      if (message?.type === 'childrenChunk') {
        const details = document.querySelector('details[data-node-id="' + CSS.escape(String(message.nodeId)) + '"]');
        const container = details?.querySelector(':scope > .tree-children');
        if (!details || !container) return;
        if (!message.append) container.replaceChildren();
        const template = document.createElement('template');
        template.innerHTML = String(message.html ?? '').trim();
        container.append(template.content);
        bindTree(container);
        return;
      }
      if (message?.type === 'childrenLoaded') {
        const details = document.querySelector('details[data-node-id="' + CSS.escape(String(message.nodeId)) + '"]');
        if (!details) return;
        details.dataset.loaded = 'true';
        delete details.dataset.loading;
        details.removeAttribute('aria-busy');
        scrollSelectedIntoView();
        return;
      }
      if (message?.type !== 'nodeReplaced') return;
      const current = document.querySelector('.tree-node[data-node-id="' + CSS.escape(String(message.nodeId)) + '"]');
      if (!current) return;
      const template = document.createElement('template');
      template.innerHTML = String(message.html ?? '').trim();
      const next = template.content.firstElementChild;
      if (!next) return;
      current.replaceWith(next);
      bindTree(next);
      scrollSelectedIntoView();
    });

    document.addEventListener('click', hideContextMenu);
    document.addEventListener('scroll', hideContextMenu, true);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') hideContextMenu();
    });

    search?.addEventListener('input', () => {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(sendSearch, 400);
    });

    search?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      window.clearTimeout(searchTimer);
      sendSearch();
    });

    clear?.addEventListener('click', () => {
      window.clearTimeout(searchTimer);
      if (search) search.value = '';
      vscode.postMessage({ type: 'clearSearch' });
      search?.focus();
    });
  </script>
</body>
</html>`;
  }

  private renderOperations(webview: vscode.Webview, serverStatus: StandaloneServerStatus): string {
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
    return `
      <div class="actions">
        <button type="button" data-command="v8vscedit.importConfigurations" title="Импортировать конфигурации из базы" aria-label="Импортировать конфигурации из базы">${cloudDownloadIcon()}</button>
        <button type="button" data-command="v8vscedit.updateChangedConfigurations" title="Обновить изменённые конфигурации" aria-label="Обновить изменённые конфигурации">
          <picture><source srcset="${String(updateIconLight)}" media="(prefers-color-scheme: light)"><img class="icon" src="${String(updateIconDark)}" alt=""></picture>
        </button>
        <button type="button" data-command="v8vscedit.runThinClient" title="Запустить тонкий клиент" aria-label="Запустить тонкий клиент">${runIcon()}</button>
        <button type="button" data-command="v8vscedit.runConfigurator" title="Запустить конфигуратор" aria-label="Запустить конфигуратор">${toolsIcon()}</button>
        <button type="button" data-command="v8vscedit.configureEnvironment" title="Настройки проекта" aria-label="Настройки проекта">${settingsIcon()}</button>
        <button type="button" data-command="v8vscedit.installAiSkills" title="Установить ИИ-скилы 1С" aria-label="Установить ИИ-скилы 1С">${skillsIcon()}</button>
      </div>
      ${renderStandaloneServer(serverStatus)}
    `;
  }

  private renderProcessingOverlay(state: UniversalPanelProcessingState): string {
    if (!state.active) {
      return '';
    }

    const title = escapeHtml(state.title ?? 'Обработка дерева метаданных');
    const message = escapeHtml(state.message ?? 'Дождитесь завершения операции.');
    return `
      <div class="processing-overlay" role="status" aria-live="polite" aria-busy="true">
        <div class="processing-card">
          <div class="processing-spinner" aria-hidden="true"></div>
          <div class="processing-title">${title}</div>
          <div class="processing-message">${message}</div>
        </div>
      </div>
    `;
  }

  private renderTree(webview: vscode.Webview): string {
    const roots = this.services.treeProvider.getChildren();
    if (roots.length === 0) {
      return '<div class="empty">Метаданные не найдены.</div>';
    }
    return roots.map((node, index) => this.renderTreeNode(webview, node, 0, `n${String(index)}`, '')).join('');
  }

  private renderTreeNode(
    webview: vscode.Webview | undefined,
    node: MetadataNode,
    depth: number,
    id: string,
    parentKey: string
  ): string {
    this.services.treeProvider.getTreeItem(node);
    const nodeKey = this.buildNodeKey(node, parentKey);
    this.nodeById.set(id, node);
    this.nodeKeyById.set(id, nodeKey);
    this.nodeIdByNode.set(node, id);
    const hasChildren = Boolean(node.childrenLoader);
    const padding = 4 + depth * 14;
    const label = escapeHtml(node.textLabel);
    const actions = this.getNodeActions(node);
    const actionsJson = escapeHtml(JSON.stringify(actions.map((action) => ({
      command: action.command,
      title: action.title,
    }))));
    const gitStatus = this.resolveGitStatus(node);
    const gitClass = gitStatus ? ` git-${gitStatus}` : '';
    const stateIcons = this.renderStateIcons(webview, node.contextValue ?? '');
    const gitBadge = this.renderGitBadge(gitStatus);
    const inlineActions = this.renderInlineActions(node, id);
    const icon = this.renderNodeIcon(webview, node);
    const selected = this.selectedNodeKey === nodeKey;
    const selectedClass = selected ? ' selected' : '';
    const ariaSelected = selected ? 'true' : 'false';
    const open = this.openNodeKeys.has(nodeKey) || this.isSelectedAncestor(nodeKey);
    const childrenHtml = open
      ? this.services.treeProvider.getChildren(node)
        .map((child, index) => this.renderTreeNode(webview, child, depth + 1, `${id}_${String(index)}`, nodeKey))
        .join('')
      : '';

    if (!hasChildren) {
      return `
        <div class="tree-node" data-node-id="${escapeHtml(id)}">
          <div class="tree-row${gitClass}${selectedClass}" data-node-row="true" data-node-id="${escapeHtml(id)}" data-actions="${actionsJson}" aria-selected="${ariaSelected}" style="padding-left:${String(padding)}px">
            <span class="tree-spacer" aria-hidden="true"></span>
            ${icon}
            <span class="tree-label" title="${label}" data-node-default="${escapeHtml(id)}">${label}</span>
            ${inlineActions}
            ${stateIcons}
            ${gitBadge}
          </div>
        </div>
      `;
    }

    return `
      <details class="tree-node" data-node-id="${escapeHtml(id)}" data-loaded="${open ? 'true' : 'false'}" ${open ? 'open' : ''}>
        <summary class="tree-summary${gitClass}${selectedClass}" data-node-row="true" data-node-id="${escapeHtml(id)}" data-actions="${actionsJson}" aria-selected="${ariaSelected}" style="padding-left:${String(padding)}px">
          <span class="tree-toggle" role="button" tabindex="0" aria-label="Свернуть или развернуть"></span>
          ${icon}
          <span class="tree-label" title="${label}" data-node-default="${escapeHtml(id)}">${label}</span>
          ${inlineActions}
          ${stateIcons}
          ${gitBadge}
        </summary>
        <div class="tree-children">${childrenHtml}</div>
      </details>
    `;
  }

  private buildNodeKey(node: MetadataNode, parentKey: string): string {
    const context = node.metaContext;
    const segment = [
      node.nodeKind,
      node.textLabel,
      node.xmlPath ?? '',
      node.model.decorationPath ?? '',
      context?.ownerObjectXmlPath ?? '',
      context?.tabularSectionName ?? '',
      node.ownershipTag ?? '',
    ].map((part) => encodeURIComponent(part)).join('~');
    return parentKey ? `${parentKey}/${segment}` : segment;
  }

  private isSelectedAncestor(nodeKey: string): boolean {
    return Boolean(this.selectedNodeKey?.startsWith(`${nodeKey}/`));
  }

  private renderNodeIcon(webview: vscode.Webview | undefined, node: MetadataNode): string {
    if (!webview) {
      return '<span class="tree-icon" aria-hidden="true"></span>';
    }

    const iconUris = getIconUris(node.nodeKind, node.ownershipTag, this.extensionUri);
    const lightUri = webview.asWebviewUri(iconUris.light);
    const darkUri = webview.asWebviewUri(iconUris.dark);
    return `<picture class="tree-icon"><source srcset="${String(lightUri)}" media="(prefers-color-scheme: light)"><img class="tree-icon-img" src="${String(darkUri)}" alt=""></picture>`;
  }

  private renderStateIcons(webview: vscode.Webview | undefined, contextValue: string): string {
    if (!webview) {
      return '';
    }

    const icons: string[] = [];
    if (contextValue.includes('-support2')) {
      icons.push(this.renderThemeStateIcon(webview, 'support-locked', 'На поддержке, редактирование запрещено'));
    } else if (contextValue.includes('-support1')) {
      icons.push(this.renderThemeStateIcon(webview, 'support-editable', 'На поддержке, редактирование разрешено'));
    } else if (contextValue.includes('-support0')) {
      icons.push(this.renderThemeStateIcon(webview, 'support-none', 'Не на поддержке'));
    }

    if (contextValue.includes('-repoLocked')) {
      icons.push(`<span class="state-icon" title="Захвачено в хранилище">${lockIcon()}</span>`);
    } else if (contextValue.includes('-repoUnlocked')) {
      icons.push(`<span class="state-icon" title="Не захвачено в хранилище">${unlockIcon()}</span>`);
    } else if (contextValue.includes('-repoConnected')) {
      icons.push(`<span class="state-icon" title="Подключено к хранилищу">${databaseIcon()}</span>`);
    }

    if (contextValue.includes('-repoEditRestricted')) {
      icons.push(`<span class="state-icon" title="Редактирование запрещено хранилищем">${lockIcon()}</span>`);
    }

    if (icons.length === 0) {
      return '';
    }

    return `<span class="state-icons">${icons.join('')}</span>`;
  }

  private renderThemeStateIcon(webview: vscode.Webview, name: string, title: string): string {
    const lightUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'src', 'icons', 'light', `${name}.svg`));
    const darkUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'src', 'icons', 'dark', `${name}.svg`));
    return `<picture class="state-icon" title="${escapeHtml(title)}"><source srcset="${String(lightUri)}" media="(prefers-color-scheme: light)"><img class="state-icon-img" src="${String(darkUri)}" alt=""></picture>`;
  }

  private resolveGitStatus(node: MetadataNode): MetadataGitDecorationStatus | undefined {
    const target = this.resolveGitTarget(node);
    return target ? this.services.gitMetadataStatusService.getStatus(target) : undefined;
  }

  private resolveGitTarget(node: MetadataNode): MetadataGitDecorationTarget | undefined {
    if (node.model.gitDecorationTarget) {
      return node.model.gitDecorationTarget;
    }

    const resourcePath = node.model.decorationPath ?? node.xmlPath;
    if (!resourcePath) {
      return undefined;
    }

    return {
      kind: 'paths',
      ownerXmlPath: resourcePath,
      childKind: node.nodeKind,
      paths: [resourcePath],
    };
  }

  private renderGitBadge(status: MetadataGitDecorationStatus | undefined): string {
    switch (status) {
      case 'added':
        return '<span class="git-badge added" title="Добавлено в Git">A</span>';
      case 'modified':
        return '<span class="git-badge modified" title="Изменено в Git">M</span>';
      case 'deleted':
        return '<span class="git-badge deleted" title="Удалено в Git">D</span>';
      default:
        return '';
    }
  }

  private renderInlineActions(node: MetadataNode, nodeId: string): string {
    const contextValue = node.contextValue ?? '';
    const actions: TreeAction[] = [];
    if (contextValue.startsWith('extensions-root')) {
      actions.push({ command: 'v8vscedit.connectExtension', title: 'Подключить расширение', icon: plugIcon() });
    }
    if (node.addMetadataTarget) {
      actions.push({ command: 'v8vscedit.addMetadata', title: 'Добавить', icon: addIcon() });
    }

    if (actions.length === 0) {
      return '';
    }

    return `<span class="inline-actions">${actions.map((action) => `
      <button class="inline-action" type="button" data-command="${escapeHtml(action.command)}" data-node-id="${escapeHtml(nodeId)}" title="${escapeHtml(action.title)}" aria-label="${escapeHtml(action.title)}">${action.icon}</button>
    `).join('')}</span>`;
  }

  private getNodeActions(node: MetadataNode): TreeAction[] {
    const contextValue = node.contextValue ?? '';
    const actions: TreeAction[] = [];
    const add = (action: TreeAction) => {
      if (!actions.some((item) => item.command === action.command)) {
        actions.push(action);
      }
    };

    if (node.xmlPath && /^configuration-hasXml|^extension-hasXml/.test(contextValue)) {
      add({ command: 'v8vscedit.showConfigActions', title: 'Команды конфигурации/расширения', icon: toolsIcon() });
      add({ command: 'v8vscedit.importConfigurationFromDb', title: 'Импортировать из базы', icon: cloudDownloadIcon() });
      add({ command: 'v8vscedit.updateConfigurationInDb', title: 'Обновить в базе', icon: syncIcon() });
    }

    if (contextValue.startsWith('extensions-root')) {
      add({ command: 'v8vscedit.connectExtension', title: 'Подключить расширение', icon: plugIcon() });
    }

    if (contextValue.startsWith('extension-hasXml')) {
      add({ command: 'v8vscedit.compileAndUpdateExtensionInDb', title: 'Полное обновление расширения в БД', icon: uploadIcon() });
    }

    if (this.canBorrowToExtension(node, contextValue)) {
      add({ command: 'v8vscedit.borrowToExtension', title: 'Добавить в расширение', icon: addIcon() });
    }

    if (node.xmlPath) {
      add({ command: 'v8vscedit.openXmlFile', title: 'Открыть XML', icon: fileCodeIcon() });
    }

    this.addModuleActions(node, add);

    if (node.xmlPath && !node.hidePropertiesCommand) {
      add({ command: 'v8vscedit.showProperties', title: 'Свойства', icon: propertiesIcon() });
    }

    if (node.addMetadataTarget) {
      add({ command: 'v8vscedit.addMetadata', title: 'Добавить', icon: addIcon() });
    }

    if (node.canRemoveMetadata) {
      add({ command: 'v8vscedit.removeMetadata', title: 'Удалить', icon: trashIcon() });
    }

    if (contextValue.includes('-repoUnlocked')) {
      add({ command: 'v8vscedit.repository.lock', title: 'Захватить в хранилище', icon: lockIcon() });
    }

    if (contextValue.includes('-repoLocked')) {
      add({ command: 'v8vscedit.repository.unlock', title: 'Освободить в хранилище', icon: unlockIcon() });
    }

    if (/^(configuration|extension)-hasXml/.test(contextValue)) {
      this.addRepositoryRootActions(contextValue, add);
    }

    if (
      contextValue.includes('-repoConnected') &&
      !contextValue.startsWith('extensions-root') &&
      !contextValue.startsWith('group-common') &&
      !contextValue.startsWith('group-type')
    ) {
      add({ command: 'v8vscedit.repository.commit', title: 'Поместить в хранилище', icon: uploadIcon() });
      add({ command: 'v8vscedit.repository.update', title: 'Получить из хранилища', icon: cloudDownloadIcon() });
    }

    return actions;
  }

  private canBorrowToExtension(node: MetadataNode, contextValue: string): boolean {
    if (!node.xmlPath || !this.services.treeProvider.getEntries().some((entry) => entry.kind === 'cfe')) {
      return false;
    }

    return (
      this.isNodeFromMainConfiguration(node) &&
      !/^(configuration|extension|extensions-root|group-)/.test(contextValue) &&
      !contextValue.includes('-fromCfe') &&
      !contextValue.includes('-repoEditRestricted')
    );
  }

  private isNodeFromMainConfiguration(node: MetadataNode): boolean {
    const sourcePath = node.metaContext?.ownerObjectXmlPath ?? node.xmlPath;
    if (!sourcePath) {
      return false;
    }

    const entry = this.services.treeProvider.getEntries()
      .filter((item) => this.isSameOrInside(sourcePath, item.rootPath))
      .sort((left, right) => right.rootPath.length - left.rootPath.length)
      .at(0);

    return entry?.kind === 'cf';
  }

  private isSameOrInside(filePath: string, rootPath: string): boolean {
    const relative = path.relative(path.resolve(rootPath), path.resolve(filePath));
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  }

  private isFormEditorNode(node: MetadataNode): boolean {
    return node.nodeKind === 'Form' || node.nodeKind === 'CommonForm';
  }

  private async openFormEditor(node: MetadataNode): Promise<void> {
    const formXmlPath = this.resolveFormEditorXmlPath(node);
    if (!formXmlPath) {
      await vscode.window.showWarningMessage(`Файл формы не найден: ${node.textLabel}`);
      return;
    }

    await vscode.commands.executeCommand(
      'vscode.openWith',
      vscode.Uri.file(formXmlPath),
      FORM_EDITOR_VIEW_TYPE
    );
  }

  private resolveFormEditorXmlPath(node: MetadataNode): string | null {
    const ownerXmlPath = node.metaContext?.ownerObjectXmlPath ?? node.xmlPath;
    if (!ownerXmlPath) {
      return null;
    }

    const location = getObjectLocationFromXml(ownerXmlPath);
    const candidates = node.nodeKind === 'CommonForm'
      ? [path.join(location.objectDir, 'Ext', 'Form.xml')]
      : [path.join(location.objectDir, 'Forms', node.textLabel, 'Ext', 'Form.xml')];

    return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
  }

  private addRepositoryRootActions(contextValue: string, add: (action: TreeAction) => void): void {
    if (contextValue.includes('-repoDisconnected')) {
      add({ command: 'v8vscedit.repository.connect', title: 'Подключить к хранилищу', icon: plugIcon() });
    }

    add({ command: 'v8vscedit.repository.create', title: 'Создать хранилище', icon: databaseIcon() });

    if (!contextValue.includes('-repoConnected')) {
      return;
    }

    add({ command: 'v8vscedit.repository.disconnect', title: 'Отключить от хранилища', icon: disconnectIcon() });
    add({ command: 'v8vscedit.repository.addUser', title: 'Добавить пользователя хранилища', icon: personAddIcon() });
    add({ command: 'v8vscedit.repository.copyUsers', title: 'Скопировать пользователей', icon: organizationIcon() });
    add({ command: 'v8vscedit.repository.dump', title: 'Выгрузить конфигурацию из хранилища', icon: archiveIcon() });
    add({ command: 'v8vscedit.repository.report', title: 'Построить отчет по хранилищу', icon: graphIcon() });
    add({ command: 'v8vscedit.repository.setLabel', title: 'Установить метку версии', icon: tagIcon() });
  }

  private addModuleActions(node: MetadataNode, add: (action: TreeAction) => void): void {
    if (!node.xmlPath) {
      return;
    }

    // Команда одиночного клика (singleClickCommand из META_TYPES) — первой в меню
    if (node.command?.command) {
      add({ command: node.command.command, title: node.command.title, icon: codeIcon() });
    }

    // Остальные слоты берём из META_TYPES — единственного источника правды по модулям
    const def = (META_TYPES as Record<string, typeof META_TYPES[MetaKind] | undefined>)[node.nodeKind];
    for (const slot of def?.modules ?? []) {
      const action = MODULE_SLOT_ACTIONS[slot];
      if (action) {
        add({ command: action.command, title: action.title, icon: codeIcon() });
      }
    }
  }

  private getNodeDepth(nodeId: string): number {
    return nodeId.split('_').length - 1;
  }

  private getParentNodeKey(nodeId: string): string {
    const separatorIndex = nodeId.lastIndexOf('_');
    if (separatorIndex < 0) {
      return '';
    }

    const parentId = nodeId.slice(0, separatorIndex);
    return this.nodeKeyById.get(parentId) ?? '';
  }
}

function renderStandaloneServer(status: StandaloneServerStatus): string {
  if (!status.configured) {
    return `<section class="standalone" aria-label="Автономный сервер">
      <div class="standalone-header">
        <span class="standalone-title">Автономный сервер</span>
        <span class="standalone-state">не настроен</span>
      </div>
      <button class="primary-action" type="button" data-command="v8vscedit.standalone.configure">Настроить автономный сервер</button>
    </section>`;
  }

  const running = status.state === 'running';
  const busy = status.state === 'busy';
  return `<section class="standalone" aria-label="Автономный сервер">
    <div class="standalone-header">
      <span class="standalone-title">Автономный сервер</span>
      <span class="standalone-state ${status.state}">${escapeHtml(getStandaloneStateLabel(status.state))}</span>
    </div>
    <div class="standalone-actions">
      <button type="button" data-command="v8vscedit.standalone.start" title="Запустить автономный сервер" aria-label="Запустить автономный сервер"${running || busy ? ' disabled' : ''}>${runIcon()}</button>
      <button type="button" data-command="v8vscedit.standalone.restart" title="Перезапустить автономный сервер" aria-label="Перезапустить автономный сервер"${busy ? ' disabled' : ''}>${restartIcon()}</button>
      <button type="button" data-command="v8vscedit.standalone.stop" title="Остановить автономный сервер" aria-label="Остановить автономный сервер"${!running || busy ? ' disabled' : ''}>${stopIcon()}</button>
      <button type="button" data-command="v8vscedit.standalone.openWebClient" title="Открыть веб-клиент" aria-label="Открыть веб-клиент"${busy ? ' disabled' : ''}>${browserIcon()}</button>
      <button type="button" data-command="v8vscedit.standalone.showLog" title="Открыть лог автономного сервера" aria-label="Открыть лог автономного сервера">${logIcon()}</button>
      <button type="button" data-command="v8vscedit.standalone.configure" title="Настройки автономного сервера" aria-label="Настройки автономного сервера">${settingsIcon()}</button>
    </div>
  </section>`;
}

function getStandaloneStateLabel(state: StandaloneServerStatus['state']): string {
  switch (state) {
    case 'running':
      return 'запущен';
    case 'unresponsive':
      return 'нет HTTP';
    case 'busy':
      return 'операция';
    case 'stale':
      return 'pid устарел';
    case 'stopped':
      return 'остановлен';
    case 'unconfigured':
      return 'не настроен';
    default:
      return state;
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

function svg(path: string): string {
  return `<svg class="icon" viewBox="0 0 16 16" aria-hidden="true">${path}</svg>`;
}

function cloudDownloadIcon(): string {
  return svg('<path fill="currentColor" d="M5.5 14h5v-1h-5v1ZM8 12l3-3h-2V5H7v4H5l3 3Z"/><path fill="currentColor" d="M12.5 6.1A4.5 4.5 0 0 0 3.9 4.7 3.3 3.3 0 0 0 4.3 11H5v-1h-.7a2.3 2.3 0 0 1-.1-4.6l.4-.1.1-.4a3.5 3.5 0 0 1 6.8 1l.1.8.8.1A1.6 1.6 0 0 1 12.2 10H11v1h1.2a2.6 2.6 0 0 0 .3-4.9Z"/>');
}

function runIcon(): string {
  return svg('<path fill="currentColor" d="M4 2.5v11l9-5.5-9-5.5Zm1 1.8L11.1 8 5 11.7V4.3Z"/>');
}

function toolsIcon(): string {
  return svg('<path fill="currentColor" d="M14.1 4.1 12 6.2l-2.2-2.1L12 1.9A4 4 0 0 0 7.1 6.8L2 11.9A1.5 1.5 0 1 0 4.1 14l5.1-5.1a4 4 0 0 0 4.9-4.8ZM3.4 13.3a.5.5 0 1 1-.7-.7.5.5 0 0 1 .7.7Z"/>');
}

function settingsIcon(): string {
  return svg('<path fill="currentColor" d="M8.6 1.5H7.4l-.4 2a4.7 4.7 0 0 0-1.1.5L4.2 2.9l-.9.9 1.1 1.7c-.2.4-.4.7-.5 1.1l-2 .4v1.2l2 .4c.1.4.3.8.5 1.1l-1.1 1.7.9.9 1.7-1.1c.4.2.7.4 1.1.5l.4 2h1.2l.4-2c.4-.1.8-.3 1.1-.5l1.7 1.1.9-.9-1.1-1.7c.2-.4.4-.7.5-1.1l2-.4V7l-2-.4c-.1-.4-.3-.8-.5-1.1l1.1-1.7-.9-.9L10.1 4c-.4-.2-.7-.4-1.1-.5l-.4-2ZM8 5.5A2.5 2.5 0 1 1 8 10.5 2.5 2.5 0 0 1 8 5.5Z"/>');
}

function skillsIcon(): string {
  return svg('<path fill="currentColor" d="M3 2h4.5L10 4.5V14H3V2Zm1 1v10h5V5H7V3H4Zm6.8 1.2 1.1-2.2 1.1 2.2 2.2 1.1L13 6.4l-1.1 2.2-1.1-2.2-2.2-1.1 2.2-1.1Zm.8 1.1.3.6.3-.6.6-.3-.6-.3-.3-.6-.3.6-.6.3.6.3Z"/>');
}

function closeIcon(): string {
  return svg('<path fill="currentColor" d="M4.6 4 8 7.4 11.4 4l.6.6L8.6 8l3.4 3.4-.6.6L8 8.6 4.6 12l-.6-.6L7.4 8 4 4.6 4.6 4Z"/>');
}

function restartIcon(): string {
  return svg('<path fill="currentColor" d="M13 3v4H9l1.7-1.7A4 4 0 1 0 12 8h1a5 5 0 1 1-1.6-3.7L13 2.7V3Z"/>');
}

function stopIcon(): string {
  return svg('<path fill="currentColor" d="M4 4h8v8H4V4Z"/>');
}

function logIcon(): string {
  return svg('<path fill="currentColor" d="M3 2h10v12H3V2Zm1 1v10h8V3H4Zm1 2h6v1H5V5Zm0 2h6v1H5V7Zm0 2h4v1H5V9Z"/>');
}

function browserIcon(): string {
  return svg('<path fill="currentColor" d="M2 3h12v10H2V3Zm1 3v6h10V6H3Zm0-2v1h10V4H3Zm2 4h6v1H5V8Zm0 2h4v1H5v-1Z"/>');
}

function fileCodeIcon(): string {
  return svg('<path fill="currentColor" d="M3 2h6l4 4v8H3V2Zm1 1v10h8V7H8V3H4Zm5 .7V6h2.3L9 3.7ZM6.4 8.1 5.5 9l.9.9-.7.7L4.1 9l1.6-1.6.7.7Zm3.2 0 .7-.7L11.9 9l-1.6 1.6-.7-.7.9-.9-.9-.9Z"/>');
}

function codeIcon(): string {
  return svg('<path fill="currentColor" d="M5.4 4.4 1.8 8l3.6 3.6.7-.7L3.2 8l2.9-2.9-.7-.7Zm5.2 0-.7.7L12.8 8l-2.9 2.9.7.7L14.2 8l-3.6-3.6ZM7.4 12.7l-.9-.4 2.1-9 .9.4-2.1 9Z"/>');
}

function propertiesIcon(): string {
  return svg('<path fill="currentColor" d="M3 3h10v1H3V3Zm0 3h10v1H3V6Zm0 3h10v1H3V9Zm0 3h7v1H3v-1Z"/>');
}

function addIcon(): string {
  return svg('<path fill="currentColor" d="M7.5 2h1v5.5H14v1H8.5V14h-1V8.5H2v-1h5.5V2Z"/>');
}

function trashIcon(): string {
  return svg('<path fill="currentColor" d="M6 2h4l.5 1H13v1H3V3h2.5L6 2Zm-1.5 3h7l-.5 9H5l-.5-9Zm1.1 1 .4 7h4l.4-7H5.6Z"/>');
}

function syncIcon(): string {
  return svg('<path fill="currentColor" d="M13 3v4H9l1.6-1.6A3.8 3.8 0 0 0 4.5 7H3.4a4.8 4.8 0 0 1 8-2.3L13 3.1V3ZM3 13V9h4l-1.6 1.6A3.8 3.8 0 0 0 11.5 9h1.1a4.8 4.8 0 0 1-8 2.3L3 12.9V13Z"/>');
}

function lockIcon(): string {
  return svg('<path fill="currentColor" d="M5 7V5a3 3 0 1 1 6 0v2h1v7H4V7h1Zm1 0h4V5a2 2 0 1 0-4 0v2Zm-1 1v5h6V8H5Z"/>');
}

function unlockIcon(): string {
  return svg('<path fill="currentColor" d="M6 7h6v7H4V7h1V5a3 3 0 0 1 5.8-1H9.7A2 2 0 0 0 6 5v2Zm-1 1v5h6V8H5Z"/>');
}

function plugIcon(): string {
  return svg('<path fill="currentColor" d="M6 2h1v3h2V2h1v3.1A3.5 3.5 0 0 1 8.5 12v2h-1v-2A3.5 3.5 0 0 1 6 5.1V2Zm0 4v2.5a2.5 2.5 0 0 0 5 0V6H6Z"/>');
}

function uploadIcon(): string {
  return svg('<path fill="currentColor" d="M5.5 14h5v-1h-5v1ZM8 4 5 7h2v5h2V7h2L8 4Z"/><path fill="currentColor" d="M12.5 6.1A4.5 4.5 0 0 0 3.9 4.7 3.3 3.3 0 0 0 4.3 11H5v-1h-.7a2.3 2.3 0 0 1-.1-4.6l.4-.1.1-.4a3.5 3.5 0 0 1 6.8 1l.1.8.8.1A1.6 1.6 0 0 1 12.2 10H11v1h1.2a2.6 2.6 0 0 0 .3-4.9Z"/>');
}

function databaseIcon(): string {
  return svg('<path fill="currentColor" d="M8 2c3 0 5 .9 5 2v8c0 1.1-2 2-5 2s-5-.9-5-2V4c0-1.1 2-2 5-2Zm0 1C5.4 3 4 3.7 4 4s1.4 1 4 1 4-.7 4-1-1.4-1-4-1ZM4 5.4V8c0 .3 1.4 1 4 1s4-.7 4-1V5.4C11.1 5.8 9.7 6 8 6s-3.1-.2-4-.6Zm0 4V12c0 .3 1.4 1 4 1s4-.7 4-1V9.4c-.9.4-2.3.6-4 .6s-3.1-.2-4-.6Z"/>');
}

function disconnectIcon(): string {
  return svg('<path fill="currentColor" d="m3.7 3 9.3 9.3-.7.7L10 10.7A3.5 3.5 0 0 1 8.5 12v2h-1v-2A3.5 3.5 0 0 1 6 5.1V5L3 2l.7-.7ZM10 5.1A3.5 3.5 0 0 1 11.5 8c0 .6-.2 1.2-.4 1.7l-.8-.8c.1-.2.2-.5.2-.9V6H8.4l-1-1H9V2h1v3.1ZM6 2h1v2.3L6 3.3V2Z"/>');
}

function personAddIcon(): string {
  return svg('<path fill="currentColor" d="M6.5 8A2.5 2.5 0 1 1 6.5 3 2.5 2.5 0 0 1 6.5 8Zm0-1A1.5 1.5 0 1 0 6.5 4 1.5 1.5 0 0 0 6.5 7ZM2 13c.3-2.2 2-3.5 4.5-3.5 1 0 1.9.2 2.6.6l-.5.9c-.6-.3-1.3-.5-2.1-.5-1.8 0-3 .8-3.4 2.5H2Zm10-3V7h1v3h3v1h-3v3h-1v-3H9v-1h3Z"/>');
}

function organizationIcon(): string {
  return svg('<path fill="currentColor" d="M2 3h5v5H2V3Zm1 1v3h3V4H3Zm6-1h5v5H9V3Zm1 1v3h3V4h-3ZM2 10h5v4H2v-4Zm1 1v2h3v-2H3Zm6-1h5v4H9v-4Zm1 1v2h3v-2h-3Z"/>');
}

function archiveIcon(): string {
  return svg('<path fill="currentColor" d="M3 2h10v3h-1v9H4V5H3V2Zm1 1v1h8V3H4Zm1 2v8h6V5H5Zm1.5 2h3v1h-3V7Z"/>');
}

function graphIcon(): string {
  return svg('<path fill="currentColor" d="M3 13h11v1H2V2h1v11Zm1-2 3-3 2 2 4-5 .8.6L9.1 11.4 7 9.4l-2.3 2.3L4 11Z"/>');
}

function tagIcon(): string {
  return svg('<path fill="currentColor" d="M2 3.5V8l5.8 5.8 5-5L7 3H2Zm1 1h3.6l4.8 4.3-3.6 3.6L3 7.6V4.5ZM5 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/>');
}
