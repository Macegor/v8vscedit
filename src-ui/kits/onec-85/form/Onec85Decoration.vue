<script setup lang="ts">
import type { FormPreviewElement } from '../../../apps/form-editor/preview-core/types/FormPreviewElement';

defineProps<{
  element: FormPreviewElement;
}>();
</script>

<template>
  <div v-if="element.visible" class="onec85-decoration">
    {{ element.title || element.name }}
  </div>
</template>

<style scoped>
.onec85-decoration {
  font-size: var(--onec85-font-size);
  color: var(--onec85-text-secondary);
  font-style: italic;
  padding: var(--onec85-spacing-xs) 0;
}
</style>
