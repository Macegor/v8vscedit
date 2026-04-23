import { NodeKind } from '../TreeNode';
import { getNodeDescriptor } from '../nodes/index';

/**
 * Возвращает имя SVG-иконки для указанного типа узла.
 * Значение берётся из соответствующего `NodeDescriptor`.
 */
export function getIconName(nodeKind: NodeKind): string {
  const descriptor = getNodeDescriptor(nodeKind);
  return descriptor?.icon ?? 'attribute';
}

