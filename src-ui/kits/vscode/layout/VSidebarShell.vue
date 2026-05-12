<template>
  <div
    class="vscode-kit-sidebar-shell"
    :class="`vscode-kit-sidebar-shell--${sidebarPosition}`"
  >
    <aside
      v-if="$slots.sidebar"
      class="vscode-kit-sidebar-shell__sidebar"
      :style="{ width: `${sidebarWidth}px` }"
    >
      <slot name="sidebar" />
    </aside>
    <main class="vscode-kit-sidebar-shell__main">
      <slot name="main" />
    </main>
  </div>
</template>

<script setup lang="ts">
/**
 * Layout с боковой панелью.
 * Позиция и ширина панели настраиваются.
 */
withDefaults(defineProps<{
  sidebarPosition?: 'left' | 'right';
  sidebarWidth?: number;
}>(), {
  sidebarPosition: 'left',
  sidebarWidth: 250,
});
</script>

<style scoped>
.vscode-kit-sidebar-shell {
  display: flex;
  flex: 1;
  overflow: hidden;
}
.vscode-kit-sidebar-shell--left {
  flex-direction: row;
}
.vscode-kit-sidebar-shell--right {
  flex-direction: row-reverse;
}
.vscode-kit-sidebar-shell__sidebar {
  flex: 0 0 auto;
  overflow-y: auto;
  background: var(--vscode-kit-sidebarBackground);
  color: var(--vscode-kit-sidebarForeground);
  border-right: 1px solid var(--vscode-kit-panelBorder);
}
.vscode-kit-sidebar-shell--right .vscode-kit-sidebar-shell__sidebar {
  border-right: none;
  border-left: 1px solid var(--vscode-kit-panelBorder);
}
.vscode-kit-sidebar-shell__main {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  background: var(--vscode-kit-editorBackground);
}
</style>
