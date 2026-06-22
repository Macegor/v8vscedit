<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { MessageBus } from '@ui-shared/api/messageBus';
import type { HostToUiMessage } from '@ui-shared/protocol/hostMessages';
import type { RepositoryConnectionState, RepositoryBindingDto, ConnectionMode } from './main';

const props = defineProps<{
  initialState: RepositoryConnectionState | null;
  messageBus: MessageBus;
}>();

const mode = ref<ConnectionMode>(props.initialState?.mode ?? 'connect');
const target = ref(props.initialState?.target ?? '');
const repoPath = ref(props.initialState?.initialBinding?.repoPath ?? '');
const repoUser = ref(props.initialState?.initialBinding?.repoUser ?? '');
const repoPassword = ref(props.initialState?.initialBinding?.repoPassword ?? '');
const loading = ref(false);
const error = ref('');

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

// Ответ host на запрос выбора папки (browseRepoPath). Корреляция по requestId,
// который шлёт browseRepoPath; payload содержит выбранный путь.
function handleReply(msg: HostToUiMessage): void {
  if (msg.type !== 'reply' || msg.requestId !== 'browse') return;
  const payload = msg.payload as { repoPath?: string } | undefined;
  if (payload?.repoPath) {
    repoPath.value = payload.repoPath;
  }
}

onMounted(() => {
  props.messageBus.on('status', handleHostMessage);
  props.messageBus.on('error', handleHostMessage);
  props.messageBus.on('reply', handleReply);
});

onUnmounted(() => {
  props.messageBus.off('status', handleHostMessage);
  props.messageBus.off('error', handleHostMessage);
  props.messageBus.off('reply', handleReply);
});
</script>

<template>
  <div class="connection-form">
    <h2 class="form-title">
      {{ mode === 'connect' ? 'Подключение к хранилищу' : 'Создание хранилища' }}
    </h2>
    <p class="form-subtitle">{{ target }}</p>

    <div class="form-field">
      <label class="field-label" for="repoPath">Путь к хранилищу</label>
      <div class="field-row">
        <vscode-textfield
          id="repoPath"
          :value="repoPath"
          placeholder="tcp://server:1542/repo или /путь/к/хранилищу"
          :disabled="loading"
          @input="(e: Event) => repoPath = (e.target as HTMLInputElement).value"
        />
        <vscode-button appearance="icon" @click="browseRepoPath" :disabled="loading" aria-label="Обзор...">
          <span class="codicon codicon-folder-opened"></span>
        </vscode-button>
      </div>
    </div>

    <div class="form-field">
      <label class="field-label" for="repoUser">Пользователь</label>
      <vscode-textfield
        id="repoUser"
        :value="repoUser"
        placeholder="Имя пользователя хранилища"
        :disabled="loading"
        @input="(e: Event) => repoUser = (e.target as HTMLInputElement).value"
      />
    </div>

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

    <template v-if="mode === 'connect'">
      <vscode-divider></vscode-divider>

      <vscode-checkbox :checked="forceBindAlreadyBindedUser" :disabled="loading" @change="(e: Event) => forceBindAlreadyBindedUser = (e.target as HTMLInputElement).checked">
        Принудительно перепривязать пользователя хранилища
      </vscode-checkbox>

      <vscode-checkbox :checked="forceReplaceCfg" :disabled="loading" @change="(e: Event) => forceReplaceCfg = (e.target as HTMLInputElement).checked">
        Принудительно заменить конфигурацию
      </vscode-checkbox>

      <vscode-checkbox :checked="allowConfigurationChanges" :disabled="loading" @change="(e: Event) => allowConfigurationChanges = (e.target as HTMLInputElement).checked">
        Разрешить изменения конфигурации
      </vscode-checkbox>

      <vscode-checkbox :checked="noBind" :disabled="loading" @change="(e: Event) => noBind = (e.target as HTMLInputElement).checked">
        Не привязывать проект к хранилищу
      </vscode-checkbox>

      <div class="form-field" v-if="allowConfigurationChanges">
        <label class="field-label">Правило для разрешённых изменений</label>
        <vscode-single-select :value="changesAllowedRule" :disabled="loading" @change="(e: Event) => changesAllowedRule = (e.target as HTMLSelectElement).value">
          <vscode-option value="allow">Разрешить</vscode-option>
          <vscode-option value="dontAllow">Не разрешать</vscode-option>
          <vscode-option value="withWarning">С предупреждением</vscode-option>
        </vscode-single-select>
      </div>

      <div class="form-field">
        <label class="field-label">Правило для нерекомендуемых изменений</label>
        <vscode-single-select :value="changesNotRecommendedRule" :disabled="loading" @change="(e: Event) => changesNotRecommendedRule = (e.target as HTMLSelectElement).value">
          <vscode-option value="dontAllow">Не разрешать</vscode-option>
          <vscode-option value="allow">Разрешить</vscode-option>
          <vscode-option value="withWarning">С предупреждением</vscode-option>
        </vscode-single-select>
      </div>
    </template>

    <div v-if="error" class="form-error">{{ error }}</div>

    <div class="form-actions">
      <vscode-button @click="submit" :disabled="loading">
        {{ loading ? 'Подключение...' : mode === 'connect' ? 'Подключиться' : 'Создать' }}
      </vscode-button>
      <vscode-button appearance="secondary" @click="cancel" :disabled="loading">
        Отмена
      </vscode-button>
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

.field-row vscode-textfield {
  flex: 1;
}

.field-input {
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
</style>
