import { MetadataNode } from '../TreeNode';
import {
  buildTreeNodesForMetaKind,
  rootMetaObjectCanShowProperties,
  rootMetaObjectGetProperties,
} from './metaObjectTreeBuilder';
import { HandlerContext, ObjectHandler, ObjectPropertiesCollection } from './_types';

// ---------------------------------------------------------------------------
// Объект «Константа» (Constant) в XML-выгрузке 1С.
// Папка: Constants, дескриптор — nodes/objects/Constant.ts (лист без дочерних групп).
// Дерево и свойства корня — metaObjectTreeBuilder + metaXmlFragmentProperties.
// ---------------------------------------------------------------------------

const NODE_KIND = 'Constant' as const;

export const constantHandler: ObjectHandler = {
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
