<template>
  <div class="vscode-kit-path-picker">
    <VInput
      :model-value="modelValue"
      :placeholder="placeholder"
      @update:model-value="emit('update:modelValue', $event)"
      class="vscode-kit-path-picker__input"
    />
    <VButton
      variant="secondary"
      size="sm"
      @click="emit('browse')"
    >
      Обзор...
    </VButton>
  </div>
</template>

<script setup lang="ts">
import VInput from '../primitives/VInput.vue';
import VButton from '../primitives/VButton.vue';

/**
 * Поле выбора пути файловой системы.
 * Содержит текстовое поле и кнопку "Обзор".
 */
withDefaults(defineProps<{
  modelValue?: string;
  label?: string;
  placeholder?: string;
  filters?: Record<string, string[]>;
}>(), {
  modelValue: '',
  placeholder: '',
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
  'browse': [];
}>();
</script>

<style scoped>
.vscode-kit-path-picker {
  display: flex;
  gap: var(--vscode-kit-spacing-2);
  align-items: flex-start;
}
.vscode-kit-path-picker__input {
  flex: 1;
  min-width: 0;
}
</style>
