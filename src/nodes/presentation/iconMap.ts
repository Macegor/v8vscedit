import { NodeKind } from '../../MetadataNode';
import { getNodeDescriptor } from '../index';

/**
 * Возвращает имя SVG-иконки для указанного типа узла.
 * Значение берётся из соответствующего `NodeDescriptor`.
 */
export function getIconName(nodeKind: NodeKind): string {
  const descriptor = getNodeDescriptor(nodeKind);
  return descriptor?.icon ?? 'attribute';
}

