<template>
  <label class="vscode-kit-checkbox" :class="{ 'vscode-kit-checkbox--disabled': disabled }">
    <input
      type="checkbox"
      class="vscode-kit-checkbox__input"
      :checked="modelValue"
      :disabled="disabled"
      :aria-disabled="disabled"
      @change="onChange"
    />
    <span class="vscode-kit-checkbox__indicator" aria-hidden="true">
      <svg v-if="modelValue" width="16" height="16" viewBox="0 0 16 16">
        <path d="M3 8l3 3 7-7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </span>
    <span v-if="label" class="vscode-kit-checkbox__label">{{ label }}</span>
  </label>
</template>

<script setup lang="ts">
/** Чекбокс в стиле VS Code. */
withDefaults(defineProps<{
  modelValue: boolean;
  label?: string;
  disabled?: boolean;
}>(), {
  modelValue: false,
  disabled: false,
});

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

function onChange(event: Event): void {
  const target = event.target as HTMLInputElement;
  emit('update:modelValue', target.checked);
}
</script>

<style scoped>
.vscode-kit-checkbox {
  display: inline-flex;
  align-items: center;
  gap: var(--vscode-kit-spacing-4);
  cursor: pointer;
  user-select: none;
  line-height: var(--vscode-kit-line-height);
  font-family: var(--vscode-kit-font-family);
  font-size: var(--vscode-kit-font-size);
  color: var(--vscode-kit-foreground);
}
.vscode-kit-checkbox--disabled {
  cursor: default;
  opacity: 0.65;
}
.vscode-kit-checkbox__input {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
}
.vscode-kit-checkbox__indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  min-width: 18px;
  box-sizing: border-box;
  border: 1px solid var(--vscode-kit-inputBorder, var(--vscode-kit-dropdownBorder, transparent));
  border-radius: 3px;
  background: var(--vscode-kit-inputBackground);
  color: var(--vscode-kit-foreground);
}
.vscode-kit-checkbox__input:focus-visible + .vscode-kit-checkbox__indicator {
  outline: 1px solid var(--vscode-kit-focusBorder);
  outline-offset: 1px;
}
.vscode-kit-checkbox:not(.vscode-kit-checkbox--disabled) .vscode-kit-checkbox__input:checked + .vscode-kit-checkbox__indicator {
  background: var(--vscode-kit-focusBorder);
  border-color: var(--vscode-kit-focusBorder);
}
.vscode-kit-checkbox__label {
  color: var(--vscode-kit-foreground);
}
</style>
