<script setup lang="ts">
import { ref } from 'vue';

const props = defineProps<{
  query: string;
}>();

const emit = defineEmits<{
  search: [query: string];
  clear: [];
}>();

const localQuery = ref(props.query);
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

function onInput(value: string): void {
  localQuery.value = value;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    emit('search', value);
  }, 400);
}

function clear(): void {
  localQuery.value = '';
  if (debounceTimer) clearTimeout(debounceTimer);
  emit('clear');
}
</script>

<template>
  <div class="search-box">
    <div class="search-input-wrapper">
      <span class="search-icon codicon codicon-search" aria-hidden="true" />
      <vscode-textfield
        class="search-input"
        :value="localQuery"
        placeholder="Поиск..."
        aria-label="Поиск по метаданным"
        @input="onInput(($event.target as HTMLInputElement).value)"
        @keydown.escape="clear"
      />
      <vscode-button
        v-if="localQuery"
        appearance="icon"
        @click="clear"
        aria-label="Очистить поиск"
      >
        <span class="codicon codicon-close" />
      </vscode-button>
    </div>
  </div>
</template>

<style scoped>
.search-box {
  padding: 8px;
  border-bottom: 1px solid var(--vscode-panel-border);
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
</style>
