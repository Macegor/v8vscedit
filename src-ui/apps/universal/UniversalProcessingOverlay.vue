<template>
  <div class="processing-overlay" role="progressbar" :aria-label="label">
    <div class="processing-panel">
      <vscode-progress-ring class="processing-ring" />
      <div class="processing-text">
        <div class="processing-title">{{ displayTitle }}</div>
        <div class="processing-message">{{ displayMessage }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  title?: string;
  message?: string;
}>();

const displayTitle = computed(() => props.title?.trim() || 'Операция с конфигурацией');
const displayMessage = computed(() => props.message?.trim() || 'Выполняется...');
const label = computed(() => `${displayTitle.value}: ${displayMessage.value}`);
</script>

<style scoped>
.processing-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.18);
  backdrop-filter: blur(3px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  z-index: 100;
}
.processing-panel {
  width: min(280px, 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 18px 16px 16px;
  color: var(--vscode-foreground);
  background: var(--vscode-sideBar-background);
  border: 1px solid var(--vscode-widget-border, var(--vscode-sideBar-border, transparent));
  border-radius: 8px;
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.32);
}
.processing-ring {
  align-self: center;
}
.processing-text {
  width: 100%;
  min-width: 0;
  text-align: center;
}
.processing-title {
  font-size: 17px;
  font-weight: 700;
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.processing-message {
  margin-top: 6px;
  color: var(--vscode-descriptionForeground);
  line-height: 1.35;
  overflow-wrap: anywhere;
}
</style>
