<template>
  <div class="vscode-kit-toolbar" role="toolbar">
    <slot />
  </div>
</template>

<script setup lang="ts">
/**
 * Панель инструментов. Горизонтальный ряд кнопок.
 */
</script>

<style scoped>
.vscode-kit-toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px 4px;
  background: var(--vscode-kit-editorBackground);
  border-bottom: 1px solid var(--vscode-kit-panelBorder);
}
</style>
