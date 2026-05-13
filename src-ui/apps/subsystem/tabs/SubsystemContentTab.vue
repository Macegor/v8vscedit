<script setup lang="ts">
import type { SubsystemContentItemDto } from '../main';

defineProps<{
  items: SubsystemContentItemDto[];
  locked: boolean;
}>();

const emit = defineEmits<{
  toggle: [item: SubsystemContentItemDto];
}>();
</script>

<template>
  <div class="content-tab">
    <div v-for="item in items" :key="item.id" class="content-row">
      <vscode-checkbox
        :checked="item.included"
        :disabled="locked"
        @change="emit('toggle', item)"
      >
        {{ item.label }}
      </vscode-checkbox>
      <span v-if="item.kind" class="content-kind">{{ item.kind }}</span>
    </div>
    <div v-if="!items.length" class="empty-state">
      Состав подсистемы пуст
    </div>
  </div>
</template>

<style scoped>
.content-tab {
  padding: 4px 12px;
}

.content-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}

.content-kind {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
}

.empty-state {
  padding: 24px;
  text-align: center;
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
}
</style>
