<script setup lang="ts">
import type { FormAttributeDto, FormCommandDto } from '../main';

defineProps<{
  attributes: FormAttributeDto[];
  commands: FormCommandDto[];
}>();
</script>

<template>
  <div class="data-panel">
    <!-- Реквизиты -->
    <div class="data-section">
      <div class="panel-header">Реквизиты</div>
      <div v-for="attr in attributes" :key="attr.id" class="data-row">
        <span class="data-icon codicon codicon-symbol-field"></span>
        <span class="data-name">{{ attr.name }}</span>
        <span class="data-type">{{ attr.valueType }}</span>
      </div>
      <div v-if="!attributes.length" class="panel-empty">Нет реквизитов</div>
    </div>

    <!-- Команды -->
    <div class="data-section">
      <div class="panel-header">Команды</div>
      <div v-for="cmd in commands" :key="cmd.id" class="data-row">
        <span class="data-icon codicon codicon-symbol-event"></span>
        <span class="data-name">{{ cmd.title || cmd.name }}</span>
        <span class="data-type">{{ cmd.representation || '' }}</span>
      </div>
      <div v-if="!commands.length" class="panel-empty">Нет команд</div>
    </div>
  </div>
</template>

<style scoped>
.data-panel {
  display: flex;
  flex-direction: column;
}

.data-section {
  display: flex;
  flex-direction: column;
}

.panel-header {
  padding: 6px 12px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--vscode-descriptionForeground);
  border-bottom: 1px solid var(--vscode-panel-border);
  background: var(--vscode-sidebar-background);
}

.data-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 12px;
  font-size: 12px;
}

.data-icon {
  font-size: 14px;
  color: var(--vscode-descriptionForeground);
}

.data-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.data-type {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.panel-empty {
  padding: 12px;
  text-align: center;
  color: var(--vscode-descriptionForeground);
  font-size: 11px;
}
</style>
