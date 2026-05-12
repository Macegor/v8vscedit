<script setup lang="ts">
import type { FormPreviewElement } from '../../../apps/form-editor/preview-core/types/FormPreviewElement';

defineProps<{
  element: FormPreviewElement;
}>();
</script>

<template>
  <div v-if="element.visible" class="taxi-table-section">
    <div v-if="element.title" class="taxi-table-title">{{ element.title }}</div>
    <table class="taxi-table">
      <thead>
        <tr>
          <th v-for="col in element.children" :key="col.id">{{ col.title || col.name }}</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td v-for="col in element.children" :key="col.id" class="taxi-td">...</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.taxi-table-section {
  border: 1px solid var(--taxi-border);
  border-radius: 3px;
  overflow: hidden;
}

.taxi-table-title {
  padding: var(--taxi-spacing-xs) var(--taxi-spacing-sm);
  font-weight: var(--taxi-font-weight-bold);
  background: var(--taxi-bg-toolbar);
  border-bottom: 1px solid var(--taxi-border);
}

.taxi-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--taxi-font-size);
}

.taxi-table th {
  text-align: left;
  padding: var(--taxi-spacing-xs) var(--taxi-spacing-sm);
  background: var(--taxi-header-bg);
  border-bottom: 1px solid var(--taxi-border);
  font-weight: var(--taxi-font-weight-bold);
}

.taxi-td {
  padding: var(--taxi-spacing-xs) var(--taxi-spacing-sm);
  border-bottom: 1px solid var(--taxi-border);
  color: var(--taxi-text-secondary);
}
</style>
