<script setup lang="ts">
import { MessageBus } from '@ui-shared/api/messageBus';
import type { SubsystemChildDto } from '../main';

const props = defineProps<{
  children: SubsystemChildDto[];
  locked: boolean;
  messageBus: MessageBus;
}>();

function openChild(child: SubsystemChildDto): void {
  props.messageBus.send({
    type: 'command',
    command: 'openChild',
    payload: { id: child.id },
  });
}
</script>

<template>
  <div class="children-tab">
    <div v-for="child in children" :key="child.id" class="child-row">
      <span class="child-icon codicon codicon-symbol-folder" aria-hidden="true"></span>
      <span class="child-name">{{ child.label }}</span>
      <button
        v-if="!locked"
        class="child-open-button"
        @click="openChild(child)"
        title="Открыть подсистему"
      >
        <span class="codicon codicon-arrow-right"></span>
      </button>
    </div>
    <div v-if="!children.length" class="empty-state">
      Нет дочерних подсистем
    </div>
  </div>
</template>

<style scoped>
.children-tab {
  padding: 4px 12px;
}

.child-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  font-size: 12px;
}

.child-icon {
  color: var(--vscode-symbolIcon-folderForeground);
}

.child-name {
  flex: 1;
  color: var(--vscode-foreground);
}

.child-open-button {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--vscode-textLink-foreground);
  padding: 2px;
  display: flex;
  align-items: center;
}

.child-open-button:hover {
  color: var(--vscode-textLink-activeForeground);
}
</style>
