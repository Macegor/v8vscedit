<script setup lang="ts">
import { computed } from 'vue';
import type { TreeNodeDto } from '@ui-shared/types/tree';
import UniversalTreeRow from './UniversalTreeRow.vue';

const props = defineProps<{
  node: TreeNodeDto;
  depth: number;
  selectedId: string | null;
  openIds: Set<string>;
}>();

const emit = defineEmits<{
  toggle: [nodeId: string];
  select: [nodeId: string | null];
  action: [payload: { nodeId: string; actionId: string }];
  contextMenu: [payload: { nodeId: string; event: MouseEvent }];
}>();

const isOpen = computed(() => props.openIds.has(props.node.id));
const isSelected = computed(() => props.node.id === props.selectedId);
const hasChildren = computed(() => props.node.hasChildren || (props.node.children?.length ?? 0) > 0);

function onToggle(): void {
  emit('toggle', props.node.id);
}

function onSelect(): void {
  emit('select', props.node.id);
}
</script>

<template>
  <div class="tree-node-wrapper">
    <UniversalTreeRow
      :node="node"
      :depth="depth"
      :is-open="isOpen"
      :is-selected="isSelected"
      @toggle="onToggle"
      @select="onSelect"
      @action="(actionId: string) => emit('action', { nodeId: node.id, actionId })"
      @context-menu="(event: MouseEvent) => emit('contextMenu', { nodeId: node.id, event })"
    />
    <div v-if="isOpen && hasChildren && node.children" class="tree-children">
      <UniversalTreeNode
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        :depth="depth + 1"
        :selected-id="selectedId"
        :open-ids="openIds"
        @toggle="emit('toggle', $event)"
        @select="emit('select', $event)"
        @action="emit('action', $event)"
        @context-menu="emit('contextMenu', $event)"
      />
    </div>
    <div v-if="isOpen && hasChildren && !node.children && !node.loaded" class="tree-loading">
      <span class="codicon codicon-loading codicon-modifier-spin" />
    </div>
  </div>
</template>

<style scoped>
.tree-loading {
  padding: 4px 0 4px 32px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
}
</style>
