<script setup lang="ts">
import { MessageBus } from '@ui-shared/api/messageBus';

const props = defineProps<{
  properties: Record<string, unknown>;
  locked: boolean;
  messageBus: MessageBus;
}>();
</script>

<template>
  <div class="properties-tab">
    <div v-for="(value, key) in properties" :key="key" class="property-row">
      <span class="property-key">{{ key }}</span>
      <span class="property-value">{{ String(value) }}</span>
    </div>
    <div v-if="!Object.keys(properties).length" class="empty-state">
      Нет свойств для отображения
    </div>
  </div>
</template>

<style scoped>
.properties-tab {
  padding: 8px 12px;
}

.property-row {
  display: flex;
  gap: 12px;
  padding: 4px 0;
  font-size: 12px;
}

.property-key {
  color: var(--vscode-descriptionForeground);
  min-width: 140px;
  flex-shrink: 0;
}

.property-value {
  color: var(--vscode-foreground);
}
</style>
