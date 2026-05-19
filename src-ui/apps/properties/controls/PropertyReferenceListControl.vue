<script setup lang="ts">
import type { MetadataReferenceListItem, PropertyControl } from '@ui-shared/types/property';

const props = defineProps<{
  control: PropertyControl;
  readonly: boolean;
}>();

const emit = defineEmits<{
  add: [key: string];
  remove: [payload: { key: string; value: string }];
}>();

function items(): readonly MetadataReferenceListItem[] {
  return props.control.referenceItems ?? [];
}
</script>

<template>
  <div class="control-row">
    <div class="label-row">
      <label class="control-label" :title="control.id">{{ control.label }}</label>
      <button
        class="icon-action add-action"
        type="button"
        title="Добавить"
        :disabled="readonly || control.readonly"
        @click="emit('add', control.id)"
      >
        +
      </button>
    </div>
    <div v-if="items().length === 0" class="empty">Список пуст.</div>
    <div v-else class="reference-list">
      <div v-for="item in items()" :key="item.canonical" class="reference-row">
        <div class="reference-value" :title="item.canonical">{{ item.display }}</div>
        <button
          class="icon-action remove-action"
          type="button"
          title="Удалить из списка"
          :disabled="readonly || control.readonly"
          @click="emit('remove', { key: control.id, value: item.canonical })"
        >
          ×
        </button>
      </div>
    </div>
    <div v-if="control.inherited" class="property-note">
      Значение из основной конфигурации. Переопределение через панель свойств пока недоступно.
    </div>
    <div v-else-if="control.readonly" class="property-note">Служебное свойство доступно только для чтения.</div>
  </div>
</template>

<style scoped>
.control-row {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}

.control-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 600;
  color: var(--vscode-foreground);
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

.add-action {
  transform: translateY(1px);
}

.remove-action {
  position: absolute;
  top: 50%;
  right: 6px;
  transform: translateY(-50%);
}

.empty {
  padding: 12px;
  color: var(--vscode-descriptionForeground);
  border: 1px dashed var(--vscode-panel-border, var(--vscode-input-border, transparent));
  border-radius: 6px;
}

.property-note {
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
  line-height: 1.4;
}
</style>
