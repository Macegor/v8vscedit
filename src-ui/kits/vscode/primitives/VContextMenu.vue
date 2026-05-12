<template>
  <Teleport to="body">
    <Transition name="vscode-kit-menu-fade">
      <div
        v-if="visible"
        class="vscode-kit-context-menu"
        :style="{ left: `${x}px`, top: `${y}px` }"
        role="menu"
        @click.stop
        @keydown.escape="emit('close')"
        tabindex="-1"
        ref="menuRef"
      >
        <slot />
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue';

/**
 * Контекстное меню, позиционированное по координатам.
 * Телепортируется в body. Закрывается по Escape или клику вне меню.
 */
const props = withDefaults(defineProps<{
  visible: boolean;
  x: number;
  y: number;
}>(), {
  visible: false,
  x: 0,
  y: 0,
});

const emit = defineEmits<{
  close: [];
}>();

const menuRef = ref<HTMLDivElement | null>(null);

watch(() => props.visible, async (show) => {
  if (show) {
    await nextTick();
    menuRef.value?.focus();
  }
});

function handleOutsideClick(event: MouseEvent): void {
  if (props.visible && menuRef.value && !menuRef.value.contains(event.target as Node)) {
    emit('close');
  }
}

onMounted(() => {
  document.addEventListener('click', handleOutsideClick, true);
});

onUnmounted(() => {
  document.removeEventListener('click', handleOutsideClick, true);
});
</script>

<style scoped>
.vscode-kit-context-menu {
  position: fixed;
  z-index: 2000;
  min-width: 180px;
  padding: 4px 0;
  background: var(--vscode-kit-dropdownBackground);
  color: var(--vscode-kit-dropdownForeground);
  border: 1px solid var(--vscode-kit-dropdownBorder, var(--vscode-kit-panelBorder));
  border-radius: var(--vscode-kit-border-radius);
  box-shadow: 0 6px 12px rgba(0, 0, 0, 0.3);
  outline: none;
  font-family: var(--vscode-kit-font-family);
  font-size: var(--vscode-kit-font-size);
  line-height: var(--vscode-kit-line-height);
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
