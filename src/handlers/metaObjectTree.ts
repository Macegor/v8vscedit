import { MetadataNode, NodeKind } from '../MetadataNode';
import { getNodeDescriptor } from '../nodes';
import {
  buildLeafObjectTreeNodes,
  buildStructuredObjectTreeNodes,
  rootMetaObjectCanShowProperties,
  rootMetaObjectGetProperties,
} from './metaObjectTreeBuilder';
import { HandlerContext, ObjectHandler } from './_types';

/**
 * Фабрика обработчиков для типов метаданных без отдельного файла-обработчика.
 * Для типов с собственным модулем (например ExchangePlan → exchangePlan.ts)
 * регистрируйте обработчик явно в handlers/index.ts.
 */
export function createMetaObjectHandler(nodeKind: NodeKind): ObjectHandler {
  const descriptor = getNodeDescriptor(nodeKind);
  const folderName = descriptor?.folderName;
  if (!folderName) {
    return { buildTreeNodes: () => [] };
  }

  const plannedChildTags = descriptor.children;
  if (!plannedChildTags?.length) {
    return {
      buildTreeNodes: (ctx) => buildLeafObjectTreeNodes(ctx, nodeKind),
      canShowProperties: (node) => rootMetaObjectCanShowProperties(node, nodeKind),
      getProperties: (node) => rootMetaObjectGetProperties(node, nodeKind),
    };
  }

  return {
    buildTreeNodes: (ctx) => buildStructuredObjectTreeNodes(ctx, nodeKind),
    canShowProperties: (node) => rootMetaObjectCanShowProperties(node, nodeKind),
    getProperties: (node) => rootMetaObjectGetProperties(node, nodeKind),
  };
}
