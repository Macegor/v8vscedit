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
      <vscode-textarea
        id="commitComment"
        :value="comment"
        placeholder="Опишите изменение..."
        :disabled="loading"
        rows="6"
        @input="(e: Event) => comment = (e.target as HTMLTextAreaElement).value"
      ></vscode-textarea>
    </div>

    <vscode-divider></vscode-divider>

    <vscode-checkbox :checked="recursive" :disabled="loading" @change="(e: Event) => recursive = (e.target as HTMLInputElement).checked">
      Захватывать подчинённые объекты
    </vscode-checkbox>

    <vscode-checkbox :checked="keepLocked" :disabled="loading" @change="(e: Event) => keepLocked = (e.target as HTMLInputElement).checked">
      Оставить захваченным
    </vscode-checkbox>

    <vscode-checkbox :checked="force" :disabled="loading" @change="(e: Event) => force = (e.target as HTMLInputElement).checked">
      Принудительное помещение (с потерей изменений других пользователей)
    </vscode-checkbox>

    <div v-if="error" class="form-error">{{ error }}</div>

    <div class="form-actions">
      <vscode-button @click="submit" :disabled="loading">
        {{ loading ? 'Выполняется...' : 'Поместить' }}
      </vscode-button>
      <vscode-button appearance="secondary" @click="cancel" :disabled="loading">
        Отмена
      </vscode-button>
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
