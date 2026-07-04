import * as fs from 'fs';
import * as path from 'path';
import { ConfigXmlReader } from './ConfigXmlReader';
import { escapeXmlText, extractSimpleTag, unescapeXml, writeTextFilePreservingBomAndEol } from './XmlUtils';
import { getMetaFolder, getMetaLabel, META_TYPES, type MetaKind } from '../../domain/MetaTypes';

export type SubsystemPropertyKey =
  | 'Name'
  | 'Synonym'
  | 'Comment'
  | 'IncludeHelpInContents'
  | 'IncludeInCommandInterface'
  | 'UseOneCommand'
  | 'Explanation'
  | 'PictureRef'
  | 'PictureLoadTransparent';

export interface SubsystemInfo {
  xmlPath: string;
  configRoot: string;
  homeDir: string;
  name: string;
  synonym: string;
  comment: string;
  includeHelpInContents: boolean;
  includeInCommandInterface: boolean;
  useOneCommand: boolean;
  explanation: string;
  pictureRef: string;
  pictureLoadTransparent: boolean;
  contentRefs: string[];
  childSubsystems: string[];
  commandInterfacePath: string | null;
}

export interface MetadataRefItem {
  ref: string;
  kind: MetaKind;
  name: string;
  label: string;
  groupLabel: string;
  groupOrder: number;
  itemOrder: number;
}

export interface MetadataRefGroup {
  kind: MetaKind;
  label: string;
  items: MetadataRefItem[];
}

export interface MetadataRefTreeNode {
  id: string;
  label: string;
  ref?: string;
  kind?: MetaKind;
  children: MetadataRefTreeNode[];
}

export interface SubsystemEditorSnapshot {
  subsystem: SubsystemInfo;
  availableGroups: MetadataRefGroup[];
  contentTree: MetadataRefTreeNode[];
}

export interface SubsystemMembershipTreeNode {
  id: string;
  name: string;
  label: string;
  xmlPath: string;
  checked: boolean;
  children: SubsystemMembershipTreeNode[];
}

export interface SubsystemMembershipSnapshot {
  configRoot: string;
  objectRef: string;
  selectedXmlPaths: string[];
  tree: SubsystemMembershipTreeNode[];
}

export interface SubsystemContentEditResult {
  subsystemPath: string;
  changed: boolean;
  added: string[];
  removed: string[];
  contentRefs: string[];
  changedFiles: string[];
}

/**
 * Читает и меняет XML подсистемы. UI получает готовые снимки и не знает
 * о структуре тегов `Content`, `ChildObjects` и `Picture`.
 */
export class SubsystemXmlService {
  private readonly configReader = new ConfigXmlReader();

  readSnapshot(xmlPath: string): SubsystemEditorSnapshot {
    const subsystem = this.readSubsystem(xmlPath);
    return {
      subsystem,
      availableGroups: this.readAvailableContent(subsystem.configRoot),
      contentTree: this.readContentTree(subsystem.configRoot),
    };
  }

  readMembershipSnapshot(configRoot: string, objectRef: string): SubsystemMembershipSnapshot {
    const tree = this.readSubsystemMembershipTree(configRoot, objectRef);
    return {
      configRoot,
      objectRef,
      tree,
      selectedXmlPaths: flattenSubsystemMembershipTree(tree)
        .filter((item) => item.checked)
        .map((item) => item.xmlPath),
    };
  }

  readSubsystem(xmlPath: string): SubsystemInfo {
    const xml = fs.readFileSync(xmlPath, 'utf-8');
    const configRoot = findConfigRoot(xmlPath);
    const name = extractSimpleTag(xml, 'Name') ?? path.basename(xmlPath, '.xml');
    const homeDir = getSubsystemHomeDir(xmlPath, name);
    const commandInterfacePath = path.join(homeDir, 'Ext', 'CommandInterface.xml');

    return {
      xmlPath,
      configRoot,
      homeDir,
      name,
      synonym: extractLocalizedStringPresentation(xml, 'Synonym'),
      comment: extractSimpleTag(xml, 'Comment') ?? '',
      includeHelpInContents: extractBooleanTag(xml, 'IncludeHelpInContents'),
      includeInCommandInterface: extractBooleanTag(xml, 'IncludeInCommandInterface'),
      useOneCommand: extractBooleanTag(xml, 'UseOneCommand'),
      explanation: extractLocalizedStringPresentation(xml, 'Explanation'),
      pictureRef: extractPictureRef(xml),
      pictureLoadTransparent: extractPictureLoadTransparent(xml),
      contentRefs: extractContentRefs(xml),
      childSubsystems: extractChildSubsystems(xml),
      commandInterfacePath: fs.existsSync(commandInterfacePath) ? commandInterfacePath : null,
    };
  }

  updateProperty(xmlPath: string, key: SubsystemPropertyKey, value: string | boolean): boolean {
    const xml = fs.readFileSync(xmlPath, 'utf-8');
    const updated = (() => {
      if (key === 'PictureRef' || key === 'PictureLoadTransparent') {
        const currentRef = key === 'PictureRef' ? String(value) : extractPictureRef(xml);
        const currentTransparent = key === 'PictureLoadTransparent'
          ? value === true
          : extractPictureLoadTransparent(xml);
        return replacePictureBlock(xml, currentRef, currentTransparent);
      }
      if (key === 'Synonym' || key === 'Explanation') {
        return replacePropertyBlock(xml, key, buildLocalizedBlock(key, String(value)));
      }
      if (
        key === 'IncludeHelpInContents' ||
        key === 'IncludeInCommandInterface' ||
        key === 'UseOneCommand'
      ) {
        return replacePropertyBlock(xml, key, `<${key}>${value === true ? 'true' : 'false'}</${key}>`);
      }
      return replacePropertyBlock(xml, key, `<${key}>${escapeXmlText(String(value))}</${key}>`);
    })();

    if (updated === xml) {
      return false;
    }
    writeTextFilePreservingBomAndEol(xmlPath, xml, updated);
    return true;
  }

  addContentRefs(xmlPath: string, refs: string[]): boolean {
    return this.updateContentRefs(xmlPath, (current) => {
      const next = [...current];
      for (const ref of refs.map((item) => item.trim()).filter(Boolean)) {
        if (!next.includes(ref)) {
          next.push(ref);
        }
      }
      return next;
    });
  }

  removeContentRefs(xmlPath: string, refs: string[]): boolean {
    const remove = new Set(refs);
    return this.updateContentRefs(xmlPath, (current) => current.filter((ref) => !remove.has(ref)));
  }

  editContentRefs(xmlPath: string, options: { add?: readonly string[]; remove?: readonly string[] }): SubsystemContentEditResult {
    const before = this.readSubsystem(xmlPath).contentRefs;
    const add = normalizeContentRefs(options.add ?? []);
    const remove = normalizeContentRefs(options.remove ?? []);
    const knownRefs = this.readAvailableContent(this.readSubsystem(xmlPath).configRoot)
      .flatMap((group) => group.items.map((item) => item.ref));
    const known = new Set(knownRefs);
    const unknown = [...add, ...remove].filter((ref) => !known.has(ref));
    if (unknown.length > 0) {
      throw new Error(`Объекты не найдены в ChildObjects конфигурации: ${unknown.join(', ')}.`);
    }

    const removeSet = new Set(remove);
    const changed = this.updateContentRefs(xmlPath, (current) => {
      const next = current.filter((ref) => !removeSet.has(ref));
      for (const ref of add) {
        if (!next.includes(ref)) {
          next.push(ref);
        }
      }
      return next;
    });
    const after = this.readSubsystem(xmlPath).contentRefs;
    return {
      subsystemPath: xmlPath,
      changed,
      added: after.filter((ref) => !before.includes(ref)),
      removed: before.filter((ref) => !after.includes(ref)),
      contentRefs: after,
      changedFiles: changed ? [xmlPath] : [],
    };
  }

  setObjectSubsystemMembership(configRoot: string, objectRef: string, selectedXmlPaths: string[]): boolean {
    const selected = new Set(selectedXmlPaths);
    let changed = false;

    for (const node of flattenSubsystemMembershipTree(this.readSubsystemMembershipTree(configRoot, objectRef))) {
      const shouldContain = selected.has(node.xmlPath);
      const fileChanged = this.updateContentRefs(node.xmlPath, (current) => {
        const hasRef = current.includes(objectRef);
        if (shouldContain && !hasRef) {
          return [...current, objectRef];
        }
        if (!shouldContain && hasRef) {
          return current.filter((ref) => ref !== objectRef);
        }
        return current;
      });
      changed = changed || fileChanged;
    }

    return changed;
  }

  addChildSubsystem(xmlPath: string, name: string): boolean {
    const normalized = name.trim();
    if (!normalized) {
      return false;
    }
    return this.updateChildSubsystems(xmlPath, (current) => {
      return current.includes(normalized) ? current : [...current, normalized];
    });
  }

  removeChildSubsystem(xmlPath: string, name: string): boolean {
    return this.updateChildSubsystems(xmlPath, (current) => current.filter((item) => item !== name));
  }

  private updateContentRefs(xmlPath: string, mutator: (current: string[]) => string[]): boolean {
    const xml = fs.readFileSync(xmlPath, 'utf-8');
    const current = extractContentRefs(xml);
    const next = uniqueStrings(mutator(current));
    if (sameStringArray(current, next)) {
      return false;
    }
    const updated = replacePropertyBlock(xml, 'Content', buildContentBlock(next));
    writeTextFilePreservingBomAndEol(xmlPath, xml, updated);
    return true;
  }

  private updateChildSubsystems(xmlPath: string, mutator: (current: string[]) => string[]): boolean {
    const xml = fs.readFileSync(xmlPath, 'utf-8');
    const current = extractChildSubsystems(xml);
    const next = uniqueStrings(mutator(current));
    if (sameStringArray(current, next)) {
      return false;
    }
    const updated = replaceRootBlock(xml, 'ChildObjects', buildChildObjectsBlock(next));
    writeTextFilePreservingBomAndEol(xmlPath, xml, updated);
    return true;
  }

  private readAvailableContent(configRoot: string): MetadataRefGroup[] {
    const configPath = path.join(configRoot, 'Configuration.xml');
    if (!fs.existsSync(configPath)) {
      return [];
    }

    const info = this.configReader.read(configPath);
    const groups: MetadataRefGroup[] = [];
    for (const [kind, names] of info.childObjects.entries()) {
      if (!isRealMetaKind(kind) || kind === 'Subsystem') {
        continue;
      }
      const def = META_TYPES[kind];
      if (!def.folder) {
        continue;
      }
      const folder = getMetaFolder(kind);
      const items = names
        .map((name, index) => ({
          ref: `${kind}.${name}`,
          kind,
          name,
          label: `${getMetaLabel(kind)}: ${name}`,
          groupLabel: META_TYPES[kind].pluralLabel,
          groupOrder: def.groupOrder,
          itemOrder: index,
        }))
        .sort((left, right) => left.name.localeCompare(right.name, 'ru'));
      if (folder && items.length > 0) {
        groups.push({ kind, label: META_TYPES[kind].pluralLabel, items });
      }
    }
    return groups.sort((left, right) => META_TYPES[left.kind].groupOrder - META_TYPES[right.kind].groupOrder);
  }

  private readContentTree(configRoot: string): MetadataRefTreeNode[] {
    const configPath = path.join(configRoot, 'Configuration.xml');
    if (!fs.existsSync(configPath)) {
      return [];
    }

    const info = this.configReader.read(configPath);
    const result: MetadataRefTreeNode[] = [];
    const commonChildren = this.buildTypeGroups('common', info);
    if (commonChildren.length > 0) {
      result.push({
        id: 'group-common',
        label: 'Общие',
        kind: 'group-common',
        children: commonChildren,
      });
    }

    for (const def of Object.values(META_TYPES)
      .filter((item) => item.group === 'top')
      .sort((left, right) => left.groupOrder - right.groupOrder)) {
      if (def.kind === 'DocumentNumerator' || def.kind === 'Sequence') {
        continue;
      }

      if (def.kind === 'Document') {
        const documents = buildObjectRefNodes('Document', info.childObjects.get('Document') ?? []);
        const numerators = buildObjectRefNodes('DocumentNumerator', info.childObjects.get('DocumentNumerator') ?? []);
        const sequences = buildObjectRefNodes('Sequence', info.childObjects.get('Sequence') ?? []);
        const children: MetadataRefTreeNode[] = [
          numerators.length > 0
            ? { id: 'Document/NumeratorsBranch', label: 'Нумераторы', kind: 'NumeratorsBranch', children: numerators }
            : undefined,
          sequences.length > 0
            ? { id: 'Document/SequencesBranch', label: 'Последовательности', kind: 'SequencesBranch', children: sequences }
            : undefined,
          ...documents,
        ].filter((item): item is MetadataRefTreeNode => Boolean(item));

        if (children.length > 0) {
          result.push({
            id: 'type-Document',
            label: def.pluralLabel,
            kind: 'Document',
            children,
          });
        }
        continue;
      }

      const nodes = buildObjectRefNodes(def.kind, info.childObjects.get(def.kind) ?? []);
      if (nodes.length > 0) {
        result.push({
          id: `type-${def.kind}`,
          label: def.pluralLabel,
          kind: def.kind,
          children: nodes,
        });
      }
    }

    return result;
  }

  private readSubsystemMembershipTree(configRoot: string, objectRef: string): SubsystemMembershipTreeNode[] {
    const configPath = path.join(configRoot, 'Configuration.xml');
    if (!fs.existsSync(configPath)) {
      return [];
    }

    const info = this.configReader.read(configPath);
    const subsystemsRoot = path.join(configRoot, getMetaFolder('Subsystem') ?? 'Subsystems');
    const rootNames = info.childObjects.get('Subsystem') ?? [];
    return rootNames
      .map((name) => {
        const xmlPath = resolveSubsystemXml(subsystemsRoot, name);
        return xmlPath
          ? this.buildSubsystemMembershipNode(xmlPath, objectRef, new Set())
          : undefined;
      })
      .filter((item): item is SubsystemMembershipTreeNode => Boolean(item));
  }

  private buildSubsystemMembershipNode(
    xmlPath: string,
    objectRef: string,
    visitedXmlPaths: Set<string>
  ): SubsystemMembershipTreeNode {
    const normalizedPath = path.resolve(xmlPath);
    if (visitedXmlPaths.has(normalizedPath)) {
      const duplicate = this.readSubsystem(xmlPath);
      return {
        id: normalizedPath,
        name: duplicate.name,
        label: duplicate.synonym || duplicate.name,
        xmlPath,
        checked: duplicate.contentRefs.includes(objectRef),
        children: [],
      };
    }

    const nextVisited = new Set(visitedXmlPaths);
    nextVisited.add(normalizedPath);
    const subsystem = this.readSubsystem(xmlPath);
    const children = subsystem.childSubsystems
      .map((childName) => {
        const childXmlPath = resolveSubsystemXml(path.join(subsystem.homeDir, 'Subsystems'), childName);
        return childXmlPath
          ? this.buildSubsystemMembershipNode(childXmlPath, objectRef, nextVisited)
          : undefined;
      })
      .filter((item): item is SubsystemMembershipTreeNode => Boolean(item));

    return {
      id: normalizedPath,
      name: subsystem.name,
      label: subsystem.synonym || subsystem.name,
      xmlPath,
      checked: subsystem.contentRefs.includes(objectRef),
      children,
    };
  }

  private buildTypeGroups(group: 'common', info: ReturnType<ConfigXmlReader['read']>): MetadataRefTreeNode[] {
    const result: MetadataRefTreeNode[] = [];
    for (const def of Object.values(META_TYPES)
      .filter((def) => def.group === group && def.kind !== 'Subsystem')
      .sort((left, right) => left.groupOrder - right.groupOrder)) {
      const nodes = buildObjectRefNodes(def.kind, info.childObjects.get(def.kind) ?? []);
      if (nodes.length === 0) {
        continue;
      }
      result.push({
        id: `type-${def.kind}`,
        label: def.pluralLabel,
        kind: def.kind,
        children: nodes,
      });
    }
    return result;
  }
}

function buildObjectRefNodes(kind: MetaKind, names: string[]): MetadataRefTreeNode[] {
  return names.map((name, index) => ({
    id: `${kind}.${name}.${String(index)}`,
    ref: `${kind}.${name}`,
    kind,
    label: name,
    children: [],
  }));
}

function findConfigRoot(startPath: string): string {
  let dir = path.dirname(startPath);
  while (dir && dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'Configuration.xml'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return path.dirname(path.dirname(startPath));
}

function getSubsystemHomeDir(xmlPath: string, subsystemName: string): string {
  const dir = path.dirname(xmlPath);
  return path.basename(dir) === subsystemName ? dir : path.join(dir, subsystemName);
}

function resolveSubsystemXml(root: string, name: string): string | undefined {
  const nested = path.join(root, name, `${name}.xml`);
  if (fs.existsSync(nested)) {
    return nested;
  }
  const flat = path.join(root, `${name}.xml`);
  return fs.existsSync(flat) ? flat : undefined;
}

function flattenSubsystemMembershipTree(tree: SubsystemMembershipTreeNode[]): SubsystemMembershipTreeNode[] {
  const result: SubsystemMembershipTreeNode[] = [];
  const walk = (nodes: SubsystemMembershipTreeNode[]): void => {
    for (const node of nodes) {
      result.push(node);
      walk(node.children);
    }
  };
  walk(tree);
  return result;
}

function extractBooleanTag(xml: string, tagName: string): boolean {
  return (extractSimpleTag(xml, tagName) ?? '').trim().toLowerCase() === 'true';
}

function extractLocalizedStringPresentation(xml: string, tagName: string): string {
  const section = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`).exec(xml)?.[1];
  if (!section) {
    return '';
  }
  const content = /<v8:content>([\s\S]*?)<\/v8:content>/.exec(section)?.[1];
  return unescapeXml(content?.trim() ?? '');
}

function extractPictureRef(xml: string): string {
  const picture = /<Picture>([\s\S]*?)<\/Picture>/.exec(xml)?.[1];
  return unescapeXml(/<xr:Ref>([\s\S]*?)<\/xr:Ref>/.exec(picture ?? '')?.[1]?.trim() ?? '');
}

function extractPictureLoadTransparent(xml: string): boolean {
  const picture = /<Picture>([\s\S]*?)<\/Picture>/.exec(xml)?.[1];
  return (/<xr:LoadTransparent>([\s\S]*?)<\/xr:LoadTransparent>/.exec(picture ?? '')?.[1] ?? '')
    .trim()
    .toLowerCase() === 'true';
}

function extractContentRefs(xml: string): string[] {
  const content = /<Content>([\s\S]*?)<\/Content>/.exec(xml)?.[1] ?? '';
  return Array.from(content.matchAll(/<xr:Item\s+xsi:type="xr:MDObjectRef">([\s\S]*?)<\/xr:Item>/g))
    .map((match) => match[1].trim())
    .filter(Boolean);
}

function extractChildSubsystems(xml: string): string[] {
  const childObjects = /<ChildObjects>([\s\S]*?)<\/ChildObjects>/.exec(xml)?.[1] ?? '';
  return Array.from(childObjects.matchAll(/<Subsystem>([\s\S]*?)<\/Subsystem>/g))
    .map((match) => match[1].trim())
    .filter(Boolean);
}

function replacePropertyBlock(xml: string, propertyName: string, nextBlock: string): string {
  const properties = /<Properties>([\s\S]*?)<\/Properties>/.exec(xml)?.[1];
  if (properties === undefined) {
    return xml;
  }
  const propertyRe = new RegExp(`<${propertyName}>[\\s\\S]*?<\\/${propertyName}>|<${propertyName}\\s*\\/>`);
  const nextProperties = propertyRe.test(properties)
    ? properties.replace(propertyRe, () => nextBlock)
    : insertBeforeClosingProperty(properties, nextBlock);
  return xml.replace(properties, () => nextProperties);
}

function replaceRootBlock(xml: string, tagName: string, nextBlock: string): string {
  const blockRe = new RegExp(`<${tagName}>[\\s\\S]*?<\\/${tagName}>|<${tagName}\\s*\\/>`);
  return blockRe.test(xml) ? xml.replace(blockRe, () => nextBlock) : xml;
}

function insertBeforeClosingProperty(properties: string, block: string): string {
  return `${properties}\n${block}`;
}

function buildLocalizedBlock(tagName: string, value: string): string {
  if (!value) {
    return `<${tagName}/>`;
  }
  return [
    `<${tagName}>`,
    '\t\t\t\t<v8:item>',
    '\t\t\t\t\t<v8:lang>ru</v8:lang>',
    `\t\t\t\t\t<v8:content>${escapeXmlText(value)}</v8:content>`,
    '\t\t\t\t</v8:item>',
    `</${tagName}>`,
  ].join('\n');
}

function buildContentBlock(refs: string[]): string {
  if (refs.length === 0) {
    return '<Content/>';
  }
  return [
    '<Content>',
    ...refs.map((ref) => `\t\t\t\t<xr:Item xsi:type="xr:MDObjectRef">${escapeXmlText(ref)}</xr:Item>`),
    '\t\t\t</Content>',
  ].join('\n');
}

function buildChildObjectsBlock(names: string[]): string {
  if (names.length === 0) {
    return '<ChildObjects/>';
  }
  return [
    '<ChildObjects>',
    ...names.map((name) => `\t\t\t<Subsystem>${escapeXmlText(name)}</Subsystem>`),
    '\t\t</ChildObjects>',
  ].join('\n');
}

function replacePictureBlock(xml: string, pictureRef: string, loadTransparent: boolean): string {
  const lines = pictureRef
    ? [
        '<Picture>',
        `\t\t\t\t<xr:Ref>${escapeXmlText(pictureRef)}</xr:Ref>`,
        `\t\t\t\t<xr:LoadTransparent>${loadTransparent ? 'true' : 'false'}</xr:LoadTransparent>`,
        '\t\t\t</Picture>',
      ]
    : ['<Picture/>'];
  return replacePropertyBlock(xml, 'Picture', lines.join('\n'));
}

function isRealMetaKind(kind: string): kind is MetaKind {
  return Object.prototype.hasOwnProperty.call(META_TYPES, kind);
}

function sameStringArray(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

function normalizeContentRefs(values: readonly string[]): string[] {
  return uniqueStrings(values.map((value) => value.trim()).filter(Boolean));
}
