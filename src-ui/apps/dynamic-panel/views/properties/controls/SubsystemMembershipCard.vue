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
  <section class="property-section">
    <h3 class="section-title">Подсистемы</h3>
    <button
      class="icon-action section-action"
      type="button"
      title="Добавить подсистему"
      :disabled="readonly || snapshot.tree.length === 0"
      @click="emit('add')"
    >
      +
    </button>
    <p v-if="readonly" class="subtitle">Редактирование запрещено текущим состоянием поддержки или хранилища.</p>
    <div v-if="snapshot.tree.length === 0" class="empty">В конфигурации нет подсистем.</div>
    <div v-else-if="selectedNodes().length === 0" class="empty">Объект не входит ни в одну подсистему.</div>
    <div v-else class="reference-list">
      <div v-for="node in selectedNodes()" :key="node.xmlPath" class="reference-row">
        <div class="reference-value" :title="node.name">{{ node.label }}</div>
        <button
          class="icon-action remove-action"
          type="button"
          title="Убрать из подсистемы"
          :disabled="readonly"
          @click="emit('remove', node.xmlPath)"
        >
          ×
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.property-section {
  position: relative;
  display: grid;
  gap: 12px;
  min-width: 0;
  box-sizing: border-box;
  margin: 10px 0 0;
  padding: 22px 16px 16px;
  border: 1px solid var(--vscode-panel-border, var(--vscode-input-border, transparent));
  border-radius: 8px;
  background: var(--vscode-sideBar-background);
}

.section-title {
  position: absolute;
  top: -12px;
  left: 14px;
  margin: 0;
  padding: 0 8px;
  background: linear-gradient(
    to bottom,
    transparent calc(50% - 1px),
    var(--vscode-sideBar-background) calc(50% - 1px),
    var(--vscode-sideBar-background) calc(50% + 1px),
    transparent calc(50% + 1px)
  );
  font-size: 17px;
  line-height: 1.25;
  font-weight: 700;
}

.section-action {
  position: absolute;
  top: -11px;
  right: 18px;
  box-shadow: 0 0 0 4px var(--vscode-sideBar-background);
}

.subtitle,
.empty {
  color: var(--vscode-descriptionForeground);
}

.subtitle {
  margin: 0;
  line-height: 1.45;
}

.reference-list {
  display: grid;
  gap: 6px;
}

.reference-row {
  position: relative;
  min-width: 0;
}

.reference-value {
  min-height: 34px;
  box-sizing: border-box;
  padding: 7px 38px 7px 10px;
  border: 1px solid var(--vscode-input-border, transparent);
  border-radius: 6px;
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.icon-action {
  width: 24px;
  height: 24px;
  min-width: 24px;
  padding: 0;
  display: inline-grid;
  place-items: center;
  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border, transparent));
  border-radius: 5px;
  color: var(--vscode-icon-foreground, var(--vscode-foreground));
  background: var(--vscode-toolbar-hoverBackground, var(--vscode-input-background));
  font: inherit;
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
}

.icon-action:hover:not(:disabled) {
  background: var(--vscode-list-hoverBackground);
}

.icon-action:disabled {
  opacity: 0.45;
  cursor: default;
}

.remove-action {
  position: absolute;
  top: 50%;
  right: 6px;
  transform: translateY(-50%);
}

.empty {
  padding: 12px;
  border: 1px dashed var(--vscode-panel-border, var(--vscode-input-border, transparent));
  border-radius: 6px;
}
</style>
