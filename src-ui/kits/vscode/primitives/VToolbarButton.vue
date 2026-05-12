<template>
  <button
    class="vscode-kit-toolbar-button"
    :class="{ 'vscode-kit-toolbar-button--active': active }"
    :disabled="disabled"
    :title="label"
    :aria-label="label"
    :aria-pressed="active"
    @click="onClick"
  >
    <span v-if="icon" class="vscode-kit-toolbar-button__icon" aria-hidden="true">{{ icon }}</span>
  </button>
</template>

<script setup lang="ts">
/** Кнопка панели инструментов. Может быть зажатым состоянием (`active`). */
withDefaults(defineProps<{
  label: string;
  icon?: string;
  disabled?: boolean;
  active?: boolean;
}>(), {
  disabled: false,
  active: false,
});

const emit = defineEmits<{
  click: [event: MouseEvent];
}>();

function onClick(event: MouseEvent): void {
  emit('click', event);
}
</script>

<style scoped>
.vscode-kit-toolbar-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 2px;
  border: none;
  background: transparent;
  color: var(--vscode-kit-foreground);
  border-radius: var(--vscode-kit-border-radius);
  cursor: pointer;
  outline: none;
  font-size: 16px;
}
.vscode-kit-toolbar-button:hover:not(:disabled) {
  background: var(--vscode-kit-listHoverBackground);
}
.vscode-kit-toolbar-button--active {
  background: var(--vscode-kit-listActiveSelectionBackground);
  color: var(--vscode-kit-listActiveSelectionForeground);
}
.vscode-kit-toolbar-button:focus-visible {
  outline: 1px solid var(--vscode-kit-focusBorder);
  outline-offset: -1px;
}
.vscode-kit-toolbar-button:disabled {
  cursor: default;
  opacity: 0.5;
}
</style>
