<script setup lang="ts">
defineProps<{
  message?: string;
}>();
</script>

<template>
  <div class="empty-view">
    <p class="empty-view__hint">
      {{ message ?? 'Откройте модуль или выберите объект конфигурации.' }}
    </p>
  </div>
</template>

<style scoped>
.empty-view {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  padding: 6px 0;
}

.empty-view__hint {
  margin: 0;
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
  text-align: center;
  line-height: 1.5;
}
</style>
