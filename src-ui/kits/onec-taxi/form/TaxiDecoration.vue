<script setup lang="ts">
import type { FormPreviewElement } from '../../../apps/form-editor/preview-core/types/FormPreviewElement';

defineProps<{
  element: FormPreviewElement;
}>();
</script>

<template>
  <div v-if="element.visible" class="taxi-decoration">
    {{ element.title || element.name }}
  </div>
</template>

<style scoped>
.taxi-decoration {
  font-size: var(--taxi-font-size);
  color: var(--taxi-text-secondary);
  font-style: italic;
  padding: var(--taxi-spacing-xs) 0;
}
</style>
