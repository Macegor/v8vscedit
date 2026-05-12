<template>
  <textarea
    class="vscode-kit-textarea"
    :value="modelValue"
    :placeholder="placeholder"
    :disabled="disabled"
    :rows="rows"
    :aria-disabled="disabled"
    @input="onInput"
  />
</template>

<script setup lang="ts">
/**
 * Многострочное текстовое поле в стиле VS Code.
 */
withDefaults(defineProps<{
  modelValue: string;
  placeholder?: string;
  disabled?: boolean;
  rows?: number;
}>(), {
  modelValue: '',
  placeholder: '',
  disabled: false,
  rows: 3,
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

function onInput(event: Event): void {
  const target = event.target as HTMLTextAreaElement;
  emit('update:modelValue', target.value);
}
</script>

<style scoped>
.vscode-kit-textarea {
  width: 100%;
  padding: 3px 7px;
  box-sizing: border-box;
  color: var(--vscode-kit-inputForeground);
  background: var(--vscode-kit-inputBackground);
  border: 1px solid var(--vscode-kit-inputBorder, transparent);
  border-radius: var(--vscode-kit-border-radius);
  font-family: var(--vscode-kit-font-family);
  font-size: var(--vscode-kit-font-size);
  line-height: var(--vscode-kit-line-height);
  outline: none;
  resize: vertical;
}
.vscode-kit-textarea::placeholder {
  color: var(--vscode-kit-inputPlaceholderForeground);
}
.vscode-kit-textarea:focus {
  border-color: var(--vscode-kit-focusBorder);
  outline: 1px solid var(--vscode-kit-focusBorder);
  outline-offset: -1px;
}
.vscode-kit-textarea:disabled {
  cursor: default;
  opacity: 0.65;
}
</style>
