import * as fs from 'fs';
import * as path from 'path';
import {
  canonicalChildPath,
  canonicalRootPath,
  canonicalSubsystemPath,
  parseCanonicalPath,
  type ParsedCanonicalPath,
} from '../../domain/CanonicalNames';
import type { ChildTag } from '../../domain/ChildTag';
import { META_TYPES, type MetaKind } from '../../domain/MetaTypes';
import { ConfigXmlReader } from '../../infra/xml';
import type { MetadataTreeProvider } from '../tree/MetadataTreeProvider';
import type { MetadataNode } from '../tree/TreeNode';
import type { AddMetadataTarget } from '../tree/TreeNodeModel';

/**
 * MCP-навигация по дереву UniversalPanel в канонических русских путях.
 *
 * Сервис — тонкий адаптер над `domain/CanonicalNames`: вся логика построения
 * и разбора путей живёт в домене, здесь — только сопоставление узлам дерева.
 * На вход принимаются ТОЛЬКО канонические пути (`Справочники.Контрагенты`,
 * `Справочники.Контрагенты.ТабличнаяЧасть.Состав.Реквизит.Сумма`,
 * `Подсистема.Продажи.Розница`). Любая legacy- или английская форма
 * (`Catalog.X`, `Catalogs.X`, `Справочник.X` в ед. ч., `Справочники.X.Реквизиты.Y`)
 * отбивается с понятной ошибкой и подсказкой канонического вида.
 */

interface IndexedNode {
  readonly node: MetadataNode;
  readonly root: MetadataNode;
  readonly canonicalPath: string;
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

/** Параметры выдачи плоского списка канонических путей. */
export interface McpListTreePathsOptions {
  readonly configuration?: string;
  readonly scope?: 'all' | 'objects' | 'common' | 'subsystems';
  readonly depth?: 'roots' | 'objects' | 'children';
  readonly include?: readonly string[];
  readonly limit?: number;
}

/** Результат выдачи плоского дерева канонических путей. */
export interface McpListTreePathsResult {
  readonly configuration: string;
  readonly total: number;
  readonly truncated: boolean;
  readonly paths: readonly string[];
}

/**
 * Результат «мягкого» резолва канонического пути для tool `v8vscedit_resolve_path`.
 * Невалидный синтаксис превращается в исключение (внутри `parseCanonicalPath`),
 * валидный синтаксис без узла — в `{ exists: false }` без исключения.
 */
export interface McpResolveNodeSafeResult {
  readonly canonical: string;
  readonly exists: boolean;
  readonly node?: MetadataNode;
}

/** Сегмент пути канонической формы для каждого MetaKind подсказки в ошибках. */
function suggestRootSegment(kind: MetaKind): string {
  return META_TYPES[kind].pathSegment ?? META_TYPES[kind].pluralLabel;
}

export class McpMetadataPathService {
  private readonly configReader = new ConfigXmlReader();

  constructor(private readonly treeProvider: MetadataTreeProvider) {}

  // ── Обзор рабочей области ─────────────────────────────────────────────

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
            label: getPluralLabelForKind(kind),
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

  // ── Канонический путь к узлу ──────────────────────────────────────────

  /**
   * Возвращает канонический путь узла дерева.
   * Бросает ошибку, если у узла нет однозначной канонической формы
   * (например, для служебных групп `group-type` без `addMetadataTarget`).
   */
  getCanonicalPath(node: MetadataNode): string {
    const index = this.buildIndex();
    const found = index.find((item) => item.node === node);
    if (found) {
      return found.canonicalPath;
    }
    throw new Error(`Узел "${node.textLabel}" не имеет канонического пути в индексе MCP.`);
  }

  // ── Резолв узла по канон. пути ────────────────────────────────────────

  resolveNode(pathValue: string, configuration?: string): MetadataNode {
    return this.resolveIndexedNode(pathValue, configuration).node;
  }

  /**
   * «Мягкий» резолв канонического пути для MCP-tool `v8vscedit_resolve_path`.
   *
   * Различия с `resolveNode`:
   *  - невалидный синтаксис пути по-прежнему бросает Error (через
   *    `parseCanonicalPath`) — это ошибка ввода;
   *  - валидный синтаксис, для которого узла нет в дереве, возвращает
   *    `{ exists: false, canonical }` без исключения.
   */
  resolveNodeSafe(pathValue: string, configuration?: string): McpResolveNodeSafeResult {
    // parseCanonicalPath бросит ошибку при невалидном синтаксисе — пробрасываем
    // её наверх как ошибку tool (различие синтаксиса и «не нашёл узел»).
    const parsed = parseCanonicalPath(pathValue);
    const canonical = canonicalFromParsed(parsed);
    const index = this.buildIndex(configuration);
    const found = this.locateParsed(parsed, index);
    if (found) {
      return { canonical, exists: true, node: found.node };
    }
    return { canonical, exists: false };
  }

  // ── Плоский список канонических путей дерева ──────────────────────────

  /**
   * Возвращает плоский список канонических путей конфигурации без свойств.
   * Используется MCP-tool `v8vscedit_tree` как быстрая альтернатива
   * пагинированному обходу `list`.
   */
  listTreePaths(options: McpListTreePathsOptions = {}): McpListTreePathsResult {
    const scope = options.scope ?? 'all';
    const depth = options.depth ?? 'objects';
    const includeSet = options.include && options.include.length > 0
      ? new Set(options.include.map((value) => value.trim()).filter(Boolean))
      : undefined;
    const limit = options.limit !== undefined
      ? Math.max(1, Math.min(options.limit, 50_000))
      : undefined;

    const roots = this.getConfigRoots(options.configuration);
    const configurationLabel = roots.length === 1
      ? roots[0].textLabel
      : (options.configuration ?? roots.map((root) => root.textLabel).join(', '));

    const index = this.buildIndex(options.configuration);
    const filtered: string[] = [];
    for (const item of index) {
      const canonical = item.canonicalPath;
      if (!canonical) {
        continue;
      }
      if (!matchesScope(canonical, item, scope)) {
        continue;
      }
      if (!matchesDepth(canonical, item, depth)) {
        continue;
      }
      if (includeSet && !matchesInclude(canonical, includeSet)) {
        continue;
      }
      filtered.push(canonical);
    }
    filtered.sort((left, right) => left.localeCompare(right, 'ru'));

    const total = filtered.length;
    const paths = limit !== undefined && filtered.length > limit
      ? filtered.slice(0, limit)
      : filtered;
    return {
      configuration: configurationLabel,
      total,
      truncated: limit !== undefined && total > paths.length,
      paths,
    };
  }

  /**
   * Возвращает XML-путь объекта по каноническому пути либо `null`,
   * если вход не соответствует канону или указанный объект не найден.
   *
   * Абсолютные пути файлов поддерживаются как escape-hatch для tools,
   * которые ещё не унифицированы по E5 (передают пути напрямую).
   * Относительные пути от корня конфигурации не поддерживаются (legacy).
   */
  resolveObjectXmlPath(input: string, configuration?: string): string | null {
    const trimmed = input.trim();
    if (!trimmed) {
      return null;
    }

    // Абсолютные пути к существующим файлам — escape-hatch для E5-tools.
    if (path.isAbsolute(trimmed) && fs.existsSync(trimmed) && fs.statSync(trimmed).isFile()) {
      return trimmed;
    }

    try {
      const node = this.resolveNode(trimmed, configuration);
      if (node.xmlPath && fs.existsSync(node.xmlPath)) {
        return node.xmlPath;
      }
    } catch {
      return null;
    }
    return null;
  }

  // ── Поиск ────────────────────────────────────────────────────────────

  search(options: {
    readonly query: string;
    readonly configuration: string;
    readonly kind?: string;
    readonly limit?: number;
  }): McpMetadataPathSummary[] {
    const query = options.query.trim();
    if (query.length === 0) {
      return [];
    }
    const limit = clampLimit(options.limit);
    const kindFilter = options.kind ? resolveMetaKindFromInput(options.kind) : undefined;
    const normalizedQuery = normalize(query);

    return this.buildIndex(options.configuration)
      .filter((item) => {
        if (kindFilter && item.node.nodeKind !== kindFilter) {
          return false;
        }
        return normalize(item.node.textLabel).includes(normalizedQuery)
          || normalize(item.canonicalPath).includes(normalizedQuery);
      })
      .slice(0, limit)
      .map((item) => this.summarize(item));
  }

  // ── Список ───────────────────────────────────────────────────────────

  list(options: {
    readonly configuration?: string;
    readonly parentPath?: string;
    readonly kind?: string;
    readonly limit?: number;
  } = {}): McpMetadataPathSummary[] {
    const limit = clampLimit(options.limit);
    const kindFilter = options.kind ? resolveMetaKindFromInput(options.kind) : undefined;
    const index = this.buildIndex(options.configuration);

    let parentPath: string | undefined;
    if (options.parentPath !== undefined) {
      const parent = this.findInIndex(index, options.parentPath);
      if (!parent) {
        throw new Error(`Метаданные по пути "${options.parentPath}" не найдены.`);
      }
      parentPath = parent.canonicalPath;
    }

    return index
      .filter((item) => {
        if (parentPath !== undefined && !isDirectChildPath(parentPath, item.canonicalPath)) {
          return false;
        }
        if (kindFilter && item.node.nodeKind !== kindFilter) {
          return false;
        }
        return item.canonicalPath.length > 0;
      })
      .slice(0, limit)
      .map((item) => this.summarize(item));
  }

  // ── Цель добавления ──────────────────────────────────────────────────

  resolveAddTarget(request: McpAddMetadataByPathRequest): McpAddMetadataByPathTarget {
    const parsed = parseCanonicalPath(request.path);
    const index = this.buildIndex(request.configuration);

    const roots = this.getConfigRoots(request.configuration);

    if (parsed.kind === 'root') {
      const groupNode = this.findRootCollectionGroupInTree(roots, parsed.metaKind);
      if (!groupNode) {
        throw new Error(`Не найдена корневая группа для типа «${parsed.metaKind}» в конфигурации.`);
      }
      if (groupNode.addMetadataTarget?.kind !== 'root') {
        throw new Error(`У группы «${groupNode.textLabel}» отсутствует цель добавления корневого объекта.`);
      }
      return {
        target: groupNode.addMetadataTarget,
        name: parsed.name,
        sourceNode: groupNode,
      };
    }

    if (parsed.kind === 'subsystem') {
      // Добавление новой подсистемы внутри иерархии (создаётся последний сегмент).
      if (parsed.names.length === 1) {
        const groupNode = this.findRootCollectionGroupInTree(roots, 'Subsystem');
        if (groupNode?.addMetadataTarget?.kind === 'root') {
          return {
            target: groupNode.addMetadataTarget,
            name: parsed.names[0],
            sourceNode: groupNode,
          };
        }
      }
      throw new Error(
        `Добавление вложенной подсистемы по пути "${request.path}" не поддерживается ` +
        `этим инструментом — используй v8vscedit_compile_subsystem с parentPath.`,
      );
    }

    if (parsed.kind === 'child') {
      const owner = this.findRootObjectNode(index, parsed.rootKind, parsed.rootName);
      if (!owner?.xmlPath) {
        throw new Error(
          `Не найден объект-владелец «${suggestRootSegment(parsed.rootKind)}.${parsed.rootName}» для пути "${request.path}".`,
        );
      }

      // Колонка ТЧ: цель — child с childTag='Column' и tabularSectionName.
      if (parsed.tabularSectionName !== undefined) {
        const tsNode = this.findTabularSection(owner, parsed.tabularSectionName);
        if (!tsNode) {
          throw new Error(
            `Табличная часть "${parsed.tabularSectionName}" не найдена в объекте «${owner.textLabel}».`,
          );
        }
        return {
          target: {
            kind: 'child',
            ownerObjectXmlPath: owner.xmlPath,
            childTag: 'Column',
            tabularSectionName: parsed.tabularSectionName,
          },
          name: parsed.childName,
          sourceNode: tsNode,
        };
      }

      // Обычный дочерний элемент: определяем childTag по подсказке или сегменту.
      const childTag = this.resolveChildTagForAdd(parsed.childTag, request.childTag);
      const groupNode = this.findChildAddGroup(owner, childTag);
      return {
        target: { kind: 'child', ownerObjectXmlPath: owner.xmlPath, childTag },
        name: parsed.childName,
        sourceNode: groupNode,
      };
    }

    throw new Error(
      `Путь "${request.path}" должен указывать на корневой объект, подсистему или дочерний элемент.`,
    );
  }

  // ── Внутренние помощники ─────────────────────────────────────────────

  /**
   * Резолвит ChildTag для операции добавления. Парсер canonical pre-set'ает
   * `Attribute` для прямой формы (`Справочники.X.Y`), поэтому в этом случае
   * приоритет отдаётся явному `childTag` от вызова. Для сегментированных форм
   * парсер уже даёт правильный тег.
   */
  private resolveChildTagForAdd(parsedTag: ChildTag, requested: ChildTag | 'Column' | undefined): ChildTag {
    if (requested && requested !== 'Column') {
      return requested;
    }
    return parsedTag;
  }

  private resolveIndexedNode(pathValue: string, configuration?: string): IndexedNode {
    const parsed = parseCanonicalPath(pathValue);
    const index = this.buildIndex(configuration);
    const result = this.locateParsed(parsed, index);
    if (!result) {
      throw new Error(`Метаданные по пути "${pathValue}" не найдены.`);
    }
    return result;
  }

  private locateParsed(parsed: ParsedCanonicalPath, index: readonly IndexedNode[]): IndexedNode | undefined {
    if (parsed.kind === 'configuration' || parsed.kind === 'extension') {
      return index.find((item) => item.node === item.root && item.node.nodeKind === parsed.kind);
    }
    if (parsed.kind === 'configurationModule') {
      // Модули уровня конфигурации в дереве не представлены отдельными узлами.
      return undefined;
    }
    if (parsed.kind === 'subsystem') {
      const expected = canonicalSubsystemPath(parsed.names);
      return index.find((item) => item.canonicalPath === expected && item.node.nodeKind === 'Subsystem');
    }
    if (parsed.kind === 'root') {
      const expected = canonicalRootPath(parsed.metaKind, parsed.name);
      return index.find((item) => item.canonicalPath === expected
        && item.node.nodeKind === parsed.metaKind
        && !item.node.metaContext);
    }
    if (parsed.kind === 'child') {
      const owner = this.findRootObjectNode(index, parsed.rootKind, parsed.rootName);
      if (!owner?.xmlPath) {
        return undefined;
      }
      const expected = canonicalChildPath({
        rootKind: parsed.rootKind,
        rootName: parsed.rootName,
        childTag: parsed.childTag,
        childName: parsed.childName,
        tabularSectionName: parsed.tabularSectionName,
      });
      // Сравниваем именно построенный канонический путь — он сам нормализует
      // прямые и сегментированные дочерние формы по правилам домена.
      return index.find((item) => item.canonicalPath === expected
        || (parsed.tabularSectionName === undefined
            && isCandidateDirectChild(item, parsed.rootKind, parsed.rootName, parsed.childName)));
    }
    // 'module': в дереве отдельных узлов модуля нет — резолв пока невозможен.
    return undefined;
  }

  private findRootObjectNode(index: readonly IndexedNode[], rootKind: MetaKind, rootName: string): MetadataNode | undefined {
    const expected = canonicalRootPath(rootKind, rootName);
    const entry = index.find((item) => item.canonicalPath === expected
      && item.node.nodeKind === rootKind
      && !item.node.metaContext);
    return entry?.node;
  }

  /**
   * Поиск группы добавления корневых объектов прямо по дереву (узлы групп
   * сами по себе не попадают в индекс, поэтому проходим их отдельно).
   */
  private findRootCollectionGroupInTree(roots: readonly MetadataNode[], kind: MetaKind): MetadataNode | undefined {
    const visit = (node: MetadataNode): MetadataNode | undefined => {
      const target = node.addMetadataTarget;
      if (target?.kind === 'root' && target.targetKind === kind) {
        return node;
      }
      // Не уходим внутрь готовых объектов метаданных — там целей добавления корня нет.
      if (node.xmlPath && node.nodeKind !== 'configuration' && node.nodeKind !== 'extension') {
        return undefined;
      }
      for (const child of node.childrenLoader?.() ?? []) {
        const found = visit(child);
        if (found) {
          return found;
        }
      }
      return undefined;
    };
    for (const root of roots) {
      const found = visit(root);
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  private findChildAddGroup(owner: MetadataNode, childTag: ChildTag): MetadataNode | undefined {
    return owner.childrenLoader?.().find((node) => {
      const target = node.addMetadataTarget;
      return target?.kind === 'child' && target.childTag === childTag;
    });
  }

  private findTabularSection(owner: MetadataNode, name: string): MetadataNode | undefined {
    for (const group of owner.childrenLoader?.() ?? []) {
      for (const child of group.childrenLoader?.() ?? []) {
        if (child.nodeKind === 'TabularSection' && child.textLabel === name) {
          return child;
        }
      }
    }
    return undefined;
  }

  private findInIndex(index: readonly IndexedNode[], pathValue: string): IndexedNode | undefined {
    // Сначала пробуем нормальный канонический разбор — это даёт защиту от
    // alias-форм с понятной ошибкой ещё до поиска.
    let parsed: ParsedCanonicalPath;
    try {
      parsed = parseCanonicalPath(pathValue);
    } catch {
      return undefined;
    }
    return this.locateParsed(parsed, index);
  }

  // ── Построение индекса ───────────────────────────────────────────────

  private buildIndex(configuration?: string): IndexedNode[] {
    const roots = this.getConfigRoots(configuration);
    const result: IndexedNode[] = [];
    for (const root of roots) {
      this.collectRoot(root, result);
      this.collectRootChildren(root, result);
    }
    return result;
  }

  private getConfigRoots(configuration?: string): MetadataNode[] {
    const roots = flattenConfigRoots(this.treeProvider.getAutomationRoots());
    if (configuration === undefined || configuration.trim().length === 0) {
      if (roots.length > 1) {
        throw new Error(`Укажите configuration. Найдено несколько конфигураций: ${roots.map((root) => root.textLabel).join(', ')}.`);
      }
      return roots;
    }
    const normalized = normalize(configuration);
    const normalizedPath = path.resolve(configuration);
    const found = roots.filter((root) => {
      const rootPath = root.xmlPath ? path.dirname(root.xmlPath) : '';
      return normalize(root.textLabel) === normalized
        || normalize(rootPath) === normalized
        || path.resolve(rootPath).toLowerCase() === normalizedPath.toLowerCase();
    });
    if (found.length === 0) {
      throw new Error(`Конфигурация "${configuration}" не найдена. Используйте имя из v8vscedit_workspace_overview.`);
    }
    return found;
  }

  private collectRoot(root: MetadataNode, result: IndexedNode[]): void {
    const segment = META_TYPES[root.nodeKind].pathSegment;
    if (segment === undefined) {
      return;
    }
    result.push({ node: root, root, canonicalPath: segment });
  }

  private collectRootChildren(root: MetadataNode, result: IndexedNode[]): void {
    for (const group of root.childrenLoader?.() ?? []) {
      this.collectRootGroup(root, group, result);
    }
  }

  private collectRootGroup(root: MetadataNode, group: MetadataNode, result: IndexedNode[]): void {
    // Узел группы (Общие/Документы и т.п.) собственного канонического пути не имеет —
    // в индекс попадают только сами объекты и их потомки. Это убирает неуникальные
    // «листы-обёртки» из MCP-выдачи.
    for (const child of group.childrenLoader?.() ?? []) {
      if (!child.xmlPath || child.metaContext) {
        // Вложенная подгруппа (например, ветка Документы → Нумераторы).
        if (child.addMetadataTarget?.kind === 'root' || child.childrenLoader) {
          this.collectRootGroup(root, child, result);
        }
        continue;
      }

      const objectKind = child.nodeKind;
      if (objectKind === 'Subsystem') {
        this.collectSubsystemTree(root, child, [child.textLabel], result);
        continue;
      }

      const def = META_TYPES[objectKind];
      if (def.pathSegment === undefined) {
        continue;
      }
      const objectPath = canonicalRootPath(objectKind, child.textLabel);
      result.push({ node: child, root, canonicalPath: objectPath });
      this.collectObjectChildren(root, child, objectKind, child.textLabel, result);
    }
  }

  private collectSubsystemTree(
    root: MetadataNode,
    node: MetadataNode,
    hierarchy: readonly string[],
    result: IndexedNode[],
  ): void {
    const canonical = canonicalSubsystemPath(hierarchy);
    result.push({ node, root, canonicalPath: canonical });

    for (const child of node.childrenLoader?.() ?? []) {
      if (child.nodeKind !== 'Subsystem' || !child.xmlPath) {
        continue;
      }
      this.collectSubsystemTree(root, child, [...hierarchy, child.textLabel], result);
    }
  }

  private collectObjectChildren(
    root: MetadataNode,
    objectNode: MetadataNode,
    rootKind: MetaKind,
    rootName: string,
    result: IndexedNode[],
  ): void {
    for (const group of objectNode.childrenLoader?.() ?? []) {
      const target = group.addMetadataTarget;
      const childTag = (target?.kind === 'child' && target.childTag !== 'Column')
        ? target.childTag
        : undefined;
      if (!childTag) {
        continue;
      }
      // Сам узел группы (UI-обёртка) канонического пути не имеет — в индекс
      // его не помещаем. Каноническая модель оперирует объектами и их детьми.
      for (const child of group.childrenLoader?.() ?? []) {
        this.collectChildNode(root, rootKind, rootName, childTag, child, result);
      }
    }
  }

  private collectChildNode(
    root: MetadataNode,
    rootKind: MetaKind,
    rootName: string,
    childTag: ChildTag,
    child: MetadataNode,
    result: IndexedNode[],
  ): void {
    const canonical = canonicalChildPath({
      rootKind,
      rootName,
      childTag,
      childName: child.textLabel,
    });
    result.push({ node: child, root, canonicalPath: canonical });

    if (childTag === 'TabularSection') {
      for (const column of child.childrenLoader?.() ?? []) {
        if (column.nodeKind !== 'Column') {
          continue;
        }
        const columnCanonical = canonicalChildPath({
          rootKind,
          rootName,
          childTag: 'Attribute',
          childName: column.textLabel,
          tabularSectionName: child.textLabel,
        });
        result.push({ node: column, root, canonicalPath: columnCanonical });
      }
    }
  }

  private summarize(item: IndexedNode): McpMetadataPathSummary {
    return {
      path: item.canonicalPath,
      label: item.node.textLabel,
      nodeKind: item.node.nodeKind,
      xmlPath: item.node.xmlPath,
      ownerObjectXmlPath: item.node.metaContext?.ownerObjectXmlPath,
      canAddMetadata: Boolean(item.node.addMetadataTarget),
      canRemoveMetadata: Boolean(item.node.canRemoveMetadata),
    };
  }
}

// ─── Утилиты модуля ───────────────────────────────────────────────────────

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

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
}

/**
 * Безопасный доступ к `pluralLabel` по строковому ключу. Возвращает либо
 * человекочитаемый русский label из реестра, либо сам ключ (если он не
 * входит в `META_TYPES` — например, кастомный тип из ChildObjects).
 */
function getPluralLabelForKind(kind: string): string {
  return (META_TYPES as Readonly<Record<string, { pluralLabel: string } | undefined>>)[kind]?.pluralLabel ?? kind;
}

/**
 * Резолвит русский ввод имени типа метаданных в `MetaKind`.
 *
 * Принимает: канонический сегмент пути (`Справочники`, `Документы`), русский
 * label единственного и множественного числа, английский `kind` (для удобства
 * фильтра). Возвращает `undefined`, если входная строка не соответствует
 * ни одному типу.
 */
function resolveMetaKindFromInput(value: string): MetaKind | undefined {
  const normalized = normalize(value);
  for (const [kind, def] of Object.entries(META_TYPES)) {
    const aliases = [def.kind, def.label, def.pluralLabel, def.pathSegment ?? '', def.folder ?? ''];
    if (aliases.some((alias) => alias && normalize(alias) === normalized)) {
      return kind as MetaKind;
    }
  }
  return undefined;
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

/**
 * Проверяет, что узел индекса — кандидат «прямого» дочернего элемента
 * с заданным именем (Реквизит/ТабличнаяЧасть/Измерение/Ресурс/Значение
 * перечисления). Используется, когда `parseCanonicalPath` для строки
 * `Справочники.X.Y` отдаёт «лучшую догадку» `childTag='Attribute'`, а
 * фактический тип в дереве может оказаться другим (например, TabularSection).
 */
function isCandidateDirectChild(
  item: IndexedNode,
  rootKind: MetaKind,
  rootName: string,
  childName: string,
): boolean {
  if (!item.node.metaContext) {
    return false;
  }
  if (item.node.textLabel !== childName) {
    return false;
  }
  // Прямые дочерние элементы используются только когда tabularSectionName не задан.
  if (item.node.metaContext.tabularSectionName !== undefined) {
    return false;
  }
  // Должен быть один из прямых типов (см. §1.3 плана).
  const directKinds: readonly string[] = ['Attribute', 'TabularSection', 'Dimension', 'Resource', 'EnumValue'];
  if (!directKinds.includes(item.node.nodeKind)) {
    return false;
  }
  // canonicalPath индекса начинается с корня объекта.
  const expectedRoot = canonicalRootPath(rootKind, rootName);
  // Прямые формы — это `{root}.{childName}`.
  return item.canonicalPath === `${expectedRoot}.${childName}`
    // На случай, если ChildTag CHILD_TAG_CONFIG поменяет правила направление — fallback.
    || canonicalContainsRoot(item.canonicalPath, expectedRoot);
}

function canonicalContainsRoot(canonical: string, expectedRoot: string): boolean {
  return canonical === expectedRoot || canonical.startsWith(`${expectedRoot}.`);
}

// ─── Утилиты для listTreePaths / resolveNodeSafe ─────────────────────────

/**
 * Восстанавливает каноническую форму пути из результата `parseCanonicalPath`.
 * Используется в `resolveNodeSafe` для возврата нормализованного входа даже
 * когда узла в дереве нет.
 */
function canonicalFromParsed(parsed: ParsedCanonicalPath): string {
  const configurationSegment = META_TYPES.configuration.pathSegment ?? 'Конфигурация';
  const extensionSegment = META_TYPES.extension.pathSegment ?? 'Расширение';
  switch (parsed.kind) {
    case 'configuration':
      return configurationSegment;
    case 'extension':
      return extensionSegment;
    case 'configurationModule':
      return `${parsed.root === 'configuration' ? configurationSegment : extensionSegment}.${parsed.segment}`;
    case 'subsystem':
      return canonicalSubsystemPath(parsed.names);
    case 'root':
      return canonicalRootPath(parsed.metaKind, parsed.name);
    case 'child':
      return canonicalChildPath({
        rootKind: parsed.rootKind,
        rootName: parsed.rootName,
        childTag: parsed.childTag,
        childName: parsed.childName,
        tabularSectionName: parsed.tabularSectionName,
      });
    case 'module':
      // canonicalModulePath требует MetaKind/rootName; для модулей объекта это просто хвост.
      return parsed.subPath !== undefined
        ? `${canonicalRootPath(parsed.rootKind, parsed.rootName)}.${
            (parsed.subPath.tag === 'Form' ? 'Форма' : 'Команда')
          }.${parsed.subPath.name}.${parsed.slot === 'ChildForm' ? 'МодульФормы' : 'МодульКоманды'}`
        : `${canonicalRootPath(parsed.rootKind, parsed.rootName)}.${parsed.slot}`;
  }
}

/** Возвращает первый сегмент канонического пути (`Справочники`, `Подсистема`, …). */
function firstSegment(canonical: string): string {
  const dot = canonical.indexOf('.');
  return dot === -1 ? canonical : canonical.slice(0, dot);
}

/**
 * Фильтр по `scope`. Группа определяется по `MetaGroup` корня объекта
 * (`top` — прикладные, `common` — общие). Подсистемы выделены отдельно.
 */
function matchesScope(canonical: string, item: IndexedNode, scope: 'all' | 'objects' | 'common' | 'subsystems'): boolean {
  if (scope === 'all') {
    return true;
  }
  // Подсистемы — единственный корневой тип в группе `common`, для которого
  // нужно отдельное правило: по требованию scope='common' включает в т.ч. их.
  const head = firstSegment(canonical);
  const subsystemSegment = META_TYPES.Subsystem.pathSegment ?? 'Подсистема';
  if (scope === 'subsystems') {
    return head === subsystemSegment;
  }
  // Сами псевдо-корни конфигурации/расширения относим к «common» (это
  // общие настройки, а не прикладные объекты).
  if (item.node.nodeKind === 'configuration' || item.node.nodeKind === 'extension') {
    return scope === 'common';
  }
  // Определяем группу по типу корневого MetaKind объекта в индексе. Для
  // дочерних элементов берём тип корня (это корневой объект-владелец).
  const rootKind = item.root.nodeKind === 'configuration' || item.root.nodeKind === 'extension'
    ? findRootKindByHead(head)
    : (item.root.nodeKind);
  if (!rootKind) {
    return false;
  }
  // Сам узел может быть Subsystem — он живёт в group='common', и при
  // scope='common' должен попасть в выдачу.
  const def = (META_TYPES as Readonly<Record<string, { group?: string } | undefined>>)[rootKind];
  const group = def?.group;
  if (scope === 'objects') {
    return group === 'top' || group === 'documents-branch';
  }
  // scope === 'common'
  return group === 'common' || group === 'root';
}

/**
 * Определяет `MetaKind` корня по русскому сегменту пути (для случая, когда
 * индексируется псевдо-корень `configuration`, а нужно понять тип ветки).
 */
function findRootKindByHead(head: string): string | undefined {
  for (const [kind, def] of Object.entries(META_TYPES)) {
    if (def.pathSegment === head) {
      return kind;
    }
  }
  return undefined;
}

/**
 * Фильтр по глубине. Корнем считается путь без точки или путь подсистемы
 * с одним сегментом-именем; объектом — путь с двумя сегментами для обычных
 * корней или двумя сегментами для подсистем; всё остальное — дочерние.
 */
function matchesDepth(canonical: string, item: IndexedNode, depth: 'roots' | 'objects' | 'children'): boolean {
  const isConfigRoot = item.node.nodeKind === 'configuration' || item.node.nodeKind === 'extension';
  const isSubsystem = item.node.nodeKind === 'Subsystem';
  const segCount = canonical.split('.').length;

  if (depth === 'children') {
    return true;
  }

  // depth: 'roots' — только сам узел корня объекта/подсистемы без дочерних.
  // Для подсистем «корень» — это самая верхняя подсистема (Подсистема.X, 2 сегмента).
  if (depth === 'roots') {
    if (isConfigRoot) {
      return true;
    }
    if (isSubsystem) {
      return segCount === 2;
    }
    // Прикладной объект — `Корень.Имя` (2 сегмента).
    return segCount === 2 && !item.node.metaContext;
  }

  // depth: 'objects' — корни + сами объекты, без дочерних элементов.
  if (isConfigRoot) {
    return true;
  }
  if (isSubsystem) {
    // Все уровни иерархии подсистем — это «объекты», у них нет «детей»
    // в смысле реквизитов/форм/команд (только дочерние подсистемы,
    // которые сами по себе — объекты).
    return true;
  }
  // Корневой объект (Справочники.X) попадает; дочерние (Справочники.X.Y) — нет.
  if (item.node.metaContext) {
    return false;
  }
  return segCount === 2;
}

/** Фильтр по корневому сегменту пути из массива `include`. */
function matchesInclude(canonical: string, includeSet: ReadonlySet<string>): boolean {
  return includeSet.has(firstSegment(canonical));
}

