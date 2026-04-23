import { MetadataNode } from '../TreeNode';
import { HandlerContext, ObjectHandler, ObjectPropertiesCollection } from './_types';

/**
 * Заглушка для типов в навигаторе без выгрузки в отдельные каталоги
 * (например «Цвета палитры» в конфигураторе как отдельная ветка).
 */
export const emptyMetadataGroupHandler: ObjectHandler = {
  buildTreeNodes(_ctx: HandlerContext) {
    return [];
  },
  canShowProperties(_node: MetadataNode) {
    return false;
  },
  getProperties(_node: MetadataNode): ObjectPropertiesCollection {
    return [];
  },
};
