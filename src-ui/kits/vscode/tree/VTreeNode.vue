<template>
  <div class="vscode-kit-tree-node" role="treeitem" :aria-expanded="open" :aria-selected="selected">
    <VTreeRow
      :node="node"
      :depth="depth"
      :selected="selected"
      :open="open"
      @select="emit('select', node.id)"
      @toggle="onToggle"
      @context-menu="(id: string, ev: MouseEvent) => emit('contextMenu', props.node.id, ev)"
    />
    <div v-if="open && node.children && node.children.length > 0" class="vscode-kit-tree-node__children" role="group">
      <VTreeNode
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        :depth="depth + 1"
        :selected="child.id === selectedId"
        :open="childHasOpened(child.id)"
        :opened-set="effectiveOpenedSet"
        :selected-id="selectedId"
        @select="(id: string) => emit('select', id)"
        @toggle="(id: string) => emit('toggle', id)"
        @load-children="(id: string) => emit('loadChildren', id)"
        @context-menu="(id: string, ev: MouseEvent) => emit('contextMenu', id, ev)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { TreeNodeDto } from '@ui-shared/types/tree';
import VTreeRow from './VTreeRow.vue';

/**
 * Рекурсивный узел дерева. Оборачивает VTreeRow
 * и рендерит дочерние VTreeNode при развороте.
 */
const props = withDefaults(defineProps<{
  node: TreeNodeDto;
  depth: number;
  selected: boolean;
  open: boolean;
  openedSet?: Set<string>;
  selectedId?: string;
}>(), {
  depth: 0,
  selected: false,
  open: false,
  openedSet: undefined,
  selectedId: '',
});

const emit = defineEmits<{
  select: [id: string];
  toggle: [id: string];
  loadChildren: [id: string];
  contextMenu: [id: string, event: MouseEvent];
}>();

const effectiveOpenedSet = computed(() => props.openedSet || new Set<string>());

function childHasOpened(id: string): boolean {
  return effectiveOpenedSet.value.has(id);
}

function onToggle(): void {
  if (!props.node.loaded && props.node.hasChildren) {
    emit('loadChildren', props.node.id);
  }
  emit('toggle', props.node.id);
}

function onContextMenu(event: MouseEvent): void {
  emit('contextMenu', props.node.id, event);
}
</script>

<style scoped>
.vscode-kit-tree-node__children {
  /* Отступ наследуется от VTreeRow через padding-left */
}
</style>
