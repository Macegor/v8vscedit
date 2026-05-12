<template>
  <div class="processing-overlay" role="progressbar" aria-label="Обработка">
    <div class="processing-spinner">
      <span class="codicon codicon-loading codicon-modifier-spin" />
    </div>
  </div>
</template>

<style scoped>
.processing-overlay {
  position: absolute;
  inset: 0;
  background: var(--vscode-sidebar-background);
  opacity: 0.8;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.processing-spinner {
  font-size: 32px;
  color: var(--vscode-progressBar-background);
}
</style>
