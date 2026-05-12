<script setup lang="ts">
import { ref, watch } from 'vue';
import type { PropertyControlDto } from '@ui-shared/types/property';

const props = defineProps<{
  control: PropertyControlDto;
  readonly: boolean;
}>();

const emit = defineEmits<{
  change: [value: string];
}>();

const localValue = ref(String(props.control.value ?? ''));

watch(() => props.control.value, (newVal) => {
  localValue.value = String(newVal ?? '');
});

function onChange(): void {
  emit('change', localValue.value);
}
</script>

<template>
  <div class="control-row">
    <label class="control-label" :for="'prop-' + control.id">
      {{ control.label }}
    </label>
    <select
      :id="'prop-' + control.id"
      class="control-select"
      v-model="localValue"
      :disabled="readonly"
      @change="onChange"
    >
      <option
        v-for="opt in control.enumOptions"
        :key="opt.value"
        :value="opt.value"
      >
        {{ opt.label }}
      </option>
    </select>
  </div>
</template>

<style scoped>
.control-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 12px;
  min-height: 24px;
}

.control-label {
  font-size: 12px;
  color: var(--vscode-foreground);
  min-width: 120px;
  flex-shrink: 0;
}

.control-select {
  flex: 1;
  background: var(--vscode-dropdown-background);
  color: var(--vscode-dropdown-foreground);
  border: 1px solid var(--vscode-dropdown-border, transparent);
  border-radius: 2px;
  padding: 2px 6px;
  font-family: inherit;
  font-size: 12px;
  max-width: 200px;
}

.control-select:focus {
  outline: 1px solid var(--vscode-focusBorder);
}

.control-select:disabled {
  opacity: 0.5;
}
</style>
