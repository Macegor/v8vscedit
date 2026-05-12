<template>
  <span
    class="vscode-kit-tag"
    :class="[`vscode-kit-tag--${variant}`]"
    role="status"
  >
    <span class="vscode-kit-tag__label">{{ label }}</span>
    <button
      v-if="closable"
      class="vscode-kit-tag__close"
      @click="onClose"
      aria-label="Удалить тег"
      type="button"
    >
      &times;
    </button>
  </span>
</template>

<script setup lang="ts">
/**
 * Тег — маленькая метка с опциональным крестиком закрытия.
 */
withDefaults(defineProps<{
  label: string;
  closable?: boolean;
  variant?: 'default' | 'info' | 'warning' | 'error';
}>(), {
  closable: false,
  variant: 'default',
});

const emit = defineEmits<{
  close: [];
}>();

function onClose(): void {
  emit('close');
}
</script>

<style scoped>
.vscode-kit-tag {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 1px 4px;
  font-size: 11px;
  line-height: 1.4;
  font-family: var(--vscode-kit-font-family);
  border-radius: var(--vscode-kit-border-radius-small);
  user-select: none;
  white-space: nowrap;
}
.vscode-kit-tag--default {
  color: var(--vscode-kit-badgeForeground);
  background: var(--vscode-kit-badgeBackground);
}
.vscode-kit-tag--info {
  color: var(--vscode-kit-foreground);
  background: rgba(75, 145, 220, 0.2);
}
.vscode-kit-tag--warning {
  color: var(--vscode-kit-errorForeground);
  background: rgba(204, 153, 0, 0.2);
}
.vscode-kit-tag--error {
  color: var(--vscode-kit-errorForeground);
  background: rgba(204, 0, 0, 0.15);
}
.vscode-kit-tag__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  padding: 0;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  border-radius: var(--vscode-kit-border-radius-small);
  opacity: 0.7;
}
.vscode-kit-tag__close:hover {
  opacity: 1;
  background: rgba(128, 128, 128, 0.2);
}
</style>
