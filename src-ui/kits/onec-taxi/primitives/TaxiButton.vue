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
  <button class="taxi-button" :disabled="disabled" @click="emit('click')">
    <slot />
    {{ label }}
  </button>
</template>

<style scoped>
.taxi-button {
  background: var(--taxi-button-bg);
  color: var(--taxi-text-primary);
  border: 1px solid var(--taxi-border);
  border-radius: 3px;
  padding: 4px 12px;
  font-family: var(--taxi-font-family);
  font-size: var(--taxi-font-size);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}

.taxi-button:hover:not(:disabled) {
  background: var(--taxi-button-hover);
}

.taxi-button:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
