<script setup lang="ts">
import type { SubsystemMembershipSnapshot, SubsystemMembershipTreeNode } from '@ui-shared/types/property';

const props = defineProps<{
  snapshot: SubsystemMembershipSnapshot;
  readonly: boolean;
}>();

const emit = defineEmits<{
  add: [];
  remove: [xmlPath: string];
}>();

function flatten(nodes: readonly SubsystemMembershipTreeNode[]): SubsystemMembershipTreeNode[] {
  const result: SubsystemMembershipTreeNode[] = [];
  for (const node of nodes) {
    result.push(node, ...flatten(node.children));
  }
  return result;
}

function selectedNodes(): SubsystemMembershipTreeNode[] {
  return flatten(props.snapshot.tree).filter((node) => node.checked);
}
</script>

<template>
  <div class="subsystem-membership">
    <div class="header-actions">
      <button
        class="icon-action"
        type="button"
        title="Добавить подсистему"
        :disabled="readonly || snapshot.tree.length === 0"
        @click="emit('add')"
      >
        +
      </button>
    </div>
    <p v-if="readonly" class="hint">Редактирование запрещено текущим состоянием поддержки или хранилища.</p>
    <div v-if="snapshot.tree.length === 0" class="empty">В конфигурации нет подсистем.</div>
    <div v-else-if="selectedNodes().length === 0" class="empty">Объект не входит ни в одну подсистему.</div>
    <ul v-else class="membership-list">
      <li v-for="node in selectedNodes()" :key="node.xmlPath" class="membership-row" :title="node.name">
        <span class="membership-label">{{ node.label }}</span>
        <button
          class="icon-action remove-action"
          type="button"
          title="Убрать из подсистемы"
          :disabled="readonly"
          @click="emit('remove', node.xmlPath)"
        >
          ×
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.subsystem-membership {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.header-actions {
  display: flex;
  justify-content: flex-end;
}

.hint,
.empty {
  margin: 0;
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
  line-height: 1.4;
}

.membership-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.membership-row {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 22px;
}

.membership-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.icon-action {
  width: 20px;
  height: 20px;
  min-width: 20px;
  padding: 0;
  display: inline-grid;
  place-items: center;
  border: 1px solid transparent;
  border-radius: 4px;
  color: var(--vscode-icon-foreground, var(--vscode-foreground));
  background: transparent;
  font: inherit;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}

.icon-action:hover:not(:disabled) {
  background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground));
}

.icon-action:disabled {
  opacity: 0.45;
  cursor: default;
}
</style>
