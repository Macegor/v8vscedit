<script setup lang="ts">
import { computed, ref } from 'vue';
import type { PropertyControl } from '@ui-shared/types/property';

const props = defineProps<{
  controls: readonly PropertyControl[];
  readonly: boolean;
}>();

const emit = defineEmits<{
  pick: [key: string];
  clear: [key: string];
}>();

const activeTab = ref<'main' | 'aux'>('main');
const mainControls = computed(() => props.controls.filter((control) => control.id.startsWith('Default')));
const auxiliaryControls = computed(() => {
  const auxiliary = props.controls.filter((control) => control.id.startsWith('Auxiliary'));
  const rest = props.controls.filter((control) => !control.id.startsWith('Default') && !control.id.startsWith('Auxiliary'));
  return [...auxiliary, ...rest];
});

function formName(value: unknown): string {
  const raw = typeof value === 'string' ? value : '';
  const marker = '.Form.';
  const index = raw.lastIndexOf(marker);
  return index >= 0 ? raw.slice(index + marker.length) : raw;
}
</script>

<template>
  <div class="forms-section">
    <div class="tabbar" role="tablist" aria-label="Формы">
      <button
        class="tab-button"
        :class="{ active: activeTab === 'main' }"
        type="button"
        role="tab"
        :aria-selected="activeTab === 'main'"
        @click="activeTab = 'main'"
      >
        Основные
      </button>
      <button
        class="tab-button"
        :class="{ active: activeTab === 'aux' }"
        type="button"
        role="tab"
        :aria-selected="activeTab === 'aux'"
        @click="activeTab = 'aux'"
      >
        Дополнительные
      </button>
    </div>

    <div class="form">
      <template v-for="control in (activeTab === 'main' ? mainControls : auxiliaryControls)" :key="control.id">
        <div class="control-row">
          <label class="control-label" :title="control.id">{{ control.label }}</label>
          <div class="form-picker">
            <input
              class="form-input"
              type="text"
              :value="formName(control.value)"
              placeholder="Используется стандартная форма"
              readonly
            />
            <div class="form-actions">
              <button
                class="icon-action"
                type="button"
                title="Выбрать форму"
                :disabled="readonly || control.readonly"
                @click="emit('pick', control.id)"
              >
                ...
              </button>
              <button
                v-if="formName(control.value)"
                class="icon-action"
                type="button"
                title="Очистить форму"
                :disabled="readonly || control.readonly"
                @click="emit('clear', control.id)"
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
      <div v-if="(activeTab === 'main' ? mainControls : auxiliaryControls).length === 0" class="empty">
        {{ activeTab === 'main' ? 'Нет основных форм.' : 'Нет дополнительных форм.' }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.forms-section,
.form {
  display: grid;
  gap: 12px;
}

.tabbar {
  display: inline-flex;
  width: fit-content;
  gap: 4px;
  padding: 2px;
  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border, transparent));
  border-radius: 6px;
  background: var(--vscode-input-background);
}

.tab-button {
  min-height: 28px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 4px;
  color: var(--vscode-descriptionForeground);
  background: transparent;
  font: inherit;
  cursor: pointer;
}

.tab-button.active {
  color: var(--vscode-foreground);
  border-color: var(--vscode-input-border, var(--vscode-panel-border, transparent));
  background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground));
}

.control-row {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.control-label {
  font-size: 13px;
  font-weight: 600;
}

.form-picker {
  position: relative;
  min-width: 0;
}

.form-input {
  width: 100%;
  min-height: 34px;
  box-sizing: border-box;
  padding: 7px 74px 7px 10px;
  border: 1px solid var(--vscode-input-border, transparent);
  border-radius: 6px;
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  font: inherit;
  overflow: hidden;
  text-overflow: ellipsis;
}

.form-input::placeholder {
  color: var(--vscode-input-placeholderForeground);
}

.form-actions {
  position: absolute;
  top: 50%;
  right: 6px;
  display: inline-flex;
  gap: 4px;
  transform: translateY(-50%);
}

.icon-action {
  width: 26px;
  height: 24px;
  min-width: 26px;
  padding: 0;
  display: inline-grid;
  place-items: center;
  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border, transparent));
  border-radius: 5px;
  color: var(--vscode-icon-foreground, var(--vscode-foreground));
  background: var(--vscode-toolbar-hoverBackground, var(--vscode-input-background));
  font: inherit;
  font-size: 14px;
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

@media (max-width: 760px) {
  .tabbar {
    display: flex;
    width: auto;
  }

  .tab-button {
    flex: 1;
  }

}
</style>
