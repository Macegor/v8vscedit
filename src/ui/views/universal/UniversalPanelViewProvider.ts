import * as path from 'path';
import * as vscode from 'vscode';
import type {
  GitMetadataStatusService,
  MetadataGitDecorationStatus,
  MetadataGitDecorationTarget,
} from '../../../infra/git/GitMetadataStatusService';
import type { StandaloneServerStatus } from '../../../infra/standalone';
import { META_TYPES } from '../../../domain/MetaTypes';
import { getIconUris } from '../../tree/presentation/icon';
import { WebviewHtmlFactory } from '../webview/WebviewHtmlFactory';
import type { MetadataTreeProvider } from '../../tree/MetadataTreeProvider';
import type { MetadataNode } from '../../tree/TreeNode';

// ── DTO-типы (зеркалят src-ui/shared/types) ──

interface IconDto {
  readonly kind: 'codicon' | 'metadata' | 'asset' | 'none';
  readonly name?: string;
  readonly lightUri?: string;
  readonly darkUri?: string;
}

interface TreeNodeActionDto {
  readonly id: string;
  readonly label: string;
  readonly command: string;
  readonly icon?: IconDto;
}

interface TreeNodeStateIconDto {
  readonly title: string;
  readonly icon: IconDto;
}

interface TreeNodeDto {
  readonly id: string;
  readonly key: string;
  readonly label: string;
  readonly description?: string;
  readonly icon?: IconDto;
  readonly kind?: string;
  readonly ownership?: 'own' | 'borrowed' | 'unknown';
  readonly supportMode?: 'none' | 'editable' | 'locked';
  readonly hasChildren: boolean;
  readonly loaded: boolean;
  readonly children?: TreeNodeDto[];
  readonly actions: TreeNodeActionDto[];
  readonly inlineActions?: TreeNodeActionDto[];
  readonly stateIcons?: TreeNodeStateIconDto[];
  readonly gitStatus?: 'added' | 'modified' | 'deleted';
}

interface UniversalPanelState {
  readonly initialized: boolean;
  readonly processing: boolean;
  readonly processingTitle?: string;
  readonly processingMessage?: string;
  readonly searchQuery: string;
  readonly openNodeIds: readonly string[];
  readonly selectedNodeId?: string;
  readonly rootNodes: readonly TreeNodeDto[];
  readonly standaloneStatus: {
    readonly configured: boolean;
    readonly state: string;
    readonly port?: number;
    readonly pid?: number;
    readonly name?: string;
  };
}

interface UniversalPanelServices {
  readonly state: vscode.Memento;
  readonly treeProvider: MetadataTreeProvider;
  readonly setTreeMessage: (message: string | undefined) => void;
  readonly isProjectInitialized: () => boolean;
  readonly getStandaloneServerStatus: () => StandaloneServerStatus;
  readonly refreshStandaloneServerStatus: () => Promise<StandaloneServerStatus>;
  readonly getProcessingState: () => UniversalPanelProcessingState;
  readonly gitMetadataStatusService: GitMetadataStatusService;
  readonly refreshActionsView: () => void;
}

export interface UniversalPanelProcessingState {
  readonly active: boolean;
  readonly title?: string;
  readonly message?: string;
}

// ── Сообщения от webview (формат MessageBus / UiToHostMessage) ──

interface WebviewMessage {
  readonly type: 'ready' | 'refresh' | 'command' | 'request';
  readonly command?: string;
  readonly requestId?: string;
  readonly name?: string;
  readonly payload?: unknown;
}

// ── Действия слотов модулей ──

interface TreeAction {
  readonly command: string;
  readonly title: string;
  readonly icon: IconDto;
}

const MODULE_SLOT_ACTIONS: Partial<Record<string, { command: string; title: string; icon: IconDto }>> = {
  Object:       { command: 'v8vscedit.openObjectModule',    title: 'Открыть модуль объекта',   icon: codicon('code') },
  Manager:      { command: 'v8vscedit.openManagerModule',   title: 'Открыть модуль менеджера', icon: codicon('code') },
  ValueManager: { command: 'v8vscedit.openConstantModule',  title: 'Открыть модуль константы', icon: codicon('code') },
  RecordSet:    { command: 'v8vscedit.openRecordSetModule', title: 'Открыть модуль записи',    icon: codicon('code') },
  Service:      { command: 'v8vscedit.openServiceModule',   title: 'Открыть модуль сервиса',   icon: codicon('code') },
  CommonModule: { command: 'v8vscedit.openCommonModuleCode', title: 'Открыть модуль',          icon: codicon('code') },
  CommonCommand:{ command: 'v8vscedit.openCommandModule',   title: 'Открыть модуль команды',   icon: codicon('code') },
  CommonForm:   { command: 'v8vscedit.openFormModule',      title: 'Открыть модуль формы',     icon: codicon('code') },
  ChildForm:    { command: 'v8vscedit.openFormModule',      title: 'Открыть модуль формы',     icon: codicon('code') },
  ChildCommand: { command: 'v8vscedit.openCommandModule',   title: 'Открыть модуль команды',   icon: codicon('code') },
};

const CHILDREN_CHUNK_SIZE = 40;
const PASSIVE_NODE_ACTIONS = new Set<string>([
  'v8vscedit.showProperties',
  'v8vscedit.openXmlFile',
  'v8vscedit.openObjectModule',
  'v8vscedit.openManagerModule',
  'v8vscedit.openConstantModule',
  'v8vscedit.openRecordSetModule',
  'v8vscedit.openServiceModule',
  'v8vscedit.openCommonModuleCode',
  'v8vscedit.openCommandModule',
  'v8vscedit.openFormModule',
]);

/**
 * Универсальная панель — основной навигатор метаданных на Vue.
 * Генерирует HTML через renderVueWebviewHtml, передаёт состояние дерева как TreeNodeDto[].
 */
export class UniversalPanelViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewType = 'v8vsceditUniversal';
  private static readonly selectedNodeStateKey = 'v8vscedit.universalPanel.selectedNodeKey';

  private view: vscode.WebviewView | undefined;
  private readonly nodeById = new Map<string, MetadataNode>();
  private readonly nodeKeyById = new Map<string, string>();
  private readonly openNodeKeys = new Set<string>();
  private readonly treeListener: vscode.Disposable;
  private viewDisposables: vscode.Disposable[] = [];
  private selectedNodeKey: string | undefined;
  private cachedRootNodes: TreeNodeDto[] = [];
  private currentOpenNodeIds = new Set<string>();
  private currentSelectedNodeId: string | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly services: UniversalPanelServices
  ) {
    this.selectedNodeKey = services.state.get<string>(UniversalPanelViewProvider.selectedNodeStateKey);
    this.treeListener = this.services.treeProvider.onDidChangeTreeData(() => {
      this.refresh();
    });
  }

  // ── WebviewViewProvider ──

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    // View может пересоздаваться (сворачивание/разворачивание контейнера),
    // поэтому освобождаем подписки прошлого экземпляра, чтобы они не накапливались.
    this.disposeViewSubscriptions();
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'dist', 'ui'),
        this.extensionUri,
      ],
    };

    webviewView.webview.html = this.buildHtml(webviewView.webview);
    this.viewDisposables.push(
      webviewView.webview.onDidReceiveMessage((message: WebviewMessage) => {
        void this.handleMessage(message);
      }),
      webviewView.onDidDispose(() => {
        this.view = undefined;
        this.disposeViewSubscriptions();
      })
    );
  }

  private disposeViewSubscriptions(): void {
    for (const disposable of this.viewDisposables) {
      disposable.dispose();
    }
    this.viewDisposables = [];
  }

  refresh(): void {
    if (this.view) {
      this.postState();
    }
  }

  dispose(): void {
    this.treeListener.dispose();
    this.disposeViewSubscriptions();
  }

  // ── HTML (Vue) ──

  private buildHtml(webview: vscode.Webview): string {
    const factory = new WebviewHtmlFactory(this.extensionUri);
    return factory.renderVueWebviewHtml({
      webview,
      title: 'Метаданные',
      entry: 'universal',
      viewKind: 'universal',
      initialState: this.buildInitialState(),
      csp: { allowStyles: true, allowImages: true },
    });
  }

  private buildInitialState(): UniversalPanelState {
    this.nodeById.clear();
    this.nodeKeyById.clear();
    this.cachedRootNodes = this.buildRootNodes();
    const processingState = this.services.getProcessingState();
    return {
      initialized: this.services.isProjectInitialized(),
      processing: processingState.active,
      processingTitle: processingState.title,
      processingMessage: processingState.message,
      searchQuery: this.services.treeProvider.getSearchQuery(),
      openNodeIds: [...this.currentOpenNodeIds],
      selectedNodeId: this.currentSelectedNodeId,
      rootNodes: this.cachedRootNodes,
      standaloneStatus: this.toStatusDto(this.services.getStandaloneServerStatus()),
    };
  }

  private postState(): void {
    if (!this.view) {return;}
    this.cachedRootNodes = this.buildRootNodes();
    const processingState = this.services.getProcessingState();
    void this.view.webview.postMessage({
      type: 'state',
      state: {
        initialized: this.services.isProjectInitialized(),
        processing: processingState.active,
        processingTitle: processingState.title,
        processingMessage: processingState.message,
        searchQuery: this.services.treeProvider.getSearchQuery(),
        openNodeIds: [...this.currentOpenNodeIds],
        selectedNodeId: this.currentSelectedNodeId,
        rootNodes: this.cachedRootNodes,
        standaloneStatus: this.toStatusDto(this.services.getStandaloneServerStatus()),
      },
    });
  }

  // ── Сообщения от webview ──

  private async handleMessage(msg: WebviewMessage): Promise<void> {
    if (this.services.getProcessingState().active) {return;}

    if (msg.type === 'command') {
      await this.handleCommand(msg.command ?? '', msg.payload);
      return;
    }

    if (msg.type === 'request') {
      await this.handleRequest(msg.name ?? '', msg.requestId ?? '', msg.payload);
    }
  }

  private async handleCommand(command: string, payload?: unknown): Promise<void> {
    const p = payload as { nodeId?: string; actionId?: string } | undefined;

    // Выбор узла
    if (command === 'selectNode' && p?.nodeId) {
      await this.selectNode(p.nodeId);
      return;
    }

    if (command === 'nodeDefault' && p?.nodeId) {
      await this.executeNodeDefault(p.nodeId);
      return;
    }

    if (command === 'toggleNode' && p?.nodeId) {
      this.rememberNodeState(p.nodeId, Boolean((payload as { open?: boolean } | undefined)?.open));
      return;
    }

    // Действие узла (контекстное меню / inline-кнопка)
    if (command === 'executeNodeAction' && p?.nodeId && p.actionId) {
      const node = this.nodeById.get(p.nodeId);
      if (node) {
        await this.executeCommand(p.actionId, node);
        if (!PASSIVE_NODE_ACTIONS.has(p.actionId)) {
          this.services.refreshActionsView();
        }
      }
      return;
    }

    // Остальные команды — прямой вызов VS Code
    try {
      const node = p?.nodeId ? this.nodeById.get(p.nodeId) : undefined;
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

  private async handleRequest(name: string, _requestId: string, payload?: unknown): Promise<void> {
    const p = payload as { nodeId?: string; query?: string } | undefined;

    if (name === 'loadChildren' && p?.nodeId) {
      await this.loadChildren(p.nodeId);
      return;
    }

    if (name === 'search') {
      const query = typeof payload === 'string' ? payload : (p?.query ?? '');
      this.applySearch(query);
      this.postState();
      return;
    }

    if (name === 'refreshStandaloneStatus') {
      const status = await this.services.refreshStandaloneServerStatus();
      await this.postStandaloneStatus(status);
    }
  }

  private async postStandaloneStatus(status = this.services.getStandaloneServerStatus()): Promise<void> {
    await this.view?.webview.postMessage({
      type: 'standaloneStatus',
      status: this.toStatusDto(status),
    });
  }

  // ── Построение дерева ──

  private buildRootNodes(): TreeNodeDto[] {
    const roots = this.services.treeProvider.getChildren();
    this.nodeById.clear();
    this.nodeKeyById.clear();
    this.currentOpenNodeIds = new Set<string>();
    this.currentSelectedNodeId = undefined;
    return roots.map((node, i) => this.toDto(node, 0, `n${String(i)}`, ''));
  }

  private toDto(node: MetadataNode, depth: number, id: string, parentKey: string): TreeNodeDto {
    this.services.treeProvider.getTreeItem(node);
    const nodeKey = this.buildNodeKey(node, parentKey);
    this.nodeById.set(id, node);
    this.nodeKeyById.set(id, nodeKey);

    const hasChildren = Boolean(node.childrenLoader);
    const ctxValue = node.contextValue ?? '';
    const open = this.openNodeKeys.has(nodeKey) || this.isSelectedAncestor(nodeKey);
    const selected = this.selectedNodeKey === nodeKey;
    if (open) {
      this.currentOpenNodeIds.add(id);
    }
    if (selected) {
      this.currentSelectedNodeId = id;
    }

    // Дети загружаем сразу, если узел открыт (как в старом коде)
    let children: TreeNodeDto[] | undefined;
    let loaded = false;
    if (open && hasChildren) {
      const raw = this.services.treeProvider.getChildren(node);
      children = raw.map((child, i) => this.toDto(child, depth + 1, `${id}_${String(i)}`, nodeKey));
      loaded = true;
    }

    return {
      id,
      key: nodeKey,
      label: node.textLabel,
      description: this.nodeDescription(node),
      icon: this.buildIcon(node),
      kind: node.nodeKind,
      ownership: this.ownership(node),
      supportMode: this.supportMode(ctxValue),
      hasChildren,
      loaded,
      children,
      actions: this.buildActions(node),
      inlineActions: this.buildInlineActions(node),
      stateIcons: this.buildStateIcons(node),
      gitStatus: this.resolveGitStatus(node),
    };
  }

  private nodeDescription(node: MetadataNode): string | undefined {
    if (node.ownershipTag) {
      return undefined;
    }
    return typeof node.description === 'string' ? node.description : undefined;
  }

  private buildIcon(node: MetadataNode): IconDto {
    try {
      const iconUris = getIconUris(node.nodeKind, node.ownershipTag, this.extensionUri);
      const lightUri = this.view?.webview.asWebviewUri(iconUris.light).toString();
      const darkUri = this.view?.webview.asWebviewUri(iconUris.dark).toString();
      if (!lightUri || !darkUri) {
        return { kind: 'none' };
      }
      return { kind: 'asset', lightUri, darkUri };
    } catch {
      return { kind: 'none' };
    }
  }

  private ownership(node: MetadataNode): 'own' | 'borrowed' | 'unknown' {
    if (node.ownershipTag === 'OWN') {return 'own';}
    if (node.ownershipTag === 'BORROWED') {return 'borrowed';}
    return 'unknown';
  }

  private supportMode(ctx: string): 'none' | 'editable' | 'locked' {
    if (ctx.includes('-support2')) {return 'locked';}
    if (ctx.includes('-support1')) {return 'editable';}
    return 'none';
  }

  /** Действия узла повторяют меню старой HTML-панели из main. */
  private buildActions(node: MetadataNode): TreeNodeActionDto[] {
    const raw = this.getNodeActions(node);
    return raw.map((a) => ({ id: a.command, label: a.title, command: a.command, icon: a.icon }));
  }

  private buildInlineActions(node: MetadataNode): TreeNodeActionDto[] {
    const contextValue = node.contextValue ?? '';
    const actions: TreeAction[] = [];
    if (contextValue.startsWith('extensions-root')) {
      actions.push({ command: 'v8vscedit.connectExtension', title: 'Подключить расширение', icon: codicon('plug') });
    }
    if (node.addMetadataTarget) {
      actions.push({ command: 'v8vscedit.addMetadata', title: 'Добавить', icon: codicon('add') });
    }
    return actions.map((action) => ({
      id: action.command,
      label: action.title,
      command: action.command,
      icon: action.icon,
    }));
  }

  private buildStateIcons(node: MetadataNode): TreeNodeStateIconDto[] {
    const contextValue = node.contextValue ?? '';
    const result: TreeNodeStateIconDto[] = [];
    if (contextValue.includes('-support2')) {
      result.push(this.themeStateIcon('support-locked', 'На поддержке, редактирование запрещено'));
    } else if (contextValue.includes('-support1')) {
      result.push(this.themeStateIcon('support-editable', 'На поддержке, редактирование разрешено'));
    } else if (contextValue.includes('-support0')) {
      result.push(this.themeStateIcon('support-none', 'Не на поддержке'));
    }

    if (contextValue.includes('-repoLocked')) {
      result.push({ title: 'Захвачено в хранилище', icon: codicon('lock') });
    } else if (contextValue.includes('-repoUnlocked')) {
      result.push({ title: 'Не захвачено в хранилище', icon: codicon('unlock') });
    } else if (contextValue.includes('-repoConnected')) {
      result.push({ title: 'Подключено к хранилищу', icon: codicon('database') });
    }

    if (contextValue.includes('-repoEditRestricted')) {
      result.push({ title: 'Редактирование запрещено хранилищем', icon: codicon('lock') });
    }

    return result;
  }

  private themeStateIcon(name: string, title: string): TreeNodeStateIconDto {
    const lightUri = this.view?.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'src', 'icons', 'light', `${name}.svg`)
    ).toString();
    const darkUri = this.view?.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'src', 'icons', 'dark', `${name}.svg`)
    ).toString();
    if (!lightUri || !darkUri) {
      return { title, icon: { kind: 'none' } };
    }
    return { title, icon: { kind: 'asset', lightUri, darkUri } };
  }

  private buildNodeKey(node: MetadataNode, parentKey: string): string {
    const ctx = node.metaContext;
    const segment = [
      node.nodeKind,
      node.textLabel,
      node.xmlPath ?? '',
      node.model.decorationPath ?? '',
      ctx?.ownerObjectXmlPath ?? '',
      ctx?.tabularSectionName ?? '',
      node.ownershipTag ?? '',
    ].map((p) => encodeURIComponent(p)).join('~');
    return parentKey ? `${parentKey}/${segment}` : segment;
  }

  // ── Загрузка детей (ленивая — если не загружены при начальном рендере) ──

  private async loadChildren(nodeId: string): Promise<void> {
    const node = this.nodeById.get(nodeId);
    if (!node || !this.view) {return;}

    this.rememberNodeState(nodeId, true);
    const raw = this.services.treeProvider.getChildren(node);
    const depth = this.nodeDepth(nodeId);
    const parentKey = this.nodeKeyById.get(nodeId) ?? '';
    if (raw.length === 0) {
      await this.view.webview.postMessage({
        type: 'childrenLoaded',
        nodeId,
        children: [],
        append: false,
        done: true,
      });
      return;
    }

    for (let offset = 0; offset < raw.length; offset += CHILDREN_CHUNK_SIZE) {
      const chunk = raw
        .slice(offset, offset + CHILDREN_CHUNK_SIZE)
        .map((child, index) => this.toDto(child, depth + 1, `${nodeId}_${String(offset + index)}`, parentKey));
      await this.view.webview.postMessage({
        type: 'childrenLoaded',
        nodeId,
        children: chunk,
        append: offset > 0,
        done: offset + CHILDREN_CHUNK_SIZE >= raw.length,
      });
      if (offset + CHILDREN_CHUNK_SIZE < raw.length) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
  }

  // ── Выбор узла ──

  private async selectNode(nodeId: string): Promise<void> {
    const nodeKey = this.nodeKeyById.get(nodeId);
    if (!nodeKey) {return;}

    this.selectedNodeKey = nodeKey;
    this.openSelectedAncestors(nodeKey);
    void this.services.state
      .update(UniversalPanelViewProvider.selectedNodeStateKey, nodeKey)
      .then(undefined, () => undefined);

    const node = this.nodeById.get(nodeId);
    if (!node) {return;}
    // Сначала показываем свойства — DynamicPanelController ставит окно приоритета,
    // и последующие программные события активного редактора не перебьют state.
    if (node.xmlPath && !node.hidePropertiesCommand) {
      await this.executeCommand('v8vscedit.showProperties', node);
    }
    if (node.command) {
      // Связанный документ (модуль/XML) открываем без перехвата фокуса:
      // курсор остаётся в боковой панели, свойства видны, а при клике в редактор
      // пользователем — динамическая панель переключится на структуру модуля.
      await this.executeCommand(node.command.command, node, { preserveFocus: true });
    }
  }

  private async executeNodeDefault(nodeId: string): Promise<void> {
    const node = this.nodeById.get(nodeId);
    if (!node?.xmlPath) {
      return;
    }
    // Двойной клик по подсистеме открывает полноценный редактор (состав, дочерние подсистемы).
    if (node.nodeKind === 'Subsystem') {
      await this.executeCommand('v8vscedit.openSubsystemEditor', node);
      return;
    }
    await this.executeCommand('v8vscedit.showProperties', node);
  }

  private async executeCommand(command: string, node?: MetadataNode, options?: Record<string, unknown>): Promise<void> {
    try {
      if (node) {
        if (options !== undefined) {
          await vscode.commands.executeCommand(command, node, options);
        } else {
          await vscode.commands.executeCommand(command, node);
        }
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
    if (!nodeKey) {return;}
    if (open) {
      this.openNodeKeys.add(nodeKey);
    } else {
      this.openNodeKeys.delete(nodeKey);
      for (const k of [...this.openNodeKeys]) {
        if (k.startsWith(`${nodeKey}/`)) {this.openNodeKeys.delete(k);}
      }
    }
  }

  private openSelectedAncestors(nodeKey: string): void {
    const parts = nodeKey.split('/');
    for (let i = 1; i < parts.length; i += 1) {
      this.openNodeKeys.add(parts.slice(0, i).join('/'));
    }
  }

  private isSelectedAncestor(nodeKey: string): boolean {
    return Boolean(this.selectedNodeKey?.startsWith(`${nodeKey}/`));
  }

  private nodeDepth(nodeId: string): number {
    return nodeId.split('_').length - 1;
  }

  // ── Поиск ──

  private applySearch(value: string): void {
    const query = value.trim();
    this.services.treeProvider.setSearchQuery(query);
    const hasSearch = query.length > 2;
    void vscode.commands.executeCommand('setContext', 'v8vscedit.hasTreeSearch', hasSearch);
    this.services.setTreeMessage(hasSearch ? `Поиск: ${query}` : undefined);
    this.services.refreshActionsView();
  }

  // ── Статус автономного сервера ──

  private toStatusDto(status: StandaloneServerStatus): UniversalPanelState['standaloneStatus'] {
    return {
      configured: status.configured,
      state: status.state,
      port: status.settings.httpPort,
      pid: status.pid ?? undefined,
      name: status.settings.name,
    };
  }

  // ═══════════════════════════════════════════════════════
  // Ниже — методы из оригинального провайдера (логика действий)
  // ═══════════════════════════════════════════════════════

  private getNodeActions(node: MetadataNode): TreeAction[] {
    const ctxValue = node.contextValue ?? '';
    const actions: TreeAction[] = [];
    const add = (command: string, title: string, icon: IconDto) => {
      if (!actions.some((a) => a.command === command)) {actions.push({ command, title, icon });}
    };

    if (node.xmlPath && /^configuration-hasXml|^extension-hasXml/.test(ctxValue)) {
      add('v8vscedit.configuration.info', 'Информация', codicon('info'));
      add('v8vscedit.configuration.validate', 'Валидировать', codicon('check'));
      add('v8vscedit.showConfigActions', 'Команды конфигурации/расширения', codicon('tools'));
      add('v8vscedit.importConfigurationFromDb', 'Импортировать из базы', codicon('cloud-download'));
      add('v8vscedit.updateConfigurationInDb', 'Обновить в базе', codicon('sync'));
    }
    if (ctxValue.startsWith('extensions-root')) {
      add('v8vscedit.connectExtension', 'Подключить расширение', codicon('plug'));
    }
    if (ctxValue.startsWith('extension-hasXml')) {
      add('v8vscedit.compileAndUpdateExtensionInDb', 'Полное обновление расширения в БД', codicon('cloud-upload'));
      add('v8vscedit.cfe.analyzeExtension', 'Анализ расширения', codicon('inspect'));
    }
    if (this.canAddCfeInterceptor(node, ctxValue)) {
      add('v8vscedit.cfe.addMethodInterceptor', 'Добавить перехватчик', codicon('symbol-method'));
    }
    if (this.canBorrow(node, ctxValue)) {
      add('v8vscedit.borrowToExtension', 'Добавить в расширение', codicon('add'));
    }
    if (node.xmlPath) {
      if (!/^(configuration|extension)-hasXml/.test(ctxValue)) {
        add('v8vscedit.metadata.info', 'Структура объекта', codicon('info'));
        add('v8vscedit.metadata.validate', 'Валидировать объект', codicon('check'));
      }
      if (node.nodeKind === 'Role') {
        add('v8vscedit.role.info', 'Права роли', codicon('shield'));
        add('v8vscedit.role.validate', 'Валидировать роль', codicon('verified'));
      }
      if (node.nodeKind === 'Subsystem') {
        add('v8vscedit.subsystem.info', 'Информация о подсистеме', codicon('symbol-namespace'));
        add('v8vscedit.subsystem.validate', 'Валидировать подсистему', codicon('verified'));
        add('v8vscedit.interface.validate', 'Валидировать командный интерфейс', codicon('list-tree'));
      }
      if (node.nodeKind === 'Template' || node.nodeKind === 'CommonTemplate') {
        add('v8vscedit.mxl.info', 'MXL: структура', codicon('table'));
        add('v8vscedit.mxl.validate', 'MXL: валидировать', codicon('check'));
        add('v8vscedit.skd.info', 'СКД: структура', codicon('symbol-structure'));
        add('v8vscedit.skd.validate', 'СКД: валидировать', codicon('verified'));
      }
      if (node.nodeKind === 'Form' || node.nodeKind === 'CommonForm') {
        add('v8vscedit.form.info', 'Форма: структура', codicon('symbol-structure'));
        add('v8vscedit.form.validate', 'Форма: валидировать', codicon('verified'));
      }
      if (this.canAddHelp(node)) {
        add('v8vscedit.help.add', 'Добавить справку', codicon('book'));
      }
      if (node.nodeKind !== 'Form' && node.nodeKind !== 'CommonForm' && this.canAddForm(node)) {
        add('v8vscedit.form.add', 'Добавить форму', codicon('window'));
      }
      if (node.nodeKind === 'DataProcessor' || node.nodeKind === 'Report') {
        add('v8vscedit.epf.bspInit', 'БСП: регистрация', codicon('symbol-key'));
        add('v8vscedit.epf.bspAddCommand', 'БСП: добавить команду', codicon('add'));
      }
      add('v8vscedit.openXmlFile', 'Открыть XML', codicon('file-code'));
    }
    this.addModuleActions(node, add);
    if (node.xmlPath && !node.hidePropertiesCommand) {
      add('v8vscedit.showProperties', 'Свойства', codicon('list-unordered'));
    }
    if (node.addMetadataTarget) {
      add('v8vscedit.addMetadata', 'Добавить', codicon('add'));
    }
    if (node.canRemoveMetadata) {
      add('v8vscedit.removeMetadata', 'Удалить', codicon('trash'));
    }
    if (ctxValue.includes('-repoUnlocked')) {
      add('v8vscedit.repository.lock', 'Захватить в хранилище', codicon('lock'));
    }
    if (ctxValue.includes('-repoLocked')) {
      add('v8vscedit.repository.unlock', 'Освободить в хранилище', codicon('unlock'));
    }
    if (/^(configuration|extension)-hasXml/.test(ctxValue)) {
      this.addRepoRootActions(ctxValue, add);
    }
    if (
      ctxValue.includes('-repoConnected') &&
      !ctxValue.startsWith('extensions-root') &&
      !ctxValue.startsWith('group-common') &&
      !ctxValue.startsWith('group-type')
    ) {
      add('v8vscedit.repository.commit', 'Поместить в хранилище', codicon('cloud-upload'));
      add('v8vscedit.repository.update', 'Получить из хранилища', codicon('cloud-download'));
    }
    return actions;
  }

  private canAddHelp(node: MetadataNode): boolean {
    return Boolean(node.xmlPath && !['configuration', 'extension', 'Role', 'Template', 'CommonTemplate'].includes(node.nodeKind));
  }

  private canAddForm(node: MetadataNode): boolean {
    return Boolean(node.xmlPath && ['Document', 'Catalog', 'DataProcessor', 'Report', 'InformationRegister', 'AccumulationRegister', 'ChartOfAccounts', 'ChartOfCharacteristicTypes', 'ExchangePlan', 'BusinessProcess', 'Task'].includes(node.nodeKind));
  }

  private addModuleActions(node: MetadataNode, add: (command: string, title: string, icon: IconDto) => void): void {
    if (!node.xmlPath) {return;}
    if (node.command?.command) {
      add(node.command.command, node.command.title, codicon('code'));
    }
    const def = (META_TYPES as Record<string, { modules?: readonly string[] } | undefined>)[node.nodeKind];
    for (const slot of def?.modules ?? []) {
      const action = MODULE_SLOT_ACTIONS[slot];
      if (action) {add(action.command, action.title, action.icon);}
    }
  }

  private canBorrow(node: MetadataNode, ctxValue: string): boolean {
    if (!node.xmlPath || !this.services.treeProvider.getEntries().some((e) => e.kind === 'cfe')) {return false;}
    return (
      this.isMainConf(node) &&
      !/^(configuration|extension|extensions-root|group-)/.test(ctxValue) &&
      !ctxValue.includes('-fromCfe') &&
      !ctxValue.includes('-repoEditRestricted')
    );
  }

  private canAddCfeInterceptor(node: MetadataNode, ctxValue: string): boolean {
    if (!node.xmlPath || ctxValue.includes('-repoEditRestricted') || !ctxValue.includes('-fromCfe')) {
      return false;
    }
    if (node.nodeKind === 'Form') {
      return true;
    }
    const def = (META_TYPES as Record<string, { modules?: readonly string[] } | undefined>)[node.nodeKind];
    return Boolean(def?.modules?.length);
  }

  private isMainConf(node: MetadataNode): boolean {
    const src = node.metaContext?.ownerObjectXmlPath ?? node.xmlPath;
    if (!src) {return false;}
    const entry = this.services.treeProvider.getEntries()
      .filter((e) => this.isInside(src, e.rootPath))
      .sort((a, b) => b.rootPath.length - a.rootPath.length)
      .at(0);
    return entry?.kind === 'cf';
  }

  private isInside(filePath: string, rootPath: string): boolean {
    const rel = path.relative(path.resolve(rootPath), path.resolve(filePath));
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  }

  private addRepoRootActions(ctxValue: string, add: (command: string, title: string, icon: IconDto) => void): void {
    if (ctxValue.includes('-repoDisconnected')) {
      add('v8vscedit.repository.connect', 'Подключить к хранилищу', codicon('plug'));
    }
    add('v8vscedit.repository.create', 'Создать хранилище', codicon('database'));
    if (!ctxValue.includes('-repoConnected')) {return;}
    add('v8vscedit.repository.disconnect', 'Отключить от хранилища', codicon('debug-disconnect'));
    add('v8vscedit.repository.addUser', 'Добавить пользователя хранилища', codicon('person-add'));
    add('v8vscedit.repository.copyUsers', 'Скопировать пользователей', codicon('organization'));
    add('v8vscedit.repository.dump', 'Выгрузить конфигурацию из хранилища', codicon('archive'));
    add('v8vscedit.repository.report', 'Построить отчет по хранилищу', codicon('graph'));
    add('v8vscedit.repository.setLabel', 'Установить метку версии', codicon('tag'));
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
}

function codicon(name: string): IconDto {
  return { kind: 'codicon', name };
}
