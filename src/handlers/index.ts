import { MetadataNode, NodeKind } from '../MetadataNode';
import { ObjectHandler } from './_types';
import { commonAttributeHandler } from './commonAttribute';
import { commonModuleHandler } from './commonModule';
import { roleHandler } from './role';
import { sessionParameterHandler } from './sessionParameter';
import { subsystemHandler } from './subsystem';

/**
 * Реестр обработчиков по типу объекта из ChildObjects в Configuration.xml.
 * По мере реализации сюда добавляются новые типы (Catalog, Document и т.д.).
 */
const HANDLER_REGISTRY = new Map<string, ObjectHandler>([
  ['Subsystem', subsystemHandler],
  ['CommonModule', commonModuleHandler],
  ['SessionParameter', sessionParameterHandler],
  ['Role', roleHandler],
  ['CommonAttribute', commonAttributeHandler],
]);

/** Возвращает обработчик для указанного типа объекта или undefined */
export function getObjectHandler(objectType: string): ObjectHandler | undefined {
  return HANDLER_REGISTRY.get(objectType);
}

/** Возвращает обработчик для типа узла дерева, если он зарегистрирован */
export function getNodeHandler(nodeKind: NodeKind): ObjectHandler | undefined {
  return HANDLER_REGISTRY.get(nodeKind);
}

/** Возвращает обработчик для конкретного узла дерева, если он зарегистрирован */
export function getHandlerForNode(node: MetadataNode): ObjectHandler | undefined {
  return getNodeHandler(node.nodeKind);
}
