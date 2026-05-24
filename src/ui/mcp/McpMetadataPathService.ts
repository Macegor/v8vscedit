import * as fs from 'fs';
import * as path from 'path';
import { CHILD_TAG_CONFIG, type ChildTag } from '../../domain/ChildTag';
import { META_TYPES, type MetaKind } from '../../domain/MetaTypes';
import { ConfigXmlReader } from '../../infra/xml';
import { resolveMetadataObjectPath } from '../../infra/xml/MetadataInfoService';
import type { MetadataTreeProvider } from '../tree/MetadataTreeProvider';
import type { MetadataNode } from '../tree/TreeNode';
import type { AddMetadataTarget } from '../tree/TreeNodeModel';

interface IndexedNode {
  readonly node: MetadataNode;
  readonly root: MetadataNode;
  readonly logicalPath: string;
  readonly aliases: readonly string[];
}

export interface McpConfigurationOverview {
  readonly configuration: string;
  readonly rootPath: string;
  readonly configXmlPath: string;
  readonly kind: 'cf' | 'cfe';
  readonly name: string;
  readonly synonym: string;
  readonly version: string;
  readonly namePrefix: string;
  readonly objectCounts: readonly {
    readonly kind: string;
    readonly label: string;
    readonly count: number;
  }[];
}

export interface McpMetadataPathSummary {
  readonly path: string;
  readonly label: string;
  readonly nodeKind: string;
  readonly xmlPath?: string;
  readonly ownerObjectXmlPath?: string;
  readonly canAddMetadata: boolean;
  readonly canRemoveMetadata: boolean;
}

export interface McpAddMetadataByPathRequest {
  readonly path: string;
  readonly configuration?: string;
  readonly childTag?: ChildTag | 'Column';
}

export interface McpAddMetadataByPathTarget {
  readonly target: AddMetadataTarget;
  readonly name: string;
  readonly sourceNode?: MetadataNode;
}

const DIRECT_CHILD_KINDS = new Set<string>([
  'StandardAttribute',
  'Attribute',
  'AddressingAttribute',
  'TabularSection',
  'Column',
  'Dimension',
  'Resource',
  'EnumValue',
]);

const GROUPED_CHILD_KINDS = new Set<string>(['Form', 'Command', 'Template']);

const CHILD_GROUP_PATH_LABELS: Readonly<Partial<Record<ChildTag, string>>> = {
  StandardAttribute: 'СтандартныеРеквизиты',
  Attribute: 'Реквизиты',
  AddressingAttribute: 'РеквизитыАдресации',
  TabularSection: 'ТабличныеЧасти',
  Form: 'Формы',
  Command: 'Команды',
  Template: 'Макеты',
  Dimension: 'Измерения',
  Resource: 'Ресурсы',
  EnumValue: 'Значения',
};

/**
 * Предметная навигация MCP поверх дерева UniversalPanel.
 * Снаружи агент работает с путями вроде `Справочники.Пользователи.Фамилия`,
 * а внутри сервис находит тот же узел, который использует UI.
 */
export class McpMetadataPathService {
  private readonly configReader = new ConfigXmlReader();

  constructor(private readonly treeProvider: MetadataTreeProvider) {}

  getWorkspaceOverview(): {
    readonly mainConfigurations: readonly McpConfigurationOverview[];
    readonly extensions: readonly McpConfigurationOverview[];
  } {
    const configs = this.treeProvider.getEntries().map((entry) => {
      const configXmlPath = path.join(entry.rootPath, 'Configuration.xml');
      const info = this.configReader.read(configXmlPath);
      return {
        configuration: info.name,
        rootPath: entry.rootPath,
        configXmlPath,
        kind: entry.kind,
        name: info.name,
        synonym: info.synonym,
        version: info.version,
        namePrefix: info.namePrefix,
        objectCounts: Array.from(info.childObjects.entries())
          .map(([kind, names]) => ({
            kind,
            label: getMetaPluralLabel(kind),
            count: names.length,
          }))
          .sort((left, right) => left.label.localeCompare(right.label, 'ru')),
      };
    });

    return {
      mainConfigurations: configs.filter((item) => item.kind === 'cf'),
      extensions: configs.filter((item) => item.kind === 'cfe'),
    };
  }

  search(options: {
    readonly query: string;
    readonly configuration?: string;
    readonly kind?: string;
    readonly limit?: number;
  }): McpMetadataPathSummary[] {
    if (!normalize(options.query)) {
      return [];
    }
    const kind = options.kind ? resolveMetaKind(options.kind) : undefined;
    const limit = clampLimit(options.limit);

    if (kind && isRootObjectMetaKind(kind)) {
      return this.listRootObjectsByKind({
        configuration: options.configuration,
        kind,
        query: options.query,
        limit,
      });
    }
    if (!kind) {
      const rootMatches = this.searchRootObjects({
        configuration: options.configuration,
        query: options.query,
        limit,
      });
      if (rootMatches.length > 0) {
        return rootMatches;
      }
    }

    const normalizedKind = options.kind ? normalizeKind(options.kind) : undefined;
    return this.buildIndex(options.configuration)
      .filter((item) => {
        if (normalizedKind && normalizeKind(item.node.nodeKind) !== normalizedKind) {
          return false;
        }
        return matchesSearch(item.aliases, options.query);
      })
      .slice(0, limit)
      .map((item) => this.summarize(item));
  }

  list(options: {
    readonly configuration?: string;
    readonly parentPath?: string;
    readonly kind?: string;
    readonly group?: string;
    readonly query?: string;
    readonly limit?: number;
  } = {}): McpMetadataPathSummary[] {
    const limit = clampLimit(options.limit);
    const kind = options.kind ? resolveMetaKind(options.kind) : undefined;
    const group = options.group ? normalize(options.group) : undefined;
    if (!options.parentPath && kind && isRootObjectMetaKind(kind) && !group) {
      return this.listRootObjectsByKind({
        configuration: options.configuration,
        kind,
        query: options.query,
        limit,
      });
    }

    const normalizedKind = options.kind ? normalizeKind(options.kind) : undefined;
    const index = this.buildIndex(options.configuration);
    const parent = options.parentPath
      ? this.findInIndex(index, options.parentPath)
      : undefined;
    if (options.parentPath && !parent) {
      throw new Error(`Метаданные по пути "${options.parentPath}" не найдены.`);
    }
    const parentPath = parent ? normalizePath(parent.logicalPath) : undefined;

    return index
      .filter((item) => {
        if (parentPath && !isDirectChildPath(parentPath, normalizePath(item.logicalPath))) {
          return false;
        }
        if (normalizedKind && normalizeKind(item.node.nodeKind) !== normalizedKind) {
          return false;
        }
        if (group && !item.aliases.some((alias) => normalize(alias).includes(group))) {
          return false;
        }
        if (options.query && !matchesSearch(item.aliases, options.query)) {
          return false;
        }
        return item.logicalPath.length > 0;
      })
      .slice(0, limit)
      .map((item) => this.summarize(item));
  }

  resolveNode(pathValue: string, configuration?: string): MetadataNode {
    return this.resolveIndexedNode(pathValue, configuration).node;
  }

  /**
   * Универсальный резолвер для tool'ов, принимающих `objectPath`:
   * 1. абсолютный путь к файлу или каталогу объекта;
   * 2. относительный путь от корня одной из зарегистрированных конфигураций
   *    (например, `Catalogs/Задачи.xml` или `Roles/БазовыеПрава`);
   * 3. предметный путь (`Catalog.Задачи`, `Справочники.Задачи` и т.п.).
   *
   * Возвращает абсолютный путь к XML-файлу или null, если ничего не подошло.
   */
  resolveObjectXmlPath(input: string, configuration?: string): string | null {
    const trimmed = input.trim();
    if (!trimmed) {
      return null;
    }

    const direct = resolveMetadataObjectPath(trimmed);
    if (direct) {
      return direct;
    }

    if (!path.isAbsolute(trimmed)) {
      for (const root of this.collectCandidateRoots(configuration)) {
        const candidate = resolveMetadataObjectPath(path.join(root, trimmed));
        if (candidate) {
          return candidate;
        }
      }
    }

    try {
      const node = this.resolveNode(trimmed, configuration);
      if (node.xmlPath && fs.existsSync(node.xmlPath)) {
        return node.xmlPath;
      }
    } catch {
      // fall through
    }
    return null;
  }

  private collectCandidateRoots(configuration?: string): string[] {
    const entries = this.treeProvider.getEntries();
    if (!configuration?.trim()) {
      return entries.map((entry) => entry.rootPath);
    }
    const normalized = normalize(configuration);
    const normalizedPath = path.resolve(configuration);
    const filtered = entries.filter((entry) => {
      const baseName = path.basename(entry.rootPath);
      return normalize(baseName) === normalized ||
        normalize(entry.rootPath) === normalized ||
        path.resolve(entry.rootPath).toLowerCase() === normalizedPath.toLowerCase();
    });
    return (filtered.length > 0 ? filtered : entries).map((entry) => entry.rootPath);
  }

  resolveAddTarget(request: McpAddMetadataByPathRequest): McpAddMetadataByPathTarget {
    const segments = splitPath(request.path);
    if (segments.length < 2) {
      throw new Error('Путь добавления должен содержать группу и имя объекта.');
    }

    const rootGroup = this.findNodeByPath(segments[0], request.configuration);
    if (segments.length === 2 && rootGroup?.node.addMetadataTarget?.kind === 'root') {
      return {
        target: rootGroup.node.addMetadataTarget,
        name: segments.slice(1).join('.'),
        sourceNode: rootGroup.node,
      };
    }

    const owner = this.resolveLongestExistingPrefix(segments, request.configuration);
    if (!owner || !owner.node.xmlPath || owner.node.metaContext) {
      throw new Error(`Не найден объект-владелец для пути "${request.path}".`);
    }
    const rest = segments.slice(splitPath(owner.logicalPath).length);
    if (rest.length === 0) {
      throw new Error(`Путь "${request.path}" уже указывает на существующий объект.`);
    }

    if (rest.length === 1) {
      const childTag = request.childTag ?? 'Attribute';
      const groupNode = this.findChildAddGroup(owner.node, childTag);
      return {
        target: buildChildTarget(owner.node.xmlPath, childTag),
        name: rest[0],
        sourceNode: groupNode,
      };
    }

    const columnTarget = this.resolveColumnAddTarget(owner.node, rest);
    if (columnTarget) {
      return columnTarget;
    }

    const groupTag = resolveChildTag(rest[0]);
    if (groupTag) {
      const groupNode = this.findChildAddGroup(owner.node, groupTag);
      return {
        target: buildChildTarget(owner.node.xmlPath, groupTag),
        name: rest.slice(1).join('.'),
        sourceNode: groupNode,
      };
    }

    const tabularSection = this.findTabularSection(owner.node, rest[0]);
    if (tabularSection) {
      return {
        target: {
          kind: 'child',
          ownerObjectXmlPath: owner.node.xmlPath,
          childTag: 'Column',
          tabularSectionName: tabularSection.textLabel,
        },
        name: rest.slice(1).join('.'),
        sourceNode: tabularSection,
      };
    }

    throw new Error(`Не удалось определить группу добавления для пути "${request.path}".`);
  }

  private resolveColumnAddTarget(owner: MetadataNode, rest: readonly string[]): McpAddMetadataByPathTarget | undefined {
    const firstTag = resolveChildTag(rest[0]);
    const explicitTabularGroup = firstTag === 'TabularSection';
    const tabularSectionName = explicitTabularGroup ? rest[1] : rest[0];
    const rawColumnSegments = explicitTabularGroup ? rest.slice(2) : rest.slice(1);

    if (!tabularSectionName || rawColumnSegments.length === 0) {
      return undefined;
    }

    const tabularSection = this.findTabularSection(owner, tabularSectionName);
    if (!tabularSection) {
      if (explicitTabularGroup && rawColumnSegments.length > 0) {
        throw new Error(`Табличная часть "${tabularSectionName}" не найдена в объекте "${owner.textLabel}".`);
      }
      return undefined;
    }

    const columnSegments = isColumnGroupSegment(rawColumnSegments[0])
      ? rawColumnSegments.slice(1)
      : rawColumnSegments;
    if (columnSegments.length === 0) {
      throw new Error(`Не указано имя реквизита табличной части "${tabularSection.textLabel}".`);
    }

    return {
      target: {
        kind: 'child',
        ownerObjectXmlPath: owner.xmlPath ?? '',
        childTag: 'Column',
        tabularSectionName: tabularSection.textLabel,
      },
      name: columnSegments.join('.'),
      sourceNode: tabularSection,
    };
  }

  private resolveIndexedNode(pathValue: string, configuration?: string): IndexedNode {
    const found = this.findNodeByPath(pathValue, configuration);
    if (!found) {
      throw new Error(`Метаданные по пути "${pathValue}" не найдены.`);
    }
    return found;
  }

  private findNodeByPath(pathValue: string, configuration?: string): IndexedNode | undefined {
    return this.findInIndex(this.buildIndex(configuration), pathValue);
  }

  private findInIndex(index: readonly IndexedNode[], pathValue: string): IndexedNode | undefined {
    const target = normalizePath(pathValue);
    return index.find((item) => item.aliases.some((alias) => normalizePath(alias) === target));
  }

  private resolveLongestExistingPrefix(segments: readonly string[], configuration?: string): IndexedNode | undefined {
    for (let size = segments.length - 1; size >= 1; size -= 1) {
      const found = this.findNodeByPath(segments.slice(0, size).join('.'), configuration);
      if (found && found.node.xmlPath && !found.node.metaContext) {
        return found;
      }
    }
    return undefined;
  }

  private buildIndex(configuration?: string): IndexedNode[] {
    const roots = this.getConfigRoots(configuration);
    const result: IndexedNode[] = [];
    for (const root of roots) {
      this.collectRoot(root, result);
      this.collectRootChildren(root, result);
    }
    return result;
  }

  private collectRoot(root: MetadataNode, result: IndexedNode[]): void {
    const aliases = ['Configuration', 'Конфигурация', 'Расширение', 'Extension', root.textLabel, root.nodeKind];
    result.push({
      node: root,
      root,
      logicalPath: root.textLabel,
      aliases: uniqueNonEmpty(aliases),
    });
  }

  private listRootObjectsByKind(options: {
    readonly configuration?: string;
    readonly kind: MetaKind;
    readonly query?: string;
    readonly limit: number;
  }): McpMetadataPathSummary[] {
    const result: McpMetadataPathSummary[] = [];
    for (const root of this.getConfigRoots(options.configuration)) {
      for (const group of this.findRootGroupsByKind(root, options.kind)) {
        for (const child of group.childrenLoader?.() ?? []) {
          if (!isRootObjectNode(child, options.kind)) {
            continue;
          }

          const indexed = this.createRootObjectIndexEntry(root, group, child, options.kind);
          if (options.query && !matchesSearch(indexed.aliases, options.query)) {
            continue;
          }

          result.push(this.summarize(indexed));
          if (result.length >= options.limit) {
            return result;
          }
        }
      }
    }
    return result;
  }

  private searchRootObjects(options: {
    readonly configuration?: string;
    readonly query: string;
    readonly limit: number;
  }): McpMetadataPathSummary[] {
    const result: McpMetadataPathSummary[] = [];
    for (const root of this.getConfigRoots(options.configuration)) {
      for (const group of this.findRootGroups(root)) {
        const kind = group.addMetadataTarget?.kind === 'root'
          ? group.addMetadataTarget.targetKind
          : undefined;
        if (!kind || !isRootObjectMetaKind(kind)) {
          continue;
        }

        for (const child of group.childrenLoader?.() ?? []) {
          if (!isRootObjectNode(child, kind)) {
            continue;
          }
          const indexed = this.createRootObjectIndexEntry(root, group, child, kind);
          if (!matchesSearch(indexed.aliases, options.query)) {
            continue;
          }

          result.push(this.summarize(indexed));
          if (result.length >= options.limit) {
            return result;
          }
        }
      }
    }
    return result;
  }

  private findRootGroupsByKind(root: MetadataNode, kind: MetaKind): MetadataNode[] {
    return this.findRootGroups(root).filter((node) => {
      return node.addMetadataTarget?.kind === 'root' && node.addMetadataTarget.targetKind === kind;
    });
  }

  private findRootGroups(root: MetadataNode): MetadataNode[] {
    const result: MetadataNode[] = [];
    const visit = (node: MetadataNode): void => {
      if (node.addMetadataTarget?.kind === 'root') {
        result.push(node);
      }
      if (node.xmlPath && node !== root) {
        return;
      }
      for (const child of node.childrenLoader?.() ?? []) {
        visit(child);
      }
    };

    for (const child of root.childrenLoader?.() ?? []) {
      visit(child);
    }
    return result;
  }

  private createRootObjectIndexEntry(
    root: MetadataNode,
    group: MetadataNode,
    node: MetadataNode,
    kind: MetaKind
  ): IndexedNode {
    const def = META_TYPES[kind];
    const objectPath = `${def.pluralLabel}.${node.textLabel}`;
    return {
      node,
      root,
      logicalPath: objectPath,
      aliases: uniqueNonEmpty([
        objectPath,
        node.textLabel,
        `${def.kind}.${node.textLabel}`,
        `${def.label}.${node.textLabel}`,
        `${def.pluralLabel}.${node.textLabel}`,
        `${def.folder ?? ''}.${node.textLabel}`,
        `${group.textLabel}.${node.textLabel}`,
      ]),
    };
  }

  private getConfigRoots(configuration?: string): MetadataNode[] {
    const roots = flattenConfigRoots(this.treeProvider.getAutomationRoots());
    if (!configuration?.trim()) {
      if (roots.length > 1) {
        throw new Error(`Укажите configuration. Найдено несколько конфигураций: ${roots.map((root) => root.textLabel).join(', ')}.`);
      }
      return roots;
    }
    const normalized = normalize(configuration);
    const normalizedPath = path.resolve(configuration);
    const found = roots.filter((root) => {
      const rootPath = root.xmlPath ? path.dirname(root.xmlPath) : '';
      return normalize(root.textLabel) === normalized ||
        normalize(rootPath) === normalized ||
        path.resolve(rootPath).toLowerCase() === normalizedPath.toLowerCase();
    });
    if (found.length === 0) {
      throw new Error(`Конфигурация "${configuration}" не найдена. Используйте имя из v8vscedit_workspace_overview.`);
    }
    return found;
  }

  private collectRootChildren(root: MetadataNode, result: IndexedNode[]): void {
    for (const group of root.childrenLoader?.() ?? []) {
      this.collectRootGroup(root, group, result);
    }
  }

  private collectRootGroup(root: MetadataNode, group: MetadataNode, result: IndexedNode[]): void {
    const groupAliases = [group.textLabel];
    if (group.addMetadataTarget?.kind === 'root') {
      const def = META_TYPES[group.addMetadataTarget.targetKind];
      groupAliases.push(def.kind, def.pluralLabel, def.folder ?? '');
    }
    result.push({
      node: group,
      root,
      logicalPath: group.textLabel,
      aliases: uniqueNonEmpty(groupAliases),
    });

    for (const child of group.childrenLoader?.() ?? []) {
      if (!child.xmlPath || child.metaContext) {
        if (child.addMetadataTarget?.kind === 'root' || child.childrenLoader) {
          this.collectRootGroup(root, child, result);
        }
        continue;
      }
      const def = META_TYPES[child.nodeKind];
      const objectPath = `${def?.pluralLabel ?? group.textLabel}.${child.textLabel}`;
      const objectAliases = uniqueNonEmpty([
        objectPath,
        `${child.nodeKind}.${child.textLabel}`,
        `${def?.folder ?? ''}.${child.textLabel}`,
        `${group.textLabel}.${child.textLabel}`,
      ]);
      result.push({
        node: child,
        root,
        logicalPath: objectPath,
        aliases: objectAliases,
      });
      this.collectObjectChildren(root, child, objectPath, objectAliases, result);
    }
  }

  private collectObjectChildren(
    root: MetadataNode,
    objectNode: MetadataNode,
    objectPath: string,
    objectAliases: readonly string[],
    result: IndexedNode[]
  ): void {
    if (objectNode.nodeKind === 'Subsystem') {
      for (const child of objectNode.childrenLoader?.() ?? []) {
        if (child.nodeKind !== 'Subsystem' || !child.xmlPath) {
          continue;
        }
        const childPath = `${objectPath}.${child.textLabel}`;
        const childAliases = uniqueNonEmpty([
          childPath,
          `${objectPath}.Subsystem.${child.textLabel}`,
          ...objectAliases.map((alias) => `${alias}.${child.textLabel}`),
          ...objectAliases.map((alias) => `${alias}.Subsystem.${child.textLabel}`),
        ]);
        result.push({
          node: child,
          root,
          logicalPath: childPath,
          aliases: childAliases,
        });
        this.collectObjectChildren(root, child, childPath, childAliases, result);
      }
      return;
    }

    for (const group of objectNode.childrenLoader?.() ?? []) {
      const rawGroupTag = group.addMetadataTarget?.kind === 'child'
        ? group.addMetadataTarget.childTag
        : resolveChildTag(group.textLabel);
      const groupTag = rawGroupTag === 'Column' ? undefined : rawGroupTag;
      const groupLabel = getChildGroupPathLabel(groupTag, group.textLabel);
      const groupPath = `${objectPath}.${groupLabel}`;
      result.push({
        node: group,
        root,
        logicalPath: groupPath,
        aliases: uniqueNonEmpty([
          groupPath,
          `${objectPath}.${group.textLabel}`,
          groupTag ? `${objectPath}.${groupTag}` : '',
        ]),
      });

      for (const child of group.childrenLoader?.() ?? []) {
        this.collectChildNode(root, objectPath, objectAliases, groupLabel, group.textLabel, groupTag, child, result);
      }
    }
  }

  private collectChildNode(
    root: MetadataNode,
    objectPath: string,
    objectAliases: readonly string[],
    groupLabel: string,
    originalGroupLabel: string,
    groupTag: string | undefined,
    node: MetadataNode,
    result: IndexedNode[]
  ): void {
    const groupedPath = `${objectPath}.${groupLabel}.${node.textLabel}`;
    const originalGroupedPath = `${objectPath}.${originalGroupLabel}.${node.textLabel}`;
    const directPath = DIRECT_CHILD_KINDS.has(node.nodeKind)
      ? `${objectPath}.${node.textLabel}`
      : groupedPath;
    const aliases = [
      directPath,
      groupedPath,
      originalGroupedPath,
      groupTag ? `${objectPath}.${groupTag}.${node.textLabel}` : '',
      `${objectPath}.${node.nodeKind}.${node.textLabel}`,
      ...objectAliases.map((alias) => `${alias}.${node.textLabel}`),
      ...objectAliases.map((alias) => `${alias}.${groupLabel}.${node.textLabel}`),
      ...objectAliases.map((alias) => `${alias}.${originalGroupLabel}.${node.textLabel}`),
      ...objectAliases.map((alias) => `${alias}.${node.nodeKind}.${node.textLabel}`),
    ];

    result.push({
      node,
      root,
      logicalPath: directPath,
      aliases: uniqueNonEmpty(aliases),
    });

    if (node.nodeKind === 'TabularSection') {
      for (const column of node.childrenLoader?.() ?? []) {
        const columnPath = `${objectPath}.${node.textLabel}.${column.textLabel}`;
        result.push({
          node: column,
          root,
          logicalPath: columnPath,
          aliases: uniqueNonEmpty([
            columnPath,
            `${groupedPath}.${column.textLabel}`,
            `${originalGroupedPath}.${column.textLabel}`,
            `${objectPath}.Column.${node.textLabel}.${column.textLabel}`,
            ...objectAliases.map((alias) => `${alias}.${node.textLabel}.${column.textLabel}`),
            ...objectAliases.map((alias) => `${alias}.${groupLabel}.${node.textLabel}.${column.textLabel}`),
            ...objectAliases.map((alias) => `${alias}.${originalGroupLabel}.${node.textLabel}.${column.textLabel}`),
          ]),
        });
      }
    } else if (!GROUPED_CHILD_KINDS.has(node.nodeKind)) {
      for (const child of node.childrenLoader?.() ?? []) {
        this.collectChildNode(root, directPath, objectAliases, groupLabel, originalGroupLabel, groupTag, child, result);
      }
    }
  }

  private findChildAddGroup(owner: MetadataNode, childTag: ChildTag | 'Column'): MetadataNode | undefined {
    if (childTag === 'Column') {
      return undefined;
    }
    return owner.childrenLoader?.().find((node) => {
      const target = node.addMetadataTarget;
      return target?.kind === 'child' && target.childTag === childTag;
    });
  }

  private findTabularSection(owner: MetadataNode, name: string): MetadataNode | undefined {
    const normalizedName = normalize(name);
    for (const group of owner.childrenLoader?.() ?? []) {
      for (const child of group.childrenLoader?.() ?? []) {
        if (child.nodeKind === 'TabularSection' && normalize(child.textLabel) === normalizedName) {
          return child;
        }
      }
    }
    return undefined;
  }

  private summarize(item: IndexedNode): McpMetadataPathSummary {
    return {
      path: item.logicalPath,
      label: item.node.textLabel,
      nodeKind: item.node.nodeKind,
      xmlPath: item.node.xmlPath,
      ownerObjectXmlPath: item.node.metaContext?.ownerObjectXmlPath,
      canAddMetadata: Boolean(item.node.addMetadataTarget),
      canRemoveMetadata: Boolean(item.node.canRemoveMetadata),
    };
  }
}

function flattenConfigRoots(nodes: readonly MetadataNode[]): MetadataNode[] {
  const result: MetadataNode[] = [];
  for (const node of nodes) {
    if ((node.nodeKind === 'configuration' || node.nodeKind === 'extension') && node.xmlPath) {
      result.push(node);
      continue;
    }
    result.push(...flattenConfigRoots(node.childrenLoader?.() ?? []));
  }
  return result;
}

function splitPath(value: string): string[] {
  return value
    .split('.')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
}

function normalizeLabel(value: string): string {
  return normalize(value).replace(/\s+/g, '');
}

function normalizePath(value: string): string {
  return splitPath(value).map(normalize).join('.');
}

function normalizeKind(value: string): string {
  return normalize(resolveMetaKind(value) ?? value);
}

function resolveMetaKind(value: string): MetaKind | undefined {
  const normalized = normalize(value);
  return Object.values(META_TYPES).find((def) => {
    const aliases = [def.kind, def.label, def.pluralLabel, def.folder ?? ''];
    return aliases.some((alias) => normalize(alias) === normalized);
  })?.kind;
}

function isRootObjectMetaKind(kind: MetaKind): boolean {
  const group = META_TYPES[kind].group;
  return group === 'common' || group === 'top' || group === 'documents-branch';
}

function isRootObjectNode(node: MetadataNode, kind: MetaKind): boolean {
  return node.nodeKind === kind && Boolean(node.xmlPath) && !node.metaContext;
}

function matchesSearch(aliases: readonly string[], query: string): boolean {
  const normalized = normalize(query);
  const compact = normalizeForSearch(query);
  return aliases.some((alias) => {
    const normalizedAlias = normalize(alias);
    return normalizedAlias.includes(normalized) || normalizeForSearch(alias).includes(compact);
  });
}

function normalizeForSearch(value: string): string {
  return normalize(value).replace(/[\s_.-]+/g, '');
}

function resolveChildTag(value: string): ChildTag | undefined {
  const normalized = normalizeLabel(value);
  for (const [tag, config] of Object.entries(CHILD_TAG_CONFIG)) {
    if (
      normalizeLabel(tag) === normalized ||
      normalizeLabel(config.label) === normalized ||
      normalizeLabel(CHILD_GROUP_PATH_LABELS[tag as ChildTag] ?? '') === normalized ||
      normalizeLabel(META_TYPES[tag as MetaKind].label) === normalized ||
      normalizeLabel(META_TYPES[tag as MetaKind].pluralLabel) === normalized
    ) {
      return tag as ChildTag;
    }
  }
  return undefined;
}

function getChildGroupPathLabel(tag: ChildTag | undefined, fallback: string): string {
  return tag ? CHILD_GROUP_PATH_LABELS[tag] ?? fallback.replace(/\s+/g, '') : fallback;
}

function isColumnGroupSegment(value: string): boolean {
  const tag = resolveChildTag(value);
  if (tag === 'Attribute') {
    return true;
  }
  const normalized = normalizeLabel(value);
  return normalized === normalizeLabel('Колонки') ||
    normalized === normalizeLabel('Колонка') ||
    normalized === normalizeLabel('РеквизитыТабличнойЧасти');
}

function buildChildTarget(ownerObjectXmlPath: string, childTag: ChildTag | 'Column'): AddMetadataTarget {
  if (childTag === 'Column') {
    throw new Error('Для колонки нужна табличная часть в пути.');
  }
  return { kind: 'child', ownerObjectXmlPath, childTag };
}

function getMetaPluralLabel(kind: string): string {
  return META_TYPES[kind as MetaKind]?.pluralLabel ?? kind;
}

function uniqueNonEmpty(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function clampLimit(value: number | undefined): number {
  return Math.max(1, Math.min(value ?? 200, 1_000));
}

function isDirectChildPath(parentPath: string, childPath: string): boolean {
  if (!childPath.startsWith(`${parentPath}.`)) {
    return false;
  }
  const rest = childPath.slice(parentPath.length + 1);
  return rest.length > 0 && !rest.includes('.');
}
