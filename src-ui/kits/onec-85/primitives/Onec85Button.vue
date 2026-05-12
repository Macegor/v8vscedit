<script setup lang="ts">
defineProps<{
  label?: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  click: [];
}>();
</script>

<template>
  <button class="onec85-button" :disabled="disabled" @click="emit('click')">
    <slot />
    {{ label }}
  </button>
</template>

<style scoped>
.onec85-button {
  background: var(--onec85-button-bg);
  color: var(--onec85-text-primary);
  border: 1px solid var(--onec85-border);
  border-radius: 2px;
  padding: 3px 10px;
  font-family: var(--onec85-font-family);
  font-size: var(--onec85-font-size);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  white-space: nowrap;
}

.onec85-button:hover:not(:disabled) {
  background: var(--onec85-button-hover);
}

.onec85-button:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
