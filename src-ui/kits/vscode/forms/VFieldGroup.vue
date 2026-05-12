<template>
  <fieldset class="vscode-kit-field-group">
    <legend v-if="legend" class="vscode-kit-field-group__legend">{{ legend }}</legend>
    <div class="vscode-kit-field-group__body">
      <slot />
    </div>
  </fieldset>
</template>

<script setup lang="ts">
/** Группа полей (fieldset) с опциональным заголовком. */
withDefaults(defineProps<{
  legend?: string;
}>(), {
  legend: '',
});
</script>

<style scoped>
.vscode-kit-field-group {
  margin: 0;
  padding: 0;
  border: none;
  display: flex;
  flex-direction: column;
  gap: var(--vscode-kit-spacing-5);
}
.vscode-kit-field-group__legend {
  padding: 0;
  font-family: var(--vscode-kit-font-family);
  font-size: var(--vscode-kit-font-size);
  font-weight: var(--vscode-kit-font-weight-bold);
  line-height: var(--vscode-kit-line-height);
  color: var(--vscode-kit-foreground);
  margin-bottom: var(--vscode-kit-spacing-2);
}
</style>
