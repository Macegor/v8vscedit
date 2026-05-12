<template>
  <div class="vscode-kit-footer-bar" role="status">
    <slot />
  </div>
</template>

<script setup lang="ts">
/** Нижняя панель (статус-бар). */
</script>

<style scoped>
.vscode-kit-footer-bar {
  display: flex;
  align-items: center;
  gap: var(--vscode-kit-spacing-2);
  padding: 0 10px;
  min-height: 22px;
  background: var(--vscode-kit-panelBackground);
  color: var(--vscode-kit-descriptionForeground);
  font-family: var(--vscode-kit-font-family);
  font-size: var(--vscode-kit-font-size-small);
  line-height: var(--vscode-kit-line-height);
  user-select: none;
  border-top: 1px solid var(--vscode-kit-panelBorder);
}
</style>
