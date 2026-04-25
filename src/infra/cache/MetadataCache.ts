import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { CHILD_TAG_CONFIG, ChildTag } from '../../domain/ChildTag';
import { ConfigEntry, ConfigInfo } from '../../domain/Configuration';
import { MetaChild } from '../../domain/MetaObject';
import { MetaKind, getMetaFolder, getMetaType, getMetaTypesByGroup } from '../../domain/MetaTypes';
import { buildScopeKey } from '../../cli/core/hashCache';
import { getObjectLocationFromXml, resolveObjectXmlPath } from '../fs/MetaPathResolver';
import { parseConfigXml, parseObjectXml } from '../xml';

export interface MetadataCacheNode {
  type: MetaKind;
  name: string;
  label: string;
  xmlPath?: string;
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
  schemaVersion: 3;
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
const CACHE_SCHEMA_VERSION = 3;

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
      hidePropertiesCommand: true,
      addMetadataTarget: buildRootAddTarget(entry, info, 'DocumentNumerator'),
      children: buildObjectNodes(entry, info, 'DocumentNumerator', numeratorNames),
    }),
    node({
      type: 'SequencesBranch',
      name: 'SequencesBranch',
      label: 'Последовательности',
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
