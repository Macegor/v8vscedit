<script setup lang="ts">
import type { PropertyControlDto } from '@ui-shared/types/property';

const props = defineProps<{
  control: PropertyControlDto;
  readonly: boolean;
}>();

const emit = defineEmits<{
  change: [value: boolean];
}>();

function toggle(): void {
  if (props.readonly) return;
  emit('change', !props.control.value);
}
</script>

<template>
  <div class="control-row">
    <label class="checkbox-wrapper" :for="'prop-' + control.id">
      <input
        :id="'prop-' + control.id"
        type="checkbox"
        :checked="!!control.value"
        :disabled="readonly"
        @change="toggle"
      />
      <span class="control-label">{{ control.label }}</span>
    </label>
  </div>
</template>

<style scoped>
.control-row {
  padding: 2px 12px;
}

.checkbox-wrapper {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 12px;
}

.checkbox-wrapper input[type="checkbox"] {
  margin: 0;
}

.control-label {
  color: var(--vscode-foreground);
}
</style>
