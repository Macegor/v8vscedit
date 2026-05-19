<script setup lang="ts">
import type { PropertyControl } from '@ui-shared/types/property';

const props = defineProps<{
  control: PropertyControl;
  readonly: boolean;
}>();

const emit = defineEmits<{
  change: [value: boolean];
}>();

function toggle(): void {
  if (props.readonly || props.control.readonly) return;
  emit('change', !props.control.value);
}
</script>

<template>
  <div class="control-row">
    <vscode-checkbox
      :id="'prop-' + control.id"
      :checked="!!control.value"
      :disabled="readonly || control.readonly"
      @change="toggle"
    >
      {{ control.label }}
    </vscode-checkbox>
    <div v-if="control.inherited" class="property-note">
      Значение из основной конфигурации. Переопределение через панель свойств пока недоступно.
    </div>
    <div v-else-if="control.readonly" class="property-note">Служебное свойство доступно только для чтения.</div>
  </div>
</template>

<style scoped>
.control-row {
  display: grid;
  gap: 4px;
}

.property-note {
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
  line-height: 1.4;
}
</style>
