<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { MessageBus } from '@ui-shared/api/messageBus';
import type { HostToUiMessage } from '@ui-shared/protocol/hostMessages';
import type { PropertiesViewState, PropertyControlDto } from '@ui-shared/types/property';
import PropertyTextControl from './controls/PropertyTextControl.vue';
import PropertyBooleanControl from './controls/PropertyBooleanControl.vue';
import PropertyEnumControl from './controls/PropertyEnumControl.vue';
import PropertyNumberControl from './controls/PropertyNumberControl.vue';

const props = defineProps<{
  initialState: PropertiesViewState | null;
  messageBus: MessageBus;
}>();

const title = ref(props.initialState?.title ?? '');
const sections = ref(props.initialState?.sections ?? []);
const readonly = ref(props.initialState?.readonly ?? false);
const diagnostics = ref(props.initialState?.diagnostics ?? []);

function handleHostMessage(msg: HostToUiMessage): void {
  if (msg.type === 'state') {
    const state = msg.state as Partial<PropertiesViewState>;
    if (state.title !== undefined) title.value = state.title;
    if (state.sections) sections.value = state.sections;
    if (state.readonly !== undefined) readonly.value = state.readonly;
    if (state.diagnostics) diagnostics.value = state.diagnostics;
  }
}

function onControlChanged(control: PropertyControlDto, value: unknown): void {
  if (readonly.value) return;
  props.messageBus.send({
    type: 'command',
    command: 'propertyChanged',
    payload: { controlId: control.id, value },
  });
}

onMounted(() => {
  props.messageBus.on('state', handleHostMessage);
});

onUnmounted(() => {
  props.messageBus.off('state', handleHostMessage);
});
</script>

<template>
  <div class="properties-panel">
    <!-- Заголовок -->
    <div class="properties-header">
      <h2 class="properties-title">{{ title }}</h2>
      <span v-if="readonly" class="readonly-badge">Только чтение</span>
    </div>

    <!-- Диагностика -->
    <div v-if="diagnostics.length" class="diagnostics-section">
      <div
        v-for="d in diagnostics"
        :key="d.message"
        class="diagnostic-item"
        :class="'diagnostic-' + d.kind"
      >
        <span class="diagnostic-icon" aria-hidden="true">
          {{ d.kind === 'error' ? '!' : d.kind === 'warning' ? '?' : 'i' }}
        </span>
        <span class="diagnostic-message">{{ d.message }}</span>
      </div>
    </div>

    <!-- Секции свойств -->
    <div v-if="sections.length" class="sections-list">
      <div v-for="section in sections" :key="section.id" class="property-section">
        <h3 class="section-title">{{ section.title }}</h3>
        <div class="section-controls">
          <template v-for="control in section.controls" :key="control.id">
            <!-- Текстовое поле -->
            <PropertyTextControl
              v-if="control.kind === 'text'"
              :control="control"
              :readonly="readonly"
              @change="onControlChanged(control, $event)"
            />
            <!-- Boolean/Чекбокс -->
            <PropertyBooleanControl
              v-else-if="control.kind === 'boolean'"
              :control="control"
              :readonly="readonly"
              @change="onControlChanged(control, $event)"
            />
            <!-- Выпадающий список -->
            <PropertyEnumControl
              v-else-if="control.kind === 'enum'"
              :control="control"
              :readonly="readonly"
              @change="onControlChanged(control, $event)"
            />
            <!-- Число -->
            <PropertyNumberControl
              v-else-if="control.kind === 'number'"
              :control="control"
              :readonly="readonly"
              @change="onControlChanged(control, $event)"
            />
            <!-- Остальные типы — заглушка -->
            <div v-else class="control-row">
              <label class="control-label">{{ control.label }}</label>
              <span class="control-unsupported">({{ control.kind }})</span>
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- Пустое состояние -->
    <div v-else class="empty-state">
      <p>Выберите объект метаданных для просмотра свойств</p>
    </div>
  </div>
</template>

<style scoped>
.properties-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size, 13px);
  color: var(--vscode-foreground);
  overflow: hidden;
}

.properties-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--vscode-panel-border);
  background: var(--vscode-sidebar-background);
}

.properties-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.readonly-badge {
  font-size: 11px;
  padding: 2px 6px;
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
  border-radius: 2px;
}

.diagnostics-section {
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.diagnostic-item {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 2px;
  font-size: 12px;
}

.diagnostic-error {
  background: var(--vscode-inputValidation-errorBackground);
  border: 1px solid var(--vscode-inputValidation-errorBorder);
  color: var(--vscode-errorForeground);
}

.diagnostic-warning {
  background: var(--vscode-inputValidation-warningBackground);
  border: 1px solid var(--vscode-inputValidation-warningBorder);
  color: var(--vscode-list-warningForeground);
}

.diagnostic-info {
  color: var(--vscode-descriptionForeground);
}

.diagnostic-icon {
  font-weight: bold;
  font-size: 14px;
  min-width: 16px;
  text-align: center;
}

.sections-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

.property-section {
  margin-bottom: 4px;
}

.section-title {
  margin: 0;
  padding: 4px 12px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--vscode-descriptionForeground);
  letter-spacing: 0.5px;
}

.section-controls {
  display: flex;
  flex-direction: column;
}

.control-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 12px;
  min-height: 24px;
}

.control-label {
  font-size: 12px;
  color: var(--vscode-foreground);
  min-width: 120px;
  flex-shrink: 0;
}

.control-unsupported {
  font-size: 11px;
  color: var(--vscode-disabledForeground);
  font-style: italic;
}

.empty-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
  padding: 24px;
}
</style>
