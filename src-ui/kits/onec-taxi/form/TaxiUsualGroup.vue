<script setup lang="ts">
import type { FormPreviewElement } from '../../../apps/form-editor/preview-core/types/FormPreviewElement';
import TaxiField from './TaxiField.vue';

defineProps<{
  element: FormPreviewElement;
}>();
</script>

<template>
  <div v-if="element.visible" class="taxi-group" :class="{ horizontal: element.groupDirection === 'Horizontal' }">
    <div v-if="element.title" class="taxi-group-title">{{ element.title }}</div>
    <div class="taxi-group-body">
      <template v-for="child in element.children" :key="child.id">
        <TaxiField v-if="['InputField','LabelField','CheckBoxField','RadioButtonField'].includes(child.type)" :element="child" />
        <div v-else-if="child.type === 'LabelDecoration'" class="taxi-decoration-text">{{ child.title }}</div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.taxi-group {
  display: flex;
  flex-direction: column;
  gap: var(--taxi-spacing-xs);
}

.taxi-group.horizontal {
  flex-direction: row;
  flex-wrap: wrap;
  gap: var(--taxi-spacing-md);
}

.taxi-group-title {
  font-weight: var(--taxi-font-weight-bold);
  font-size: var(--taxi-font-size);
  margin-bottom: var(--taxi-spacing-xs);
}

.taxi-group-body {
  display: flex;
  flex-direction: column;
  gap: var(--taxi-spacing-xs);
}

.taxi-group.horizontal .taxi-group-body {
  flex-direction: row;
  flex-wrap: wrap;
  gap: var(--taxi-spacing-md);
}

.taxi-decoration-text {
  font-size: var(--taxi-font-size);
  color: var(--taxi-text-primary);
}
</style>
