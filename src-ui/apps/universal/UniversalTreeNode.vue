<script setup lang="ts">
import { computed } from 'vue';
import type { TreeNodeDto } from '@ui-shared/types/tree';
import UniversalTreeRow from './UniversalTreeRow.vue';

type IdMap = Readonly<Record<string, true>>;

const props = defineProps<{
  node: TreeNodeDto;
  depth: number;
  selectedId: string | null;
  openIds: IdMap;
  loadingIds: IdMap;
}>();

const emit = defineEmits<{
  toggle: [nodeId: string];
  select: [nodeId: string | null];
  default: [nodeId: string];
  action: [payload: { nodeId: string; actionId: string }];
  contextMenu: [payload: { nodeId: string; event: MouseEvent }];
}>();

const isOpen = computed(() => Boolean(props.openIds[props.node.id]));
const isSelected = computed(() => props.node.id === props.selectedId);
const isLoading = computed(() => Boolean(props.loadingIds[props.node.id]));
const hasChildren = computed(() => props.node.hasChildren || (props.node.children?.length ?? 0) > 0);

function onToggle(): void {
  emit('toggle', props.node.id);
}

function onSelect(): void {
  emit('select', props.node.id);
}

function onDefault(): void {
  emit('default', props.node.id);
}
</script>

<template>
  <div class="tree-node-wrapper">
    <UniversalTreeRow
      :node="node"
      :depth="depth"
      :is-open="isOpen"
      :is-selected="isSelected"
      :is-loading="isLoading"
      @toggle="onToggle"
      @select="onSelect"
      @default="onDefault"
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
        :loading-ids="loadingIds"
        @toggle="emit('toggle', $event)"
        @select="emit('select', $event)"
        @default="emit('default', $event)"
        @action="emit('action', $event)"
        @context-menu="emit('contextMenu', $event)"
      />
    </div>
  </div>
</template>

<style scoped></style>
