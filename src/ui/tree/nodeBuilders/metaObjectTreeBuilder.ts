/**
 * Декомпозированная сборка дерева для объектов метаданных с XML-выгрузки 1С.
 * Конкретные обработчики (catalog.ts, constant.ts, …) вызывают эти функции,
 * а не дублируют обход ChildObjects и построение групп.
 */
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import type { MetaTreeNodeContext, MetadataNode, NodeKind } from '../TreeNode';
import { buildNode } from '../nodes/_base';
import { getNodeDescriptor } from '../nodes/index';
import type { NodeDescriptor } from '../nodes/_types';
import { type ChildTag, CHILD_TAG_CONFIG } from '../../../domain/ChildTag';
import { getMetaType } from '../../../domain/MetaTypes';
import { type MetaChild, parseObjectXml, resolveObjectXmlPath } from '../../../infra/xml';
import { getObjectLocationFromXml } from '../../../infra/fs/MetaPathResolver';
import { buildRootMetaObjectProperties } from '../../views/properties/PropertyBuilder';
import { readInheritedObjectXmlForBorrowed } from '../../views/properties/BorrowedPropertiesResolver';
import { enrichCommandInterfaceGroupOptions } from '../../views/properties/CommandInterfaceGroupOptions';
import type { HandlerContext, ObjectPropertiesCollection } from './_types';

function requireNodeDescriptor(kind: NodeKind): NodeDescriptor {
  return getNodeDescriptor(kind);
}

/** Строит плоский список узлов объекта без дочерней структуры ChildObjects */
export function buildLeafObjectTreeNodes(ctx: HandlerContext, nodeKind: NodeKind): MetadataNode[] {
  const descriptor = requireNodeDescriptor(nodeKind);

  return ctx.names
    .map((name) => {
      const xmlPath = resolveObjectXmlPath(ctx.configRoot, nodeKind, name) ?? undefined;
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

      return node;
    })
    .filter((n): n is MetadataNode => Boolean(n));
}

/** Строит узлы объектов с иерархией по дескриптору (группы реквизитов, ТЧ, форм, …) */
export function buildStructuredObjectTreeNodes(ctx: HandlerContext, nodeKind: NodeKind): MetadataNode[] {
  const descriptor = requireNodeDescriptor(nodeKind);
  const plannedChildTags = descriptor.children ?? [];
  if (!plannedChildTags.length) {
    return [];
  }

  return ctx.names
    .map((name) => {
      const xmlPath = resolveObjectXmlPath(ctx.configRoot, nodeKind, name) ?? undefined;
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

      // flatChildren: единственный дочерний тег висит прямо на узле объекта, без
      // промежуточной группы (HTTP-сервис → URL-шаблоны как в конфигураторе).
      const flatten = getMetaType(nodeKind).flatChildren === true && plannedChildTags.length === 1;
      const childNodes = flatten
        ? buildLeavesForTag(xmlPath, plannedChildTags[0], byTag.get(plannedChildTags[0]) ?? [], nodeKind)
        : buildGroupNodes(xmlPath, byTag, plannedChildTags, nodeKind);
      const hasStructure = plannedChildTags.length > 0;

      const node = buildNode(descriptor, {
        label: objectInfo?.name ?? name,
        kind: nodeKind,
        collapsibleState: hasStructure
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None,
        xmlPath,
        childrenLoader: hasStructure ? () => childNodes : undefined,
        ownershipTag,
        addMetadataTarget: flatten
          ? { kind: 'child', ownerObjectXmlPath: xmlPath, childTag: plannedChildTags[0] }
          : undefined,
      });

      if (objectInfo?.synonym) {
        node.tooltip = objectInfo.synonym;
      }
      return node;
    })
    .filter((n): n is MetadataNode => Boolean(n));
}

/**
 * Дерево объектов метаданных по дескриптору узла (`nodes/objects/*.ts`):
 * без `children` — плоский список файлов объектов, иначе — группы по ChildObjects.
 */
export function buildTreeNodesForMetaKind(ctx: HandlerContext, nodeKind: NodeKind): MetadataNode[] {
  const descriptor = requireNodeDescriptor(nodeKind);
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
    const properties = buildRootMetaObjectProperties(xml, nodeKind, inheritedXml);
    return enrichCommandInterfaceGroupOptions(properties, getObjectLocationFromXml(node.xmlPath).configRoot);
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
    const group = map.get(ch.tag);
    if (group) {
      group.push(ch);
    } else {
      map.set(ch.tag, [ch]);
    }
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
  const groupDesc = requireNodeDescriptor('group-type');

  for (const tag of plannedChildTags) {
    const items = byTag.get(tag) ?? [];
    if (tag === 'StandardAttribute' && items.length === 0) {
      continue;
    }

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

  if (tag === 'URLTemplate') {
    return items.map((template) => buildUrlTemplateNode(objectXmlPath, template, rootMetaKind));
  }

  const leafDesc = requireNodeDescriptor(CHILD_TAG_CONFIG[tag].kind);

  return items.map((item) => {
    const xmlPath = resolveLeafXmlPath(objectXmlPath, tag, item.name);
    const metaContext: MetaTreeNodeContext = {
      rootMetaKind,
      ownerObjectXmlPath: objectXmlPath,
      standardAttributeName: tag === 'StandardAttribute' ? item.name : undefined,
    };
    const node = buildNode(leafDesc, {
      label: item.presentation ?? item.name,
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
  const tsDesc = requireNodeDescriptor('TabularSection');
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

/**
 * URL-шаблон HTTP-сервиса: при наличии методов раскрывается до узлов Method.
 * Контейнерный узел, симметричный {@link buildTabularSectionNode} (ТЧ→Колонка).
 */
export function buildUrlTemplateNode(objectXmlPath: string, template: MetaChild, rootMetaKind: NodeKind): MetadataNode {
  const desc = requireNodeDescriptor('URLTemplate');
  const methods = template.columns ?? [];
  const hasMethods = methods.length > 0;
  const metaContext: MetaTreeNodeContext = { rootMetaKind, ownerObjectXmlPath: objectXmlPath };

  const node = buildNode(desc, {
    label: template.name,
    kind: 'URLTemplate',
    collapsibleState: hasMethods ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
    xmlPath: objectXmlPath,
    childrenLoader: hasMethods ? () => buildMethodNodes(objectXmlPath, methods, template.name, rootMetaKind) : undefined,
    ownershipTag: undefined,
    metaContext,
  });

  if (template.synonym) {
    node.tooltip = template.synonym;
  }
  return node;
}

/** Методы URL-шаблона HTTP-сервиса */
export function buildMethodNodes(
  objectXmlPath: string,
  methods: MetaChild[],
  urlTemplateName: string,
  rootMetaKind: NodeKind
): MetadataNode[] {
  const desc = requireNodeDescriptor('Method');
  const metaContext: MetaTreeNodeContext = {
    rootMetaKind,
    urlTemplateName,
    ownerObjectXmlPath: objectXmlPath,
  };

  return methods.map((method) => {
    const node = buildNode(desc, {
      label: method.name,
      kind: 'Method',
      collapsibleState: vscode.TreeItemCollapsibleState.None,
      xmlPath: objectXmlPath,
      childrenLoader: undefined,
      ownershipTag: undefined,
      metaContext,
    });
    if (method.synonym) {
      node.tooltip = method.synonym;
    }
    return node;
  });
}

/** Колонки табличной части */
export function buildColumnNodes(
  objectXmlPath: string,
  columns: MetaChild[],
  tabularSectionName: string,
  rootMetaKind: NodeKind
): MetadataNode[] {
  const colDesc = requireNodeDescriptor('Column');
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
