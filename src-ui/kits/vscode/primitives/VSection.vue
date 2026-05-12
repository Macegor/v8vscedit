<template>
  <section class="vscode-kit-section">
    <div
      v-if="title || $slots.header"
      class="vscode-kit-section__header"
      :class="{ 'vscode-kit-section__header--collapsible': collapsible }"
      :role="collapsible ? 'button' : undefined"
      :tabindex="collapsible ? 0 : undefined"
      :aria-expanded="collapsible ? !localCollapsed : undefined"
      @click="onToggle"
      @keydown.enter="onToggle"
      @keydown.space.prevent="onToggle"
    >
      <slot name="header">
        <span class="vscode-kit-section__title">{{ title }}</span>
      </slot>
    </div>
    <div v-if="!localCollapsed" class="vscode-kit-section__body">
      <slot />
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue';

/**
 * Секция с заголовком. Может быть сворачиваемой.
 * Состояние сворачивания — внутреннее.
 */
const props = withDefaults(defineProps<{
  title?: string;
  collapsible?: boolean;
}>(), {
  collapsible: false,
});

const localCollapsed = ref(false);

function onToggle(): void {
  if (props.collapsible) {
    localCollapsed.value = !localCollapsed.value;
  }
}
</script>

<style scoped>
.vscode-kit-section {
  display: flex;
  flex-direction: column;
}
.vscode-kit-section__header {
  display: flex;
  align-items: center;
  gap: var(--vscode-kit-spacing-2);
  padding: var(--vscode-kit-spacing-4) 0;
  font-family: var(--vscode-kit-font-family);
  font-size: var(--vscode-kit-font-size);
  font-weight: var(--vscode-kit-font-weight-bold);
  line-height: var(--vscode-kit-line-height);
  color: var(--vscode-kit-foreground);
  user-select: none;
  border-bottom: 1px solid var(--vscode-kit-panelBorder);
}
.vscode-kit-section__header--collapsible {
  cursor: pointer;
}
.vscode-kit-section__header--collapsible:hover {
  background: var(--vscode-kit-listHoverBackground);
}
.vscode-kit-section__title {
  flex: 1;
}
.vscode-kit-section__body {
  padding-top: var(--vscode-kit-spacing-4);
}
</style>
