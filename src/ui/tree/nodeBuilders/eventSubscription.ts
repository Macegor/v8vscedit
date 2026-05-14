import * as fs from 'fs';
import type { MetadataNode } from '../TreeNode';
import {
  buildTreeNodesForMetaKind,
  rootMetaObjectCanShowProperties,
} from './metaObjectTreeBuilder';
import type { HandlerContext, ObjectHandler, ObjectPropertiesCollection } from './_types';
import { buildEventSubscriptionProperties } from '../../views/properties/EventSubscriptionPropertyService';

// ---------------------------------------------------------------------------
// Объект «Подписка на событие» (EventSubscription). Папка: EventSubscriptions.
// Дескриптор — nodes/objects/EventSubscription.ts.
// ---------------------------------------------------------------------------

const NODE_KIND = 'EventSubscription' as const;

export const eventSubscriptionHandler: ObjectHandler = {
  buildTreeNodes(ctx: HandlerContext) {
    return buildTreeNodesForMetaKind(ctx, NODE_KIND);
  },

  canShowProperties(node: MetadataNode) {
    return rootMetaObjectCanShowProperties(node, NODE_KIND);
  },

  getProperties(node: MetadataNode): ObjectPropertiesCollection {
    if (node.nodeKind !== NODE_KIND || !node.xmlPath || node.metaContext) {
      return [];
    }
    try {
      const xml = fs.readFileSync(node.xmlPath, 'utf-8');
      return buildEventSubscriptionProperties(xml, node.xmlPath);
    } catch {
      return [];
    }
  },
};
