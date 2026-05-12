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
      <input
        class="search-input"
        type="search"
        :value="localQuery"
        @input="onInput(($event.target as HTMLInputElement).value)"
        @keydown.escape="clear"
        placeholder="Поиск..."
        aria-label="Поиск по метаданным"
      />
      <button
        v-if="localQuery"
        class="search-clear"
        @click="clear"
        aria-label="Очистить поиск"
      >
        <span class="codicon codicon-close" />
      </button>
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
  background: transparent;
  border: none;
  outline: none;
  color: var(--vscode-input-foreground);
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size, 13px);
  padding: 4px 0;
}
.search-input::placeholder {
  color: var(--vscode-input-placeholderForeground);
}
.search-clear {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--vscode-input-foreground);
  padding: 2px;
  display: flex;
  align-items: center;
  opacity: 0.7;
}
.search-clear:hover {
  opacity: 1;
}
</style>
