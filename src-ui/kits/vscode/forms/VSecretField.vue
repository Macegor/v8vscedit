<template>
  <div class="vscode-kit-secret-field">
    <div class="vscode-kit-form-row__header">
      <VFormLabel v-if="label" :for="inputId">{{ label }}</VFormLabel>
    </div>
    <div class="vscode-kit-secret-field__control">
      <input
        :id="inputId"
        class="vscode-kit-secret-field__input"
        :type="visible ? 'text' : 'password'"
        :value="modelValue"
        :placeholder="placeholder"
        :aria-disabled="disabled"
        autocomplete="off"
        spellcheck="false"
        @input="onInput"
      />
      <VIconButton
        :ariaLabel="visible ? 'Скрыть пароль' : 'Показать пароль'"
        @click="toggleVisible"
        class="vscode-kit-secret-field__toggle"
      >
        <svg v-if="visible" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 3C4 3 1.5 8 1.5 8s2.5 5 6.5 5 6.5-5 6.5-5-2.5-5-6.5-5z" fill="none" stroke="currentColor" stroke-width="1.2"/>
          <circle cx="8" cy="8" r="2" fill="currentColor"/>
        </svg>
        <svg v-else width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 3C4 3 1.5 8 1.5 8s2.5 5 6.5 5 6.5-5 6.5-5-2.5-5-6.5-5z" fill="none" stroke="currentColor" stroke-width="1.2"/>
          <circle cx="8" cy="8" r="2" fill="currentColor"/>
          <line x1="3" y1="3" x2="13" y2="13" stroke="currentColor" stroke-width="1.2"/>
        </svg>
      </VIconButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import VFormLabel from './VFormLabel.vue';
import VIconButton from '../primitives/VIconButton.vue';

/**
 * Поле для ввода пароля/секрета с кнопкой показа/скрытия.
 */
withDefaults(defineProps<{
  modelValue?: string;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
}>(), {
  modelValue: '',
  placeholder: '',
  disabled: false,
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const visible = ref(false);
const inputId = `vscode-kit-secret-${Math.random().toString(36).slice(2, 8)}`;

function onInput(event: Event): void {
  const target = event.target as HTMLInputElement;
  emit('update:modelValue', target.value);
}

function toggleVisible(): void {
  visible.value = !visible.value;
}
</script>

<style scoped>
.vscode-kit-secret-field {
  display: flex;
  flex-direction: column;
  gap: var(--vscode-kit-spacing-2);
}
.vscode-kit-secret-field__control {
  position: relative;
  display: flex;
  align-items: center;
}
.vscode-kit-secret-field__input {
  width: 100%;
  min-height: 28px;
  padding: 3px 32px 3px 7px;
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
.vscode-kit-secret-field__input::placeholder {
  color: var(--vscode-kit-inputPlaceholderForeground);
}
.vscode-kit-secret-field__input:focus {
  border-color: var(--vscode-kit-focusBorder);
  outline: 1px solid var(--vscode-kit-focusBorder);
  outline-offset: -1px;
}
.vscode-kit-secret-field__toggle {
  position: absolute;
  right: 3px;
}
</style>
