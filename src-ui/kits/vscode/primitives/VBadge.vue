<template>
  <span
    class="vscode-kit-badge"
    :class="[`vscode-kit-badge--${variant}`, `vscode-kit-badge--${size}`]"
    role="status"
  >
    <slot />
  </span>
</template>

<script setup lang="ts">
/**
 * Бейдж (метка статуса). Используется в дереве метаданных
 * для отображения режима поддержки и других признаков.
 */
withDefaults(defineProps<{
  variant?: 'default' | 'info' | 'warning' | 'error';
  size?: 'sm' | 'md';
}>(), {
  variant: 'default',
  size: 'sm',
});
</script>

<style scoped>
.vscode-kit-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: var(--vscode-kit-font-family);
  line-height: 1;
  border-radius: var(--vscode-kit-border-radius-small);
  user-select: none;
  white-space: nowrap;
}

.vscode-kit-badge--sm {
  padding: 1px 4px;
  font-size: 11px;
  min-height: 16px;
}
.vscode-kit-badge--md {
  padding: 2px 6px;
  font-size: var(--vscode-kit-font-size-small);
  min-height: 20px;
}

.vscode-kit-badge--default {
  color: var(--vscode-kit-badgeForeground);
  background: var(--vscode-kit-badgeBackground);
}
.vscode-kit-badge--info {
  color: var(--vscode-kit-foreground);
  background: rgba(75, 145, 220, 0.2);
}
.vscode-kit-badge--warning {
  color: var(--vscode-kit-errorForeground);
  background: rgba(204, 153, 0, 0.2);
}
.vscode-kit-badge--error {
  color: var(--vscode-kit-errorForeground);
  background: rgba(204, 0, 0, 0.15);
}
</style>
