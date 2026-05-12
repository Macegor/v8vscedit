<template>
  <p class="vscode-kit-form-error" role="alert">{{ text }}</p>
</template>

<script setup lang="ts">
/** Сообщение об ошибке поля формы. */
defineProps<{
  text: string;
}>();
</script>

<style scoped>
.vscode-kit-form-error {
  margin: 0;
  font-size: var(--vscode-kit-font-size-small);
  line-height: var(--vscode-kit-line-height);
  color: var(--vscode-kit-errorForeground);
}
</style>
