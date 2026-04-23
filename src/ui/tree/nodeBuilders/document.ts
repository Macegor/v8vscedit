import { MetadataNode } from '../TreeNode';
import {
  buildTreeNodesForMetaKind,
  rootMetaObjectCanShowProperties,
  rootMetaObjectGetProperties,
} from './metaObjectTreeBuilder';
import { HandlerContext, ObjectHandler, ObjectPropertiesCollection } from './_types';

// ---------------------------------------------------------------------------
// Объект «Документ» (Document) в XML-выгрузке 1С:
//
// Папка: Documents, дескриптор — nodes/objects/Document.ts
// (реквизиты, табличные части, формы, команды, макеты).
//
// Дерево и свойства корня — через metaObjectTreeBuilder.
// ---------------------------------------------------------------------------

const NODE_KIND = 'Document' as const;

export const documentHandler: ObjectHandler = {
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
