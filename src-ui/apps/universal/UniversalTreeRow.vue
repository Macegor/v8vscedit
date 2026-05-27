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

    <span
      v-if="isAssetIcon(node.icon)"
      class="tree-icon-asset"
      :style="{ '--icon-light': `url(${node.icon.lightUri})`, '--icon-dark': `url(${node.icon.darkUri})` }"
      aria-hidden="true"
    />
    <span v-else class="tree-icon" :class="iconClass(node.icon)" aria-hidden="true" />

    <span class="tree-label" :title="node.tooltip ?? node.label">{{ node.label }}</span>
    <span v-if="node.description" class="tree-description" :title="node.description">{{ node.description }}</span>
    <span class="tree-spacer" aria-hidden="true"></span>

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
        <span
          v-if="isAssetIcon(stateIcon.icon)"
          class="state-icon-asset"
          :style="{ '--icon-light': `url(${stateIcon.icon.lightUri})`, '--icon-dark': `url(${stateIcon.icon.darkUri})` }"
          aria-hidden="true"
        />
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
.tree-icon.codicon-symbol-function {
  color: var(--vscode-symbolIcon-functionForeground, #b180d7);
}
.tree-icon.codicon-symbol-method,
.tree-icon.codicon-symbol-constructor {
  color: var(--vscode-symbolIcon-methodForeground, #b180d7);
}
.tree-icon.codicon-symbol-variable {
  color: var(--vscode-symbolIcon-variableForeground, #75beff);
}
.tree-icon.codicon-symbol-namespace,
.tree-icon.codicon-symbol-module {
  color: var(--vscode-symbolIcon-namespaceForeground, var(--vscode-icon-foreground));
}
.tree-icon.codicon-symbol-constant {
  color: var(--vscode-symbolIcon-constantForeground, #75beff);
}
.tree-icon.codicon-symbol-property {
  color: var(--vscode-symbolIcon-propertyForeground, #b180d7);
}
.tree-icon.codicon-symbol-field {
  color: var(--vscode-symbolIcon-fieldForeground, #75beff);
}
.tree-icon.codicon-symbol-class {
  color: var(--vscode-symbolIcon-classForeground, #ee9d28);
}
.tree-icon.codicon-symbol-interface {
  color: var(--vscode-symbolIcon-interfaceForeground, #75beff);
}
.tree-row.selected .tree-icon {
  color: var(--vscode-list-activeSelectionForeground);
}
.tree-icon-asset {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  display: inline-block;
  background-image: var(--icon-light);
  background-size: contain;
  background-repeat: no-repeat;
  background-position: center;
}
body.vscode-dark .tree-icon-asset,
body.vscode-high-contrast:not(.vscode-high-contrast-light) .tree-icon-asset {
  background-image: var(--icon-dark);
}
.tree-label {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 24px;
}
.tree-description {
  flex: 0 1 auto;
  min-width: 0;
  margin-left: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
  line-height: 24px;
}
.tree-spacer {
  flex: 1 1 auto;
  min-width: 0;
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
.state-icon {
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--vscode-icon-foreground);
}
.state-icon-asset {
  width: 16px;
  height: 16px;
  display: inline-block;
  background-image: var(--icon-light);
  background-size: contain;
  background-repeat: no-repeat;
  background-position: center;
}
body.vscode-dark .state-icon-asset,
body.vscode-high-contrast:not(.vscode-high-contrast-light) .state-icon-asset {
  background-image: var(--icon-dark);
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
