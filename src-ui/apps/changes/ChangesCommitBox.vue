<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { CommitMode } from '@ui-shared/types/changes';

const props = defineProps<{
  canCommit: boolean;
  initialMessage: string;
}>();

const emit = defineEmits<{
  commit: [message: string, mode: CommitMode];
}>();

const message = ref(props.initialMessage);
const menuOpen = ref(false);

watch(
  () => props.initialMessage,
  (next) => {
    // Хост очищает сообщение после успешной фиксации — синхронизируем поле.
    if (next === '') {
      message.value = '';
    }
  },
);

const disabled = computed(() => !props.canCommit || !message.value.trim());

/** Пункты выпадающего меню split-кнопки — как в штатном SCM. */
const MENU_ITEMS: { readonly mode: CommitMode; readonly label: string }[] = [
  { mode: 'commit', label: 'Фиксация' },
  { mode: 'push', label: 'Фиксация и отправка' },
  { mode: 'sync', label: 'Фиксация и синхронизация' },
];

function runCommit(mode: CommitMode): void {
  const text = message.value.trim();
  if (!text || !props.canCommit) {
    return;
  }
  menuOpen.value = false;
  emit('commit', text, mode);
  // Локальная фиксация застейдженного (guard выше гарантирует canCommit) успешна
  // сразу — очищаем поле оптимистично, не дожидаясь эха от host: `initialMessage`
  // всегда пуст, поэтому watch-очистка ниже никогда не срабатывает сама.
  message.value = '';
}

function toggleMenu(): void {
  if (disabled.value) {
    return;
  }
  menuOpen.value = !menuOpen.value;
}

function closeMenu(): void {
  menuOpen.value = false;
}
</script>

<template>
  <div class="commit-box">
    <textarea
      class="commit-message"
      :value="message"
      placeholder="Сообщение фиксации"
      rows="3"
      @input="(e: Event) => (message = (e.target as HTMLTextAreaElement).value)"
    ></textarea>

    <!-- Split-кнопка: основное действие «Фиксация» + каретка с вариантами. -->
    <div class="commit-split">
      <button
        class="commit-button primary"
        type="button"
        title="Зафиксировать проиндексированные изменения"
        aria-label="Зафиксировать проиндексированные изменения"
        :disabled="disabled"
        @click="runCommit('commit')"
      >
        <span class="codicon codicon-check" aria-hidden="true" />
        Фиксация
      </button>
      <button
        class="commit-button caret"
        type="button"
        title="Другие варианты фиксации"
        aria-label="Другие варианты фиксации"
        aria-haspopup="menu"
        :aria-expanded="menuOpen"
        :disabled="disabled"
        @click="toggleMenu"
        @keydown.esc="closeMenu"
      >
        <span class="codicon codicon-chevron-down" aria-hidden="true" />
      </button>

      <template v-if="menuOpen">
        <div class="commit-menu-backdrop" @click="closeMenu" />
        <ul class="commit-menu" role="menu" @keydown.esc="closeMenu">
          <li
            v-for="item in MENU_ITEMS"
            :key="item.mode"
            class="commit-menu-item"
            role="menuitem"
            tabindex="0"
            @click="runCommit(item.mode)"
            @keydown.enter.prevent="runCommit(item.mode)"
            @keydown.space.prevent="runCommit(item.mode)"
          >
            {{ item.label }}
          </li>
        </ul>
      </template>
    </div>
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
.commit-message {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size, 13px);
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, transparent);
  border-radius: 5px;
  padding: 6px 8px;
}
.commit-message:focus {
  outline: 1px solid var(--vscode-focusBorder);
}
/* Split-кнопка: две части встык, скруглены только внешние углы. */
.commit-split {
  position: relative;
  display: flex;
  align-items: stretch;
  gap: 1px;
}
.commit-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6px 10px;
  border: 0;
  color: var(--vscode-button-foreground);
  background: var(--vscode-button-background);
  cursor: pointer;
  font: inherit;
  font-size: 13px;
}
.commit-button.primary {
  flex: 1 1 auto;
  border-radius: 5px 0 0 5px;
}
.commit-button.caret {
  flex: 0 0 auto;
  padding: 6px 6px;
  border-radius: 0 5px 5px 0;
}
.commit-button:hover:not(:disabled) {
  background: var(--vscode-button-hoverBackground);
}
.commit-button:disabled {
  opacity: 0.5;
  cursor: default;
}
/* Прозрачная подложка перехватывает клик мимо меню и закрывает его. */
.commit-menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10;
}
.commit-menu {
  position: absolute;
  z-index: 11;
  right: 0;
  /* Поле фиксации — вверху блока «Изменения», поэтому меню раскрывается ВНИЗ
     (под кнопку), а не вверх — иначе оно налезает на шапку блока. */
  top: calc(100% + 2px);
  min-width: 100%;
  margin: 0;
  padding: 4px 0;
  list-style: none;
  background: var(--vscode-menu-background, var(--vscode-editorWidget-background));
  color: var(--vscode-menu-foreground, var(--vscode-foreground));
  border: 1px solid var(--vscode-menu-border, var(--vscode-widget-border, transparent));
  border-radius: 5px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.36);
}
.commit-menu-item {
  padding: 4px 12px;
  white-space: nowrap;
  cursor: pointer;
}
.commit-menu-item:hover,
.commit-menu-item:focus {
  outline: none;
  background: var(--vscode-menu-selectionBackground, var(--vscode-list-activeSelectionBackground));
  color: var(--vscode-menu-selectionForeground, var(--vscode-list-activeSelectionForeground));
}
</style>
