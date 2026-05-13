<template>
  <div class="layout">
    <section>
      <div class="title">
        <span>Платформа 1С</span>
        <vscode-badge id="platformCount">{{ platformCount }}</vscode-badge>
      </div>
      <label>
        Версия
        <vscode-single-select id="platform" :value="platformPath" :disabled="isDisabled" @change="(e: Event) => platformPath = (e.target as HTMLSelectElement).value">
          <vscode-option value="">Автоопределение</vscode-option>
          <vscode-option v-for="item in state.platforms" :key="item.executablePath" :value="item.executablePath">
            {{ item.label }}
          </vscode-option>
        </vscode-single-select>
      </label>
      <div id="platformPath" class="path">{{ platformDetails }}</div>
    </section>

    <section>
      <div class="title">
        <span>Информационная база</span>
        <vscode-badge id="baseCount">{{ baseCount }}</vscode-badge>
      </div>
      <label>
        База
        <vscode-single-select id="base" :value="baseId" :disabled="isDisabled || state.bases.length === 0" @change="(e: Event) => baseId = (e.target as HTMLSelectElement).value">
          <vscode-option v-for="item in state.bases" :key="item.id" :value="item.id">
            {{ item.name }}
          </vscode-option>
        </vscode-single-select>
      </label>
      <div id="baseDetails" class="details">
        <template v-if="selectedBase?.kind === 'file'">
          <strong>Файловая:</strong> {{ selectedBase.filePath || '' }}
        </template>
        <template v-else-if="selectedBase?.kind === 'server'">
          <strong>Серверная:</strong> {{ `${selectedBase.server || ''}/${selectedBase.ref || ''}` }}
        </template>
        <template v-else>{{ baseDetails }}</template>
      </div>
    </section>

    <section>
      <label>
        Пользователь
        <vscode-textfield id="dbUser" :value="dbUser" autocomplete="off" spellcheck="false" :disabled="isDisabled" @input="(e: Event) => dbUser = (e.target as HTMLInputElement).value" />
      </label>
      <label>
        Пароль
        <input id="dbPassword" v-model="dbPassword" type="password" autocomplete="off" spellcheck="false" :disabled="isDisabled">
      </label>
    </section>

    <div id="warnings">
      <div v-for="warning in state.warnings" :key="warning" class="warning">{{ warning }}</div>
    </div>
    <div id="status" class="status" :class="[statusVisible ? 'visible' : '', status.kind]" aria-live="polite">
      <vscode-progress-ring v-if="status.kind === 'loading'" id="spinner" />
      <span id="statusText">{{ statusText }}</span>
    </div>
    <div class="buttons">
      <vscode-button id="save" :disabled="isDisabled" @click="save">{{ saving ? 'Сохранение...' : 'Сохранить' }}</vscode-button>
      <vscode-button id="refresh" appearance="secondary" :disabled="isDisabled" @click="refresh">Обновить</vscode-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { getVscodeApi } from '@ui-shared/api/vscodeApi';
import { loadInitialState } from '@ui-shared/api/loadInitialState';
import type { HostToUiMessage, HostStatusKind } from '@ui-shared/protocol/hostMessages';
import type { ProjectEnvironmentSnapshot, ProjectEnvironmentUiMessage } from '@ui-shared/types/environment';

const vscode = getVscodeApi();
const initialState = loadInitialState<ProjectEnvironmentSnapshot>('environment');
if (!initialState) {
  throw new Error('Начальное состояние настроек проекта не передано');
}

const state = ref<ProjectEnvironmentSnapshot>(initialState);
const platformPath = ref(state.value.settings.platformPath || '');
const baseId = ref(findSelectedBaseId(state.value));
const dbUser = ref(state.value.settings.dbUser || '');
const dbPassword = ref(state.value.settings.dbPassword || '');
const saving = ref(false);
const loading = ref(false);
const status = reactive<{ kind: HostStatusKind; message: string }>({ kind: 'loading', message: 'Загружаю списки баз и платформ...' });

const platformCount = computed(() => state.value.platforms.length ? String(state.value.platforms.length) : '0');
const baseCount = computed(() => state.value.bases.length ? String(state.value.bases.length) : '0');
const isDisabled = computed(() => saving.value || loading.value);
const statusVisible = computed(() => status.kind !== 'idle' && status.message.length > 0);
const statusText = computed(() => statusVisible.value ? status.message : '');
const selectedBase = computed(() => state.value.bases.find((item) => item.id === baseId.value));
const platformDetails = computed(() => {
  const selectedPlatform = state.value.platforms.find((item) => item.executablePath === platformPath.value);
  return platformPath.value
    ? selectedPlatform?.executablePath || platformPath.value
    : 'Путь будет найден автоматически при запуске.';
});
const baseDetails = computed(() => selectedBase.value?.connection || 'Системный список баз 1С пуст.');

function updateDetails(): void {
  // v-model уже обновил состояние; computed-поля пересчитаются автоматически.
}

function save(): void {
  if (saving.value || loading.value) {
    return;
  }
  saving.value = true;
  loading.value = false;
  setStatus('loading', 'Сохраняю настройки проекта...');
  postMessage({
    type: 'save',
    platformPath: platformPath.value,
    baseId: baseId.value,
    dbUser: dbUser.value,
    dbPassword: dbPassword.value,
  });
}

function refresh(): void {
  if (saving.value || loading.value) {
    return;
  }
  postMessage({ type: 'refresh' });
}

function applyState(nextState: ProjectEnvironmentSnapshot): void {
  state.value = nextState;
  platformPath.value = nextState.settings.platformPath || '';
  baseId.value = findSelectedBaseId(nextState);
  dbUser.value = nextState.settings.dbUser || '';
  dbPassword.value = nextState.settings.dbPassword || '';
}

function setStatus(kind: HostStatusKind, message: string): void {
  status.kind = kind;
  status.message = message;
  loading.value = kind === 'loading' && !saving.value;
  if (kind !== 'loading') {
    saving.value = false;
  }
}

function findSelectedBaseId(snapshot: ProjectEnvironmentSnapshot): string {
  const byConnection = snapshot.bases.find((item) => item.connection === snapshot.settings.ibConnection);
  return byConnection?.id || snapshot.bases[0]?.id || '';
}

function postMessage(message: ProjectEnvironmentUiMessage): void {
  vscode.postMessage(message);
}

window.addEventListener('message', (event: MessageEvent<HostToUiMessage<ProjectEnvironmentSnapshot>>) => {
  const message = event.data;
  if (message.type === 'state' || message.type === 'init') {
    applyState(message.state);
  } else if (message.type === 'status') {
    setStatus(message.kind, message.message);
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

.details,
.path,
.empty,
.warning {
  color: var(--vscode-descriptionForeground);
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.details strong {
  color: var(--vscode-foreground);
  font-weight: 600;
}

.warning {
  color: var(--vscode-inputValidation-warningForeground, var(--vscode-descriptionForeground));
}

.status {
  display: none;
  align-items: center;
  gap: 8px;
  min-height: 24px;
  color: var(--vscode-descriptionForeground);
  line-height: 1.35;
}

.status.visible {
  display: flex;
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
