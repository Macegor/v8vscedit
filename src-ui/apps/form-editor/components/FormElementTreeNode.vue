<script setup lang="ts">
import { ref, computed } from 'vue';
import type { FormElementDto } from '../main';

const props = defineProps<{
  element: FormElementDto;
  depth: number;
  selectedId?: number;
}>();

const emit = defineEmits<{
  select: [id: number];
}>();

const expanded = ref(true);
const isSelected = computed(() => props.element.id === props.selectedId);
const hasChildren = computed(() => props.element.children?.length > 0);

function getIconClass(type: string): string {
  const iconMap: Record<string, string> = {
    UsualGroup: 'codicon-symbol-field',
    InputField: 'codicon-symbol-text',
    LabelField: 'codicon-symbol-text',
    Button: 'codicon-symbol-event',
    Table: 'codicon-symbol-table',
    Pages: 'codicon-symbol-folder',
    Page: 'codicon-symbol-folder',
    CheckBoxField: 'codicon-symbol-boolean',
    CommandBar: 'codicon-symbol-ruler',
    Navigator: 'codicon-symbol-navigator',
  };
  return iconMap[type] ?? 'codicon-symbol-misc';
}
</script>

<template>
  <div class="tree-node" :style="{ paddingLeft: depth * 16 + 'px' }">
    <div
      class="tree-row"
      :class="{ selected: isSelected }"
      role="treeitem"
      :aria-selected="isSelected"
      @click="emit('select', element.id)"
    >
      <span
        v-if="hasChildren"
        class="tree-expander"
        :class="{ expanded }"
        @click.stop="expanded = !expanded"
      >
        <span class="codicon codicon-chevron-right"></span>
      </span>
      <span v-else class="tree-expander-spacer"></span>
      <span class="tree-icon codicon" :class="getIconClass(element.type)" :title="element.type"></span>
      <span class="tree-label">{{ element.title || element.name || element.type }}</span>
      <span v-if="element.dataPath" class="tree-datapath">{{ element.dataPath }}</span>
    </div>
    <div v-if="hasChildren && expanded" class="tree-children">
      <FormElementTreeNode
        v-for="child in element.children"
        :key="child.id"
        :element="child"
        :depth="depth + 1"
        :selected-id="selectedId"
        @select="emit('select', $event)"
      />
    </div>
  </div>
</template>

<style scoped>
.tree-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  cursor: pointer;
  font-size: 12px;
  border-radius: 2px;
  user-select: none;
}

.tree-row:hover {
  background: var(--vscode-list-hoverBackground);
}

.tree-row.selected {
  background: var(--vscode-list-activeSelectionBackground);
  color: var(--vscode-list-activeSelectionForeground);
}

.tree-expander {
  width: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.15s;
  cursor: pointer;
}

.tree-expander.expanded {
  transform: rotate(90deg);
}

.tree-expander-spacer {
  width: 16px;
}

.tree-icon {
  font-size: 14px;
  flex-shrink: 0;
}

.tree-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tree-datapath {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
