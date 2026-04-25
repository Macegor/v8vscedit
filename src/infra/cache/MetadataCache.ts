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
  children: MetadataCacheNode[];
}

export interface MetadataCacheSnapshot {
  schemaVersion: 1;
  scopeKey: string;
  generatedAt: string;
  rootPath: string;
  configKind: 'cf' | 'cfe';
  root: MetadataCacheNode;
}

const METADATA_CACHE_DIR = path.join('.v8vscedit', 'meta');
const CACHE_SCHEMA_VERSION = 1;

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
  fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), 'utf-8');
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
        children,
      }));
      continue;
    }

    const names = info.childObjects.get(def.kind) ?? [];
    result.push(node({
      type: def.kind,
      name: def.kind,
      label: def.pluralLabel,
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
      children: buildObjectNodes(entry, info, 'DocumentNumerator', numeratorNames),
    }),
    node({
      type: 'SequencesBranch',
      name: 'SequencesBranch',
      label: 'Последовательности',
      hidePropertiesCommand: true,
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

function node(params: Omit<MetadataCacheNode, 'children'> & { children?: MetadataCacheNode[] }): MetadataCacheNode {
  return {
    ...params,
    children: params.children ?? [],
  };
}
