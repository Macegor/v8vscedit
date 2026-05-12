<template>
  <button
    class="vscode-kit-button"
    :class="[`vscode-kit-button--${variant}`, `vscode-kit-button--${size}`]"
    :disabled="disabled"
    :title="title"
    :aria-disabled="disabled"
    @click="onClick"
  >
    <span class="vscode-kit-button__content">
      <slot />
    </span>
  </button>
</template>

<script setup lang="ts">
/**
 * Текстовая кнопка в стиле VS Code.
 *
 * Variant `primary` — основное действие (заливка),
 * `secondary` — второстепенное действие (контур),
 * `icon` — кнопка-иконка без рамки.
 */
withDefaults(defineProps<{
  variant?: 'primary' | 'secondary' | 'icon';
  disabled?: boolean;
  title?: string;
  size?: 'sm' | 'md';
}>(), {
  variant: 'primary',
  disabled: false,
  size: 'md',
});

const emit = defineEmits<{
  click: [event: MouseEvent];
}>();

function onClick(event: MouseEvent): void {
  emit('click', event);
}
</script>

<style scoped>
.vscode-kit-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--vscode-kit-spacing-2);
  border: 1px solid transparent;
  border-radius: var(--vscode-kit-border-radius);
  font-family: var(--vscode-kit-font-family);
  font-size: var(--vscode-kit-font-size);
  line-height: var(--vscode-kit-line-height);
  cursor: pointer;
  outline: none;
  white-space: nowrap;
  user-select: none;
  transition: background 80ms ease;
}
.vscode-kit-button:focus-visible {
  outline: 1px solid var(--vscode-kit-focusBorder);
  outline-offset: -1px;
}
.vscode-kit-button:disabled {
  cursor: default;
  opacity: 0.65;
}

.vscode-kit-button--md {
  min-height: 28px;
  padding: var(--vscode-kit-spacing-2) var(--vscode-kit-spacing-5);
}
.vscode-kit-button--sm {
  min-height: 22px;
  padding: 0 var(--vscode-kit-spacing-3);
  font-size: var(--vscode-kit-font-size-small);
}

.vscode-kit-button__content {
  display: inline-flex;
  align-items: center;
  gap: var(--vscode-kit-spacing-2);
}

.vscode-kit-button--primary {
  color: var(--vscode-kit-buttonForeground);
  background: var(--vscode-kit-buttonBackground);
}
.vscode-kit-button--primary:hover:not(:disabled) {
  background: var(--vscode-kit-buttonHoverBackground);
}

.vscode-kit-button--secondary {
  color: var(--vscode-kit-buttonSecondaryForeground);
  background: var(--vscode-kit-buttonSecondaryBackground);
  border-color: var(--vscode-kit-inputBorder);
}
.vscode-kit-button--secondary:hover:not(:disabled) {
  background: var(--vscode-kit-buttonSecondaryHoverBackground);
}

.vscode-kit-button--icon {
  min-width: 28px;
  min-height: 28px;
  padding: var(--vscode-kit-spacing-2);
  background: transparent;
  color: var(--vscode-kit-foreground);
}
.vscode-kit-button--icon:hover:not(:disabled) {
  background: var(--vscode-kit-listHoverBackground);
}
</style>
