<script setup lang="ts">
import { ref, watch } from 'vue';

const props = defineProps<{
  canCommit: boolean;
  initialMessage: string;
}>();

const emit = defineEmits<{
  commit: [message: string];
  refresh: [];
  stageAll: [];
}>();

const message = ref(props.initialMessage);

watch(
  () => props.initialMessage,
  (next) => {
    // Хост очищает сообщение после успешного коммита — синхронизируем поле.
    if (next === '') {
      message.value = '';
    }
  },
);

function onCommit(): void {
  const text = message.value.trim();
  if (!text || !props.canCommit) {
    return;
  }
  emit('commit', text);
}
</script>

<template>
  <div class="commit-box">
    <div class="commit-toolbar">
      <button
        class="toolbar-button"
        type="button"
        title="Проиндексировать все изменения"
        aria-label="Проиндексировать все изменения"
        @click="emit('stageAll')"
      >
        <span class="codicon codicon-add" aria-hidden="true" />
      </button>
      <button
        class="toolbar-button"
        type="button"
        title="Обновить список изменений"
        aria-label="Обновить список изменений"
        @click="emit('refresh')"
      >
        <span class="codicon codicon-refresh" aria-hidden="true" />
      </button>
    </div>

    <textarea
      class="commit-message"
      :value="message"
      placeholder="Сообщение коммита"
      rows="3"
      @input="(e: Event) => (message = (e.target as HTMLTextAreaElement).value)"
    ></textarea>

    <button
      class="commit-button"
      type="button"
      title="Закоммитить проиндексированные изменения"
      aria-label="Закоммитить проиндексированные изменения"
      :disabled="!canCommit || !message.trim()"
      @click="onCommit"
    >
      <span class="codicon codicon-check" aria-hidden="true" />
      Закоммитить
    </button>
  </div>
</template>

<style scoped>
.commit-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border-bottom: 1px solid var(--vscode-panel-border, transparent);
}
.commit-toolbar {
  display: flex;
  justify-content: flex-end;
  gap: 2px;
}
.toolbar-button {
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 5px;
  color: var(--vscode-icon-foreground);
  background: transparent;
  cursor: pointer;
}
.toolbar-button:hover {
  background: var(--vscode-toolbar-hoverBackground);
}
.commit-message {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size, 13px);
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, transparent);
  border-radius: 2px;
  padding: 6px 8px;
}
.commit-message:focus {
  outline: 1px solid var(--vscode-focusBorder);
}
.commit-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 4px 10px;
  border: 0;
  border-radius: 2px;
  color: var(--vscode-button-foreground);
  background: var(--vscode-button-background);
  cursor: pointer;
  font: inherit;
  font-size: 13px;
}
.commit-button:hover:not(:disabled) {
  background: var(--vscode-button-hoverBackground);
}
.commit-button:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
