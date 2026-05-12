<script setup lang="ts">
import type { FormPreviewViewModel } from '../../../apps/form-editor/preview-core/types/FormPreviewViewModel';
import TaxiFormRoot from './TaxiFormRoot.vue';

defineProps<{
  viewModel: FormPreviewViewModel;
}>();
</script>

<template>
  <div class="taxi-form-window">
    <TaxiFormRoot :element="viewModel.root" />
  </div>
</template>

<style scoped>
.taxi-form-window {
  background: var(--taxi-bg-primary);
  font-family: var(--taxi-font-family);
  font-size: var(--taxi-font-size);
  color: var(--taxi-text-primary);
  min-height: 100%;
  display: flex;
  flex-direction: column;
}
</style>
