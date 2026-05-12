<template>
  <div
    class="vscode-kit-tree-row"
    :class="{
      'vscode-kit-tree-row--selected': selected,
      'vscode-kit-tree-row--focused': selected,
    }"
    :style="{ paddingLeft: `${depth * 16 + 4}px` }"
    @click="emit('select', node.id)"
    @contextmenu.prevent="emit('contextMenu', node.id, $event)"
    @dblclick="onDblClick"
  >
    <VTreeExpander
      :expanded="open"
      :loading="false"
      :visible="node.hasChildren"
      @toggle="emit('toggle', node.id)"
    />
    <VTreeIcon v-if="node.icon" :icon="node.icon" />
    <VTreeLabel :label="node.label" :highlight="''" />
    <VTreeDescription v-if="node.description" :description="node.description" />
    <VTreeBadge v-if="node.supportMode" :kind="node.supportMode" :label="supportLabel(node.supportMode)" />
    <VTreeActions v-if="node.actions && node.actions.length > 0">
      <VTreeActionButton
        v-for="action in node.actions"
        :key="action.id"
        :action="action"
        @click="(ev: MouseEvent) => handleAction(action, ev)"
      />
    </VTreeActions>
  </div>
</template>

<script setup lang="ts">
import type { TreeNodeDto, TreeNodeActionDto, SupportMode } from '@ui-shared/types/tree';
import VTreeExpander from './VTreeExpander.vue';
import VTreeIcon from './VTreeIcon.vue';
import VTreeLabel from './VTreeLabel.vue';
import VTreeDescription from './VTreeDescription.vue';
import VTreeBadge from './VTreeBadge.vue';
import VTreeActions from './VTreeActions.vue';
import VTreeActionButton from './VTreeActionButton.vue';

/**
 * Строка узла дерева. Содержит раскрыватель, иконку, заголовок,
 * описание, бейдж поддержки и действия узла.
 */
const props = withDefaults(defineProps<{
  node: TreeNodeDto;
  depth: number;
  selected: boolean;
  open: boolean;
}>(), {
  depth: 0,
  selected: false,
  open: false,
});

const emit = defineEmits<{
  select: [id: string];
  toggle: [id: string];
  contextMenu: [id: string, event: MouseEvent];
  action: [id: string, actionId: string];
}>();

function supportLabel(mode: SupportMode): string {
  const labels: Record<SupportMode, string> = {
    none: '',
    editable: 'Редактируется',
    locked: 'Заблокирован',
  };
  return labels[mode];
}

function onDblClick(): void {
  if (props.node.hasChildren) {
    emit('toggle', props.node.id);
  }
}

function handleAction(action: TreeNodeActionDto, _event: MouseEvent): void {
  emit('action', props.node.id, action.id);
}
</script>

<style scoped>
.vscode-kit-tree-row {
  display: flex;
  align-items: center;
  gap: 2px;
  min-height: 22px;
  padding-top: 1px;
  padding-bottom: 1px;
  cursor: pointer;
  border-radius: var(--vscode-kit-border-radius-small);
}
.vscode-kit-tree-row:hover {
  background: var(--vscode-kit-listHoverBackground);
}
.vscode-kit-tree-row--selected {
  background: var(--vscode-kit-listInactiveSelectionBackground);
}
.vscode-kit-tree-row--focused {
  background: var(--vscode-kit-listActiveSelectionBackground);
  color: var(--vscode-kit-listActiveSelectionForeground);
}
</style>
