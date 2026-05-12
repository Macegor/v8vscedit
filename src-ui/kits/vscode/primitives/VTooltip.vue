<template>
  <div
    class="vscode-kit-tooltip-wrapper"
    @mouseenter="show"
    @mouseleave="hide"
    @focusin="show"
    @focusout="hide"
  >
    <slot />
    <Transition name="vscode-kit-tooltip-fade">
      <div
        v-if="visible"
        class="vscode-kit-tooltip"
        :class="`vscode-kit-tooltip--${position}`"
        role="tooltip"
      >
        {{ text }}
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

/**
 * Обёртка для элемента, показывающая тултип при наведении/фокусе.
 * Позиция настраивается через `position`.
 */
withDefaults(defineProps<{
  text: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
}>(), {
  position: 'top',
});

const visible = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;

function show(): void {
  clearTimeout(timer);
  timer = setTimeout(() => { visible.value = true; }, 300);
}

function hide(): void {
  clearTimeout(timer);
  visible.value = false;
}
</script>

<style scoped>
.vscode-kit-tooltip-wrapper {
  position: relative;
  display: inline-flex;
}

.vscode-kit-tooltip {
  position: absolute;
  z-index: 1000;
  padding: 3px 6px;
  font-size: var(--vscode-kit-font-size-small);
  line-height: 1.4;
  font-family: var(--vscode-kit-font-family);
  color: var(--vscode-kit-foreground);
  background: var(--vscode-kit-editorBackground);
  border: 1px solid var(--vscode-kit-panelBorder);
  border-radius: var(--vscode-kit-border-radius);
  white-space: nowrap;
  pointer-events: none;
}

.vscode-kit-tooltip--top {
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  margin-bottom: 4px;
}
.vscode-kit-tooltip--bottom {
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  margin-top: 4px;
}
.vscode-kit-tooltip--left {
  right: 100%;
  top: 50%;
  transform: translateY(-50%);
  margin-right: 4px;
}
.vscode-kit-tooltip--right {
  left: 100%;
  top: 50%;
  transform: translateY(-50%);
  margin-left: 4px;
}

.vscode-kit-tooltip-fade-enter-active,
.vscode-kit-tooltip-fade-leave-active {
  transition: opacity 120ms ease;
}
.vscode-kit-tooltip-fade-enter-from,
.vscode-kit-tooltip-fade-leave-to {
  opacity: 0;
}
</style>
