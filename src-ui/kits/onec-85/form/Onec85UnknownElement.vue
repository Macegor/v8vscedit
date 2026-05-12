<script setup lang="ts">
defineProps<{
  type: string;
}>();
</script>

<template>
  <div class="onec85-unknown-element">
    <span class="unknown-badge">{{ type }}</span>
  </div>
</template>

<style scoped>
.onec85-unknown-element {
  padding: 3px 6px;
  background: var(--onec85-bg-secondary);
  border: 1px dashed var(--onec85-border);
}

.unknown-badge {
  font-size: var(--onec85-font-size-sm);
  color: var(--onec85-text-secondary);
  font-style: italic;
}
</style>
