/**
 * Декомпозированная сборка дерева для объектов метаданных с XML-выгрузки 1С.
 * Конкретные обработчики (catalog.ts, constant.ts, …) вызывают эти функции,
 * а не дублируют обход ChildObjects и построение групп.
 */
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { MetaTreeNodeContext, MetadataNode, NodeKind } from '../TreeNode';
import { buildNode } from '../nodes/_base';
import { getNodeDescriptor } from '../nodes/index';
import { ChildTag, CHILD_TAG_CONFIG } from '../nodes/_types';
import { MetaChild, parseObjectXml, resolveObjectXmlPath, extractSynonym } from '../../../infra/xml';
import { getObjectLocationFromXml } from '../../../infra/fs/MetaPathResolver';
import { buildRootMetaObjectProperties } from '../../views/properties/PropertyBuilder';
import { readInheritedObjectXmlForBorrowed } from '../../views/properties/BorrowedPropertiesResolver';
import { HandlerContext, ObjectPropertiesCollection } from './_types';

/** Строит плоский список узлов объекта без дочерней структуры ChildObjects */
export function buildLeafObjectTreeNodes(ctx: HandlerContext, nodeKind: NodeKind): MetadataNode[] {
  const descriptor = getNodeDescriptor(nodeKind)!;

  return ctx.names
    .map((name) => {
      const xmlPath = resolveObjectXmlPath(ctx.configRoot, nodeKind as string, name) ?? undefined;
      if (!xmlPath) {
        return undefined;
      }

      let ownershipTag: 'OWN' | 'BORROWED' | undefined;
      if (ctx.configKind === 'cfe' && ctx.namePrefix) {
        ownershipTag = name.startsWith(ctx.namePrefix) ? 'OWN' : 'BORROWED';
      }

      const node = buildNode(descriptor, {
        label: name,
        kind: nodeKind,
        collapsibleState: vscode.TreeItemCollapsibleState.None,
        xmlPath,
        childrenLoader: undefined,
        ownershipTag,
      });

      attachLazySynonymTooltip(node, xmlPath);
      return node;
    })
    .filter((n): n is MetadataNode => Boolean(n));
}

/** Строит узлы объектов с иерархией по дескриптору (группы реквизитов, ТЧ, форм, …) */
export function buildStructuredObjectTreeNodes(ctx: HandlerContext, nodeKind: NodeKind): MetadataNode[] {
  const descriptor = getNodeDescriptor(nodeKind)!;
  const plannedChildTags = descriptor.children!;
  if (!plannedChildTags.length) {
    return [];
  }

  return ctx.names
    .map((name) => {
      const xmlPath = resolveObjectXmlPath(ctx.configRoot, nodeKind as string, name) ?? undefined;
      if (!xmlPath) {
        return undefined;
      }

      let ownershipTag: 'OWN' | 'BORROWED' | undefined;
      if (ctx.configKind === 'cfe' && ctx.namePrefix) {
        ownershipTag = name.startsWith(ctx.namePrefix) ? 'OWN' : 'BORROWED';
      }

      const objectInfo = parseObjectXml(xmlPath);
      const allowed = new Set<string>(plannedChildTags);
      const byTag = groupMetaChildren(objectInfo?.children ?? [], allowed);

      const groupNodes = buildGroupNodes(xmlPath, byTag, plannedChildTags, nodeKind);
      const hasStructure = plannedChildTags.length > 0;

      const node = buildNode(descriptor, {
        label: objectInfo?.name ?? name,
        kind: nodeKind,
        collapsibleState: hasStructure
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None,
        xmlPath,
        childrenLoader: hasStructure ? () => groupNodes : undefined,
        ownershipTag,
      });

      attachLazySynonymTooltip(node, xmlPath);
      return node;
    })
    .filter((n): n is MetadataNode => Boolean(n));
}

/**
 * Дерево объектов метаданных по дескриптору узла (`nodes/objects/*.ts`):
 * без `children` — плоский список файлов объектов, иначе — группы по ChildObjects.
 */
export function buildTreeNodesForMetaKind(ctx: HandlerContext, nodeKind: NodeKind): MetadataNode[] {
  const descriptor = getNodeDescriptor(nodeKind)!;
  if (!descriptor.folderName) {
    return [];
  }
  const planned = descriptor.children;
  if (!planned?.length) {
    return buildLeafObjectTreeNodes(ctx, nodeKind);
  }
  return buildStructuredObjectTreeNodes(ctx, nodeKind);
}

/** Корневой узел метаданных: доступна панель свойств */
export function rootMetaObjectCanShowProperties(node: MetadataNode, nodeKind: NodeKind): boolean {
  return node.nodeKind === nodeKind && Boolean(node.xmlPath) && !node.metaContext;
}

/** Свойства корневого XML-объекта метаданных */
export function rootMetaObjectGetProperties(node: MetadataNode, nodeKind: NodeKind): ObjectPropertiesCollection {
  if (node.nodeKind !== nodeKind || !node.xmlPath || node.metaContext) {
    return [];
  }
  try {
    const xml = fs.readFileSync(node.xmlPath, 'utf-8');
    const inheritedXml = node.ownershipTag === 'BORROWED'
      ? readInheritedObjectXmlForBorrowed(node.xmlPath)
      : null;
    return buildRootMetaObjectProperties(xml, nodeKind, inheritedXml);
  } catch {
    return [];
  }
}

/** Группирует дочерние элементы по XML-тегу, только разрешённые дескриптором */
export function groupMetaChildren(children: MetaChild[], allowed: Set<string>): Map<string, MetaChild[]> {
  const map = new Map<string, MetaChild[]>();
  for (const ch of children) {
    if (!allowed.has(ch.tag)) {
      continue;
    }
    if (!map.has(ch.tag)) {
      map.set(ch.tag, []);
    }
    map.get(ch.tag)!.push(ch);
  }
  return map;
}

/**
 * Узлы групп в порядке дескриптора; пустые группы тоже создаются,
 * но без шеврона раскрытия и без {@link MetadataNode.childrenLoader}.
 */
export function buildGroupNodes(
  objectXmlPath: string,
  byTag: Map<string, MetaChild[]>,
  plannedChildTags: readonly ChildTag[],
  rootMetaKind: NodeKind
): MetadataNode[] {
  const groups: MetadataNode[] = [];
  const groupDesc = getNodeDescriptor('group-type')!;

  for (const tag of plannedChildTags) {
    const items = byTag.get(tag) ?? [];

    const tagCfg = CHILD_TAG_CONFIG[tag];
    /** Без дочерних элементов — лист без шеврона раскрытия (как в стандартном дереве VS Code) */
    const hasTagItems = items.length > 0;
    const groupNode = buildNode(groupDesc, {
      label: tagCfg.label,
      kind: 'group-type',
      collapsibleState: hasTagItems
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
      xmlPath: undefined,
      childrenLoader: hasTagItems
        ? () => buildLeavesForTag(objectXmlPath, tag, items, rootMetaKind)
        : undefined,
      ownershipTag: undefined,
      hidePropertiesCommand: true,
    });

    groups.push(groupNode);
  }

  return groups;
}

/** Листья внутри одной группы (одинаковый XML-тег) */
export function buildLeavesForTag(
  objectXmlPath: string,
  tag: ChildTag,
  items: MetaChild[],
  rootMetaKind: NodeKind
): MetadataNode[] {
  if (tag === 'TabularSection') {
    return items.map((ts) => buildTabularSectionNode(objectXmlPath, ts, rootMetaKind));
  }

  const leafDesc = getNodeDescriptor(CHILD_TAG_CONFIG[tag].kind)!;

  return items.map((item) => {
    const xmlPath = resolveLeafXmlPath(objectXmlPath, tag, item.name);
    const metaContext: MetaTreeNodeContext = {
      rootMetaKind,
      ownerObjectXmlPath: objectXmlPath,
    };
    const node = buildNode(leafDesc, {
      label: item.name,
      kind: CHILD_TAG_CONFIG[tag].kind,
      collapsibleState: vscode.TreeItemCollapsibleState.None,
      xmlPath,
      childrenLoader: undefined,
      ownershipTag: undefined,
      metaContext,
    });

    if (item.synonym) {
      node.tooltip = item.synonym;
    }
    return node;
  });
}

/** Табличная часть: при наличии колонок — раскрывается до узлов Column */
export function buildTabularSectionNode(objectXmlPath: string, ts: MetaChild, rootMetaKind: NodeKind): MetadataNode {
  const tsDesc = getNodeDescriptor('TabularSection')!;
  const columns = ts.columns ?? [];
  const hasColumns = columns.length > 0;
  const metaContext: MetaTreeNodeContext = { rootMetaKind, ownerObjectXmlPath: objectXmlPath };

  const node = buildNode(tsDesc, {
    label: ts.name,
    kind: 'TabularSection',
    collapsibleState: hasColumns ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
    xmlPath: objectXmlPath,
    childrenLoader: hasColumns ? () => buildColumnNodes(objectXmlPath, columns, ts.name, rootMetaKind) : undefined,
    ownershipTag: undefined,
    metaContext,
  });

  if (ts.synonym) {
    node.tooltip = ts.synonym;
  }
  return node;
}

/** Колонки табличной части */
export function buildColumnNodes(
  objectXmlPath: string,
  columns: MetaChild[],
  tabularSectionName: string,
  rootMetaKind: NodeKind
): MetadataNode[] {
  const colDesc = getNodeDescriptor('Column')!;
  const metaContext: MetaTreeNodeContext = {
    rootMetaKind,
    tabularSectionName,
    ownerObjectXmlPath: objectXmlPath,
  };

  return columns.map((col) => {
    const node = buildNode(colDesc, {
      label: col.name,
      kind: 'Column',
      collapsibleState: vscode.TreeItemCollapsibleState.None,
      xmlPath: objectXmlPath,
      childrenLoader: undefined,
      ownershipTag: undefined,
      metaContext,
    });
    if (col.synonym) {
      node.tooltip = col.synonym;
    }
    return node;
  });
}

/**
 * Путь к XML для открытия по клику: вложенные артефакты — свой файл;
 * реквизиты ведут на XML объекта-владельца.
 */
export function resolveLeafXmlPath(objectXmlPath: string, tag: ChildTag, itemName: string): string {
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

/** Синоним объекта подгружается при первом показе подсказки */
export function attachLazySynonymTooltip(node: MetadataNode, xmlPath: string): void {
  let cached: string | undefined;
  Object.defineProperty(node, 'tooltip', {
    get: () => {
      if (cached !== undefined) {
        return cached;
      }
      try {
        const xml = fs.readFileSync(xmlPath, 'utf-8');
        cached = extractSynonym(xml) || '';
      } catch {
        cached = '';
      }
      return cached;
    },
    enumerable: true,
    configurable: true,
  });
}
