<template>
  <span class="vscode-kit-tree-actions" @click.stop>
    <slot />
  </span>
</template>

<script setup lang="ts">
/**
 * Контейнер для кнопок действий узла дерева.
 * Появляется при наведении на строку.
 */
</script>

<style scoped>
.vscode-kit-tree-actions {
  display: none;
  align-items: center;
  gap: 1px;
  margin-left: auto;
  padding-right: 2px;
}
.vscode-kit-tree-row:hover .vscode-kit-tree-actions {
  display: inline-flex;
}
</style>
