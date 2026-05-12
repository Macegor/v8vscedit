<template>
  <label class="vscode-kit-form-label" :for="forAttr">
    <slot />
    <span v-if="required" class="vscode-kit-form-label__required" aria-hidden="true">*</span>
  </label>
</template>

<script setup lang="ts">
/** Метка поля формы. */
withDefaults(defineProps<{
  forAttr?: string;
  required?: boolean;
}>(), {
  required: false,
});
</script>

<style scoped>
.vscode-kit-form-label {
  display: flex;
  align-items: center;
  gap: 2px;
  font-family: var(--vscode-kit-font-family);
  font-size: var(--vscode-kit-font-size);
  line-height: var(--vscode-kit-line-height);
  color: var(--vscode-kit-foreground);
  user-select: none;
}
.vscode-kit-form-label__required {
  color: var(--vscode-kit-errorForeground);
  font-weight: var(--vscode-kit-font-weight-bold);
}
</style>
