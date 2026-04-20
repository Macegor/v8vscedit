import { MetadataNode } from '../MetadataNode';
import {
  buildStructuredObjectTreeNodes,
  rootMetaObjectCanShowProperties,
  rootMetaObjectGetProperties,
} from './metaObjectTreeBuilder';
import { HandlerContext, ObjectHandler, ObjectPropertiesCollection } from './_types';

// ---------------------------------------------------------------------------
// Объект «План обмена» (ExchangePlan) в XML-выгрузке 1С:
//
// Папка: ExchangePlans, дескриптор узла — nodes/objects/ExchangePlan.ts
// (реквизиты, табличные части, формы, команды, макеты по схеме дескриптора).
//
// Дерево и свойства корня делегируются в metaObjectTreeBuilder; здесь —
// точка входа по соглашению «один тип объекта — один файл-обработчик».
// ---------------------------------------------------------------------------

const NODE_KIND = 'ExchangePlan' as const;

export const exchangePlanHandler: ObjectHandler = {
  buildTreeNodes(ctx: HandlerContext) {
    return buildStructuredObjectTreeNodes(ctx, NODE_KIND);
  },

  canShowProperties(node: MetadataNode) {
    return rootMetaObjectCanShowProperties(node, NODE_KIND);
  },

  getProperties(node: MetadataNode): ObjectPropertiesCollection {
    return rootMetaObjectGetProperties(node, NODE_KIND);
  },
};
