<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { MessageBus } from '@ui-shared/api/messageBus';
import type { HostToUiMessage } from '@ui-shared/protocol/hostMessages';
import type { RepositoryCommitState } from './main';

const props = defineProps<{
  initialState: RepositoryCommitState | null;
  messageBus: MessageBus;
}>();

const targetLabel = ref(props.initialState?.targetLabel ?? '');
const initiallyLocked = ref(props.initialState?.initiallyLocked ?? false);
const comment = ref('');
const recursive = ref(initiallyLocked.value);
const keepLocked = ref(true);
const force = ref(false);
const loading = ref(false);
const error = ref('');

function submit(): void {
  if (!comment.value.trim()) {
    error.value = 'Введите комментарий к изменению';
    return;
  }
  error.value = '';
  loading.value = true;

  props.messageBus.send({
    type: 'command',
    command: 'submit',
    payload: {
      comment: comment.value,
      recursive: recursive.value,
      keepLocked: keepLocked.value,
      force: force.value,
    },
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
  <div class="commit-form">
    <h2 class="form-title">Помещение в хранилище</h2>
    <p class="form-subtitle">{{ targetLabel }}</p>

    <div class="form-field">
      <label class="field-label" for="commitComment">Комментарий к изменению</label>
      <textarea
        id="commitComment"
        class="field-textarea"
        v-model="comment"
        placeholder="Опишите изменение..."
        rows="6"
        :disabled="loading"
      ></textarea>
    </div>

    <div class="form-divider"></div>

    <label class="checkbox-row">
      <input type="checkbox" v-model="recursive" :disabled="loading" />
      <span>Захватывать подчинённые объекты</span>
    </label>

    <label class="checkbox-row">
      <input type="checkbox" v-model="keepLocked" :disabled="loading" />
      <span>Оставить захваченным</span>
    </label>

    <label class="checkbox-row">
      <input type="checkbox" v-model="force" :disabled="loading" />
      <span>Принудительное помещение (с потерей изменений других пользователей)</span>
    </label>

    <div v-if="error" class="form-error">{{ error }}</div>

    <div class="form-actions">
      <button class="action-button primary" @click="submit" :disabled="loading">
        {{ loading ? 'Выполняется...' : 'Поместить' }}
      </button>
      <button class="action-button secondary" @click="cancel" :disabled="loading">
        Отмена
      </button>
    </div>
  </div>
</template>

<style scoped>
.commit-form {
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

.field-textarea {
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border, transparent);
  border-radius: 2px;
  padding: 8px;
  font-family: inherit;
  font-size: inherit;
  resize: vertical;
  min-height: 80px;
}

.field-textarea:focus {
  outline: 1px solid var(--vscode-focusBorder);
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
