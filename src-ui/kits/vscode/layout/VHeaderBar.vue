<template>
  <div class="vscode-kit-header-bar" role="banner">
    <slot />
  </div>
</template>

<script setup lang="ts">
/** Верхняя панель (хедер). */
</script>

<style scoped>
.vscode-kit-header-bar {
  display: flex;
  align-items: center;
  gap: var(--vscode-kit-spacing-4);
  padding: var(--vscode-kit-spacing-2) var(--vscode-kit-spacing-5);
  min-height: 36px;
  background: var(--vscode-kit-panelBackground);
  border-bottom: 1px solid var(--vscode-kit-panelBorder);
  color: var(--vscode-kit-foreground);
  font-family: var(--vscode-kit-font-family);
  font-size: var(--vscode-kit-font-size);
  line-height: var(--vscode-kit-line-height);
  user-select: none;
}
</style>
