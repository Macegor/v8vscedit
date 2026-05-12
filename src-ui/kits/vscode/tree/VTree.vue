<template>
  <div
    class="vscode-kit-tree"
    role="tree"
    :aria-label="ariaLabel"
    @contextmenu.prevent="onContextMenu"
  >
    <VTreeNode
      v-for="node in nodes"
      :key="node.id"
      :node="node"
      :depth="0"
      :selected="node.id === selectedId"
      :open="openedSet.has(node.id)"
      @select="onSelect"
      @toggle="onToggle"
      @load-children="onLoadChildren"
      @context-menu="onNodeContextMenu"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { TreeNodeDto } from '@ui-shared/types/tree';
import VTreeNode from './VTreeNode.vue';

/**
 * Дерево метаданных. Рендерит список TreeNodeDto рекурсивно.
 *
 * - `openIds` — Set развёрнутых узлов
 * - `loadChildren` — callback для ленивой загрузки дочерних узлов
 * - Контекстное меню через `contextMenu` с координатами
 */
const props = withDefaults(defineProps<{
  nodes: readonly TreeNodeDto[];
  selectedId?: string;
  openIds?: readonly string[];
  ariaLabel?: string;
}>(), {
  nodes: () => [],
  selectedId: '',
  openIds: () => [],
  ariaLabel: 'Дерево метаданных',
});

const emit = defineEmits<{
  select: [id: string];
  toggle: [id: string];
  loadChildren: [id: string];
  contextMenu: [id: string, event: MouseEvent];
}>();

const openedSet = computed(() => new Set(props.openIds));

function onSelect(id: string): void {
  emit('select', id);
}

function onToggle(id: string): void {
  emit('toggle', id);
}

function onLoadChildren(id: string): void {
  emit('loadChildren', id);
}

function onNodeContextMenu(id: string, event: MouseEvent): void {
  emit('contextMenu', id, event);
}

function onContextMenu(event: MouseEvent): void {
  if (event.target === event.currentTarget) {
    emit('contextMenu', '', event);
  }
}
</script>

<style scoped>
.vscode-kit-tree {
  outline: none;
  font-family: var(--vscode-kit-font-family);
  font-size: var(--vscode-kit-font-size);
  line-height: var(--vscode-kit-line-height);
  color: var(--vscode-kit-foreground);
  user-select: none;
}
</style>
