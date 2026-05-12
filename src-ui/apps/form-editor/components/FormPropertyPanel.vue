<script setup lang="ts">
import { computed, inject } from 'vue';
import { MessageBus } from '@ui-shared/api/messageBus';
import type { FormElementDto } from '../main';

const props = defineProps<{
  element: FormElementDto;
  selectedId?: number;
}>();

const messageBus = inject<MessageBus>('messageBus')!;

const selectedElement = computed(() => {
  if (!props.selectedId) return null;
  return findElement(props.element, props.selectedId);
});

function findElement(el: FormElementDto, id: number): FormElementDto | null {
  if (el.id === id) return el;
  for (const child of el.children || []) {
    const found = findElement(child, id);
    if (found) return found;
  }
  return null;
}

const properties = computed(() => {
  const el = selectedElement.value;
  if (!el) return [];
  return [
    { label: 'Имя', value: el.name },
    { label: 'Тип', value: el.type },
    { label: 'Заголовок', value: el.title ?? '' },
    { label: 'Показывать заголовок', value: String(el.showTitle ?? true) },
    { label: 'Путь к данным', value: el.dataPath ?? '' },
    { label: 'Растягивать по горизонтали', value: String(el.horizontalStretch ?? false) },
    { label: 'Растягивать по вертикали', value: String(el.verticalStretch ?? false) },
    { label: 'Ширина', value: String(el.width ?? 'auto') },
    { label: 'Высота', value: String(el.height ?? 'auto') },
    { label: 'Только чтение', value: String(el.readOnly ?? false) },
    { label: 'Видимость', value: String(el.visible ?? true) },
    ...(el.group ? [{ label: 'Группировка', value: el.group }] : []),
  ];
});
</script>

<template>
  <div class="property-panel">
    <div class="panel-header">Свойства</div>
    <div v-if="selectedElement" class="properties-list">
      <div v-for="prop in properties" :key="prop.label" class="property-row">
        <span class="property-label">{{ prop.label }}</span>
        <span class="property-value">{{ prop.value || '—' }}</span>
      </div>
    </div>
    <div v-else class="panel-empty">
      Выберите элемент для просмотра свойств
    </div>
  </div>
</template>

<style scoped>
.property-panel {
  display: flex;
  flex-direction: column;
}

.panel-header {
  padding: 6px 12px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--vscode-descriptionForeground);
  border-bottom: 1px solid var(--vscode-panel-border);
  background: var(--vscode-sidebar-background);
}

.properties-list {
  padding: 4px 0;
}

.property-row {
  display: flex;
  gap: 8px;
  padding: 3px 12px;
  font-size: 12px;
}

.property-label {
  color: var(--vscode-descriptionForeground);
  min-width: 100px;
  flex-shrink: 0;
}

.property-value {
  color: var(--vscode-foreground);
  word-break: break-all;
}

.panel-empty {
  padding: 24px;
  text-align: center;
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
}
</style>
