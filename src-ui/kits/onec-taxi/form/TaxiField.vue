<script setup lang="ts">
import type { FormPreviewElement } from '../../../apps/form-editor/preview-core/types/FormPreviewElement';

defineProps<{
  element: FormPreviewElement;
}>();
</script>

<template>
  <div v-if="element.visible" class="taxi-field" :class="{ readonly: element.readOnly }">
    <label v-if="element.title" class="taxi-field-label">{{ element.title }}</label>
    <div class="taxi-field-control">
      <input
        v-if="element.type === 'InputField'"
        class="taxi-input-field"
        type="text"
        :placeholder="element.title"
        :readonly="element.readOnly"
        disabled
      />
      <label v-else-if="element.type === 'CheckBoxField'" class="taxi-checkbox-field">
        <input type="checkbox" :disabled="element.readOnly" />
        <span>{{ element.title || element.name }}</span>
      </label>
      <span v-else class="taxi-field-placeholder">{{ element.type }}</span>
    </div>
  </div>
</template>

<style scoped>
.taxi-field {
  display: flex;
  align-items: center;
  gap: var(--taxi-spacing-sm);
  min-height: 28px;
}

.taxi-field-label {
  font-size: var(--taxi-font-size);
  color: var(--taxi-text-secondary);
  min-width: 80px;
  flex-shrink: 0;
  text-align: right;
}

.taxi-field-control {
  flex: 1;
}

.taxi-input-field {
  width: 100%;
  background: var(--taxi-input-bg);
  border: 1px solid var(--taxi-input-border);
  border-radius: 2px;
  padding: 4px 8px;
  font-family: var(--taxi-font-family);
  font-size: var(--taxi-font-size);
  color: var(--taxi-text-primary);
}

.taxi-input-field:disabled {
  opacity: 0.7;
  background: var(--taxi-bg-primary);
}

.taxi-checkbox-field {
  display: flex;
  align-items: center;
  gap: var(--taxi-spacing-xs);
  font-size: var(--taxi-font-size);
  cursor: pointer;
}

.taxi-field-placeholder {
  font-size: var(--taxi-font-size-sm);
  color: var(--taxi-text-secondary);
  font-style: italic;
}
</style>
