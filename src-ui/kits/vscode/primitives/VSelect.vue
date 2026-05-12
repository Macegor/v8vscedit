<template>
  <select
    class="vscode-kit-select"
    :value="modelValue"
    :disabled="disabled"
    :aria-disabled="disabled"
    @change="onChange"
  >
    <option
      v-if="placeholder"
      value=""
      disabled
      hidden
    >
      {{ placeholder }}
    </option>
    <option
      v-for="opt in options"
      :key="String(opt.value)"
      :value="opt.value"
    >
      {{ opt.label }}
    </option>
  </select>
</template>

<script setup lang="ts">
/** Выпадающий список в стиле VS Code. */
withDefaults(defineProps<{
  modelValue: string;
  options: { readonly value: string; readonly label: string }[];
  disabled?: boolean;
  placeholder?: string;
}>(), {
  modelValue: '',
  disabled: false,
  placeholder: '',
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

function onChange(event: Event): void {
  const target = event.target as HTMLSelectElement;
  emit('update:modelValue', target.value);
}
</script>

<style scoped>
.vscode-kit-select {
  width: 100%;
  min-height: 28px;
  padding: 3px 6px;
  box-sizing: border-box;
  color: var(--vscode-kit-dropdownForeground);
  background: var(--vscode-kit-dropdownBackground);
  border: 1px solid var(--vscode-kit-dropdownBorder, transparent);
  border-radius: var(--vscode-kit-border-radius);
  font-family: var(--vscode-kit-font-family);
  font-size: var(--vscode-kit-font-size);
  line-height: var(--vscode-kit-line-height);
  outline: none;
  cursor: pointer;
}
.vscode-kit-select:focus {
  border-color: var(--vscode-kit-focusBorder);
  outline: 1px solid var(--vscode-kit-focusBorder);
  outline-offset: -1px;
}
.vscode-kit-select:disabled {
  cursor: default;
  opacity: 0.65;
}
</style>
