<script setup lang="ts">
import { ref, watch } from 'vue';
import type { PropertyControlDto } from '@ui-shared/types/property';

const props = defineProps<{
  control: PropertyControlDto;
  readonly: boolean;
}>();

const emit = defineEmits<{
  change: [value: number];
}>();

const localValue = ref(String(props.control.value ?? '0'));

watch(() => props.control.value, (newVal) => {
  localValue.value = String(newVal ?? '0');
});

function onChange(): void {
  const num = parseFloat(localValue.value);
  emit('change', isNaN(num) ? 0 : num);
}
</script>

<template>
  <div class="control-row">
    <label class="control-label" :for="'prop-' + control.id">
      {{ control.label }}
    </label>
    <input
      :id="'prop-' + control.id"
      class="control-input"
      type="number"
      v-model="localValue"
      :disabled="readonly"
      @change="onChange"
    />
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

.control-input {
  width: 120px;
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border, transparent);
  border-radius: 2px;
  padding: 2px 6px;
  font-family: inherit;
  font-size: 12px;
  text-align: right;
}

.control-input:focus {
  outline: 1px solid var(--vscode-focusBorder);
}

.control-input:disabled {
  opacity: 0.5;
}
</style>
