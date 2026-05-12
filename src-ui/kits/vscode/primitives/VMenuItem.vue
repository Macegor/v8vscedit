<template>
  <button
    class="vscode-kit-menu-item"
    :class="{ 'vscode-kit-menu-item--danger': danger }"
    :disabled="disabled"
    :aria-disabled="disabled"
    role="menuitem"
    @click="onSelect"
  >
    <span v-if="icon" class="vscode-kit-menu-item__icon" aria-hidden="true">{{ icon }}</span>
    <span class="vscode-kit-menu-item__label">{{ label }}</span>
    <span v-if="shortcut" class="vscode-kit-menu-item__shortcut">{{ shortcut }}</span>
  </button>
</template>

<script setup lang="ts">
/** Пункт выпадающего меню. */
withDefaults(defineProps<{
  label: string;
  icon?: string;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
}>(), {
  disabled: false,
  danger: false,
});

const emit = defineEmits<{
  select: [];
}>();

function onSelect(): void {
  emit('select');
}
</script>

<style scoped>
.vscode-kit-menu-item {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 4px 12px;
  gap: 8px;
  border: none;
  background: transparent;
  color: var(--vscode-kit-dropdownForeground);
  font-family: inherit;
  font-size: inherit;
  line-height: inherit;
  text-align: left;
  cursor: pointer;
  outline: none;
  box-sizing: border-box;
}
.vscode-kit-menu-item:hover:not(:disabled) {
  background: var(--vscode-kit-listActiveSelectionBackground);
  color: var(--vscode-kit-listActiveSelectionForeground);
}
.vscode-kit-menu-item:focus-visible {
  background: var(--vscode-kit-listFocusBackground);
}
.vscode-kit-menu-item:disabled {
  cursor: default;
  opacity: 0.5;
}
.vscode-kit-menu-item--danger:hover:not(:disabled) {
  background: rgba(204, 0, 0, 0.15);
  color: var(--vscode-kit-errorForeground);
}
.vscode-kit-menu-item__icon {
  width: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.vscode-kit-menu-item__label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vscode-kit-menu-item__shortcut {
  color: var(--vscode-kit-descriptionForeground);
  font-size: var(--vscode-kit-font-size-small);
  margin-left: auto;
  white-space: nowrap;
}
</style>
