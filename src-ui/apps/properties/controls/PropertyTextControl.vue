<script setup lang="ts">
import { ref, watch } from 'vue';
import type { PropertyControl } from '@ui-shared/types/property';

const props = defineProps<{
  control: PropertyControl;
  readonly: boolean;
}>();

const emit = defineEmits<{
  change: [value: string];
  invalidName: [];
}>();

const localValue = ref(String(props.control.value ?? ''));
const lastSubmittedValue = ref(localValue.value);

watch(() => props.control.value, (newVal) => {
  localValue.value = String(newVal ?? '');
  lastSubmittedValue.value = localValue.value;
});

const namePattern = /^[\p{L}][\p{L}\p{Nd}_]*$/u;

function isMultiline(): boolean {
  return props.control.id === 'Explanation' ||
    props.control.id === 'ExtendedExplanation' ||
    localValue.value.includes('\n');
}

function submit(): void {
  if (props.readonly || props.control.readonly) {
    return;
  }
  if (props.control.id === 'Name' && !namePattern.test(localValue.value)) {
    localValue.value = lastSubmittedValue.value;
    emit('invalidName');
    return;
  }
  if (localValue.value === lastSubmittedValue.value) {
    return;
  }
  lastSubmittedValue.value = localValue.value;
  emit('change', localValue.value);
}

function onKeydown(event: KeyboardEvent): void {
  if (isMultiline() || event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) {
    return;
  }
  event.preventDefault();
  submit();
  (event.target as HTMLElement).blur();
}
</script>

<template>
  <div class="control-row">
    <label class="control-label" :for="'prop-' + control.id">
      {{ control.label }}
    </label>
    <vscode-textarea
      v-if="isMultiline()"
      :id="'prop-' + control.id"
      :value="localValue"
      :disabled="readonly || control.readonly"
      resize="vertical"
      @input="(e: Event) => { localValue = (e.target as HTMLInputElement).value; }"
      @blur="submit"
    />
    <vscode-textfield
      v-else
      :id="'prop-' + control.id"
      :value="localValue"
      :disabled="readonly || control.readonly"
      @input="(e: Event) => { localValue = (e.target as HTMLInputElement).value; }"
      @blur="submit"
      @keydown="onKeydown"
    />
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

vscode-textfield,
vscode-textarea {
  width: 100%;
}

.property-note {
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
  line-height: 1.4;
}
</style>
