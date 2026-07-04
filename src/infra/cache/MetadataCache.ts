import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { CHILD_TAG_CONFIG, type ChildTag } from '../../domain/ChildTag';
import type { ConfigEntry, ConfigInfo } from '../../domain/Configuration';
import type { MetaChild } from '../../domain/MetaObject';
import { type MetaKind, getMetaFolder, getMetaType, getMetaTypesByGroup } from '../../domain/MetaTypes';
import { buildScopeKey } from './HashCache';
import type { MetadataGitDecorationTarget } from '../git/GitMetadataStatusService';
import { getObjectLocationFromXml, resolveObjectXmlPath } from '../fs/MetaPathResolver';
import { parseConfigXml, parseObjectXml, readTemplateTypeFromXml } from '../xml';

export type MetadataCacheSingleClickAction = 'openTemplateContent';

export interface MetadataCacheNode {
  type: MetaKind;
  name: string;
  label: string;
  xmlPath?: string;
  decorationPath?: string;
  gitDecorationTarget?: MetadataGitDecorationTarget;
  tooltip?: string;
  ownershipTag?: 'OWN' | 'BORROWED';
  hidePropertiesCommand?: boolean;
  metaContext?: {
    rootMetaKind: MetaKind;
    tabularSectionName?: string;
    urlTemplateName?: string;
    standardAttributeName?: string;
    ownerObjectXmlPath?: string;
  };
  addMetadataTarget?: MetadataCacheAddTarget;
  canRemoveMetadata?: boolean;
  singleClickAction?: MetadataCacheSingleClickAction;
  children: MetadataCacheNode[];
}

export type MetadataCacheAddTarget =
  | {
    kind: 'root';
    configRoot: string;
    configKind: 'cf' | 'cfe';
    targetKind: MetaKind;
    namePrefix?: string;
  }
  | {
    kind: 'child';
    ownerObjectXmlPath: string;
    childTag: ChildTag | 'Column';
    tabularSectionName?: string;
    urlTemplateName?: string;
  };

/**
 * Отпечаток состояния ФС на момент сохранения снимка.
 * Используется для инвалидации кэша при любом внешнем изменении выгрузки
 * (правка Configuration.xml или изменение состава корневого каталога),
 * которое произошло в обход перехваченных операций добавления/переименования.
 */
export interface MetadataCacheFingerprint {
  configurationXml: { mtimeMs: number; size: number };
  rootDir: { mtimeMs: number };
}

export interface MetadataCacheSnapshot {
  schemaVersion: 17;
  scopeKey: string;
  generatedAt: string;
  rootPath: string;
  configKind: 'cf' | 'cfe';
  fingerprint: MetadataCacheFingerprint;
  root: MetadataCacheNode;
}

export interface MetadataCacheUpdateResult {
  snapshot: MetadataCacheSnapshot;
  updatedPartially: boolean;
}

const METADATA_CACHE_DIR = path.join('.v8vscedit', 'meta');
const CACHE_SCHEMA_VERSION = 17;

/**
 * Строит полный снимок дерева метаданных без ленивых загрузчиков, чтобы UI мог восстановить дерево из JSON.
 * Отпечаток ФС при первичной сборке проставляется заглушкой и пересчитывается в saveMetadataCache
 * из snapshot.rootPath — единая точка гарантирует актуальность отпечатка после любых мутаций.
 */
export function buildMetadataCacheSnapshot(scopeKey: string, entry: ConfigEntry): MetadataCacheSnapshot {
  const info = parseConfigXml(path.join(entry.rootPath, 'Configuration.xml'));
  return {
    schemaVersion: CACHE_SCHEMA_VERSION,
    scopeKey,
    generatedAt: new Date().toISOString(),
    rootPath: entry.rootPath,
    configKind: entry.kind,
    fingerprint: computeFingerprint(entry.rootPath),
    root: buildConfigNode(entry, info),
  };
}

/**
 * Вычисляет отпечаток ФС по корню выгрузки: mtime+size у Configuration.xml и mtime корневого каталога.
 * Отсутствие Configuration.xml трактуется как «нулевой» отпечаток — он не совпадёт ни с одним реальным
 * снимком, поэтому кэш будет инвалидирован при загрузке.
 */
function computeFingerprint(rootPath: string): MetadataCacheFingerprint {
  const configXmlPath = path.join(rootPath, 'Configuration.xml');
  const configStat = statSafe(configXmlPath);
  const rootStat = statSafe(rootPath);
  return {
    configurationXml: {
      mtimeMs: configStat?.mtimeMs ?? 0,
      size: configStat?.size ?? -1,
    },
    rootDir: {
      mtimeMs: rootStat?.mtimeMs ?? 0,
    },
  };
}

function statSafe(targetPath: string): fs.Stats | null {
  try {
    return fs.statSync(targetPath);
  } catch {
    return null;
  }
}

/** Глубоко-частичный вид отпечатка: читается из JSON старого/чужого формата, где полей может не быть. */
interface PartialFingerprint {
  configurationXml?: { mtimeMs?: number; size?: number };
  rootDir?: { mtimeMs?: number };
}

function fingerprintMatches(saved: PartialFingerprint | undefined, current: MetadataCacheFingerprint): boolean {
  return (
    saved?.configurationXml?.mtimeMs === current.configurationXml.mtimeMs &&
    saved.configurationXml.size === current.configurationXml.size &&
    saved.rootDir?.mtimeMs === current.rootDir.mtimeMs
  );
}

export function saveMetadataCache(projectRoot: string, snapshot: MetadataCacheSnapshot): void {
  const filePath = getMetadataCacheFilePath(projectRoot, snapshot.scopeKey);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  // Отпечаток пересчитываем здесь, в единой точке, уже ПОСЛЕ того как мутации ФС применены
  // (объект добавлен/переименован/удалён), чтобы updateMetadataCacheAfter* писали актуальное состояние.
  const persisted: MetadataCacheSnapshot = { ...snapshot, fingerprint: computeFingerprint(snapshot.rootPath) };
  // Пишем во временный файл рядом и атомарно подменяем целевой через rename,
  // чтобы прерывание записи не оставило битый JSON в кэше (образец — HashCache.saveHashCache).
  const tempPath = `${filePath}.${String(process.pid)}.${String(Date.now())}.tmp`;
  try {
    fs.writeFileSync(tempPath, JSON.stringify(persisted), 'utf-8');
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    fs.rmSync(tempPath, { force: true });
    throw error;
  }
  // Держим переданный снимок согласованным с тем, что записано на диск.
  snapshot.fingerprint = persisted.fingerprint;
}

export function loadMetadataCache(projectRoot: string, scopeKey: string): MetadataCacheSnapshot | null {
  const filePath = getMetadataCacheFilePath(projectRoot, scopeKey);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<MetadataCacheSnapshot>;
    if (parsed.schemaVersion !== CACHE_SCHEMA_VERSION || parsed.scopeKey !== scopeKey || !parsed.root) {
      return null;
    }
    // Свежесть: отпечаток снимка обязан совпасть с текущим состоянием ФС выгрузки,
    // иначе кэш устарел (внешняя правка Configuration.xml или изменение состава каталога).
    const current = computeFingerprint(typeof parsed.rootPath === 'string' ? parsed.rootPath : '');
    if (!fingerprintMatches(parsed.fingerprint, current)) {
      return null;
    }
    return parsed as MetadataCacheSnapshot;
  } catch {
    return null;
  }
}

export function saveMetadataCacheForEntry(projectRoot: string, scopeKey: string, entry: ConfigEntry): void {
  saveMetadataCache(projectRoot, buildMetadataCacheSnapshot(scopeKey, entry));
}

/**
 * Обновляет JSON-кэш после интерактивного добавления одного объекта без полного пересоздания снимка.
 * Полная сборка остаётся только аварийным путём, когда кэш ещё не создан или в нём нет ожидаемой ветки.
 */
export function updateMetadataCacheAfterAdd(
  projectRoot: string,
  entry: ConfigEntry,
  target: MetadataCacheAddTarget,
  name: string
): MetadataCacheUpdateResult {
  const info = parseConfigXml(path.join(entry.rootPath, 'Configuration.xml'));
  const scopeKey = buildMetadataCacheScopeKey(entry, info);
  const cached = loadMetadataCache(projectRoot, scopeKey);
  if (!cached) {
    const snapshot = buildMetadataCacheSnapshot(scopeKey, entry);
    saveMetadataCache(projectRoot, snapshot);
    return { snapshot, updatedPartially: false };
  }

  const updated = target.kind === 'root'
    ? updateRootObjectCache(cached, entry, info, target.targetKind, name)
    : updateChildObjectCache(cached, target.ownerObjectXmlPath);

  if (!updated) {
    const snapshot = buildMetadataCacheSnapshot(scopeKey, entry);
    saveMetadataCache(projectRoot, snapshot);
    return { snapshot, updatedPartially: false };
  }

  cached.generatedAt = new Date().toISOString();
  saveMetadataCache(projectRoot, cached);
  return { snapshot: cached, updatedPartially: true };
}

/**
 * Точечно обновляет JSON-кэш после переименования корневого объекта метаданных.
 * Находит узел по oldXmlPath, перестраивает его из newXmlPath и сохраняет кэш.
 * Намного быстрее полного пересоздания снимка — не читает остальные XML-файлы.
 */
export function updateMetadataCacheAfterRename(
  projectRoot: string,
  entry: ConfigEntry,
  oldXmlPath: string,
  newXmlPath: string
): MetadataCacheUpdateResult | null {
  const info = parseConfigXml(path.join(entry.rootPath, 'Configuration.xml'));
  const scopeKey = buildMetadataCacheScopeKey(entry, info);
  const cached = loadMetadataCache(projectRoot, scopeKey);

  if (!cached) {
    const snapshot = buildMetadataCacheSnapshot(scopeKey, entry);
    saveMetadataCache(projectRoot, snapshot);
    return { snapshot, updatedPartially: false };
  }

  const target = findObjectNodeByChangedPath(cached.root, oldXmlPath);
  if (!target) {
    const snapshot = buildMetadataCacheSnapshot(scopeKey, entry);
    saveMetadataCache(projectRoot, snapshot);
    return { snapshot, updatedPartially: false };
  }

  // Патчим xmlPath перед вызовом rebuildObjectNodeFromXml — он перечитает XML с нового пути
  target.node.xmlPath = newXmlPath;
  const refreshed = rebuildObjectNodeFromXml(entry, info, target.node);

  if (!refreshed) {
    const snapshot = buildMetadataCacheSnapshot(scopeKey, entry);
    saveMetadataCache(projectRoot, snapshot);
    return { snapshot, updatedPartially: false };
  }

  target.parent.children[target.index] = refreshed;
  cached.generatedAt = new Date().toISOString();
  saveMetadataCache(projectRoot, cached);
  return { snapshot: cached, updatedPartially: true };
}

/**
 * Обновляет JSON-кэш дерева по внешним изменениям файлов выгрузки.
 * Hash-кэш загрузки в 1С не трогается: он должен отражать последнее успешное
 * состояние синхронизации, а не каждое локальное редактирование.
 */
export function updateMetadataCacheForChangedFiles(
  projectRoot: string,
  entry: ConfigEntry,
  filePaths: string[]
): MetadataCacheUpdateResult | null {
  const relatedFiles = filePaths.filter((filePath) => isPathInside(filePath, entry.rootPath));
  if (relatedFiles.length === 0) {
    return null;
  }

  const info = parseConfigXml(path.join(entry.rootPath, 'Configuration.xml'));
  const scopeKey = buildMetadataCacheScopeKey(entry, info);
  const cached = loadMetadataCache(projectRoot, scopeKey);
  if (!cached) {
    const snapshot = buildMetadataCacheSnapshot(scopeKey, entry);
    saveMetadataCache(projectRoot, snapshot);
    return { snapshot, updatedPartially: false };
  }

  if (relatedFiles.some((filePath) => isConfigurationXml(filePath))) {
    const snapshot = buildMetadataCacheSnapshot(scopeKey, entry);
    saveMetadataCache(projectRoot, snapshot);
    return { snapshot, updatedPartially: false };
  }

  // Несколько relatedFiles одной пары (Object.xml + Ext/ObjectModule.bsl) резолвятся в ОДИН
  // и тот же узел дерева. Дедуплицируем по идентичности узла, чтобы не задваивать перестройку
  // и не бить splice'ом по устаревшим индексам соседей.
  const targetsByNode = new Map<MetadataCacheNode, { parent: MetadataCacheNode; node: MetadataCacheNode }>();
  for (const filePath of relatedFiles) {
    if (path.extname(filePath).toLowerCase() !== '.xml') {
      continue;
    }

    const target = findObjectNodeByChangedPath(cached.root, filePath);
    if (!target || targetsByNode.has(target.node)) {
      continue;
    }
    targetsByNode.set(target.node, { parent: target.parent, node: target.node });
  }

  if (targetsByNode.size === 0) {
    return null;
  }

  // Разделяем операции: перестройка узла заменяет его на месте; удаление — вырезает из родителя.
  // Удаления собираем по родителю и применяем по убыванию индекса за один проход, чтобы
  // индексы соседних удаляемых узлов не смещались.
  // Каждый targetNode получен как parent.children[index] в findObjectNodeByChangedPath,
  // а перестройка заменяет узел на месте (длина массива не меняется), поэтому indexOf
  // гарантированно ≥ 0 — дополнительные guard'ы и флаг "было ли изменение" не нужны:
  // непустой targetsByNode уже гарантирует ≥1 перестройку или удаление.
  const removalsByParent = new Map<MetadataCacheNode, MetadataCacheNode[]>();
  for (const { parent, node: targetNode } of targetsByNode.values()) {
    const refreshed = rebuildObjectNodeFromXml(entry, info, targetNode);
    if (refreshed) {
      parent.children[parent.children.indexOf(targetNode)] = refreshed;
      continue;
    }
    const removals = removalsByParent.get(parent) ?? [];
    removals.push(targetNode);
    removalsByParent.set(parent, removals);
  }

  for (const [parent, nodesToRemove] of removalsByParent) {
    const indices = nodesToRemove
      .map((removed) => parent.children.indexOf(removed))
      .sort((left, right) => right - left);
    for (const index of indices) {
      parent.children.splice(index, 1);
    }
  }

  cached.generatedAt = new Date().toISOString();
  saveMetadataCache(projectRoot, cached);
  return { snapshot: cached, updatedPartially: true };
}

export function buildMetadataCacheScopeKey(entry: ConfigEntry, info: ConfigInfo): string {
  return buildScopeKey(entry.kind, entry.rootPath, entry.kind === 'cfe' ? info.name : '');
}

function getMetadataCacheFilePath(projectRoot: string, scopeKey: string): string {
  const hash = crypto.createHash('sha1').update(scopeKey).digest('hex');
  return path.join(projectRoot, METADATA_CACHE_DIR, `${hash}.json`);
}

function buildConfigNode(entry: ConfigEntry, info: ConfigInfo): MetadataCacheNode {
  const type: MetaKind = entry.kind === 'cf' ? 'configuration' : 'extension';
  return node({
    type,
    name: info.name,
    label: info.name,
    xmlPath: path.join(entry.rootPath, 'Configuration.xml'),
    decorationPath: entry.rootPath,
    tooltip: info.synonym || undefined,
    children: buildConfigChildren(entry, info),
  });
}

function buildConfigChildren(entry: ConfigEntry, info: ConfigInfo): MetadataCacheNode[] {
  return [
    node({
      type: 'group-common',
      name: 'common',
      label: 'Общие',
      decorationPath: entry.rootPath,
      hidePropertiesCommand: true,
      children: buildCommonSubgroups(entry, info),
    }),
    ...buildTopGroups(entry, info),
  ];
}

function buildTopGroups(entry: ConfigEntry, info: ConfigInfo): MetadataCacheNode[] {
  const result: MetadataCacheNode[] = [];

  for (const def of getMetaTypesByGroup('top')) {
    if (def.kind === 'DocumentNumerator' || def.kind === 'Sequence') {
      continue;
    }

    if (def.kind === 'Document') {
      const children = buildDocumentsBranchChildren(entry, info);
      result.push(node({
        type: 'Document',
        name: 'Document',
        label: def.pluralLabel,
        decorationPath: buildRootGroupDecorationPath(entry, def.kind),
        addMetadataTarget: buildRootAddTarget(entry, info, def.kind),
        children,
      }));
      continue;
    }

    const names = info.childObjects.get(def.kind) ?? [];
    result.push(node({
      type: def.kind,
      name: def.kind,
      label: def.pluralLabel,
      decorationPath: buildRootGroupDecorationPath(entry, def.kind),
      addMetadataTarget: buildRootAddTarget(entry, info, def.kind),
      children: names.length > 0 ? buildObjectNodes(entry, info, def.kind, names) : [],
    }));
  }

  return result;
}

function buildCommonSubgroups(entry: ConfigEntry, info: ConfigInfo): MetadataCacheNode[] {
  return getMetaTypesByGroup('common').map((def) => {
    const names = info.childObjects.get(def.kind) ?? [];
    return node({
      type: def.kind,
      name: def.kind,
      label: def.pluralLabel,
      decorationPath: buildRootGroupDecorationPath(entry, def.kind),
      addMetadataTarget: buildRootAddTarget(entry, info, def.kind),
      children: names.length > 0 ? buildObjectNodes(entry, info, def.kind, names) : [],
    });
  });
}

function buildDocumentsBranchChildren(entry: ConfigEntry, info: ConfigInfo): MetadataCacheNode[] {
  const numeratorNames = info.childObjects.get('DocumentNumerator') ?? [];
  const sequenceNames = info.childObjects.get('Sequence') ?? [];
  const documentNames = info.childObjects.get('Document') ?? [];

  return [
    node({
      type: 'NumeratorsBranch',
      name: 'NumeratorsBranch',
      label: 'Нумераторы',
      decorationPath: buildRootGroupDecorationPath(entry, 'DocumentNumerator'),
      hidePropertiesCommand: true,
      addMetadataTarget: buildRootAddTarget(entry, info, 'DocumentNumerator'),
      children: buildObjectNodes(entry, info, 'DocumentNumerator', numeratorNames),
    }),
    node({
      type: 'SequencesBranch',
      name: 'SequencesBranch',
      label: 'Последовательности',
      decorationPath: buildRootGroupDecorationPath(entry, 'Sequence'),
      hidePropertiesCommand: true,
      addMetadataTarget: buildRootAddTarget(entry, info, 'Sequence'),
      children: buildObjectNodes(entry, info, 'Sequence', sequenceNames),
    }),
    ...buildObjectNodes(entry, info, 'Document', documentNames),
  ];
}

function buildObjectNodes(entry: ConfigEntry, info: ConfigInfo, type: MetaKind, names: string[]): MetadataCacheNode[] {
  if (type === 'PaletteColor') {
    return [];
  }
  if (type === 'Subsystem') {
    return buildSubsystemNodes(entry, info, names);
  }

  const childTags = getMetaType(type).childTags ?? [];

  return names
    .map((name) => buildObjectNode(entry, info, type, name, childTags))
    .filter((item): item is MetadataCacheNode => Boolean(item));
}

function buildObjectNode(
  entry: ConfigEntry,
  info: ConfigInfo,
  type: MetaKind,
  name: string,
  childTags: readonly ChildTag[]
): MetadataCacheNode | undefined {
  const xmlPath = resolveObjectXmlPath(entry.rootPath, type, name) ?? undefined;
  if (!xmlPath) {
    return undefined;
  }

  const objectInfo = parseObjectXml(xmlPath);
  const label = objectInfo?.name ?? name;
  const ownershipTag = getOwnershipTag(entry, info, label);

  return node({
    type,
    name: label,
    label,
    xmlPath,
    decorationPath: resolveObjectDecorationPath(xmlPath),
    gitDecorationTarget: buildObjectGitDecorationTarget(type, xmlPath),
    tooltip: objectInfo?.synonym ?? undefined,
    ownershipTag,
    canRemoveMetadata: true,
    addMetadataTarget: flatChildAddTarget(xmlPath, type, childTags),
    singleClickAction: resolveObjectSingleClickAction(type, xmlPath),
    children: buildObjectChildNodes(xmlPath, type, objectInfo?.children ?? [], childTags),
  });
}

/**
 * Строит дочерние узлы объекта с учётом flatChildren: единственный дочерний тег
 * висит прямо на узле объекта, без промежуточной группы (HTTP-сервис → URL-шаблоны
 * как в конфигураторе). Иначе — обычные группы по тегам.
 * Единая точка для полной сборки и инкрементального обновления кэша.
 */
function buildObjectChildNodes(
  objectXmlPath: string,
  type: MetaKind,
  objectChildren: MetaChild[],
  childTags: readonly ChildTag[]
): MetadataCacheNode[] {
  if (childTags.length === 0) {
    return [];
  }
  if (getMetaType(type).flatChildren === true && childTags.length === 1) {
    return buildLeavesForTag(objectXmlPath, type, childTags[0], objectChildren.filter((c) => c.tag === childTags[0]));
  }
  return buildStructuredChildren(objectXmlPath, type, objectChildren, childTags);
}

/** Цель добавления для flatChildren-объекта — кнопка «Добавить» на самом узле объекта. */
function flatChildAddTarget(
  objectXmlPath: string,
  type: MetaKind,
  childTags: readonly ChildTag[]
): MetadataCacheAddTarget | undefined {
  if (getMetaType(type).flatChildren === true && childTags.length === 1) {
    return { kind: 'child', ownerObjectXmlPath: objectXmlPath, childTag: childTags[0] };
  }
  return undefined;
}

function resolveObjectSingleClickAction(type: MetaKind, xmlPath: string): MetadataCacheSingleClickAction | undefined {
  if (type !== 'CommonTemplate') {
    return undefined;
  }

  return readTemplateTypeFromXml(xmlPath) === 'TextDocument' ? 'openTemplateContent' : undefined;
}

function buildStructuredChildren(
  objectXmlPath: string,
  rootMetaKind: MetaKind,
  children: MetaChild[],
  childTags: readonly ChildTag[]
): MetadataCacheNode[] {
  return childTags.map((tag) => {
    const items = children.filter((item) => item.tag === tag);
    if (tag === 'StandardAttribute' && items.length === 0) {
      return null;
    }
    const tagCfg = CHILD_TAG_CONFIG[tag];
    return node({
      type: 'group-type',
      name: tag,
      label: tagCfg.label,
      decorationPath: undefined,
      gitDecorationTarget: isEmbeddedChildTag(tag)
        ? {
          kind: 'group',
          ownerXmlPath: objectXmlPath,
          childKind: tag,
        }
        : {
          kind: 'paths',
          ownerXmlPath: objectXmlPath,
          childKind: tag,
          paths: resolveChildGroupDecorationPaths(objectXmlPath, tag),
        },
      hidePropertiesCommand: true,
      addMetadataTarget: tag === 'StandardAttribute' ? undefined : {
        kind: 'child',
        ownerObjectXmlPath: objectXmlPath,
        childTag: tag,
      },
      children: buildLeavesForTag(objectXmlPath, rootMetaKind, tag, items),
    });
  }).filter((item): item is MetadataCacheNode => Boolean(item));
}

function buildLeavesForTag(
  objectXmlPath: string,
  rootMetaKind: MetaKind,
  tag: ChildTag,
  items: MetaChild[]
): MetadataCacheNode[] {
  if (tag === 'TabularSection') {
    return items.map((item) => buildTabularSectionNode(objectXmlPath, rootMetaKind, item));
  }

  if (tag === 'URLTemplate') {
    return items.map((item) => buildUrlTemplateNode(objectXmlPath, rootMetaKind, item));
  }

  const type = CHILD_TAG_CONFIG[tag].kind as MetaKind;
  return items.map((item) => {
    const xmlPath = resolveLeafXmlPath(objectXmlPath, tag, item.name);
    return node({
      type,
      name: item.name,
      label: item.presentation ?? item.name,
      xmlPath,
      decorationPath: undefined,
      gitDecorationTarget: isEmbeddedChildTag(tag)
        ? {
          kind: 'child',
          ownerXmlPath: objectXmlPath,
          childKind: tag,
          name: item.name,
        }
        : {
          kind: 'paths',
          ownerXmlPath: objectXmlPath,
          childKind: tag,
          name: item.name,
          paths: resolveChildDecorationPaths(objectXmlPath, tag, item.name),
        },
      tooltip: item.synonym || undefined,
      metaContext: {
        rootMetaKind,
        ownerObjectXmlPath: objectXmlPath,
        standardAttributeName: tag === 'StandardAttribute' ? item.name : undefined,
      },
      canRemoveMetadata: tag !== 'StandardAttribute',
      singleClickAction: resolveLeafSingleClickAction(tag, xmlPath),
      children: [],
    });
  });
}

function resolveLeafSingleClickAction(tag: ChildTag, xmlPath: string): MetadataCacheSingleClickAction | undefined {
  if (tag !== 'Template') {
    return undefined;
  }

  return readTemplateTypeFromXml(xmlPath) === 'TextDocument' ? 'openTemplateContent' : undefined;
}

function buildTabularSectionNode(
  objectXmlPath: string,
  rootMetaKind: MetaKind,
  item: MetaChild
): MetadataCacheNode {
  const columns = item.columns ?? [];
  return node({
    type: 'TabularSection',
    name: item.name,
    label: item.name,
    xmlPath: objectXmlPath,
    gitDecorationTarget: {
      kind: 'child',
      ownerXmlPath: objectXmlPath,
      childKind: 'TabularSection',
      name: item.name,
    },
    tooltip: item.synonym || undefined,
    metaContext: {
      rootMetaKind,
      ownerObjectXmlPath: objectXmlPath,
    },
    addMetadataTarget: {
      kind: 'child',
      ownerObjectXmlPath: objectXmlPath,
      childTag: 'Column',
      tabularSectionName: item.name,
    },
    canRemoveMetadata: true,
    children: columns.map((column) => node({
      type: 'Column',
      name: column.name,
      label: column.name,
      xmlPath: objectXmlPath,
      gitDecorationTarget: {
        kind: 'child',
        ownerXmlPath: objectXmlPath,
        childKind: 'Column',
        name: column.name,
        tabularSectionName: item.name,
      },
      tooltip: column.synonym || undefined,
      metaContext: {
        rootMetaKind,
        tabularSectionName: item.name,
        ownerObjectXmlPath: objectXmlPath,
      },
      canRemoveMetadata: true,
      children: [],
    })),
  });
}

/**
 * URL-шаблон HTTP-сервиса — контейнерный узел, симметричный
 * {@link buildTabularSectionNode} (ТЧ→Колонка). Вложенные `Method` строятся
 * прямыми детьми (как колонки), с `urlTemplateName` в контексте для адресации
 * при редактировании/удалении.
 */
function buildUrlTemplateNode(
  objectXmlPath: string,
  rootMetaKind: MetaKind,
  item: MetaChild
): MetadataCacheNode {
  const methods = item.columns ?? [];
  return node({
    type: 'URLTemplate',
    name: item.name,
    label: item.name,
    xmlPath: objectXmlPath,
    gitDecorationTarget: {
      kind: 'child',
      ownerXmlPath: objectXmlPath,
      childKind: 'URLTemplate',
      name: item.name,
    },
    tooltip: item.synonym || undefined,
    metaContext: {
      rootMetaKind,
      ownerObjectXmlPath: objectXmlPath,
    },
    addMetadataTarget: {
      kind: 'child',
      ownerObjectXmlPath: objectXmlPath,
      childTag: 'Method',
      urlTemplateName: item.name,
    },
    canRemoveMetadata: true,
    children: methods.map((method) => node({
      type: 'Method',
      name: method.name,
      label: method.name,
      xmlPath: objectXmlPath,
      gitDecorationTarget: {
        kind: 'child',
        ownerXmlPath: objectXmlPath,
        childKind: 'Method',
        name: method.name,
        urlTemplateName: item.name,
      },
      tooltip: method.synonym || undefined,
      metaContext: {
        rootMetaKind,
        urlTemplateName: item.name,
        ownerObjectXmlPath: objectXmlPath,
      },
      canRemoveMetadata: true,
      children: [],
    })),
  });
}

function buildSubsystemNodes(entry: ConfigEntry, info: ConfigInfo, names: string[]): MetadataCacheNode[] {
  const subsystemsRoot = path.join(entry.rootPath, getMetaFolder('Subsystem') ?? 'Subsystems');
  return names
    .map((name) => {
      const xmlPath = resolveSubsystemXml(subsystemsRoot, name);
      return xmlPath ? buildSubsystemNode(entry, info, name, xmlPath, getSubsystemHomeDir(xmlPath, name), new Set()) : undefined;
    })
    .filter((item): item is MetadataCacheNode => Boolean(item));
}

function buildSubsystemNode(
  entry: ConfigEntry,
  info: ConfigInfo,
  label: string,
  xmlPath: string,
  homeDir: string,
  visited: Set<string>
): MetadataCacheNode {
  if (visited.has(xmlPath)) {
    return node({
      type: 'Subsystem',
      name: label,
      label: `${label} (цикл)`,
      xmlPath,
      decorationPath: resolveObjectDecorationPath(xmlPath),
      gitDecorationTarget: buildObjectGitDecorationTarget('Subsystem', xmlPath),
      children: [],
    });
  }

  const nextVisited = new Set(visited);
  nextVisited.add(xmlPath);
  const objectInfo = parseObjectXml(xmlPath);
  const name = objectInfo?.name ?? label;
  const children = (objectInfo?.children ?? [])
    .filter((item) => item.tag === 'Subsystem' && item.name !== name)
    .map((item) => {
      const childXmlPath = resolveSubsystemXml(path.join(homeDir, 'Subsystems'), item.name);
      return childXmlPath
        ? buildSubsystemNode(entry, info, item.name, childXmlPath, getSubsystemHomeDir(childXmlPath, item.name), nextVisited)
        : undefined;
    })
    .filter((item): item is MetadataCacheNode => Boolean(item));

  return node({
    type: 'Subsystem',
    name,
    label: name,
    xmlPath,
    decorationPath: resolveObjectDecorationPath(xmlPath),
    gitDecorationTarget: buildObjectGitDecorationTarget('Subsystem', xmlPath),
    tooltip: objectInfo?.synonym ?? undefined,
    ownershipTag: getOwnershipTag(entry, info, name),
    canRemoveMetadata: true,
    children,
  });
}

function resolveLeafXmlPath(objectXmlPath: string, tag: ChildTag, itemName: string): string {
  if (tag === 'Form' || tag === 'Command') {
    return objectXmlPath;
  }

  if (tag === 'Template') {
    const loc = getObjectLocationFromXml(objectXmlPath);
    const own = path.join(loc.objectDir, 'Templates', itemName, `${itemName}.xml`);
    if (fs.existsSync(own)) {
      return own;
    }
    const flat = path.join(loc.objectDir, 'Templates', `${itemName}.xml`);
    if (fs.existsSync(flat)) {
      return flat;
    }
  }

  return objectXmlPath;
}

function buildRootGroupDecorationPath(entry: ConfigEntry, kind: MetaKind): string | undefined {
  const folder = getMetaFolder(kind);
  return folder ? path.join(entry.rootPath, folder) : undefined;
}

function resolveObjectDecorationPath(xmlPath: string): string {
  const loc = getObjectLocationFromXml(xmlPath);
  return fs.existsSync(loc.objectDir) ? loc.objectDir : xmlPath;
}

function buildObjectGitDecorationTarget(
  kind: MetaKind,
  xmlPath: string
): MetadataGitDecorationTarget | undefined {
  const loc = getObjectLocationFromXml(xmlPath);
  const xmlDir = path.resolve(path.dirname(xmlPath));
  const objectDir = path.resolve(loc.objectDir);
  if (xmlDir === objectDir || !fs.existsSync(loc.objectDir)) {
    return undefined;
  }

  return {
    kind: 'paths',
    ownerXmlPath: xmlPath,
    childKind: kind,
    paths: [xmlPath, loc.objectDir],
  };
}

function resolveChildDecorationPaths(objectXmlPath: string, tag: ChildTag, itemName: string): string[] {
  const loc = getObjectLocationFromXml(objectXmlPath);
  switch (tag) {
    case 'Form':
      return [
        path.join(loc.objectDir, 'Forms', `${itemName}.xml`),
        path.join(loc.objectDir, 'Forms', itemName),
      ];
    case 'Command':
      return [
        path.join(loc.objectDir, 'Commands', `${itemName}.xml`),
        path.join(loc.objectDir, 'Commands', itemName),
      ];
    case 'Template':
      return [
        path.join(loc.objectDir, 'Templates', `${itemName}.xml`),
        path.join(loc.objectDir, 'Templates', itemName),
      ];
    default:
      return [objectXmlPath];
  }
}

function resolveChildGroupDecorationPaths(objectXmlPath: string, tag: ChildTag): string[] {
  const loc = getObjectLocationFromXml(objectXmlPath);
  switch (tag) {
    case 'Form':
      return [path.join(loc.objectDir, 'Forms')];
    case 'Command':
      return [path.join(loc.objectDir, 'Commands')];
    case 'Template':
      return [path.join(loc.objectDir, 'Templates')];
    default:
      return [];
  }
}

function isEmbeddedChildTag(tag: ChildTag): boolean {
  return tag !== 'Form' && tag !== 'Command' && tag !== 'Template';
}

function resolveSubsystemXml(root: string, name: string): string | undefined {
  const deep = path.join(root, name, `${name}.xml`);
  if (fs.existsSync(deep)) {
    return deep;
  }
  const flat = path.join(root, `${name}.xml`);
  return fs.existsSync(flat) ? flat : undefined;
}

function getSubsystemHomeDir(xmlPath: string, subsystemName: string): string {
  const dir = path.dirname(xmlPath);
  return path.basename(dir) === subsystemName ? dir : path.join(dir, subsystemName);
}

function getOwnershipTag(entry: ConfigEntry, info: ConfigInfo, name: string): 'OWN' | 'BORROWED' | undefined {
  if (entry.kind !== 'cfe' || !info.namePrefix) {
    return undefined;
  }
  return name.startsWith(info.namePrefix) ? 'OWN' : 'BORROWED';
}

function buildRootAddTarget(entry: ConfigEntry, info: ConfigInfo, targetKind: MetaKind): MetadataCacheAddTarget | undefined {
  if (!getMetaFolder(targetKind)) {
    return undefined;
  }
  return {
    kind: 'root',
    configRoot: entry.rootPath,
    configKind: entry.kind,
    targetKind,
    namePrefix: entry.kind === 'cfe' ? info.namePrefix : undefined,
  };
}

function updateRootObjectCache(
  snapshot: MetadataCacheSnapshot,
  entry: ConfigEntry,
  info: ConfigInfo,
  targetKind: MetaKind,
  name: string
): boolean {
  const newNode = buildObjectNode(entry, info, targetKind, name, getMetaType(targetKind).childTags ?? []);
  const container = findRootAddContainer(snapshot.root, targetKind);
  if (!newNode || !container) {
    return false;
  }

  upsertSortedByLabel(container.children, newNode, targetKind);
  return true;
}

function updateChildObjectCache(snapshot: MetadataCacheSnapshot, ownerObjectXmlPath: string): boolean {
  const ownerNode = findRootObjectNodeByXml(snapshot.root, ownerObjectXmlPath);
  if (!ownerNode) {
    return false;
  }

  const objectInfo = parseObjectXml(ownerObjectXmlPath);
  const childTags = getMetaType(ownerNode.type).childTags ?? [];
  ownerNode.tooltip = objectInfo?.synonym ?? undefined;
  // flatChildren-aware: иначе после добавления/удаления дочернего элемента у плоского
  // объекта (HTTP-сервис) при инкрементальном обновлении снова возникала бы группа.
  ownerNode.children = buildObjectChildNodes(ownerObjectXmlPath, ownerNode.type, objectInfo?.children ?? [], childTags);
  ownerNode.addMetadataTarget = flatChildAddTarget(ownerObjectXmlPath, ownerNode.type, childTags) ?? ownerNode.addMetadataTarget;
  return true;
}

function rebuildObjectNodeFromXml(
  entry: ConfigEntry,
  info: ConfigInfo,
  existing: MetadataCacheNode
): MetadataCacheNode | null {
  if (!existing.xmlPath) {
    return null;
  }

  const objectInfo = parseObjectXml(existing.xmlPath);
  if (!objectInfo) {
    return null;
  }

  const childTags = getMetaType(existing.type).childTags ?? [];
  const label = objectInfo.name || existing.name;
  return node({
    type: existing.type,
    name: label,
    label,
    xmlPath: existing.xmlPath,
    decorationPath: resolveObjectDecorationPath(existing.xmlPath),
    gitDecorationTarget: buildObjectGitDecorationTarget(existing.type, existing.xmlPath),
    tooltip: objectInfo.synonym || undefined,
    ownershipTag: getOwnershipTag(entry, info, label),
    canRemoveMetadata: existing.canRemoveMetadata,
    addMetadataTarget: flatChildAddTarget(existing.xmlPath, existing.type, childTags),
    children: buildObjectChildNodes(existing.xmlPath, existing.type, objectInfo.children, childTags),
  });
}

function findObjectNodeByChangedPath(
  root: MetadataCacheNode,
  changedPath: string
): { parent: MetadataCacheNode; index: number; node: MetadataCacheNode } | null {
  const normalizedChangedPath = normalizePath(changedPath);
  return findObjectNodeByChangedPathInner(root, normalizedChangedPath);
}

function findObjectNodeByChangedPathInner(
  parent: MetadataCacheNode,
  normalizedChangedPath: string
): { parent: MetadataCacheNode; index: number; node: MetadataCacheNode } | null {
  for (let index = 0; index < parent.children.length; index += 1) {
    const child = parent.children[index];
    if (isObjectCacheNode(child) && child.xmlPath && isPathOwnedByObject(normalizedChangedPath, child.xmlPath)) {
      return { parent, index, node: child };
    }

    const found = findObjectNodeByChangedPathInner(child, normalizedChangedPath);
    if (found) {
      return found;
    }
  }

  return null;
}

function isObjectCacheNode(node: MetadataCacheNode): boolean {
  return Boolean(node.xmlPath && getMetaFolder(node.type));
}

function isPathOwnedByObject(normalizedChangedPath: string, objectXmlPath: string): boolean {
  const normalizedXmlPath = normalizePath(objectXmlPath);
  if (normalizedChangedPath === normalizedXmlPath) {
    return true;
  }

  const loc = getObjectLocationFromXml(objectXmlPath);
  const normalizedObjectDir = normalizePath(loc.objectDir);
  return normalizedChangedPath.startsWith(`${normalizedObjectDir}${path.sep}`);
}

function findRootAddContainer(node: MetadataCacheNode, targetKind: MetaKind): MetadataCacheNode | undefined {
  if (node.addMetadataTarget?.kind === 'root' && node.addMetadataTarget.targetKind === targetKind) {
    return node;
  }

  for (const child of node.children) {
    const found = findRootAddContainer(child, targetKind);
    if (found) {
      return found;
    }
  }

  return undefined;
}

function findRootObjectNodeByXml(node: MetadataCacheNode, xmlPath: string): MetadataCacheNode | undefined {
  const normalizedXmlPath = path.normalize(xmlPath).toLowerCase();
  if (
    node.xmlPath &&
    path.normalize(node.xmlPath).toLowerCase() === normalizedXmlPath &&
    (getMetaType(node.type).childTags?.length ?? 0) > 0
  ) {
    return node;
  }

  for (const child of node.children) {
    const found = findRootObjectNodeByXml(child, xmlPath);
    if (found) {
      return found;
    }
  }

  return undefined;
}

function upsertSortedByLabel(nodes: MetadataCacheNode[], next: MetadataCacheNode, targetKind: MetaKind): void {
  const existingIndex = nodes.findIndex((item) => item.type === next.type && item.name === next.name);
  if (existingIndex >= 0) {
    nodes[existingIndex] = next;
  } else {
    nodes.push(next);
  }

  const firstTargetIndex = nodes.findIndex((item) => item.type === targetKind);
  if (firstTargetIndex < 0) {
    return;
  }

  const targetNodes = nodes
    .filter((item) => item.type === targetKind)
    .sort((left, right) => left.label.localeCompare(right.label, 'ru'));
  nodes.splice(firstTargetIndex, targetNodes.length, ...targetNodes);
}

function node(params: Omit<MetadataCacheNode, 'children'> & { children?: MetadataCacheNode[] }): MetadataCacheNode {
  return {
    ...params,
    children: params.children ?? [],
  };
}

function isConfigurationXml(filePath: string): boolean {
  return path.basename(filePath).toLowerCase() === 'configuration.xml';
}

function isPathInside(filePath: string, rootPath: string): boolean {
  const normalizedFilePath = normalizePath(filePath);
  const normalizedRootPath = normalizePath(rootPath);
  return normalizedFilePath === normalizedRootPath ||
    normalizedFilePath.startsWith(`${normalizedRootPath}${path.sep}`);
}

function normalizePath(filePath: string): string {
  return path.resolve(filePath).toLowerCase();
}
