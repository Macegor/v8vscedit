<script setup lang="ts">
import type { TreeNodeDto } from '@ui-shared/types/tree';

const props = defineProps<{
  node: TreeNodeDto;
  depth: number;
  isOpen: boolean;
  isSelected: boolean;
  isLoading: boolean;
}>();

const emit = defineEmits<{
  toggle: [];
  select: [];
  default: [];
  action: [actionId: string];
  contextMenu: [event: MouseEvent];
}>();

function onContextMenu(event: MouseEvent): void {
  event.preventDefault();
  emit('select');
  emit('contextMenu', event);
}

function iconClass(icon?: { kind: string; name?: string }): string {
  if (!icon || icon.kind === 'none') return 'codicon codicon-symbol-misc';
  if (icon.kind === 'codicon' && icon.name) {
    return `codicon codicon-${icon.name}`;
  }
  return 'codicon codicon-symbol-misc';
}

function isAssetIcon(icon?: { kind: string; lightUri?: string; darkUri?: string }): icon is { kind: 'asset'; lightUri: string; darkUri: string } {
  return icon?.kind === 'asset' && Boolean(icon.lightUri) && Boolean(icon.darkUri);
}

function gitBadgeLabel(status?: string): string {
  if (status === 'added') return 'A';
  if (status === 'modified') return 'M';
  if (status === 'deleted') return 'D';
  return '';
}
</script>

<template>
  <div
    class="tree-row"
    :class="[{ selected: isSelected, loading: isLoading }, node.gitStatus ? `git-${node.gitStatus}` : '']"
    :style="{ paddingLeft: 2 + depth * 14 + 'px' }"
    role="treeitem"
    :aria-selected="isSelected"
    :aria-expanded="isOpen || undefined"
    @click="emit('select')"
    @dblclick.stop="emit('default')"
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

    <picture v-if="isAssetIcon(node.icon)" class="tree-icon-picture" aria-hidden="true">
      <source :srcset="node.icon.lightUri" media="(prefers-color-scheme: light)" />
      <img class="tree-icon-img" :src="node.icon.darkUri" alt="" />
    </picture>
    <span v-else class="tree-icon" :class="iconClass(node.icon)" aria-hidden="true" />

    <span class="tree-label" :title="node.label">{{ node.label }}</span>

    <span v-if="node.inlineActions?.length" class="inline-actions" @click.stop>
      <button
        v-for="action in node.inlineActions"
        :key="action.id"
        class="inline-action"
        type="button"
        :title="action.label"
        :aria-label="action.label"
        @click.stop="emit('action', action.id)"
      >
        <span v-if="action.icon?.kind === 'codicon'" class="codicon" :class="'codicon-' + action.icon.name" aria-hidden="true" />
      </button>
    </span>

    <span v-if="node.stateIcons?.length" class="state-icons">
      <span v-for="stateIcon in node.stateIcons" :key="stateIcon.title" class="state-icon" :title="stateIcon.title">
        <picture v-if="isAssetIcon(stateIcon.icon)" class="state-icon-picture" aria-hidden="true">
          <source :srcset="stateIcon.icon.lightUri" media="(prefers-color-scheme: light)" />
          <img class="state-icon-img" :src="stateIcon.icon.darkUri" alt="" />
        </picture>
        <span v-else-if="stateIcon.icon.kind === 'codicon'" class="codicon" :class="'codicon-' + stateIcon.icon.name" aria-hidden="true" />
      </span>
    </span>

    <span v-if="node.gitStatus" class="git-badge" :class="node.gitStatus" :title="'Статус Git: ' + node.gitStatus">
      {{ gitBadgeLabel(node.gitStatus) }}
    </span>
  </div>
</template>

<style scoped>
.tree-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
  padding-top: 0;
  padding-right: 4px;
  padding-bottom: 0;
  cursor: pointer;
  user-select: none;
  min-height: 24px;
  box-sizing: border-box;
  overflow: hidden;
}
.tree-row:hover {
  background: var(--vscode-list-hoverBackground);
}
.tree-row.selected {
  background: var(--vscode-list-hoverBackground);
}
.tree-row.loading::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(
    110deg,
    transparent 0%,
    transparent 34%,
    color-mix(in srgb, var(--vscode-list-highlightForeground, #ffffff) 18%, transparent) 48%,
    transparent 62%,
    transparent 100%
  );
  transform: translateX(-100%);
  animation: tree-row-shimmer 1.15s ease-in-out infinite;
}
@keyframes tree-row-shimmer {
  to {
    transform: translateX(100%);
  }
}
.tree-expander {
  width: 16px;
  height: 16px;
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
  font-size: 16px;
  width: 16px;
  height: 16px;
  text-align: center;
  flex-shrink: 0;
  color: var(--vscode-symbolIcon-classForeground);
}
.tree-row.selected .tree-icon {
  color: var(--vscode-list-activeSelectionForeground);
}
.tree-icon-picture {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.tree-icon-img {
  width: 16px;
  height: 16px;
  display: block;
  object-fit: contain;
}
.tree-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 24px;
}
.tree-row.git-added .tree-label {
  color: var(--vscode-gitDecoration-addedResourceForeground, var(--vscode-foreground));
}
.tree-row.git-modified .tree-label {
  color: var(--vscode-gitDecoration-modifiedResourceForeground, var(--vscode-foreground));
}
.tree-row.git-deleted .tree-label {
  color: var(--vscode-gitDecoration-deletedResourceForeground, var(--vscode-foreground));
  text-decoration: line-through;
}
.inline-actions {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-left: 4px;
  opacity: 0;
  pointer-events: none;
  transform: translateX(3px);
  transition: opacity 120ms ease-out, transform 120ms ease-out;
}
.tree-row:hover .inline-actions,
.tree-row:focus-within .inline-actions {
  opacity: 1;
  pointer-events: auto;
  transform: translateX(0);
}
button.inline-action {
  width: 22px;
  height: 22px;
  flex: 0 0 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 5px;
  color: var(--vscode-icon-foreground);
  background: transparent;
  cursor: pointer;
}
button.inline-action:hover {
  background: var(--vscode-toolbar-hoverBackground);
}
.state-icons {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-left: 6px;
}
.state-icon,
.state-icon-picture {
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--vscode-icon-foreground);
}
.state-icon-img {
  width: 16px;
  height: 16px;
  display: block;
  object-fit: contain;
}
.git-badge {
  min-width: 15px;
  height: 15px;
  padding: 0 3px;
  box-sizing: border-box;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
  line-height: 15px;
}
.git-badge.added {
  color: var(--vscode-gitDecoration-addedResourceForeground, var(--vscode-foreground));
  background: color-mix(in srgb, var(--vscode-gitDecoration-addedResourceForeground, #2ea043) 18%, transparent);
}
.git-badge.modified {
  color: var(--vscode-gitDecoration-modifiedResourceForeground, var(--vscode-foreground));
  background: color-mix(in srgb, var(--vscode-gitDecoration-modifiedResourceForeground, #d29922) 18%, transparent);
}
.git-badge.deleted {
  color: var(--vscode-gitDecoration-deletedResourceForeground, var(--vscode-foreground));
  background: color-mix(in srgb, var(--vscode-gitDecoration-deletedResourceForeground, #f85149) 18%, transparent);
}
</style>
