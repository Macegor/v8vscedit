<script setup lang="ts">
defineProps<{
  type: string;
}>();
</script>

<template>
  <div class="taxi-unknown-element">
    <span class="unknown-badge">{{ type }}</span>
  </div>
</template>

<style scoped>
.taxi-unknown-element {
  padding: 4px 8px;
  background: var(--taxi-bg-primary);
  border: 1px dashed var(--taxi-border);
  border-radius: 2px;
}

.unknown-badge {
  font-size: var(--taxi-font-size-sm);
  color: var(--taxi-text-secondary);
  font-style: italic;
}
</style>
