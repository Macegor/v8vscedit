<template>
  <div
    ref="containerRef"
    class="vscode-kit-splitter"
    :class="`vscode-kit-splitter--${direction}`"
    @mousedown="onMouseDown"
  >
    <div class="vscode-kit-splitter__pane" :style="paneStyle" />
    <div
      class="vscode-kit-splitter__gutter"
      :class="{ 'vscode-kit-splitter__gutter--dragging': dragging }"
      role="separator"
      :aria-orientation="direction"
      :aria-valuenow="currentPosition"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue';

/**
 * Разделитель панелей. Позволяет перетаскивать границу
 * между двумя областями.
 */
const props = withDefaults(defineProps<{
  direction?: 'horizontal' | 'vertical';
  initialPosition?: number;
}>(), {
  direction: 'horizontal',
  initialPosition: 50,
});

const emit = defineEmits<{
  'update:position': [percent: number];
}>();

const currentPosition = ref(props.initialPosition);
const dragging = ref(false);
const containerRef = ref<HTMLDivElement | null>(null);
const startPos = ref(0);
const startFraction = ref(0);

const paneStyle = computed(() => {
  if (props.direction === 'horizontal') {
    return { width: `${currentPosition.value}%` };
  }
  return { height: `${currentPosition.value}%` };
});

function onMouseDown(event: MouseEvent): void {
  if (event.button !== 0) return;
  dragging.value = true;
  const rect = containerRef.value?.getBoundingClientRect();
  if (!rect) return;
  startPos.value = props.direction === 'horizontal' ? event.clientX : event.clientY;
  startFraction.value = currentPosition.value;
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
}

function onMouseMove(event: MouseEvent): void {
  if (!dragging.value) return;
  const rect = containerRef.value?.getBoundingClientRect();
  if (!rect) return;
  const size = props.direction === 'horizontal' ? rect.width : rect.height;
  const delta = ((props.direction === 'horizontal' ? event.clientX : event.clientY) - startPos.value);
  const pct = Math.max(10, Math.min(90, startFraction.value + (delta / size) * 100));
  currentPosition.value = Math.round(pct);
  emit('update:position', currentPosition.value);
}

function onMouseUp(): void {
  dragging.value = false;
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mouseup', onMouseUp);
}

onUnmounted(() => {
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mouseup', onMouseUp);
});
</script>

<style scoped>
.vscode-kit-splitter {
  display: flex;
  overflow: hidden;
}
.vscode-kit-splitter--horizontal {
  flex-direction: row;
}
.vscode-kit-splitter--vertical {
  flex-direction: column;
}
.vscode-kit-splitter__pane {
  flex: 0 0 auto;
  overflow: hidden;
}
.vscode-kit-splitter__gutter {
  flex: 0 0 4px;
  background: var(--vscode-kit-panelBorder);
  cursor: col-resize;
  transition: background 80ms ease;
}
.vscode-kit-splitter--vertical .vscode-kit-splitter__gutter {
  cursor: row-resize;
}
.vscode-kit-splitter__gutter:hover,
.vscode-kit-splitter__gutter--dragging {
  background: var(--vscode-kit-focusBorder);
}
</style>
