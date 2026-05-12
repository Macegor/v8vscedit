<template>
  <div class="vscode-kit-spinner" :class="`vscode-kit-spinner--${size}`" role="status" :aria-label="label">
    <span class="vscode-kit-spinner__indicator" />
    <span v-if="label" class="vscode-kit-spinner__label">{{ label }}</span>
  </div>
</template>

<script setup lang="ts">
/**
 * Спиннер загрузки в стиле VS Code.
 * Размеры: sm (12px), md (16px), lg (24px).
 */
withDefaults(defineProps<{
  size?: 'sm' | 'md' | 'lg';
  label?: string;
}>(), {
  size: 'md',
});
</script>

<style scoped>
.vscode-kit-spinner {
  display: inline-flex;
  align-items: center;
  gap: var(--vscode-kit-spacing-4);
  font-family: var(--vscode-kit-font-family);
  font-size: var(--vscode-kit-font-size);
  color: var(--vscode-kit-foreground);
}
.vscode-kit-spinner__indicator {
  box-sizing: border-box;
  border: 2px solid var(--vscode-kit-progressBarBackground);
  border-right-color: transparent;
  border-radius: 50%;
  animation: vscode-kit-spin 0.8s linear infinite;
}
.vscode-kit-spinner--sm .vscode-kit-spinner__indicator {
  width: 12px;
  height: 12px;
}
.vscode-kit-spinner--md .vscode-kit-spinner__indicator {
  width: 16px;
  height: 16px;
}
.vscode-kit-spinner--lg .vscode-kit-spinner__indicator {
  width: 24px;
  height: 24px;
  border-width: 3px;
}
.vscode-kit-spinner__label {
  color: var(--vscode-kit-descriptionForeground);
}
@keyframes vscode-kit-spin {
  to { transform: rotate(360deg); }
}
</style>
