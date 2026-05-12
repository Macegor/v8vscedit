<template>
  <p class="vscode-kit-form-hint">{{ text }}</p>
</template>

<script setup lang="ts">
/** Подсказка под полем формы. */
defineProps<{
  text: string;
}>();
</script>

<style scoped>
.vscode-kit-form-hint {
  margin: 0;
  font-size: var(--vscode-kit-font-size-small);
  line-height: var(--vscode-kit-line-height);
  color: var(--vscode-kit-descriptionForeground);
}
</style>
