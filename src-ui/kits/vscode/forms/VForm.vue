<template>
  <form class="vscode-kit-form" novalidate @submit.prevent>
    <slot />
  </form>
</template>

<script setup lang="ts">
/** Контейнер формы. Предотвращает нативную отправку. */
</script>

<style scoped>
.vscode-kit-form {
  display: flex;
  flex-direction: column;
  gap: var(--vscode-kit-spacing-6);
  font-family: var(--vscode-kit-font-family);
  font-size: var(--vscode-kit-font-size);
  line-height: var(--vscode-kit-line-height);
  color: var(--vscode-kit-foreground);
}
</style>
