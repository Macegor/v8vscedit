<script setup lang="ts">
import type { FormPreviewElement } from '../../../apps/form-editor/preview-core/types/FormPreviewElement';
import Onec85Field from './Onec85Field.vue';

defineProps<{
  element: FormPreviewElement;
}>();
</script>

<template>
  <div v-if="element.visible" class="onec85-group" :class="{ horizontal: element.groupDirection === 'Horizontal' }">
    <div v-if="element.title" class="onec85-group-title">{{ element.title }}</div>
    <div class="onec85-group-body">
      <template v-for="child in element.children" :key="child.id">
        <Onec85Field v-if="['InputField','LabelField','CheckBoxField','RadioButtonField'].includes(child.type)" :element="child" />
        <div v-else-if="child.type === 'LabelDecoration'" class="onec85-decoration-text">{{ child.title }}</div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.onec85-group {
  display: flex;
  flex-direction: column;
  gap: var(--onec85-spacing-xs);
}

.onec85-group.horizontal {
  flex-direction: row;
  flex-wrap: wrap;
  gap: var(--onec85-spacing-sm);
}

.onec85-group-title {
  font-weight: var(--onec85-font-weight-bold);
  font-size: var(--onec85-font-size);
  color: var(--onec85-header-text);
  margin-bottom: var(--onec85-spacing-xs);
}

.onec85-group-body {
  display: flex;
  flex-direction: column;
  gap: var(--onec85-spacing-xs);
}

.onec85-group.horizontal .onec85-group-body {
  flex-direction: row;
  flex-wrap: wrap;
  gap: var(--onec85-spacing-sm);
}

.onec85-decoration-text {
  font-size: var(--onec85-font-size);
  color: var(--onec85-text-primary);
}
</style>
