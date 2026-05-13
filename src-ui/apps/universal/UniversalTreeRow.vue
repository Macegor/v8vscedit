<script setup lang="ts">
import type { TreeNodeDto } from '@ui-shared/types/tree';

const props = defineProps<{
  node: TreeNodeDto;
  depth: number;
  isOpen: boolean;
  isSelected: boolean;
}>();

const emit = defineEmits<{
  toggle: [];
  select: [];
  action: [actionId: string];
  contextMenu: [event: MouseEvent];
}>();

function onContextMenu(event: MouseEvent): void {
  event.preventDefault();
  emit('select');
  emit('contextMenu', event);
}

function ownershipBadge(ownership?: string): string | undefined {
  if (ownership === 'borrowed') return 'З';
  if (ownership === 'own') return 'С';
  return undefined;
}

function supportBadge(supportMode?: string): string | undefined {
  if (supportMode === 'editable') return 'Р';
  if (supportMode === 'locked') return 'Б';
  return undefined;
}

function iconClass(icon?: { kind: string; name?: string }): string {
  if (!icon || icon.kind === 'none') return 'codicon codicon-symbol-misc';
  if (icon.kind === 'codicon' && icon.name) {
    return `codicon codicon-${icon.name}`;
  }
  return 'codicon codicon-symbol-misc';
}
</script>

<template>
  <div
    class="tree-row"
    :class="{ selected: isSelected }"
    :style="{ paddingLeft: depth * 16 + 'px' }"
    role="treeitem"
    :aria-selected="isSelected"
    :aria-expanded="isOpen || undefined"
    @click="emit('select')"
    @contextmenu="onContextMenu"
  >
    <span
      v-if="node.hasChildren"
      class="tree-expander"
      :class="{ expanded: isOpen }"
      @click.stop="emit('toggle')"
    >
      <span class="codicon codicon-chevron-right" />
    </span>
    <span v-else class="tree-expander-spacer" />

    <span class="tree-icon" :class="iconClass(node.icon)" aria-hidden="true" />

    <span class="tree-label">{{ node.label }}</span>

    <span v-if="node.description" class="tree-description">{{ node.description }}</span>

    <span v-if="ownershipBadge(node.ownership)" class="tree-badge ownership-badge">
      {{ ownershipBadge(node.ownership) }}
    </span>
    <span v-if="supportBadge(node.supportMode)" class="tree-badge support-badge">
      {{ supportBadge(node.supportMode) }}
    </span>

    <div v-if="node.actions?.length" class="tree-actions" @click.stop>
      <vscode-button
        v-for="action in node.actions"
        :key="action.id"
        appearance="icon"
        :title="action.label"
        @click.stop="emit('action', action.id)"
      >
        <span v-if="action.icon?.kind === 'codicon'" class="codicon" :class="'codicon-' + action.icon.name" />
        <span v-else>{{ action.label[0] }}</span>
      </vscode-button>
    </div>
  </div>
</template>

<style scoped>
.tree-row {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 2px 8px;
  cursor: pointer;
  font-size: 12px;
  user-select: none;
  min-height: 22px;
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
  flex-shrink: 0;
  transition: transform 0.15s;
  color: var(--vscode-foreground);
  opacity: 0.7;
}
.tree-expander.expanded {
  transform: rotate(90deg);
}
.tree-expander-spacer {
  width: 16px;
  flex-shrink: 0;
}
.tree-icon {
  font-size: 14px;
  width: 16px;
  text-align: center;
  flex-shrink: 0;
  color: var(--vscode-symbolIcon-classForeground);
}
.tree-row.selected .tree-icon {
  color: var(--vscode-list-activeSelectionForeground);
}
.tree-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tree-description {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tree-badge {
  font-size: 9px;
  padding: 1px 4px;
  border-radius: 2px;
  font-weight: 600;
  flex-shrink: 0;
}
.ownership-badge {
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
}
.support-badge {
  background: var(--vscode-inputValidation-warningBackground);
  color: var(--vscode-list-warningForeground);
}
.tree-actions {
  display: none;
  gap: 2px;
  flex-shrink: 0;
}
.tree-row:hover .tree-actions {
  display: flex;
}
</style>
