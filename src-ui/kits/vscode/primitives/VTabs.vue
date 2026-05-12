<template>
  <div class="vscode-kit-tabs" role="tablist">
    <slot />
  </div>
</template>

<script setup lang="ts">
/**
 * Контейнер вкладок (tablist). Управляет активной вкладкой через v-model.
 * Слот ожидает VTab.
 */
const props = withDefaults(defineProps<{
  modelValue: string;
}>(), {
  modelValue: '',
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

function select(id: string): void {
  emit('update:modelValue', id);
}

defineExpose({ select });
</script>

<style scoped>
.vscode-kit-tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--vscode-kit-panelBorder);
  background: var(--vscode-kit-tabInactiveBackground);
  user-select: none;
}
</style>
