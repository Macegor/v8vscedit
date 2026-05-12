<template>
  <div class="layout">
    <section>
      <div class="title">
        <span>Платформа и ibsrv</span>
      </div>
      <label>
        Платформа
        <select id="platform" v-model="platformPath" :disabled="saving">
          <option value="">Автоопределение из env.json</option>
          <option v-for="item in state.platforms" :key="item.executablePath" :value="item.executablePath">
            {{ item.label }}
          </option>
        </select>
      </label>
      <label>
        Путь к ibsrv
        <input id="ibsrvPath" v-model="ibsrvPath" type="text" autocomplete="off" spellcheck="false" placeholder="Авто: рядом с выбранной платформой" :disabled="saving">
      </label>
      <div id="dataPath" class="path">Данные сервера: {{ state.settings.dataPath }}</div>
    </section>

    <section>
      <div class="title">
        <span>Файловая база</span>
      </div>
      <label>
        Каталог базы
        <input id="databasePath" v-model="databasePath" type="text" autocomplete="off" spellcheck="false" :disabled="saving">
      </label>
    </section>

    <section>
      <div class="title">
        <span>HTTP-публикация</span>
      </div>
      <div class="grid">
        <label>
          Адрес
          <input id="httpAddress" v-model="httpAddress" type="text" autocomplete="off" spellcheck="false" :disabled="saving">
        </label>
        <label>
          Порт
          <input id="httpPort" v-model.number="httpPort" type="number" min="1" max="65535" step="1" :disabled="saving">
        </label>
      </div>
      <label>
        Базовый путь
        <input id="httpBase" v-model="httpBase" type="text" autocomplete="off" spellcheck="false" :disabled="saving">
      </label>
      <label>
        Имя базы
        <input id="name" v-model="name" type="text" autocomplete="off" spellcheck="false" :disabled="saving">
      </label>
    </section>

    <section>
      <div class="title">
        <span>Режимы</span>
      </div>
      <label>
        Выдача клиентских лицензий
        <select id="distributeLicenses" v-model="distributeLicenses" :disabled="saving">
          <option value="allow">Разрешена</option>
          <option value="deny">Запрещена</option>
        </select>
      </label>
      <label>
        Регламентные задания
        <select id="scheduleJobs" v-model="scheduleJobs" :disabled="saving">
          <option value="allow">Разрешены</option>
          <option value="deny">Запрещены</option>
        </select>
      </label>
    </section>

    <div id="warnings">
      <div v-for="warning in state.warnings" :key="warning" class="warning">{{ warning }}</div>
    </div>
    <div id="status" class="status" :class="[statusVisible ? 'visible' : '', statusKind]" aria-live="polite">{{ statusMessage }}</div>
    <div class="buttons">
      <button id="save" class="primary" type="button" :disabled="saving" @click="save">{{ saving ? 'Сохранение...' : 'Сохранить' }}</button>
      <button id="refresh" class="secondary" type="button" :disabled="saving" @click="refresh">Обновить</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { getVscodeApi } from '@ui-shared/api/vscodeApi';
import { loadInitialState } from '@ui-shared/api/loadInitialState';
import type { HostToUiMessage } from '@ui-shared/protocol/hostMessages';
import type {
  StandaloneServerSettingsSnapshot,
  StandaloneServerSwitch,
  StandaloneServerUiMessage,
} from '@ui-shared/types/standalone';

const vscode = getVscodeApi();
const initialState = loadInitialState<StandaloneServerSettingsSnapshot>('standalone');
if (!initialState) {
  throw new Error('Начальное состояние автономного сервера не передано');
}

const state = ref<StandaloneServerSettingsSnapshot>(initialState);
const ibsrvPath = ref('');
const platformPath = ref('');
const databasePath = ref('');
const httpAddress = ref('');
const httpPort = ref(8314);
const httpBase = ref('/');
const name = ref('v8vscedit');
const distributeLicenses = ref<StandaloneServerSwitch>('allow');
const scheduleJobs = ref<StandaloneServerSwitch>('allow');
const saving = ref(false);
const statusKind = ref<'idle' | 'success' | 'error'>('idle');
const statusMessage = ref('');

const statusVisible = computed(() => statusMessage.value.length > 0);

applyState(initialState);

function save(): void {
  if (saving.value) {
    return;
  }
  saving.value = true;
  statusKind.value = 'idle';
  statusMessage.value = 'Сохраняю настройки автономного сервера...';
  postMessage({
    type: 'save',
    ibsrvPath: ibsrvPath.value,
    platformPath: platformPath.value,
    databasePath: databasePath.value,
    httpAddress: httpAddress.value,
    httpPort: Number(httpPort.value),
    httpBase: httpBase.value,
    name: name.value,
    distributeLicenses: distributeLicenses.value,
    scheduleJobs: scheduleJobs.value,
  });
}

function refresh(): void {
  if (saving.value) {
    return;
  }
  postMessage({ type: 'refresh' });
}

function applyState(nextState: StandaloneServerSettingsSnapshot): void {
  state.value = nextState;
  ibsrvPath.value = nextState.settings.ibsrvPath || '';
  platformPath.value = nextState.settings.platformPath || '';
  databasePath.value = nextState.settings.databasePath || '';
  httpAddress.value = nextState.settings.httpAddress || 'localhost';
  httpPort.value = nextState.settings.httpPort || 8314;
  httpBase.value = nextState.settings.httpBase || '/';
  name.value = nextState.settings.name || 'v8vscedit';
  distributeLicenses.value = nextState.settings.distributeLicenses || 'allow';
  scheduleJobs.value = nextState.settings.scheduleJobs || 'allow';
}

function setStatus(kind: 'idle' | 'success' | 'error', message: string): void {
  saving.value = false;
  statusKind.value = kind;
  statusMessage.value = message;
}

function postMessage(message: StandaloneServerUiMessage): void {
  vscode.postMessage(message);
}

window.addEventListener('message', (event: MessageEvent<HostToUiMessage<StandaloneServerSettingsSnapshot>>) => {
  const message = event.data;
  if (message.type === 'state' || message.type === 'init') {
    applyState(message.state);
  } else if (message.type === 'status') {
    setStatus(message.kind === 'loading' ? 'idle' : message.kind, message.message);
  } else if (message.type === 'error') {
    setStatus('error', message.message);
  }
});
</script>

<style>
body {
  box-sizing: border-box;
  padding: 10px 12px 12px;
  margin: 0;
  color: var(--vscode-foreground);
  background: var(--vscode-sideBar-background);
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
}

.layout {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

section {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding-bottom: 11px;
  border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border));
}

section:last-of-type {
  border-bottom: 0;
  padding-bottom: 0;
}

.title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 18px;
  font-weight: 600;
  color: var(--vscode-sideBarTitle-foreground, var(--vscode-foreground));
}

label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--vscode-descriptionForeground);
}

input,
select {
  width: 100%;
  min-height: 28px;
  box-sizing: border-box;
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, transparent);
  border-radius: 4px;
  font: inherit;
  outline: none;
}

input {
  padding: 3px 7px;
}

select {
  padding: 3px 6px;
}

input:focus,
select:focus {
  border-color: var(--vscode-focusBorder);
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: -1px;
}

.grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 92px;
  gap: 7px;
  align-items: end;
}

.path,
.warning,
.status {
  color: var(--vscode-descriptionForeground);
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.warning {
  color: var(--vscode-inputValidation-warningForeground, var(--vscode-descriptionForeground));
}

.status {
  display: none;
  min-height: 22px;
}

.status.visible {
  display: block;
}

.status.success {
  color: var(--vscode-testing-iconPassed, var(--vscode-descriptionForeground));
}

.status.error {
  color: var(--vscode-inputValidation-errorForeground, var(--vscode-errorForeground));
}

.buttons {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 6px;
}

button {
  min-height: 30px;
  padding: 5px 10px;
  border: 1px solid var(--vscode-button-border, transparent);
  border-radius: 4px;
  font: inherit;
  cursor: pointer;
}

.primary {
  color: var(--vscode-button-foreground);
  background: var(--vscode-button-background);
}

.primary:hover {
  background: var(--vscode-button-hoverBackground);
}

.secondary {
  color: var(--vscode-button-secondaryForeground);
  background: var(--vscode-button-secondaryBackground);
}

.secondary:hover {
  background: var(--vscode-button-secondaryHoverBackground);
}

button:disabled,
input:disabled,
select:disabled {
  cursor: default;
  opacity: 0.65;
}
</style>

