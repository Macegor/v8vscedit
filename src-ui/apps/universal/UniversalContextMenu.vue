<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue';
import type { TreeNodeActionDto } from '@ui-shared/types/tree';

const props = defineProps<{
  visible: boolean;
  x: number;
  y: number;
  actions: readonly TreeNodeActionDto[];
}>();

const emit = defineEmits<{
  action: [action: TreeNodeActionDto];
  close: [];
}>();

const menuRef = ref<HTMLElement | null>(null);

function onDocumentClick(event: MouseEvent): void {
  if (menuRef.value && !menuRef.value.contains(event.target as Node)) {
    emit('close');
  }
}

function onEscape(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    emit('close');
  }
}

watch(() => props.visible, (visible) => {
  if (visible) {
    document.addEventListener('click', onDocumentClick, true);
    document.addEventListener('keydown', onEscape);
  } else {
    document.removeEventListener('click', onDocumentClick, true);
    document.removeEventListener('keydown', onEscape);
  }
});

onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick, true);
  document.removeEventListener('keydown', onEscape);
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      ref="menuRef"
      class="context-menu"
      :style="{ left: x + 'px', top: y + 'px' }"
      role="menu"
    >
      <button
        v-for="action in actions"
        :key="action.id"
        class="context-menu-item"
        role="menuitem"
        :disabled="action.enabled === false"
        @click="emit('action', action)"
      >
        <span class="context-menu-label">{{ action.label }}</span>
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.context-menu {
  position: fixed;
  background: var(--vscode-menu-background);
  color: var(--vscode-menu-foreground);
  border: 1px solid var(--vscode-menu-border);
  border-radius: 4px;
  padding: 4px 0;
  min-width: 150px;
  z-index: 1000;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}
.context-menu-item {
  display: block;
  width: 100%;
  padding: 4px 16px;
  background: transparent;
  border: none;
  color: var(--vscode-menu-foreground);
  font-family: var(--vscode-font-family);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.context-menu-item:hover {
  background: var(--vscode-menu-selectionBackground);
  color: var(--vscode-menu-selectionForeground);
}
.context-menu-item:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
