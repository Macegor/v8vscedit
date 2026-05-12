<script setup lang="ts">
import { MessageBus } from '@ui-shared/api/messageBus';
import type { StandaloneServerStatusDto } from './main';

defineProps<{
  status: StandaloneServerStatusDto;
  messageBus: MessageBus;
}>();
</script>

<template>
  <div v-if="status.state !== 'unconfigured'" class="standalone-actions">
    <div class="standalone-header">
      <span class="standalone-label">Автономный сервер</span>
      <span class="standalone-status" :class="status.state">
        {{ status.state === 'running' ? 'Работает' : status.state === 'stopped' ? 'Остановлен' : status.state }}
      </span>
    </div>
    <div class="standalone-buttons">
      <button
        v-if="status.state === 'stopped' || status.state === 'stale'"
        class="ss-button"
        @click="messageBus.send({ type: 'command', command: 'v8vscedit.startStandaloneServer' })"
        title="Запустить"
      >
        <span class="codicon codicon-play" />
      </button>
      <button
        v-if="status.state === 'running'"
        class="ss-button"
        @click="messageBus.send({ type: 'command', command: 'v8vscedit.stopStandaloneServer' })"
        title="Остановить"
      >
        <span class="codicon codicon-stop" />
      </button>
      <button
        class="ss-button"
        @click="messageBus.send({ type: 'command', command: 'v8vscedit.openStandaloneServerLog' })"
        title="Лог"
      >
        <span class="codicon codicon-output" />
      </button>
      <button
        v-if="status.state === 'running'"
        class="ss-button"
        @click="messageBus.send({ type: 'command', command: 'v8vscedit.openStandaloneServer' })"
        title="Открыть"
      >
        <span class="codicon codicon-browser" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.standalone-actions {
  padding: 8px;
  border-top: 1px solid var(--vscode-panel-border);
}
.standalone-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}
.standalone-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--vscode-descriptionForeground);
}
.standalone-status {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 2px;
}
.standalone-status.running {
  background: var(--vscode-testing-iconPassed);
  color: var(--vscode-editor-background);
}
.standalone-status.stopped {
  background: var(--vscode-testing-iconFailed);
  color: var(--vscode-editor-background);
}
.standalone-status.unresponsive,
.standalone-status.stale,
.standalone-status.busy {
  background: var(--vscode-testing-iconErrored);
  color: var(--vscode-editor-background);
}
.standalone-buttons {
  display: flex;
  gap: 4px;
}
.ss-button {
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
  border: none;
  border-radius: 2px;
  padding: 3px 6px;
  cursor: pointer;
  font-size: 14px;
  display: flex;
  align-items: center;
}
.ss-button:hover {
  background: var(--vscode-button-secondaryHoverBackground);
}
</style>
