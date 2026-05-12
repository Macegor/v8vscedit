<script setup lang="ts">
import type { FormPreviewViewModel } from '../../../apps/form-editor/preview-core/types/FormPreviewViewModel';
import Onec85FormRoot from './Onec85FormRoot.vue';

defineProps<{
  viewModel: FormPreviewViewModel;
}>();
</script>

<template>
  <div class="onec85-form-window">
    <Onec85FormRoot :element="viewModel.root" />
  </div>
</template>

<style scoped>
.onec85-form-window {
  background: var(--onec85-bg-primary);
  font-family: var(--onec85-font-family);
  font-size: var(--onec85-font-size);
  color: var(--onec85-text-primary);
  min-height: 100%;
  display: flex;
  flex-direction: column;
}
</style>
