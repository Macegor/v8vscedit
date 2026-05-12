<template>
  <div class="vscode-kit-panel" :class="{ 'vscode-kit-panel--collapsed': collapsed }">
    <div
      v-if="title || $slots.header"
      class="vscode-kit-panel__header"
      :class="{ 'vscode-kit-panel__header--collapsible': collapsible }"
      :role="collapsible ? 'button' : undefined"
      :tabindex="collapsible ? 0 : undefined"
      :aria-expanded="collapsible ? !collapsed : undefined"
      @click="onToggle"
      @keydown.enter="onToggle"
      @keydown.space.prevent="onToggle"
    >
      <span v-if="collapsible" class="vscode-kit-panel__chevron" aria-hidden="true">
        <svg width="10" height="10" viewBox="0 0 10 10">
          <path d="M3 2l4 3-4 3" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
        </svg>
      </span>
      <slot name="header">
        <span class="vscode-kit-panel__title">{{ title }}</span>
      </slot>
    </div>
    <div v-if="!collapsed" class="vscode-kit-panel__body">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Панель с заголовком. Может быть сворачиваемой.
 * Слот `header` переопределяет заголовок.
 */
const props = withDefaults(defineProps<{
  title?: string;
  collapsible?: boolean;
  collapsed?: boolean;
}>(), {
  collapsible: false,
  collapsed: false,
});

const emit = defineEmits<{
  toggle: [];
}>();

function onToggle(): void {
  if (props.collapsible) emit('toggle');
}
</script>

<style scoped>
.vscode-kit-panel {
  display: flex;
  flex-direction: column;
}
.vscode-kit-panel__header {
  display: flex;
  align-items: center;
  gap: var(--vscode-kit-spacing-2);
  padding: 4px 8px;
  min-height: 22px;
  background: var(--vscode-kit-panelBackground);
  color: var(--vscode-kit-foreground);
  font-family: var(--vscode-kit-font-family);
  font-size: var(--vscode-kit-font-size-small);
  font-weight: var(--vscode-kit-font-weight-bold);
  line-height: var(--vscode-kit-line-height);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  user-select: none;
}
.vscode-kit-panel__header--collapsible {
  cursor: pointer;
}
.vscode-kit-panel__header--collapsible:hover {
  background: var(--vscode-kit-listHoverBackground);
}
.vscode-kit-panel__chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 12px;
  height: 12px;
  transition: transform 100ms ease;
  color: var(--vscode-kit-descriptionForeground);
}
.vscode-kit-panel--collapsed .vscode-kit-panel__chevron {
  transform: rotate(-90deg);
}
.vscode-kit-panel__title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vscode-kit-panel__body {
  flex: 1;
  overflow: auto;
}
</style>
