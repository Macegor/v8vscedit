<script setup lang="ts">
import type { TreeNodeDto } from '@ui-shared/types/tree';
import UniversalTreeNode from './UniversalTreeNode.vue';

defineProps<{
  nodes: readonly TreeNodeDto[];
  selectedId: string | null;
  openIds: Set<string>;
  loadingIds: Set<string>;
}>();

const emit = defineEmits<{
  toggle: [nodeId: string, open: boolean];
  select: [nodeId: string | null];
  default: [nodeId: string];
  action: [nodeId: string, actionId: string];
  contextMenu: [nodeId: string, event: MouseEvent];
}>();
</script>

<template>
  <div class="universal-tree" role="tree">
    <UniversalTreeNode
      v-for="node in nodes"
      :key="node.id"
      :node="node"
      :depth="0"
      :selected-id="selectedId"
      :open-ids="openIds"
      :loading-ids="loadingIds"
      @toggle="emit('toggle', $event, !openIds.has($event))"
      @select="emit('select', $event)"
      @default="emit('default', $event)"
      @action="($event) => emit('action', $event.nodeId, $event.actionId)"
      @context-menu="($event) => emit('contextMenu', $event.nodeId, $event.event)"
    />
    <div v-if="!nodes.length" class="tree-empty">Нет данных</div>
  </div>
</template>

<style scoped>
.universal-tree {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 2px 4px 12px;
}
.tree-empty {
  padding: 24px;
  text-align: center;
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
}
</style>
