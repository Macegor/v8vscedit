<script setup lang="ts">
import type { FormElementDto } from '../main';
import FormElementTreeNode from './FormElementTreeNode.vue';

defineProps<{
  element: FormElementDto;
  selectedId?: number;
}>();

const emit = defineEmits<{
  select: [id: number];
}>();
</script>

<template>
  <div class="element-tree" role="tree">
    <FormElementTreeNode
      :element="element"
      :depth="0"
      :selected-id="selectedId"
      @select="emit('select', $event)"
    />
  </div>
</template>

<style scoped>
.element-tree {
  overflow-y: auto;
  padding: 4px 0;
}
</style>
