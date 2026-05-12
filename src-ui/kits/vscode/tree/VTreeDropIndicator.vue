<template>
  <div
    v-if="visible"
    class="vscode-kit-tree-drop-indicator"
    :class="`vscode-kit-tree-drop-indicator--${position}`"
    aria-hidden="true"
  />
</template>

<script setup lang="ts">
/**
 * Индикатор позиции drag-and-drop в дереве.
 * Показывает линию до/после или подсветку внутри узла.
 */
withDefaults(defineProps<{
  position?: 'before' | 'after' | 'inside';
  visible?: boolean;
}>(), {
  position: 'before',
  visible: false,
});
</script>

<style scoped>
.vscode-kit-tree-drop-indicator {
  position: absolute;
  pointer-events: none;
  z-index: 10;
}
.vscode-kit-tree-drop-indicator--before,
.vscode-kit-tree-drop-indicator--after {
  left: 0;
  right: 0;
  height: 2px;
  background: var(--vscode-kit-focusBorder);
}
.vscode-kit-tree-drop-indicator--before {
  top: 0;
}
.vscode-kit-tree-drop-indicator--after {
  bottom: 0;
}
.vscode-kit-tree-drop-indicator--inside {
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  outline: 1px dashed var(--vscode-kit-focusBorder);
  outline-offset: -1px;
  border-radius: var(--vscode-kit-border-radius);
}
</style>
