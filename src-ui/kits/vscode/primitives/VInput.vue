<template>
  <div class="vscode-kit-input-wrapper">
    <input
      ref="inputRef"
      :value="modelValue"
      :placeholder="placeholder"
      :disabled="disabled"
      :type="inputType"
      class="vscode-kit-input"
      :class="{ 'vscode-kit-input--search': type === 'search' }"
      :autofocus="autofocus"
      :aria-disabled="disabled"
      @input="onInput"
      @keydown.enter="onEnter"
      @focus="emit('focus')"
      @blur="emit('blur')"
    />
    <span v-if="type === 'search' && modelValue" class="vscode-kit-input__clear" @click="onClear" role="button" tabindex="0" aria-label="Очистить">&times;</span>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

/**
 * Текстовое поле ввода в стиле VS Code.
 * Поддерживает обычный текст и поиск (с крестиком очистки).
 */
const props = withDefaults(defineProps<{
  modelValue: string;
  placeholder?: string;
  disabled?: boolean;
  type?: 'text' | 'search';
  autofocus?: boolean;
}>(), {
  modelValue: '',
  placeholder: '',
  disabled: false,
  type: 'text',
  autofocus: false,
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
  'enter': [];
  'focus': [];
  'blur': [];
}>();

const inputRef = ref<HTMLInputElement | null>(null);

const inputType = 'text';

function onInput(event: Event): void {
  const target = event.target as HTMLInputElement;
  emit('update:modelValue', target.value);
}

function onEnter(): void {
  emit('enter');
}

function onClear(): void {
  emit('update:modelValue', '');
  inputRef.value?.focus();
}
</script>

<style scoped>
.vscode-kit-input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}
.vscode-kit-input {
  width: 100%;
  min-height: 28px;
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
}
.vscode-kit-input::placeholder {
  color: var(--vscode-kit-inputPlaceholderForeground);
}
.vscode-kit-input:focus {
  border-color: var(--vscode-kit-focusBorder);
  outline: 1px solid var(--vscode-kit-focusBorder);
  outline-offset: -1px;
}
.vscode-kit-input:disabled {
  cursor: default;
  opacity: 0.65;
}
.vscode-kit-input--search {
  padding-right: 22px;
}
.vscode-kit-input__clear {
  position: absolute;
  right: 4px;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--vscode-kit-descriptionForeground);
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  border-radius: var(--vscode-kit-border-radius);
}
.vscode-kit-input__clear:hover {
  background: var(--vscode-kit-listHoverBackground);
}
</style>
