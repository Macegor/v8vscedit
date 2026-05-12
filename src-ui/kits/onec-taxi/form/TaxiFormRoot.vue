<script setup lang="ts">
import type { FormPreviewElement } from '../../../apps/form-editor/preview-core/types/FormPreviewElement';
import TaxiUsualGroup from './TaxiUsualGroup.vue';
import TaxiPages from './TaxiPages.vue';
import TaxiTable from './TaxiTable.vue';
import TaxiField from './TaxiField.vue';
import TaxiCommandBar from './TaxiCommandBar.vue';
import TaxiDecoration from './TaxiDecoration.vue';

defineProps<{
  element: FormPreviewElement;
}>();
</script>

<template>
  <div class="taxi-form-root">
    <template v-for="child in element.children" :key="child.id">
      <TaxiCommandBar v-if="child.type === 'CommandBar'" :element="child" />
      <TaxiUsualGroup v-else-if="child.type === 'UsualGroup'" :element="child" />
      <TaxiPages v-else-if="child.type === 'Pages'" :element="child" />
      <TaxiTable v-else-if="child.type === 'Table'" :element="child" />
      <TaxiField v-else-if="['InputField','LabelField','CheckBoxField','RadioButtonField'].includes(child.type)" :element="child" />
      <TaxiDecoration v-else-if="child.type === 'LabelDecoration'" :element="child" />
      <div v-else class="taxi-unknown">{{ child.type }}</div>
    </template>
  </div>
</template>

<style scoped>
.taxi-form-root {
  padding: var(--taxi-spacing-md);
  display: flex;
  flex-direction: column;
  gap: var(--taxi-spacing-sm);
}

.taxi-unknown {
  color: var(--taxi-text-secondary);
  font-size: var(--taxi-font-size-sm);
  font-style: italic;
}
</style>
