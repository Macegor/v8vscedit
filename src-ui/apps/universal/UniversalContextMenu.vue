<script setup lang="ts">
import { computed, nextTick, ref, watch, onUnmounted } from 'vue';
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
const menuPosition = ref({ x: 0, y: 0 });
const maxHeight = ref<number | null>(null);

const menuItems = computed(() => props.actions.map((action) => ({
  label: action.label,
  value: action.id,
})));

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

function onSelect(event: CustomEvent<{ value: string }>): void {
  const action = props.actions.find((item) => item.id === event.detail.value);
  if (action && action.enabled !== false) {
    emit('action', action);
  }
}

async function updateMenuPosition(): Promise<void> {
  menuPosition.value = { x: props.x, y: props.y };
  maxHeight.value = null;
  await nextTick();
  await new Promise((resolve) => requestAnimationFrame(resolve));

  const menu = menuRef.value;
  if (!menu) {
    return;
  }

  const margin = 6;
  const rect = menu.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const availableHeight = Math.max(48, viewportHeight - margin * 2);
  let x = props.x;
  let y = props.y;

  if (rect.width > viewportWidth - margin * 2) {
    x = margin;
  } else if (x + rect.width > viewportWidth - margin) {
    x = viewportWidth - rect.width - margin;
  }
  if (rect.height > availableHeight) {
    maxHeight.value = availableHeight;
    y = margin;
  } else if (y + rect.height > viewportHeight - margin) {
    y = viewportHeight - rect.height - margin;
  }

  menuPosition.value = {
    x: Math.max(margin, x),
    y: Math.max(margin, y),
  };
}

watch(() => props.visible, (visible) => {
  if (visible) {
    document.addEventListener('click', onDocumentClick, true);
    document.addEventListener('keydown', onEscape);
    window.addEventListener('resize', updateMenuPosition);
    void updateMenuPosition();
  } else {
    document.removeEventListener('click', onDocumentClick, true);
    document.removeEventListener('keydown', onEscape);
    window.removeEventListener('resize', updateMenuPosition);
  }
});

watch(() => [props.x, props.y, props.actions.length], () => {
  if (props.visible) {
    void updateMenuPosition();
  }
});

onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick, true);
  document.removeEventListener('keydown', onEscape);
  window.removeEventListener('resize', updateMenuPosition);
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      ref="menuRef"
      class="context-menu-shell"
      :style="{
        left: menuPosition.x + 'px',
        top: menuPosition.y + 'px',
        maxHeight: maxHeight ? maxHeight + 'px' : undefined,
      }"
    >
      <vscode-context-menu
        class="context-menu"
        :data="menuItems"
        :show="visible"
        @vsc-context-menu-select="onSelect"
      />
    </div>
  </Teleport>
</template>

<style scoped>
.context-menu-shell {
  position: fixed;
  z-index: 10000;
  min-width: 180px;
  max-width: min(360px, calc(100vw - 12px));
  overflow: auto;
  color-scheme: dark light;
}

.context-menu {
  min-width: 100%;
  --vscode-menu-border: var(--vscode-menu-border, var(--vscode-widget-border, var(--vscode-panel-border)));
  --vscode-widget-shadow: rgba(0, 0, 0, 0.36);
}

.context-menu-shell::-webkit-scrollbar {
  width: 10px;
}

.context-menu-shell::-webkit-scrollbar-thumb {
  background: var(--vscode-scrollbarSlider-background);
}

.context-menu-shell::-webkit-scrollbar-thumb:hover {
  background: var(--vscode-scrollbarSlider-hoverBackground);
}
</style>
