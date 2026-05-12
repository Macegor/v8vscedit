<script setup lang="ts">
import type { FormPreviewElement } from '../../../apps/form-editor/preview-core/types/FormPreviewElement';
import Onec85UsualGroup from './Onec85UsualGroup.vue';
import Onec85Pages from './Onec85Pages.vue';
import Onec85Table from './Onec85Table.vue';
import Onec85Field from './Onec85Field.vue';
import Onec85CommandBar from './Onec85CommandBar.vue';
import Onec85Decoration from './Onec85Decoration.vue';

defineProps<{
  element: FormPreviewElement;
}>();
</script>

<template>
  <div class="onec85-form-root">
    <template v-for="child in element.children" :key="child.id">
      <Onec85CommandBar v-if="child.type === 'CommandBar'" :element="child" />
      <Onec85UsualGroup v-else-if="child.type === 'UsualGroup'" :element="child" />
      <Onec85Pages v-else-if="child.type === 'Pages'" :element="child" />
      <Onec85Table v-else-if="child.type === 'Table'" :element="child" />
      <Onec85Field v-else-if="['InputField','LabelField','CheckBoxField','RadioButtonField'].includes(child.type)" :element="child" />
      <Onec85Decoration v-else-if="child.type === 'LabelDecoration'" :element="child" />
      <div v-else class="onec85-unknown">{{ child.type }}</div>
    </template>
  </div>
</template>

<style scoped>
.onec85-form-root {
  padding: var(--onec85-spacing-md);
  display: flex;
  flex-direction: column;
  gap: var(--onec85-spacing-xs);
}

.onec85-unknown {
  color: var(--onec85-text-secondary);
  font-size: var(--onec85-font-size-sm);
  font-style: italic;
}
</style>
