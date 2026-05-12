<script setup lang="ts">
import type { FormPreviewElement } from '../../../apps/form-editor/preview-core/types/FormPreviewElement';

defineProps<{
  element: FormPreviewElement;
}>();
</script>

<template>
  <div v-if="element.visible" class="onec85-field" :class="{ readonly: element.readOnly }">
    <label v-if="element.title" class="onec85-field-label">{{ element.title }}</label>
    <div class="onec85-field-control">
      <input
        v-if="element.type === 'InputField'"
        class="onec85-input-field"
        type="text"
        :placeholder="element.title"
        :readonly="element.readOnly"
        disabled
      />
      <label v-else-if="element.type === 'CheckBoxField'" class="onec85-checkbox-field">
        <input type="checkbox" :disabled="element.readOnly" />
        <span>{{ element.title || element.name }}</span>
      </label>
      <span v-else class="onec85-field-placeholder">{{ element.type }}</span>
    </div>
  </div>
</template>

<style scoped>
.onec85-field {
  display: flex;
  align-items: center;
  gap: var(--onec85-spacing-xs);
  min-height: 22px;
}

.onec85-field-label {
  font-size: var(--onec85-font-size);
  color: var(--onec85-text-secondary);
  min-width: 70px;
  flex-shrink: 0;
  text-align: right;
}

.onec85-field-control {
  flex: 1;
}

.onec85-input-field {
  width: 100%;
  background: var(--onec85-input-bg);
  border: 1px solid var(--onec85-input-border);
  border-radius: 1px;
  padding: 2px 6px;
  font-family: var(--onec85-font-family);
  font-size: var(--onec85-font-size);
  color: var(--onec85-text-primary);
}

.onec85-input-field:disabled {
  opacity: 0.6;
  background: var(--onec85-bg-secondary);
}

.onec85-checkbox-field {
  display: flex;
  align-items: center;
  gap: var(--onec85-spacing-xs);
  font-size: var(--onec85-font-size);
  cursor: pointer;
}

.onec85-field-placeholder {
  font-size: var(--onec85-font-size-sm);
  color: var(--onec85-text-secondary);
  font-style: italic;
}
</style>
