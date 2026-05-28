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
      class="prop-multi-select"
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
    <div v-else class="select-picker">
      <select
        :id="'prop-' + control.id"
        class="prop-select enum-select"
        :value="localValue"
        :disabled="readonly || control.readonly"
        @change="(e: Event) => { localValue = (e.target as HTMLSelectElement).value; onChange(); }"
      >
        <option
          v-for="opt in control.options"
          :key="opt.value"
          :value="opt.value"
        >
          {{ opt.label }}
        </option>
      </select>
      <span class="select-icon codicon codicon-chevron-down" aria-hidden="true"></span>
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

.control-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--vscode-foreground);
}

.select-picker {
  position: relative;
  min-width: 0;
}

.enum-select {
  padding-right: 36px;
  appearance: none;
}

.select-icon {
  position: absolute;
  top: 50%;
  right: 4px;
  width: 24px;
  height: 24px;
  display: inline-grid;
  place-items: center;
  color: var(--vscode-icon-foreground, var(--vscode-foreground));
  font-size: 14px;
  line-height: 1;
  pointer-events: none;
  transform: translateY(-50%);
}

.enum-select:disabled + .select-icon {
  opacity: 0.45;
}

.property-note {
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
  line-height: 1.4;
}
</style>
