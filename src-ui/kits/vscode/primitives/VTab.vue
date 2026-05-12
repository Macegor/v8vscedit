<template>
  <button
    class="vscode-kit-tab"
    :class="{ 'vscode-kit-tab--active': active }"
    :disabled="disabled"
    :aria-selected="active"
    role="tab"
    @click="onSelect"
  >
    <span v-if="icon" class="vscode-kit-tab__icon" aria-hidden="true">{{ icon }}</span>
    <span class="vscode-kit-tab__label">{{ label }}</span>
  </button>
</template>

<script setup lang="ts">
/**
 * Вкладка. Используется внутри VTabs.
 * Активность определяется prop `active` от родителя.
 */
const props = withDefaults(defineProps<{
  id: string;
  label: string;
  disabled?: boolean;
  icon?: string;
  active?: boolean;
}>(), {
  disabled: false,
  active: false,
});

const emit = defineEmits<{
  select: [id: string];
}>();

function onSelect(): void {
  emit('select', props.id);
}
</script>

<style scoped>
.vscode-kit-tab {
  display: inline-flex;
  align-items: center;
  gap: var(--vscode-kit-spacing-2);
  padding: 6px 12px;
  border: none;
  background: transparent;
  color: var(--vscode-kit-foreground);
  font-family: var(--vscode-kit-font-family);
  font-size: var(--vscode-kit-font-size);
  line-height: var(--vscode-kit-line-height);
  cursor: pointer;
  outline: none;
  white-space: nowrap;
  border-bottom: 1px solid transparent;
  margin-bottom: -1px;
  opacity: 0.75;
}
.vscode-kit-tab:hover:not(:disabled) {
  opacity: 1;
  background: var(--vscode-kit-listHoverBackground);
}
.vscode-kit-tab--active {
  opacity: 1;
  background: var(--vscode-kit-tabActiveBackground);
  border-bottom-color: var(--vscode-kit-tabActiveForeground);
  color: var(--vscode-kit-tabActiveForeground);
}
.vscode-kit-tab:focus-visible {
  outline: 1px solid var(--vscode-kit-focusBorder);
  outline-offset: -2px;
}
.vscode-kit-tab:disabled {
  cursor: default;
  opacity: 0.4;
}
.vscode-kit-tab__icon {
  display: inline-flex;
  font-size: 16px;
}
</style>
