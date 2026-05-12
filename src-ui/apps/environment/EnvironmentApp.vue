<template>
  <div class="layout">
    <section>
      <div class="title">
        <span>Платформа 1С</span>
        <span id="platformCount" class="count">{{ platformCount }}</span>
      </div>
      <label>
        Версия
        <select id="platform" v-model="platformPath" :disabled="isDisabled" @change="updateDetails">
          <option value="">Автоопределение</option>
          <option v-for="item in state.platforms" :key="item.executablePath" :value="item.executablePath">
            {{ item.label }}
          </option>
        </select>
      </label>
      <div id="platformPath" class="path">{{ platformDetails }}</div>
    </section>

    <section>
      <div class="title">
        <span>Информационная база</span>
        <span id="baseCount" class="count">{{ baseCount }}</span>
      </div>
      <label>
        База
        <select id="base" v-model="baseId" :disabled="isDisabled || state.bases.length === 0" @change="updateDetails">
          <option v-for="item in state.bases" :key="item.id" :value="item.id">
            {{ item.name }}
          </option>
        </select>
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
        <input id="dbUser" v-model="dbUser" type="text" autocomplete="off" spellcheck="false" :disabled="isDisabled">
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
      <span id="spinner" class="spinner" :class="{ hidden: status.kind !== 'loading' }" aria-hidden="true"></span>
      <span id="statusText">{{ statusText }}</span>
    </div>
    <div class="buttons">
      <button id="save" class="primary" type="button" :disabled="isDisabled" @click="save">{{ saving ? 'Сохранение...' : 'Сохранить' }}</button>
      <button id="refresh" class="secondary" type="button" :disabled="isDisabled" @click="refresh">Обновить</button>
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

.count {
  color: var(--vscode-descriptionForeground);
  font-weight: 400;
  white-space: nowrap;
}

label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--vscode-descriptionForeground);
}

select,
input {
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

select {
  padding: 3px 6px;
}

input {
  padding: 3px 7px;
}

select:focus,
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

.spinner {
  width: 14px;
  height: 14px;
  box-sizing: border-box;
  border: 2px solid var(--vscode-progressBar-background);
  border-right-color: transparent;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  flex: 0 0 auto;
}

.spinner.hidden {
  display: none;
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
select:disabled,
input:disabled {
  cursor: default;
  opacity: 0.65;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
