import * as path from 'path';
import * as vscode from 'vscode';
import { ConfigEntry } from '../../infra/fs/ConfigLocator';
import { RepositoryService } from '../../infra/repository/RepositoryService';
import { parseConfigXml } from '../../infra/xml';
import { SupportInfoService } from '../../infra/support/SupportInfoService';
import {
  buildMetadataCacheScopeKey,
  MetadataCacheAddTarget,
  loadMetadataCache,
  MetadataCacheNode,
  MetadataCacheSnapshot,
  saveMetadataCacheForEntry,
} from '../../infra/cache/MetadataCache';
import { buildNode } from './nodes/_base';
import { getNodeDescriptor } from './nodes/index';
import { getIconUris } from './presentation/icon';
import { MetadataNode } from './TreeNode';

export class MetadataTreeProvider implements vscode.TreeDataProvider<MetadataNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<MetadataNode | undefined | null>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private roots: MetadataNode[] = [];
  private searchQuery = '';

  constructor(
    private entries: ConfigEntry[],
    private readonly extensionUri: vscode.Uri,
    private readonly projectRoot: string,
    private readonly setStatusMessage?: (message: string | undefined) => void,
    private readonly supportService?: SupportInfoService,
    private readonly repositoryService?: RepositoryService
  ) {
    this.buildRoots();
  }

  /** Перестраивает корневые узлы дерева только из JSON-кэша метаданных. */
  refresh(): void {
    this.buildRoots();
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  /** Обновляет найденные конфигурации и перестраивает дерево. */
  updateEntries(entries: ConfigEntry[]): void {
    this.entries = entries;
    this.refresh();
  }

  /** Возвращает найденные корни конфигураций для команд уровня рабочей области. */
  getEntries(): ConfigEntry[] {
    return [...this.entries];
  }

  /** Обновляет фильтр дерева. Строки короче трёх символов сбрасывают фильтрацию. */
  setSearchQuery(query: string): void {
    const nextQuery = query.trim();
    this.searchQuery = nextQuery.length > 2 ? nextQuery : '';
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  /** Возвращает текущий фильтр дерева для повторного открытия строки поиска. */
  getSearchQuery(): string {
    return this.searchQuery;
  }

  /** Сбрасывает активный фильтр дерева. */
  clearSearchQuery(): void {
    if (!this.searchQuery) {
      return;
    }

    this.searchQuery = '';
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  /**
   * Обновляет только выбранный узел дерева из уже изменённого JSON-снимка.
   * Используется после добавления метаданных, чтобы не пересоздавать всё дерево.
   */
  refreshNodeFromCache(targetNode: MetadataNode, snapshot: MetadataCacheSnapshot): boolean {
    const target = targetNode.addMetadataTarget;
    if (!target) {
      return false;
    }

    const cachedNode = this.findCacheNodeByAddTarget(snapshot.root, target);
    if (!cachedNode) {
      return false;
    }

    const children = cachedNode.children.map((child) => this.buildNodeFromCache(child));
    targetNode.replaceChildren(
      children,
      children.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None
    );
    this.onDidChangeTreeDataEmitter.fire(targetNode);
    return true;
  }

  getTreeItem(element: MetadataNode): vscode.TreeItem {
    element.iconPath = getIconUris(element.nodeKind, element.ownershipTag, this.extensionUri);
    this.applySupportDecoration(element);
    this.applyRepositoryDecoration(element);
    return element;
  }

  getChildren(element?: MetadataNode): MetadataNode[] {
    if (!element) {
      if (this.roots.length === 0) {
        return [
          new MetadataNode({
            label: 'Загрузка...',
            nodeKind: 'group-type',
            hidePropertiesCommand: true,
          }, vscode.TreeItemCollapsibleState.None),
        ];
      }
      return this.getVisibleRoots();
    }

    return element.childrenLoader ? element.childrenLoader() : [];
  }

  /**
   * Добавляет к `contextValue` суффикс режима поддержки для inline-индикаторов.
   */
  private applySupportDecoration(element: MetadataNode): void {
    if (!element.xmlPath || !this.supportService) {
      return;
    }
    if (!this.supportService.hasConfigData(element.xmlPath)) {
      return;
    }

    const mode = this.supportService.getSupportMode(element.xmlPath);
    const baseContextValue = (element.contextValue ?? '').replace(/-support\d$/, '');
    element.contextValue = `${baseContextValue}-support${mode}`;
  }

  /**
   * Добавляет к `contextValue` признаки подключения к хранилищу и локального состояния захвата.
   */
  private applyRepositoryDecoration(element: MetadataNode): void {
    if (!this.repositoryService) {
      return;
    }

    const state = this.resolveRepositoryState(element);
    if (!state) {
      return;
    }

    const baseContextValue = (element.contextValue ?? '')
      .replace(/-repoConnected/g, '')
      .replace(/-repoDisconnected/g, '')
      .replace(/-repoEditRestricted/g, '')
      .replace(/-repoEditAllowed/g, '')
      .replace(/-repoLocked/g, '')
      .replace(/-repoUnlocked/g, '');
    element.contextValue = `${baseContextValue}-${state.connected ? 'repoConnected' : 'repoDisconnected'}`;

    if (!state.connected) {
      return;
    }

    if (state.editRestricted !== undefined) {
      element.contextValue = `${element.contextValue}-${state.editRestricted ? 'repoEditRestricted' : 'repoEditAllowed'}`;
    }

    if (state.locked !== undefined) {
      element.contextValue = `${element.contextValue}-${state.locked ? 'repoLocked' : 'repoUnlocked'}`;
    }
  }

  private resolveRepositoryState(element: MetadataNode): {
    connected: boolean;
    editRestricted?: boolean;
    locked?: boolean;
  } | null {
    if (!this.repositoryService) {
      return null;
    }

    if (element.addMetadataTarget?.kind === 'child') {
      const ownerObjectXmlPath = element.addMetadataTarget.ownerObjectXmlPath;
      const target = this.repositoryService.resolveTargetByXmlPath(ownerObjectXmlPath);
      if (!target) {
        return null;
      }

      const connected = this.repositoryService.hasBinding(target) && this.repositoryService.isConnected(target);
      return {
        connected,
        editRestricted: connected
          ? this.repositoryService.isMetadataEditRestricted(target, ownerObjectXmlPath)
          : undefined,
      };
    }

    if (element.addMetadataTarget?.kind === 'root') {
      const target = this.repositoryService.resolveTargetByConfigRoot(element.addMetadataTarget.configRoot);
      if (!target) {
        return null;
      }

      const connected = this.repositoryService.hasBinding(target) && this.repositoryService.isConnected(target);
      return {
        connected,
        editRestricted: connected ? this.repositoryService.isMetadataEditRestricted(target) : undefined,
        locked: connected ? this.repositoryService.isRootLocked(target) : undefined,
      };
    }

    const anchorXmlPath = element.metaContext?.ownerObjectXmlPath ?? element.xmlPath;
    if (!anchorXmlPath) {
      return null;
    }

    const target = this.repositoryService.resolveTargetByXmlPath(anchorXmlPath);
    if (!target) {
      return null;
    }

    const connected = this.repositoryService.hasBinding(target) && this.repositoryService.isConnected(target);
    if (!connected) {
      return { connected: false };
    }

    const ownerObjectXmlPath = this.isRootRepositoryNode(element)
      ? undefined
      : (element.metaContext?.ownerObjectXmlPath ?? element.xmlPath);

    return {
      connected: true,
      editRestricted: this.repositoryService.isMetadataEditRestricted(target, ownerObjectXmlPath),
      locked: this.resolveRepositoryLockState(element),
    };
  }

  private resolveRepositoryLockState(element: MetadataNode): boolean | undefined {
    if (!this.repositoryService) {
      return undefined;
    }

    if (this.isRootRepositoryNode(element)) {
      const target = element.xmlPath ? this.repositoryService.resolveTargetByXmlPath(element.xmlPath) : null;
      return target ? this.repositoryService.isRootLocked(target) : undefined;
    }

    const fullName = this.repositoryService.resolveFullName({
      nodeKind: element.nodeKind,
      label: element.label ? String(element.label) : undefined,
      xmlPath: element.xmlPath,
      metaContext: element.metaContext,
    });
    if (!fullName) {
      return undefined;
    }

    const anchorXmlPath = element.metaContext?.ownerObjectXmlPath ?? element.xmlPath;
    if (!anchorXmlPath) {
      return undefined;
    }

    const target = this.repositoryService.resolveTargetByXmlPath(anchorXmlPath);
    if (!target) {
      return undefined;
    }

    return this.repositoryService.isLocked(target, fullName);
  }

  private isRootRepositoryNode(element: MetadataNode): boolean {
    return element.nodeKind === 'configuration' || element.nodeKind === 'extension';
  }

  private buildRoots(): void {
    let rebuiltCache = false;
    if (this.supportService) {
      for (const entry of this.entries) {
        this.supportService.loadConfig(entry.rootPath);
      }
    }

    const configRoots: MetadataNode[] = [];
    const extensionRoots: MetadataNode[] = [];

    for (const entry of this.entries) {
      const result = this.buildConfigNode(entry);
      rebuiltCache = rebuiltCache || result.rebuiltCache;
      if (entry.kind === 'cfe') {
        extensionRoots.push(result.node);
      } else {
        configRoots.push(result.node);
      }
    }

    this.roots = [
      ...configRoots,
      this.buildExtensionsRoot(extensionRoots),
    ];

    if (rebuiltCache) {
      this.setStatusMessage?.(undefined);
    }
  }

  private buildExtensionsRoot(children: MetadataNode[]): MetadataNode {
    return new MetadataNode({
      label: 'Расширения',
      nodeKind: 'extensions-root',
      hidePropertiesCommand: true,
      childrenLoader: () => children,
    }, children.length > 0
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None);
  }

  private getVisibleRoots(): MetadataNode[] {
    if (!this.searchQuery) {
      return this.roots;
    }

    return this.filterNodes(this.roots, this.normalizeSearchText(this.searchQuery));
  }

  private filterNodes(nodes: MetadataNode[], normalizedQuery: string): MetadataNode[] {
    const result: MetadataNode[] = [];

    for (const node of nodes) {
      const nodeMatches = this.normalizeSearchText(node.textLabel).includes(normalizedQuery);
      if (nodeMatches && node.xmlPath) {
        result.push(this.cloneNode(node, vscode.TreeItemCollapsibleState.None));
        continue;
      }

      const children = node.childrenLoader ? this.filterNodes(node.childrenLoader(), normalizedQuery) : [];
      if (children.length > 0) {
        result.push(this.cloneNode(
          node,
          vscode.TreeItemCollapsibleState.Expanded,
          () => children
        ));
        continue;
      }

      if (nodeMatches) {
        result.push(this.cloneNode(
          node,
          node.collapsibleState ?? vscode.TreeItemCollapsibleState.None
        ));
      }
    }

    return result;
  }

  private cloneNode(
    node: MetadataNode,
    collapsibleState: vscode.TreeItemCollapsibleState,
    childrenLoader?: () => MetadataNode[]
  ): MetadataNode {
    const clone = new MetadataNode({
      ...node.model,
      childrenLoader,
    }, collapsibleState);

    clone.command = node.command;
    clone.tooltip = node.tooltip;
    clone.resourceUri = node.resourceUri;
    return clone;
  }

  private normalizeSearchText(value: string): string {
    return value.toLocaleLowerCase('ru-RU');
  }

  private buildConfigNode(entry: ConfigEntry): { node: MetadataNode; rebuiltCache: boolean } {
    const configXmlPath = path.join(entry.rootPath, 'Configuration.xml');
    const info = parseConfigXml(configXmlPath);
    const scopeKey = buildMetadataCacheScopeKey(entry, info);
    let cached = loadMetadataCache(this.projectRoot, scopeKey);
    let rebuiltCache = false;

    if (!cached) {
      this.setStatusMessage?.(`Обновление кэша метаданных: ${info.name}`);
      saveMetadataCacheForEntry(this.projectRoot, scopeKey, entry);
      cached = loadMetadataCache(this.projectRoot, scopeKey);
      rebuiltCache = true;
    }

    if (!cached) {
      return {
        node: new MetadataNode({
          label: `Не удалось создать кэш метаданных: ${info.name}`,
          nodeKind: 'group-type',
          hidePropertiesCommand: true,
        }, vscode.TreeItemCollapsibleState.None),
        rebuiltCache,
      };
    }

    return { node: this.buildNodeFromCache(cached.root), rebuiltCache };
  }

  private buildNodeFromCache(cached: MetadataCacheNode): MetadataNode {
    const children = cached.children.map((child) => this.buildNodeFromCache(child));
    const descriptor = getNodeDescriptor(cached.type);
    const node = buildNode(descriptor, {
      label: cached.label,
      kind: cached.type,
      collapsibleState: children.length > 0
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
      xmlPath: cached.xmlPath,
      childrenLoader: children.length > 0 ? () => children : undefined,
      ownershipTag: cached.ownershipTag,
      hidePropertiesCommand: cached.hidePropertiesCommand ||
        cached.type === 'configuration' ||
        cached.type === 'extension',
      metaContext: cached.metaContext,
      addMetadataTarget: cached.addMetadataTarget,
      canRemoveMetadata: cached.canRemoveMetadata,
    });

    if (cached.tooltip) {
      node.tooltip = cached.tooltip;
    }

    return node;
  }

  private findCacheNodeByAddTarget(node: MetadataCacheNode, target: MetadataCacheAddTarget): MetadataCacheNode | undefined {
    if (node.addMetadataTarget && this.sameAddTarget(node.addMetadataTarget, target)) {
      return node;
    }

    for (const child of node.children) {
      const found = this.findCacheNodeByAddTarget(child, target);
      if (found) {
        return found;
      }
    }

    return undefined;
  }

  private sameAddTarget(left: MetadataCacheAddTarget, right: MetadataCacheAddTarget): boolean {
    if (left.kind !== right.kind) {
      return false;
    }

    if (left.kind === 'root' && right.kind === 'root') {
      return (
        this.samePath(left.configRoot, right.configRoot) &&
        left.configKind === right.configKind &&
        left.targetKind === right.targetKind
      );
    }

    if (left.kind === 'child' && right.kind === 'child') {
      return (
        this.samePath(left.ownerObjectXmlPath, right.ownerObjectXmlPath) &&
        left.childTag === right.childTag &&
        left.tabularSectionName === right.tabularSectionName
      );
    }

    return false;
  }

  private samePath(left: string, right: string): boolean {
    return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
  }
}
