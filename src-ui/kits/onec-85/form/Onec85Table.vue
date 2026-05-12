<script setup lang="ts">
import type { FormPreviewElement } from '../../../apps/form-editor/preview-core/types/FormPreviewElement';

defineProps<{
  element: FormPreviewElement;
}>();
</script>

<template>
  <div v-if="element.visible" class="onec85-table-section">
    <div v-if="element.title" class="onec85-table-title">{{ element.title }}</div>
    <table class="onec85-table">
      <thead>
        <tr>
          <th v-for="col in element.children" :key="col.id">{{ col.title || col.name }}</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td v-for="col in element.children" :key="col.id" class="onec85-td">...</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.onec85-table-section {
  border: 1px solid var(--onec85-border);
  overflow: hidden;
}

.onec85-table-title {
  padding: var(--onec85-spacing-xs) var(--onec85-spacing-sm);
  font-weight: var(--onec85-font-weight-bold);
  background: var(--onec85-header-bg);
  color: var(--onec85-header-text);
  border-bottom: 1px solid var(--onec85-border);
}

.onec85-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--onec85-font-size);
}

.onec85-table th {
  text-align: left;
  padding: var(--onec85-spacing-xs) var(--onec85-spacing-sm);
  background: var(--onec85-header-bg);
  color: var(--onec85-header-text);
  border-bottom: 1px solid var(--onec85-border);
  font-weight: var(--onec85-font-weight-bold);
}

.onec85-td {
  padding: var(--onec85-spacing-xs) var(--onec85-spacing-sm);
  border-bottom: 1px solid var(--onec85-border);
  color: var(--onec85-text-secondary);
}
</style>
