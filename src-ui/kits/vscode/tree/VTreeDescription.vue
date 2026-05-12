<template>
  <span class="vscode-kit-tree-description">{{ description }}</span>
</template>

<script setup lang="ts">
/**
 * Описание узла дерева (вспомогательный текст справа).
 */
defineProps<{
  description: string;
}>();
</script>

<style scoped>
.vscode-kit-tree-description {
  margin-left: auto;
  padding-right: var(--vscode-kit-spacing-2);
  font-size: var(--vscode-kit-font-size-small);
  color: var(--vscode-kit-descriptionForeground);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 120px;
}
</style>
