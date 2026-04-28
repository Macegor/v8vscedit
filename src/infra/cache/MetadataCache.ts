import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { CHILD_TAG_CONFIG, ChildTag } from '../../domain/ChildTag';
import { ConfigEntry, ConfigInfo } from '../../domain/Configuration';
import { MetaChild } from '../../domain/MetaObject';
import { MetaKind, getMetaFolder, getMetaType, getMetaTypesByGroup } from '../../domain/MetaTypes';
import { buildScopeKey } from '../../cli/core/hashCache';
import type { MetadataGitDecorationTarget } from '../git/GitMetadataStatusService';
import { getObjectLocationFromXml, resolveObjectXmlPath } from '../fs/MetaPathResolver';
import { parseConfigXml, parseObjectXml } from '../xml';

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
    ownerObjectXmlPath?: string;
  };
  addMetadataTarget?: MetadataCacheAddTarget;
  canRemoveMetadata?: boolean;
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
  };

export interface MetadataCacheSnapshot {
  schemaVersion: 8;
  scopeKey: string;
  generatedAt: string;
  rootPath: string;
  configKind: 'cf' | 'cfe';
  root: MetadataCacheNode;
}

export interface MetadataCacheUpdateResult {
  snapshot: MetadataCacheSnapshot;
  updatedPartially: boolean;
}

const METADATA_CACHE_DIR = path.join('.v8vscedit', 'meta');
const CACHE_SCHEMA_VERSION = 8;

/**
 * Строит полный снимок дерева метаданных без ленивых загрузчиков, чтобы UI мог восстановить дерево из JSON.
 */
export function buildMetadataCacheSnapshot(scopeKey: string, entry: ConfigEntry): MetadataCacheSnapshot {
  const info = parseConfigXml(path.join(entry.rootPath, 'Configuration.xml'));
  return {
    schemaVersion: CACHE_SCHEMA_VERSION,
    scopeKey,
    generatedAt: new Date().toISOString(),
    rootPath: entry.rootPath,
    configKind: entry.kind,
    root: buildConfigNode(entry, info),
  };
}

export function saveMetadataCache(projectRoot: string, snapshot: MetadataCacheSnapshot): void {
  const filePath = getMetadataCacheFilePath(projectRoot, snapshot.scopeKey);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(snapshot), 'utf-8');
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

  let changed = false;
  for (const filePath of relatedFiles) {
    if (path.extname(filePath).toLowerCase() !== '.xml') {
      continue;
    }

    const target = findObjectNodeByChangedPath(cached.root, filePath);
    if (!target) {
      continue;
    }

    const refreshed = rebuildObjectNodeFromXml(entry, info, target.node);
    if (refreshed) {
      target.parent.children[target.index] = refreshed;
    } else {
      target.parent.children.splice(target.index, 1);
    }
    changed = true;
  }

  if (!changed) {
    return null;
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
    hidePropertiesCommand: true,
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
  const label = objectInfo?.name || name;
  const ownershipTag = getOwnershipTag(entry, info, label);
  const children = childTags.length > 0
    ? buildStructuredChildren(xmlPath, type, objectInfo?.children ?? [], childTags)
    : [];

  return node({
    type,
    name: label,
    label,
    xmlPath,
    decorationPath: resolveObjectDecorationPath(xmlPath),
    tooltip: objectInfo?.synonym || undefined,
    ownershipTag,
    canRemoveMetadata: true,
    children,
  });
}

function buildStructuredChildren(
  objectXmlPath: string,
  rootMetaKind: MetaKind,
  children: MetaChild[],
  childTags: readonly ChildTag[]
): MetadataCacheNode[] {
  return childTags.map((tag) => {
    const items = children.filter((item) => item.tag === tag);
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
      addMetadataTarget: {
        kind: 'child',
        ownerObjectXmlPath: objectXmlPath,
        childTag: tag,
      },
      children: buildLeavesForTag(objectXmlPath, rootMetaKind, tag, items),
    });
  });
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

  const type = CHILD_TAG_CONFIG[tag].kind as MetaKind;
  return items.map((item) => node({
    type,
    name: item.name,
    label: item.name,
    xmlPath: resolveLeafXmlPath(objectXmlPath, tag, item.name),
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
    },
    canRemoveMetadata: true,
    children: [],
  }));
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
      children: [],
    });
  }

  const nextVisited = new Set(visited);
  nextVisited.add(xmlPath);
  const objectInfo = parseObjectXml(xmlPath);
  const name = objectInfo?.name || label;
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
    tooltip: objectInfo?.synonym || undefined,
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
  ownerNode.tooltip = objectInfo?.synonym || undefined;
  ownerNode.children = buildStructuredChildren(ownerObjectXmlPath, ownerNode.type, objectInfo?.children ?? [], childTags);
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
    tooltip: objectInfo.synonym || undefined,
    ownershipTag: getOwnershipTag(entry, info, label),
    canRemoveMetadata: existing.canRemoveMetadata,
    children: childTags.length > 0
      ? buildStructuredChildren(existing.xmlPath, existing.type, objectInfo.children ?? [], childTags)
      : [],
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
    if (isObjectCacheNode(child) && isPathOwnedByObject(normalizedChangedPath, child.xmlPath!)) {
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
