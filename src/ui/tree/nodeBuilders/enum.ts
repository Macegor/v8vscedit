import { MetadataNode } from '../TreeNode';
import {
  buildTreeNodesForMetaKind,
  rootMetaObjectCanShowProperties,
  rootMetaObjectGetProperties,
} from './metaObjectTreeBuilder';
import { HandlerContext, ObjectHandler, ObjectPropertiesCollection } from './_types';

// ---------------------------------------------------------------------------
// Объект «Перечисление» (Enum) в XML-выгрузке 1С:
//
// Папка: Enums, дескриптор — nodes/objects/Enum.ts
// (значения, формы, команды, макеты; группы дерева всегда, в т.ч. пустые).
//
// Дерево и свойства корня — через metaObjectTreeBuilder.
// ---------------------------------------------------------------------------

const NODE_KIND = 'Enum' as const;

export const enumHandler: ObjectHandler = {
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
