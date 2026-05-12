<script setup lang="ts">
import type { FormPreviewElement } from '../../../apps/form-editor/preview-core/types/FormPreviewElement';

defineProps<{
  element: FormPreviewElement;
}>();
</script>

<template>
  <div v-if="element.visible" class="onec85-command-bar">
    <template v-for="child in element.children" :key="child.id">
      <button v-if="child.type === 'Button'" class="onec85-command-button">
        {{ child.title || child.name }}
      </button>
      <div v-else-if="child.type === 'Separator'" class="onec85-separator"></div>
    </template>
  </div>
</template>

<style scoped>
.onec85-command-bar {
  display: flex;
  align-items: center;
  gap: 1px;
  padding: var(--onec85-spacing-xs);
  background: var(--onec85-bg-toolbar);
  border: 1px solid var(--onec85-border);
}

.onec85-command-button {
  background: transparent;
  border: none;
  padding: 3px 8px;
  font-family: var(--onec85-font-family);
  font-size: var(--onec85-font-size);
  color: var(--onec85-text-primary);
  cursor: pointer;
}

.onec85-command-button:hover {
  background: var(--onec85-button-hover);
}

.onec85-separator {
  width: 1px;
  height: 18px;
  background: var(--onec85-border);
  margin: 0 2px;
}
</style>
