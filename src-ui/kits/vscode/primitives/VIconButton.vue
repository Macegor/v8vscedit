<template>
  <button
    class="vscode-kit-icon-button"
    :disabled="disabled"
    :title="title"
    :aria-label="ariaLabel"
    @click="onClick"
  >
    <slot />
  </button>
</template>

<script setup lang="ts">
/**
 * Кнопка-иконка. Обязательный `ariaLabel` для доступности.
 * Содержимое слота — SVG или другой графический контент.
 */
const props = withDefaults(defineProps<{
  disabled?: boolean;
  title?: string;
  ariaLabel: string;
}>(), {
  disabled: false,
});

const emit = defineEmits<{
  click: [event: MouseEvent];
}>();

function onClick(event: MouseEvent): void {
  if (props.disabled) return;
  emit('click', event);
}
</script>

<style scoped>
.vscode-kit-icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 2px;
  border: none;
  background: transparent;
  color: var(--vscode-kit-foreground);
  border-radius: var(--vscode-kit-border-radius);
  cursor: pointer;
  outline: none;
  font-size: inherit;
}
.vscode-kit-icon-button:hover:not(:disabled) {
  background: var(--vscode-kit-listHoverBackground);
}
.vscode-kit-icon-button:focus-visible {
  outline: 1px solid var(--vscode-kit-focusBorder);
  outline-offset: -1px;
}
.vscode-kit-icon-button:disabled {
  cursor: default;
  opacity: 0.5;
}
</style>
