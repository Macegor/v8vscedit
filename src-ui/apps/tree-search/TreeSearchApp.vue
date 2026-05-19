<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { MessageBus } from '@ui-shared/api/messageBus';
import type { HostToUiMessage } from '@ui-shared/protocol/hostMessages';
import type { TreeSearchState } from './main';

const props = defineProps<{
  initialState: TreeSearchState | null;
  messageBus: MessageBus;
}>();

const searchQuery = ref(props.initialState?.searchQuery ?? '');
const initialized = ref(props.initialState?.initialized ?? false);
const serverStatus = ref(props.initialState?.serverStatus ?? { state: 'unconfigured' as const });

let searchTimer: ReturnType<typeof setTimeout> | undefined;

function onSearchInput(value: string): void {
  searchQuery.value = value;
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    props.messageBus.send({ type: 'request', requestId: 'search', name: 'search', payload: value });
  }, 400);
}

function clearSearch(): void {
  searchQuery.value = '';
  props.messageBus.send({ type: 'command', command: 'v8vscedit.clearSearch' });
}

function executeCommand(command: string): void {
  props.messageBus.send({ type: 'command', command });
}

function handleHostMessage(msg: HostToUiMessage): void {
  if (msg.type === 'state') {
    const state = msg.state as Partial<TreeSearchState>;
    if (state.searchQuery !== undefined) searchQuery.value = state.searchQuery;
    if (state.initialized !== undefined) initialized.value = state.initialized;
    if (state.serverStatus) serverStatus.value = state.serverStatus as TreeSearchState['serverStatus'];
  }
}

onMounted(() => {
  props.messageBus.on('state', handleHostMessage);
});

onUnmounted(() => {
  props.messageBus.off('state', handleHostMessage);
});
</script>

<template>
  <div class="tree-search">
    <div class="search-section">
      <div class="search-input-wrapper">
        <span class="search-icon codicon codicon-search" aria-hidden="true"></span>
        <vscode-textfield
          class="search-input"
          :value="searchQuery"
          placeholder="Поиск по метаданным..."
          aria-label="Поиск по метаданным"
          @input="onSearchInput(($event.target as HTMLInputElement).value)"
          @keydown.escape="clearSearch"
        />
        <vscode-button
          v-if="searchQuery"
          appearance="icon"
          @click="clearSearch"
          aria-label="Очистить поиск"
          title="Очистить поиск"
        >
          <span class="codicon codicon-close"></span>
        </vscode-button>
      </div>
    </div>

    <template v-if="initialized">
      <div class="actions-section">
        <vscode-button @click="executeCommand('v8vscedit.decompileExtension')" title="Импорт конфигураций">
          <span class="codicon codicon-cloud-download"></span>
          <span class="action-label">Импорт</span>
        </vscode-button>
        <vscode-button @click="executeCommand('v8vscedit.runThinClient')" title="Запустить тонкий клиент">
          <span class="codicon codicon-play"></span>
          <span class="action-label">Тонкий клиент</span>
        </vscode-button>
        <vscode-button @click="executeCommand('v8vscedit.runConfigurator')" title="Запустить конфигуратор">
          <span class="codicon codicon-tools"></span>
          <span class="action-label">Конфигуратор</span>
        </vscode-button>
        <vscode-button @click="executeCommand('v8vscedit.environmentSettings')" title="Настройки проекта">
          <span class="codicon codicon-settings-gear"></span>
          <span class="action-label">Настройки</span>
        </vscode-button>
      </div>

      <div class="server-section" v-if="serverStatus.state !== 'unconfigured'">
        <div class="server-header">
          <span class="server-label">Автономный сервер</span>
          <span class="server-indicator" :class="serverStatus.state">
            {{ serverStatus.state === 'running' ? 'Работает' : serverStatus.state === 'stopped' ? 'Остановлен' : serverStatus.state }}
          </span>
        </div>
        <div class="server-actions">
          <vscode-button
            v-if="serverStatus.state === 'stopped' || serverStatus.state === 'stale'"
            appearance="secondary"
            @click="executeCommand('v8vscedit.startStandaloneServer')"
            title="Запустить"
          >
            <span class="codicon codicon-play"></span>
          </vscode-button>
          <vscode-button
            v-if="serverStatus.state === 'running'"
            appearance="secondary"
            @click="executeCommand('v8vscedit.stopStandaloneServer')"
            title="Остановить"
          >
            <span class="codicon codicon-stop"></span>
          </vscode-button>
          <vscode-button
            appearance="secondary"
            @click="executeCommand('v8vscedit.openStandaloneServerLog')"
            title="Лог"
          >
            <span class="codicon codicon-output"></span>
          </vscode-button>
          <vscode-button
            v-if="serverStatus.state === 'running'"
            appearance="secondary"
            @click="executeCommand('v8vscedit.openStandaloneServer')"
            title="Открыть в браузере"
          >
            <span class="codicon codicon-browser"></span>
          </vscode-button>
        </div>
      </div>
    </template>

    <div v-else class="uninitialized-message">
      <p>Проект не инициализирован. Откройте папку с XML-выгрузкой конфигурации 1С.</p>
    </div>
  </div>
</template>

<style scoped>
.tree-search {
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.search-section {
  width: 100%;
}

.search-input-wrapper {
  display: flex;
  align-items: center;
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, transparent);
  border-radius: 2px;
  padding: 0 4px;
}

.search-icon {
  font-size: 14px;
  color: var(--vscode-input-placeholderForeground);
  margin-right: 4px;
}

.search-input {
  flex: 1;
  border: none !important;
  background: transparent !important;
}

.actions-section {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.action-label {
  font-size: 12px;
}

.server-section {
  border-top: 1px solid var(--vscode-panel-border);
  padding-top: 8px;
}

.server-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.server-label {
  font-size: 12px;
  color: var(--vscode-foreground);
}

.server-indicator {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 2px;
}

.server-indicator.running {
  background: var(--vscode-testing-iconPassed);
  color: var(--vscode-editor-background);
}

.server-indicator.stopped {
  background: var(--vscode-testing-iconFailed);
  color: var(--vscode-editor-background);
}

.server-indicator.unresponsive,
.server-indicator.busy,
.server-indicator.stale {
  background: var(--vscode-testing-iconErrored);
  color: var(--vscode-editor-background);
}

.server-actions {
  display: flex;
  gap: 4px;
}

.uninitialized-message {
  padding: 12px;
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
  text-align: center;
}
</style>
