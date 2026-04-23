import { MetadataNode } from '../TreeNode';
import {
  buildTreeNodesForMetaKind,
  rootMetaObjectCanShowProperties,
  rootMetaObjectGetProperties,
} from './metaObjectTreeBuilder';
import { HandlerContext, ObjectHandler, ObjectPropertiesCollection } from './_types';

// ---------------------------------------------------------------------------
// Объект «Регламентное задание» (ScheduledJob). Папка: ScheduledJobs.
// Дескриптор — nodes/objects/ScheduledJob.ts.
// ---------------------------------------------------------------------------

const NODE_KIND = 'ScheduledJob' as const;

export const scheduledJobHandler: ObjectHandler = {
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
