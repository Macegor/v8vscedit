<template>
  <div class="vscode-kit-form-row" :class="{ 'vscode-kit-form-row--has-error': !!errorText }">
    <div class="vscode-kit-form-row__header">
      <slot name="label">
        <VFormLabel :for="forAttr">{{ label }}</VFormLabel>
      </slot>
    </div>
    <div class="vscode-kit-form-row__control">
      <slot />
    </div>
    <div class="vscode-kit-form-row__footer">
      <slot name="hint">
        <VFormHint v-if="hintText" :text="hintText" />
      </slot>
      <slot name="error">
        <VFormError v-if="errorText" :text="errorText" />
      </slot>
    </div>
  </div>
</template>

<script setup lang="ts">
import VFormLabel from './VFormLabel.vue';
import VFormHint from './VFormHint.vue';
import VFormError from './VFormError.vue';

/**
 * Строка формы. Содержит метку, контрол, подсказку и ошибку.
 * Слоты: `label`, `default` (контрол), `hint`, `error`.
 */
withDefaults(defineProps<{
  label?: string;
  forAttr?: string;
  hintText?: string;
  errorText?: string;
}>(), {
  label: '',
  forAttr: '',
  hintText: '',
  errorText: '',
});
</script>

<style scoped>
.vscode-kit-form-row {
  display: flex;
  flex-direction: column;
  gap: var(--vscode-kit-spacing-2);
}
.vscode-kit-form-row__header {
  display: flex;
  align-items: center;
}
.vscode-kit-form-row__control {
  display: flex;
  flex-direction: column;
}
.vscode-kit-form-row__footer {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
</style>
