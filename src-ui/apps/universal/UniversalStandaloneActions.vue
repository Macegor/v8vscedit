<script setup lang="ts">
import { MessageBus } from '@ui-shared/api/messageBus';
import type { StandaloneServerStatusDto } from './main';

defineProps<{
  status: StandaloneServerStatusDto;
  messageBus: MessageBus;
}>();

function stateLabel(state: StandaloneServerStatusDto['state']): string {
  switch (state) {
    case 'running':
      return 'запущен';
    case 'unresponsive':
      return 'нет HTTP';
    case 'busy':
      return 'операция';
    case 'stale':
      return 'pid устарел';
    case 'stopped':
      return 'остановлен';
    case 'unconfigured':
      return 'не настроен';
    default:
      return state;
  }
}

function canStop(state: StandaloneServerStatusDto['state']): boolean {
  return state === 'running' || state === 'unresponsive' || state === 'stale';
}
</script>

<template>
  <section class="standalone" aria-label="Автономный сервер">
    <div class="standalone-header">
      <span class="standalone-title">Автономный сервер</span>
      <span class="standalone-state" :class="status.state">
        {{ stateLabel(status.state) }}
      </span>
    </div>
    <button
      v-if="!status.configured"
      class="primary-action"
      type="button"
      @click="messageBus.send({ type: 'command', command: 'v8vscedit.standalone.configure' })"
    >
      Настроить автономный сервер
    </button>
    <div v-else class="standalone-actions">
      <button
        type="button"
        title="Запустить автономный сервер"
        aria-label="Запустить автономный сервер"
        :disabled="status.state === 'running' || status.state === 'busy'"
        @click="messageBus.send({ type: 'command', command: 'v8vscedit.standalone.start' })"
      >
        <span class="codicon codicon-play" aria-hidden="true" />
      </button>
      <button
        type="button"
        title="Перезапустить автономный сервер"
        aria-label="Перезапустить автономный сервер"
        :disabled="status.state === 'busy'"
        @click="messageBus.send({ type: 'command', command: 'v8vscedit.standalone.restart' })"
      >
        <span class="codicon codicon-refresh" aria-hidden="true" />
      </button>
      <button
        type="button"
        title="Остановить автономный сервер"
        aria-label="Остановить автономный сервер"
        :disabled="!canStop(status.state)"
        @click="messageBus.send({ type: 'command', command: 'v8vscedit.standalone.stop' })"
      >
        <span class="codicon codicon-debug-stop" aria-hidden="true" />
      </button>
      <button
        type="button"
        title="Открыть веб-клиент"
        aria-label="Открыть веб-клиент"
        :disabled="status.state === 'busy'"
        @click="messageBus.send({ type: 'command', command: 'v8vscedit.standalone.openWebClient' })"
      >
        <span class="codicon codicon-browser" aria-hidden="true" />
      </button>
      <button
        type="button"
        title="Открыть лог автономного сервера"
        aria-label="Открыть лог автономного сервера"
        @click="messageBus.send({ type: 'command', command: 'v8vscedit.standalone.showLog' })"
      >
        <span class="codicon codicon-output" aria-hidden="true" />
      </button>
      <button
        type="button"
        title="Настройки автономного сервера"
        aria-label="Настройки автономного сервера"
        @click="messageBus.send({ type: 'command', command: 'v8vscedit.standalone.configure' })"
      >
        <span class="codicon codicon-settings-gear" aria-hidden="true" />
      </button>
    </div>
  </section>
</template>

<style scoped>
.standalone {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 7px 0;
  margin-top: 7px;
  border-top: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border));
  border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border));
}
.standalone-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 7px;
  min-height: 18px;
}
.standalone-title {
  min-width: 0;
  font-weight: 600;
  color: var(--vscode-sideBarTitle-foreground, var(--vscode-foreground));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.standalone-state {
  flex: 0 0 auto;
  color: var(--vscode-descriptionForeground);
  font-size: 11px;
}
.standalone-state.running {
  color: var(--vscode-testing-iconPassed, var(--vscode-descriptionForeground));
}
.standalone-state.stale,
.standalone-state.unresponsive {
  color: var(--vscode-inputValidation-warningForeground, var(--vscode-descriptionForeground));
}
.standalone-state.busy {
  color: var(--vscode-progressBar-background, var(--vscode-descriptionForeground));
}
.standalone-actions {
  display: flex;
  align-items: center;
  gap: 3px;
}
button {
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid transparent;
  color: var(--vscode-icon-foreground);
  background: transparent;
  border-radius: 4px;
  font: inherit;
  cursor: pointer;
}
button:hover {
  background: var(--vscode-toolbar-hoverBackground);
  outline: 1px solid var(--vscode-toolbar-hoverOutline, transparent);
}
button:disabled {
  cursor: default;
  opacity: .5;
}
.primary-action {
  width: 100%;
  height: auto;
  min-height: 30px;
  padding: 5px 10px;
  color: var(--vscode-button-foreground);
  background: var(--vscode-button-background);
  border-color: var(--vscode-button-border, transparent);
  justify-content: center;
}
.primary-action:hover {
  background: var(--vscode-button-hoverBackground);
}
</style>
