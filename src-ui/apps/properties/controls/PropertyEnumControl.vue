<script setup lang="ts">
import { ref, watch } from 'vue';
import type { PropertyControl } from '@ui-shared/types/property';

const props = defineProps<{
  control: PropertyControl;
  readonly: boolean;
}>();

const emit = defineEmits<{
  change: [value: string | string[]];
}>();

const localValue = ref(String(props.control.value ?? ''));
const selectedValues = ref<string[]>(Array.isArray(props.control.selected) ? [...props.control.selected] : []);

watch(() => props.control.value, (newVal) => {
  localValue.value = String(newVal ?? '');
});

watch(() => props.control.selected, (newVal) => {
  selectedValues.value = Array.isArray(newVal) ? [...newVal] : [];
});

function onChange(): void {
  emit('change', localValue.value);
}

function onMultiChange(event: Event): void {
  const select = event.target as HTMLSelectElement;
  selectedValues.value = Array.from(select.selectedOptions).map((option) => option.value);
  emit('change', selectedValues.value);
}
</script>

<template>
  <div class="control-row">
    <label class="control-label" :for="'prop-' + control.id">
      {{ control.label }}
    </label>
    <select
      v-if="control.kind === 'multiEnum'"
      :id="'prop-' + control.id"
      class="multi-select"
      multiple
      :size="Math.min(Math.max(control.options?.length ?? 2, 2), 8)"
      :value="selectedValues"
      :disabled="readonly || control.readonly"
      @change="onMultiChange"
    >
      <option
        v-for="opt in control.options"
        :key="opt.value"
        :value="opt.value"
      >
        {{ opt.label }}
      </option>
    </select>
    <vscode-single-select
      v-else
      :id="'prop-' + control.id"
      :value="localValue"
      :disabled="readonly || control.readonly"
      @change="(e: Event) => { localValue = (e.target as HTMLSelectElement).value; onChange(); }"
    >
      <vscode-option
        v-for="opt in control.options"
        :key="opt.value"
        :value="opt.value"
      >
        {{ opt.label }}
      </vscode-option>
    </vscode-single-select>
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

.control-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--vscode-foreground);
}

vscode-single-select {
  width: 100%;
}

.multi-select {
  width: 100%;
  box-sizing: border-box;
  min-height: 34px;
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border, transparent);
  border-radius: 6px;
  padding: 7px 10px;
  font: inherit;
}

.property-note {
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
  line-height: 1.4;
}
</style>
