<template>
  <span class="vscode-kit-tree-label">
    <VTreeSearchHighlight v-if="highlight" :text="label" :query="highlight" />
    <template v-else>{{ label }}</template>
  </span>
</template>

<script setup lang="ts">
import VTreeSearchHighlight from './VTreeSearchHighlight.vue';

/**
 * Текст названия узла дерева.
 * При наличии `highlight` подсвечивает совпадения поиска.
 */
withDefaults(defineProps<{
  label: string;
  highlight?: string;
}>(), {
  label: '',
  highlight: '',
});
</script>

<style scoped>
.vscode-kit-tree-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--vscode-kit-font-size);
  line-height: var(--vscode-kit-line-height);
}
</style>
