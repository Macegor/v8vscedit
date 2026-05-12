<template>
  <span
    v-if="visible"
    class="vscode-kit-tree-expander"
    :class="{ 'vscode-kit-tree-expander--expanded': expanded, 'vscode-kit-tree-expander--loading': loading }"
    @click.stop="emit('toggle')"
    role="button"
    :aria-expanded="expanded"
    :aria-label="expanded ? 'Свернуть' : 'Развернуть'"
    tabindex="-1"
  >
    <svg v-if="!loading" width="10" height="10" viewBox="0 0 10 10">
      <path d="M3 2l4 3-4 3" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
    </svg>
    <span v-else class="vscode-kit-tree-expander__spinner" />
  </span>
  <span v-else class="vscode-kit-tree-expander vscode-kit-tree-expander--placeholder" />
</template>

<script setup lang="ts">
/**
 * Стрелка раскрытия узла дерева.
 * Поворачивается при развороте. Показывает спиннер при загрузке.
 */
withDefaults(defineProps<{
  expanded?: boolean;
  loading?: boolean;
  visible?: boolean;
}>(), {
  expanded: false,
  loading: false,
  visible: true,
});

const emit = defineEmits<{
  toggle: [];
}>();
</script>

<style scoped>
.vscode-kit-tree-expander {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  min-width: 16px;
  color: var(--vscode-kit-descriptionForeground);
  transition: transform 100ms ease;
  flex-shrink: 0;
}
.vscode-kit-tree-expander--expanded {
  transform: rotate(90deg);
}
.vscode-kit-tree-expander--placeholder {
  visibility: hidden;
}
.vscode-kit-tree-expander:hover {
  color: var(--vscode-kit-foreground);
}
.vscode-kit-tree-expander__spinner {
  display: inline-block;
  width: 10px;
  height: 10px;
  border: 1.5px solid var(--vscode-kit-progressBarBackground);
  border-right-color: transparent;
  border-radius: 50%;
  animation: vscode-kit-tree-expand-spin 0.6s linear infinite;
}
@keyframes vscode-kit-tree-expand-spin {
  to { transform: rotate(360deg); }
}
</style>
