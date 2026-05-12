<template>
  <label class="vscode-kit-radio" :class="{ 'vscode-kit-radio--disabled': disabled }">
    <input
      type="radio"
      class="vscode-kit-radio__input"
      :checked="modelValue === value"
      :value="value"
      :name="name"
      :disabled="disabled"
      :aria-disabled="disabled"
      @change="onChange"
    />
    <span class="vscode-kit-radio__indicator" aria-hidden="true">
      <span v-if="modelValue === value" class="vscode-kit-radio__dot" />
    </span>
    <span v-if="label" class="vscode-kit-radio__label">{{ label }}</span>
  </label>
</template>

<script setup lang="ts">
/** Радио-кнопка в стиле VS Code. */
withDefaults(defineProps<{
  modelValue: string;
  value: string;
  label?: string;
  name?: string;
  disabled?: boolean;
}>(), {
  modelValue: '',
  value: '',
  disabled: false,
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

function onChange(event: Event): void {
  const target = event.target as HTMLInputElement;
  emit('update:modelValue', target.value);
}
</script>

<style scoped>
.vscode-kit-radio {
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
.vscode-kit-radio--disabled {
  cursor: default;
  opacity: 0.65;
}
.vscode-kit-radio__input {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
}
.vscode-kit-radio__indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  min-width: 18px;
  box-sizing: border-box;
  border: 1px solid var(--vscode-kit-inputBorder, var(--vscode-kit-dropdownBorder, transparent));
  border-radius: 50%;
  background: var(--vscode-kit-inputBackground);
}
.vscode-kit-radio__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--vscode-kit-foreground);
}
.vscode-kit-radio__input:focus-visible + .vscode-kit-radio__indicator {
  outline: 1px solid var(--vscode-kit-focusBorder);
  outline-offset: 1px;
}
.vscode-kit-radio:not(.vscode-kit-radio--disabled) .vscode-kit-radio__input:checked + .vscode-kit-radio__indicator {
  border-color: var(--vscode-kit-focusBorder);
}
</style>
