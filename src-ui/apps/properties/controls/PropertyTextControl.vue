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

function onInput(): void {
  emit('change', localValue.value);
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
      type="text"
      v-model="localValue"
      :disabled="readonly"
      :title="control.description"
      @change="onInput"
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
  flex: 1;
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border, transparent);
  border-radius: 2px;
  padding: 2px 6px;
  font-family: inherit;
  font-size: 12px;
}

.control-input:focus {
  outline: 1px solid var(--vscode-focusBorder);
}

.control-input:disabled {
  opacity: 0.5;
  background: transparent;
}
</style>
