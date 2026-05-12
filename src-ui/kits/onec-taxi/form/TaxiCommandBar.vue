<script setup lang="ts">
import type { FormPreviewElement } from '../../../apps/form-editor/preview-core/types/FormPreviewElement';

defineProps<{
  element: FormPreviewElement;
}>();
</script>

<template>
  <div v-if="element.visible" class="taxi-command-bar">
    <template v-for="child in element.children" :key="child.id">
      <button v-if="child.type === 'Button'" class="taxi-command-button">
        {{ child.title || child.name }}
      </button>
      <div v-else-if="child.type === 'Separator'" class="taxi-separator"></div>
    </template>
  </div>
</template>

<style scoped>
.taxi-command-bar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: var(--taxi-spacing-xs);
  background: var(--taxi-bg-toolbar);
  border: 1px solid var(--taxi-border);
  border-radius: 3px;
}

.taxi-command-button {
  background: transparent;
  border: none;
  padding: 4px 10px;
  font-family: var(--taxi-font-family);
  font-size: var(--taxi-font-size);
  color: var(--taxi-text-primary);
  cursor: pointer;
  border-radius: 2px;
}

.taxi-command-button:hover {
  background: var(--taxi-button-hover);
}

.taxi-separator {
  width: 1px;
  height: 20px;
  background: var(--taxi-border);
  margin: 0 4px;
}
</style>
