<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { MessageBus } from '@ui-shared/api/messageBus';
import type { HostToUiMessage } from '@ui-shared/protocol/hostMessages';
import type { RepositoryConnectionState, RepositoryBindingDto, ConnectionMode } from './main';

const props = defineProps<{
  initialState: RepositoryConnectionState | null;
  messageBus: MessageBus;
}>();

// Состояние формы
const mode = ref<ConnectionMode>(props.initialState?.mode ?? 'connect');
const target = ref(props.initialState?.target ?? '');
const repoPath = ref(props.initialState?.initialBinding?.repoPath ?? '');
const repoUser = ref(props.initialState?.initialBinding?.repoUser ?? '');
const repoPassword = ref(props.initialState?.initialBinding?.repoPassword ?? '');
const loading = ref(false);
const error = ref('');

// Флаги для mode=connect
const forceBindAlreadyBindedUser = ref(false);
const forceReplaceCfg = ref(false);
const allowConfigurationChanges = ref(false);
const changesAllowedRule = ref('allow');
const changesNotRecommendedRule = ref('dontAllow');
const noBind = ref(false);

function browseRepoPath(): void {
  props.messageBus.send({
    type: 'request',
    requestId: 'browse',
    name: 'browseRepoPath',
  });
}

function submit(): void {
  if (!repoPath.value) {
    error.value = 'Укажите путь к хранилищу';
    return;
  }
  if (!repoUser.value) {
    error.value = 'Укажите пользователя хранилища';
    return;
  }
  error.value = '';
  loading.value = true;

  const formData = {
    repoPath: repoPath.value,
    repoUser: repoUser.value,
    repoPassword: repoPassword.value,
    forceBindAlreadyBindedUser: forceBindAlreadyBindedUser.value,
    forceReplaceCfg: forceReplaceCfg.value,
    allowConfigurationChanges: allowConfigurationChanges.value,
    changesAllowedRule: changesAllowedRule.value,
    changesNotRecommendedRule: changesNotRecommendedRule.value,
    noBind: noBind.value,
  };

  props.messageBus.send({
    type: 'command',
    command: 'submit',
    payload: formData,
  });
}

function cancel(): void {
  props.messageBus.send({ type: 'command', command: 'cancel' });
}

function handleHostMessage(msg: HostToUiMessage): void {
  if (msg.type === 'status') {
    if (msg.kind === 'loading') loading.value = true;
    else loading.value = false;
  }
  if (msg.type === 'error') {
    error.value = msg.message;
    loading.value = false;
  }
}

onMounted(() => {
  props.messageBus.on('status', handleHostMessage);
  props.messageBus.on('error', handleHostMessage);
});

onUnmounted(() => {
  props.messageBus.off('status', handleHostMessage);
  props.messageBus.off('error', handleHostMessage);
});
</script>

<template>
  <div class="connection-form">
    <h2 class="form-title">
      {{ mode === 'connect' ? 'Подключение к хранилищу' : 'Создание хранилища' }}
    </h2>
    <p class="form-subtitle">{{ target }}</p>

    <!-- Поле пути к хранилищу -->
    <div class="form-field">
      <label class="field-label" for="repoPath">Путь к хранилищу</label>
      <div class="field-row">
        <input
          id="repoPath"
          class="field-input"
          type="text"
          v-model="repoPath"
          placeholder="tcp://server:1542/repo или /путь/к/хранилищу"
          :disabled="loading"
        />
        <button class="browse-button" @click="browseRepoPath" :disabled="loading" title="Обзор...">
          <span class="codicon codicon-folder-opened"></span>
        </button>
      </div>
    </div>

    <!-- Пользователь -->
    <div class="form-field">
      <label class="field-label" for="repoUser">Пользователь</label>
      <input
        id="repoUser"
        class="field-input"
        type="text"
        v-model="repoUser"
        placeholder="Имя пользователя хранилища"
        :disabled="loading"
      />
    </div>

    <!-- Пароль -->
    <div class="form-field">
      <label class="field-label" for="repoPassword">Пароль</label>
      <input
        id="repoPassword"
        class="field-input"
        type="password"
        v-model="repoPassword"
        placeholder="Пароль"
        :disabled="loading"
      />
    </div>

    <!-- Дополнительные опции для connect -->
    <template v-if="mode === 'connect'">
      <div class="form-divider"></div>

      <label class="checkbox-row">
        <input type="checkbox" v-model="forceBindAlreadyBindedUser" :disabled="loading" />
        <span>Принудительно перепривязать пользователя хранилища</span>
      </label>

      <label class="checkbox-row">
        <input type="checkbox" v-model="forceReplaceCfg" :disabled="loading" />
        <span>Принудительно заменить конфигурацию</span>
      </label>

      <label class="checkbox-row">
        <input type="checkbox" v-model="allowConfigurationChanges" :disabled="loading" />
        <span>Разрешить изменения конфигурации</span>
      </label>

      <label class="checkbox-row">
        <input type="checkbox" v-model="noBind" :disabled="loading" />
        <span>Не привязывать проект к хранилищу</span>
      </label>

      <!-- Правила изменений -->
      <div class="form-field" v-if="allowConfigurationChanges">
        <label class="field-label">Правило для разрешённых изменений</label>
        <select class="field-select" v-model="changesAllowedRule" :disabled="loading">
          <option value="allow">Разрешить</option>
          <option value="dontAllow">Не разрешать</option>
          <option value="withWarning">С предупреждением</option>
        </select>
      </div>

      <div class="form-field">
        <label class="field-label">Правило для нерекомендуемых изменений</label>
        <select class="field-select" v-model="changesNotRecommendedRule" :disabled="loading">
          <option value="dontAllow">Не разрешать</option>
          <option value="allow">Разрешить</option>
          <option value="withWarning">С предупреждением</option>
        </select>
      </div>
    </template>

    <!-- Ошибка -->
    <div v-if="error" class="form-error">{{ error }}</div>

    <!-- Кнопки -->
    <div class="form-actions">
      <button class="action-button primary" @click="submit" :disabled="loading">
        {{ loading ? 'Подключение...' : mode === 'connect' ? 'Подключиться' : 'Создать' }}
      </button>
      <button class="action-button secondary" @click="cancel" :disabled="loading">
        Отмена
      </button>
    </div>
  </div>
</template>

<style scoped>
.connection-form {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size, 13px);
  color: var(--vscode-foreground);
}

.form-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.form-subtitle {
  margin: 0;
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.field-label {
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
}

.field-row {
  display: flex;
  gap: 4px;
}

.field-input {
  flex: 1;
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border, transparent);
  border-radius: 2px;
  padding: 4px 8px;
  font-family: inherit;
  font-size: inherit;
}

.field-input:focus {
  outline: 1px solid var(--vscode-focusBorder);
}

.field-select {
  background: var(--vscode-dropdown-background);
  color: var(--vscode-dropdown-foreground);
  border: 1px solid var(--vscode-dropdown-border, transparent);
  border-radius: 2px;
  padding: 4px 8px;
  font-family: inherit;
  font-size: inherit;
}

.browse-button {
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
  border: none;
  border-radius: 2px;
  padding: 4px 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
}

.browse-button:hover {
  background: var(--vscode-button-secondaryHoverBackground);
}

.form-divider {
  height: 1px;
  background: var(--vscode-panel-border);
  margin: 4px 0;
}

.checkbox-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  cursor: pointer;
}

.checkbox-row input[type="checkbox"] {
  margin: 0;
}

.form-error {
  background: var(--vscode-inputValidation-errorBackground);
  border: 1px solid var(--vscode-inputValidation-errorBorder);
  color: var(--vscode-errorForeground);
  padding: 8px;
  border-radius: 2px;
  font-size: 12px;
}

.form-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.action-button {
  padding: 6px 14px;
  border: none;
  border-radius: 2px;
  cursor: pointer;
  font-family: inherit;
  font-size: inherit;
}

.action-button:disabled {
  opacity: 0.5;
  cursor: default;
}

.action-button.primary {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}

.action-button.primary:hover:not(:disabled) {
  background: var(--vscode-button-hoverBackground);
}

.action-button.secondary {
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
}

.action-button.secondary:hover:not(:disabled) {
  background: var(--vscode-button-secondaryHoverBackground);
}
</style>
