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
    <vscode-single-select
      :id="'prop-' + control.id"
      :value="localValue"
      :disabled="readonly"
      @change="(e: Event) => { localValue = (e.target as HTMLSelectElement).value; onChange(); }"
    >
      <vscode-option
        v-for="opt in control.enumOptions"
        :key="opt.value"
        :value="opt.value"
      >
        {{ opt.label }}
      </vscode-option>
    </vscode-single-select>
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

vscode-single-select {
  flex: 1;
  max-width: 200px;
}
</style>
