import { MetadataNode } from '../TreeNode';
import {
  buildTreeNodesForMetaKind,
  rootMetaObjectCanShowProperties,
  rootMetaObjectGetProperties,
} from './metaObjectTreeBuilder';
import { HandlerContext, ObjectHandler, ObjectPropertiesCollection } from './_types';

// ---------------------------------------------------------------------------
// Объект «Справочник» (Catalog) в XML-выгрузке 1С:
//
// Папка: Catalogs, дескриптор — nodes/objects/Catalog.ts
// (реквизиты, табличные части, формы, команды, макеты).
//
// Дерево и свойства корня — через metaObjectTreeBuilder.
// ---------------------------------------------------------------------------

const NODE_KIND = 'Catalog' as const;

export const catalogHandler: ObjectHandler = {
  buildTreeNodes(ctx: HandlerContext) {
    return buildTreeNodesForMetaKind(ctx, NODE_KIND);
  },

  canShowProperties(node: MetadataNode) {
    return rootMetaObjectCanShowProperties(node, NODE_KIND);
  },

  getProperties(node: MetadataNode): ObjectPropertiesCollection {
    return rootMetaObjectGetProperties(node, NODE_KIND);
  },
};
