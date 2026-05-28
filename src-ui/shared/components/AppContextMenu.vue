<script setup lang="ts">
import { nextTick, onUnmounted, ref, watch } from 'vue';
import type { IconDto } from '@ui-shared/types/icon';

export interface ContextMenuItem {
  readonly id: string;
  readonly label: string;
  readonly icon?: IconDto;
  readonly enabled?: boolean;
}

const props = defineProps<{
  visible: boolean;
  x: number;
  y: number;
  items: readonly ContextMenuItem[];
}>();

const emit = defineEmits<{
  select: [item: ContextMenuItem];
  close: [];
}>();

const menuRef = ref<HTMLElement | null>(null);
const menuPosition = ref({ x: 0, y: 0 });
const maxHeight = ref<number | null>(null);

function iconClass(icon?: IconDto): string {
  if (icon?.kind === 'codicon' && icon.name) {
    return `codicon codicon-${icon.name}`;
  }
  return 'codicon codicon-circle-outline';
}

function isAssetIcon(icon?: IconDto): icon is IconDto & { kind: 'asset'; lightUri: string; darkUri: string } {
  return icon?.kind === 'asset' && Boolean(icon.lightUri) && Boolean(icon.darkUri);
}

function close(): void {
  emit('close');
}

function onOutsidePointer(event: PointerEvent): void {
  if (menuRef.value?.contains(event.target as Node)) {
    return;
  }
  close();
}

function onOutsideFocus(event: FocusEvent): void {
  if (menuRef.value?.contains(event.target as Node)) {
    return;
  }
  close();
}

function onWindowBlur(): void {
  close();
}

function onVisibilityChange(): void {
  if (document.visibilityState !== 'visible') {
    close();
  }
}

function onEscape(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    close();
  }
}

function onScroll(event: Event): void {
  if (menuRef.value?.contains(event.target as Node)) {
    return;
  }
  close();
}

function selectItem(item: ContextMenuItem): void {
  if (item.enabled === false) {
    return;
  }
  emit('select', item);
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

  const margin = 8;
  const rect = menu.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const availableHeight = Math.max(96, viewportHeight - margin * 2);
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
  menu.focus({ preventScroll: true });
}

function addListeners(): void {
  document.addEventListener('pointerdown', onOutsidePointer, true);
  document.addEventListener('focusin', onOutsideFocus, true);
  document.addEventListener('keydown', onEscape);
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('blur', onWindowBlur);
  window.addEventListener('resize', updateMenuPosition);
  window.addEventListener('scroll', onScroll, true);
}

function removeListeners(): void {
  document.removeEventListener('pointerdown', onOutsidePointer, true);
  document.removeEventListener('focusin', onOutsideFocus, true);
  document.removeEventListener('keydown', onEscape);
  document.removeEventListener('visibilitychange', onVisibilityChange);
  window.removeEventListener('blur', onWindowBlur);
  window.removeEventListener('resize', updateMenuPosition);
  window.removeEventListener('scroll', onScroll, true);
}

watch(() => props.visible, (visible) => {
  if (visible) {
    addListeners();
    void updateMenuPosition();
  } else {
    removeListeners();
  }
});

watch(() => [props.x, props.y, props.items.length], () => {
  if (props.visible) {
    void updateMenuPosition();
  }
});

onUnmounted(removeListeners);
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      ref="menuRef"
      class="context-menu"
      role="menu"
      tabindex="-1"
      :style="{
        left: menuPosition.x + 'px',
        top: menuPosition.y + 'px',
        maxHeight: maxHeight ? maxHeight + 'px' : undefined,
      }"
      @contextmenu.prevent
    >
      <button
        v-for="item in items"
        :key="item.id"
        class="context-menu-item"
        type="button"
        role="menuitem"
        :disabled="item.enabled === false"
        @click="selectItem(item)"
      >
        <span class="context-menu-icon" aria-hidden="true">
          <span
            v-if="isAssetIcon(item.icon)"
            class="context-menu-asset"
            :style="{ '--icon-light': `url(${item.icon.lightUri})`, '--icon-dark': `url(${item.icon.darkUri})` }"
          />
          <span v-else-if="item.icon" :class="iconClass(item.icon)" />
        </span>
        <span class="context-menu-label">{{ item.label }}</span>
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.context-menu {
  position: fixed;
  z-index: 10000;
  min-width: 220px;
  max-width: min(420px, calc(100vw - 16px));
  padding: 5px;
  overflow: auto;
  color: var(--vscode-menu-foreground, var(--vscode-foreground));
  background: var(--vscode-menu-background, var(--vscode-editorWidget-background));
  border: 1px solid var(--vscode-menu-border, var(--vscode-widget-border, var(--vscode-panel-border)));
  border-radius: 6px;
  box-shadow: 0 8px 24px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.36));
  outline: none;
}

.context-menu-item {
  width: 100%;
  min-height: 34px;
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  align-items: center;
  gap: 9px;
  padding: 5px 12px 5px 8px;
  border: 0;
  border-radius: 4px;
  color: inherit;
  background: transparent;
  font: inherit;
  font-size: 13px;
  line-height: 1.25;
  text-align: left;
  cursor: pointer;
}

.context-menu-item:hover:not(:disabled),
.context-menu-item:focus-visible {
  background: var(--vscode-menu-selectionBackground, var(--vscode-list-hoverBackground));
  color: var(--vscode-menu-selectionForeground, var(--vscode-foreground));
  outline: none;
}

.context-menu-item:disabled {
  opacity: 0.5;
  cursor: default;
}

.context-menu-icon {
  width: 22px;
  height: 22px;
  display: inline-grid;
  place-items: center;
  color: var(--vscode-menu-foreground, var(--vscode-icon-foreground));
}

.context-menu-asset {
  width: 16px;
  height: 16px;
  display: block;
  background-image: var(--icon-light);
  background-size: contain;
  background-repeat: no-repeat;
  background-position: center;
}

body.vscode-dark .context-menu-asset,
body.vscode-high-contrast:not(.vscode-high-contrast-light) .context-menu-asset {
  background-image: var(--icon-dark);
}

.context-menu-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.context-menu::-webkit-scrollbar {
  width: 10px;
}

.context-menu::-webkit-scrollbar-thumb {
  background: var(--vscode-scrollbarSlider-background);
}

.context-menu::-webkit-scrollbar-thumb:hover {
  background: var(--vscode-scrollbarSlider-hoverBackground);
}
</style>
