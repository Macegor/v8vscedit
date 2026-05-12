<template>
  <Transition name="vscode-kit-menu-fade">
    <div
      v-if="visible"
      class="vscode-kit-menu"
      :class="`vscode-kit-menu--${position}`"
      role="menu"
      @click.stop
      @keydown.escape="emit('close')"
      tabindex="-1"
    >
      <slot />
    </div>
  </Transition>
</template>

<script setup lang="ts">
/**
 * Контейнер выпадающего меню. Содержит VMenuItem.
 * Закрывается по Escape.
 */
withDefaults(defineProps<{
  visible: boolean;
  position?: 'bottom' | 'top' | 'left' | 'right';
}>(), {
  visible: false,
  position: 'bottom',
});

const emit = defineEmits<{
  close: [];
}>();
</script>

<style scoped>
.vscode-kit-menu {
  position: absolute;
  z-index: 1000;
  min-width: 160px;
  padding: 4px 0;
  background: var(--vscode-kit-dropdownBackground);
  color: var(--vscode-kit-dropdownForeground);
  border: 1px solid var(--vscode-kit-dropdownBorder, var(--vscode-kit-panelBorder));
  border-radius: var(--vscode-kit-border-radius);
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
  outline: none;
  font-family: var(--vscode-kit-font-family);
  font-size: var(--vscode-kit-font-size);
  line-height: var(--vscode-kit-line-height);
}
.vscode-kit-menu--bottom {
  top: 100%;
  left: 0;
  margin-top: 2px;
}
.vscode-kit-menu--top {
  bottom: 100%;
  left: 0;
  margin-bottom: 2px;
}
.vscode-kit-menu--left {
  right: 100%;
  top: 0;
  margin-right: 2px;
}
.vscode-kit-menu--right {
  left: 100%;
  top: 0;
  margin-left: 2px;
}

.vscode-kit-menu-fade-enter-active,
.vscode-kit-menu-fade-leave-active {
  transition: opacity 100ms ease;
}
.vscode-kit-menu-fade-enter-from,
.vscode-kit-menu-fade-leave-to {
  opacity: 0;
}
</style>
