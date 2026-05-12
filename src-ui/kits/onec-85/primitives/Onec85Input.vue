<script setup lang="ts">
defineProps<{
  modelValue?: string;
  placeholder?: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();
</script>

<template>
  <input
    class="onec85-input"
    type="text"
    :value="modelValue"
    :placeholder="placeholder"
    :disabled="disabled"
    @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
  />
</template>

<style scoped>
.onec85-input {
  background: var(--onec85-input-bg);
  color: var(--onec85-text-primary);
  border: 1px solid var(--onec85-input-border);
  border-radius: 1px;
  padding: 3px 6px;
  font-family: var(--onec85-font-family);
  font-size: var(--onec85-font-size);
  width: 100%;
  box-sizing: border-box;
}

.onec85-input:focus {
  outline: none;
  border-color: var(--onec85-border-focus);
}
</style>
