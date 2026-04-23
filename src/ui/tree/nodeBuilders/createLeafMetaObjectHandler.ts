import { MetadataNode, NodeKind } from '../TreeNode';
import {
  buildTreeNodesForMetaKind,
  rootMetaObjectCanShowProperties,
  rootMetaObjectGetProperties,
} from './metaObjectTreeBuilder';
import { HandlerContext, ObjectHandler, ObjectPropertiesCollection } from './_types';

/** Обработчик «листового» объекта метаданных по типу узла (дерево + свойства корня из XML). */
export function createLeafMetaObjectHandler(nodeKind: NodeKind): ObjectHandler {
  return {
    buildTreeNodes(ctx: HandlerContext) {
      return buildTreeNodesForMetaKind(ctx, nodeKind);
    },
    canShowProperties(node: MetadataNode) {
      return rootMetaObjectCanShowProperties(node, nodeKind);
    },
    getProperties(node: MetadataNode): ObjectPropertiesCollection {
      return rootMetaObjectGetProperties(node, nodeKind);
    },
  };
}
