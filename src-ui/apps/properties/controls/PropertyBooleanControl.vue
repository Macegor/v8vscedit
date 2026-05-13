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
    <vscode-checkbox
      :id="'prop-' + control.id"
      :checked="!!control.value"
      :disabled="readonly"
      @change="toggle"
    >
      {{ control.label }}
    </vscode-checkbox>
  </div>
</template>

<style scoped>
.control-row {
  padding: 2px 12px;
}
</style>
