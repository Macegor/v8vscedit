<template>
  <div class="vscode-kit-panel-shell">
    <div v-if="$slots.toolbar" class="vscode-kit-panel-shell__toolbar">
      <slot name="toolbar" />
    </div>
    <div class="vscode-kit-panel-shell__content">
      <slot name="content" />
    </div>
    <div v-if="$slots.statusBar" class="vscode-kit-panel-shell__status-bar">
      <slot name="statusBar" />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Layout панели с тулбаром, контентом и статус-баром.
 */
</script>

<style scoped>
.vscode-kit-panel-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}
.vscode-kit-panel-shell__toolbar {
  flex: 0 0 auto;
}
.vscode-kit-panel-shell__content {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}
.vscode-kit-panel-shell__status-bar {
  flex: 0 0 auto;
}
</style>
