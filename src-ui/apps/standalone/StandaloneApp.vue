<template>
  <div class="layout">
    <section>
      <div class="title">
        <span>Платформа и ibsrv</span>
      </div>
      <label>
        Платформа
        <vscode-single-select id="platform" :value="platformPath" :disabled="saving" @change="(e: Event) => platformPath = (e.target as HTMLSelectElement).value">
          <vscode-option value="">Автоопределение из env.json</vscode-option>
          <vscode-option v-for="item in state.platforms" :key="item.executablePath" :value="item.executablePath">
            {{ item.label }}
          </vscode-option>
        </vscode-single-select>
      </label>
      <label>
        Путь к ibsrv
        <vscode-textfield id="ibsrvPath" :value="ibsrvPath" autocomplete="off" spellcheck="false" placeholder="Авто: рядом с выбранной платформой" :disabled="saving" @input="(e: Event) => ibsrvPath = (e.target as HTMLInputElement).value" />
      </label>
      <div id="dataPath" class="path">Данные сервера: {{ state.settings.dataPath }}</div>
    </section>

    <section>
      <div class="title">
        <span>Файловая база</span>
      </div>
      <label>
        Каталог базы
        <vscode-textfield id="databasePath" :value="databasePath" autocomplete="off" spellcheck="false" :disabled="saving" @input="(e: Event) => databasePath = (e.target as HTMLInputElement).value" />
      </label>
    </section>

    <section>
      <div class="title">
        <span>HTTP-публикация</span>
      </div>
      <div class="grid">
        <label>
          Адрес
          <vscode-textfield id="httpAddress" :value="httpAddress" autocomplete="off" spellcheck="false" :disabled="saving" @input="(e: Event) => httpAddress = (e.target as HTMLInputElement).value" />
        </label>
        <label>
          Порт
          <input id="httpPort" v-model.number="httpPort" type="number" min="1" max="65535" step="1" :disabled="saving">
        </label>
      </div>
      <label>
        Базовый путь
        <vscode-textfield id="httpBase" :value="httpBase" autocomplete="off" spellcheck="false" :disabled="saving" @input="(e: Event) => httpBase = (e.target as HTMLInputElement).value" />
      </label>
      <label>
        Имя базы
        <vscode-textfield id="name" :value="name" autocomplete="off" spellcheck="false" :disabled="saving" @input="(e: Event) => name = (e.target as HTMLInputElement).value" />
      </label>
    </section>

    <section>
      <div class="title">
        <span>Режимы</span>
      </div>
      <label>
        Выдача клиентских лицензий
        <vscode-single-select id="distributeLicenses" :value="distributeLicenses" :disabled="saving" @change="(e: Event) => distributeLicenses = (e.target as HTMLSelectElement).value as StandaloneServerSwitch">
          <vscode-option value="allow">Разрешена</vscode-option>
          <vscode-option value="deny">Запрещена</vscode-option>
        </vscode-single-select>
      </label>
      <label>
        Регламентные задания
        <vscode-single-select id="scheduleJobs" :value="scheduleJobs" :disabled="saving" @change="(e: Event) => scheduleJobs = (e.target as HTMLSelectElement).value as StandaloneServerSwitch">
          <vscode-option value="allow">Разрешены</vscode-option>
          <vscode-option value="deny">Запрещены</vscode-option>
        </vscode-single-select>
      </label>
    </section>

    <div id="warnings">
      <div v-for="warning in state.warnings" :key="warning" class="warning">{{ warning }}</div>
    </div>
    <div id="status" class="status" :class="[statusVisible ? 'visible' : '', statusKind]" aria-live="polite">{{ statusMessage }}</div>
    <div class="buttons">
      <vscode-button id="save" :disabled="saving" @click="save">{{ saving ? 'Сохранение...' : 'Сохранить' }}</vscode-button>
      <vscode-button id="refresh" appearance="secondary" :disabled="saving" @click="refresh">Обновить</vscode-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { MessageBus } from '@ui-shared/api/messageBus';
import type { HostToUiMessage } from '@ui-shared/protocol/hostMessages';
import type {
  StandaloneServerSettingsSnapshot,
  StandaloneServerSwitch,
  StandaloneServerUiMessage,
} from '@ui-shared/types/standalone';

const props = defineProps<{
  initialState: StandaloneServerSettingsSnapshot | null;
  messageBus: MessageBus;
}>();

if (!props.initialState) {
  throw new Error('Начальное состояние автономного сервера не передано');
}

const state = ref<StandaloneServerSettingsSnapshot>(props.initialState);
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

applyState(props.initialState);

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
  props.messageBus.send(message);
}

function handleHostMessage(message: HostToUiMessage<StandaloneServerSettingsSnapshot>): void {
  if (message.type === 'state' || message.type === 'init') {
    applyState(message.state);
  } else if (message.type === 'status') {
    setStatus(message.kind === 'loading' ? 'idle' : message.kind, message.message);
  } else if (message.type === 'error') {
    setStatus('error', message.message);
  }
}

onMounted(() => {
  props.messageBus.on('state', handleHostMessage);
  props.messageBus.on('init', handleHostMessage);
  props.messageBus.on('status', handleHostMessage);
  props.messageBus.on('error', handleHostMessage);
});

onUnmounted(() => {
  props.messageBus.off('state', handleHostMessage);
  props.messageBus.off('init', handleHostMessage);
  props.messageBus.off('status', handleHostMessage);
  props.messageBus.off('error', handleHostMessage);
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

vscode-single-select,
input {
  width: 100%;
  min-height: 28px;
  box-sizing: border-box;
  font: inherit;
}

input {
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, transparent);
  border-radius: 4px;
  padding: 3px 7px;
  outline: none;
}

input:focus {
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

input:disabled {
  cursor: default;
  opacity: 0.65;
}
</style>
