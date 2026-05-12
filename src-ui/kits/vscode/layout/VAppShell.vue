<template>
  <div class="vscode-kit-app-shell">
    <header v-if="$slots.header" class="vscode-kit-app-shell__header">
      <slot name="header" />
    </header>
    <div class="vscode-kit-app-shell__body">
      <aside v-if="$slots.sidebar" class="vscode-kit-app-shell__sidebar">
        <slot name="sidebar" />
      </aside>
      <main class="vscode-kit-app-shell__main">
        <slot name="main" />
      </main>
    </div>
    <footer v-if="$slots.footer" class="vscode-kit-app-shell__footer">
      <slot name="footer" />
    </footer>
  </div>
</template>

<script setup lang="ts">
/**
 * Корневой layout webview-панели.
 * Слоты: `header` (верх), `sidebar` (боковая панель), `main` (основной контент), `footer` (низ).
 */
</script>

<style scoped>
.vscode-kit-app-shell {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100vh;
  overflow: hidden;
  background: var(--vscode-kit-sidebarBackground);
  color: var(--vscode-kit-foreground);
  font-family: var(--vscode-kit-font-family);
  font-size: var(--vscode-kit-font-size);
  line-height: var(--vscode-kit-line-height);
}
.vscode-kit-app-shell__header {
  flex: 0 0 auto;
}
.vscode-kit-app-shell__body {
  flex: 1;
  display: flex;
  overflow: hidden;
}
.vscode-kit-app-shell__sidebar {
  flex: 0 0 auto;
  width: 250px;
  overflow-y: auto;
  border-right: 1px solid var(--vscode-kit-panelBorder);
  background: var(--vscode-kit-sidebarBackground);
}
.vscode-kit-app-shell__main {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  background: var(--vscode-kit-editorBackground);
}
.vscode-kit-app-shell__footer {
  flex: 0 0 auto;
  border-top: 1px solid var(--vscode-kit-panelBorder);
}
</style>
