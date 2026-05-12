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
    class="taxi-input"
    type="text"
    :value="modelValue"
    :placeholder="placeholder"
    :disabled="disabled"
    @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
  />
</template>

<style scoped>
.taxi-input {
  background: var(--taxi-input-bg);
  color: var(--taxi-text-primary);
  border: 1px solid var(--taxi-input-border);
  border-radius: 2px;
  padding: 4px 8px;
  font-family: var(--taxi-font-family);
  font-size: var(--taxi-font-size);
  width: 100%;
  box-sizing: border-box;
}

.taxi-input:focus {
  outline: none;
  border-color: var(--taxi-border-focus);
}
</style>
