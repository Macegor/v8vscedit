<script setup lang="ts">
import { ref, onMounted, onUnmounted, provide } from 'vue';
import { MessageBus } from '@ui-shared/api/messageBus';
import type { HostToUiMessage } from '@ui-shared/protocol/hostMessages';
import type { FormEditorState, FormElementDto } from './main';
import FormElementTree from './components/FormElementTree.vue';
import FormPropertyPanel from './components/FormPropertyPanel.vue';
import FormPreviewPane from './components/FormPreviewPane.vue';
import FormDataPanel from './components/FormDataPanel.vue';

const props = defineProps<{
  initialState: FormEditorState | null;
  messageBus: MessageBus;
}>();

provide('messageBus', props.messageBus);

const rootElement = ref<FormElementDto | null>(props.initialState?.model?.root ?? null);
const selectedElementId = ref<number | undefined>(props.initialState?.selectedElementId);
const previewMode = ref<'taxi' | 'onec85'>(props.initialState?.previewMode ?? 'taxi');
const canUndo = ref(props.initialState?.canUndo ?? false);
const canRedo = ref(props.initialState?.canRedo ?? false);
const attributes = ref(props.initialState?.model?.attributes ?? []);
const commands = ref(props.initialState?.model?.commands ?? []);

function selectElement(id: number): void {
  selectedElementId.value = id;
  props.messageBus.send({
    type: 'command',
    command: 'selectElement',
    payload: { id },
  });
}

function handleHostMessage(msg: HostToUiMessage<FormEditorState>): void {
  if (msg.type === 'state' || msg.type === 'init') {
    const state = msg.state;
    if (state.model) {
      rootElement.value = state.model.root;
      attributes.value = state.model.attributes;
      commands.value = state.model.commands;
    }
    if (state.selectedElementId !== undefined) selectedElementId.value = state.selectedElementId;
    if (state.previewMode) previewMode.value = state.previewMode;
    if (state.canUndo !== undefined) canUndo.value = state.canUndo;
    if (state.canRedo !== undefined) canRedo.value = state.canRedo;
  }
}

onMounted(() => {
  props.messageBus.on('init', handleHostMessage);
  props.messageBus.on('state', handleHostMessage);
});

onUnmounted(() => {
  props.messageBus.off('init', handleHostMessage);
  props.messageBus.off('state', handleHostMessage);
});
</script>

<template>
  <div class="form-editor-shell">
    <!-- Панель инструментов -->
    <div class="toolbar">
      <div class="toolbar-group">
        <button class="toolbar-button" :disabled="!canUndo" @click="messageBus.send({type:'command',command:'undo'})" title="Отменить">
          <span class="codicon codicon-undo"></span>
        </button>
        <button class="toolbar-button" :disabled="!canRedo" @click="messageBus.send({type:'command',command:'redo'})" title="Повторить">
          <span class="codicon codicon-redo"></span>
        </button>
      </div>
      <div class="toolbar-group">
        <button class="toolbar-button" @click="messageBus.send({type:'command',command:'addElement'})" title="Добавить элемент">
          <span class="codicon codicon-add"></span>
        </button>
        <button class="toolbar-button" :disabled="!selectedElementId" @click="messageBus.send({type:'command',command:'deleteElement',payload:{id:selectedElementId}})" title="Удалить элемент">
          <span class="codicon codicon-trash"></span>
        </button>
      </div>
      <div class="toolbar-spacer"></div>
      <div class="toolbar-group">
        <button class="toolbar-button" :class="{active:previewMode==='taxi'}" @click="messageBus.send({type:'command',command:'setPreviewMode',payload:{mode:'taxi'}})" title="Такси">
          Такси
        </button>
        <button class="toolbar-button" :class="{active:previewMode==='onec85'}" @click="messageBus.send({type:'command',command:'setPreviewMode',payload:{mode:'onec85'}})" title="Интерфейс 8.5">
          8.5
        </button>
      </div>
    </div>

    <!-- Основная сетка: дерево | превью | свойства -->
    <div class="editor-grid">
      <!-- Левая панель: дерево элементов -->
      <div class="panel panel-tree">
        <div class="panel-header">Элементы формы</div>
        <FormElementTree
          v-if="rootElement"
          :element="rootElement"
          :selected-id="selectedElementId"
          @select="selectElement"
        />
        <div v-else class="panel-empty">Форма не загружена</div>
      </div>

      <!-- Центр: превью формы -->
      <div class="panel panel-preview">
        <FormPreviewPane
          v-if="rootElement"
          :element="rootElement"
          :mode="previewMode"
        />
        <div v-else class="panel-empty">Форма не загружена</div>
      </div>

      <!-- Правая панель: свойства + данные -->
      <div class="panel panel-sidebar">
        <FormPropertyPanel
          v-if="rootElement"
          :element="rootElement"
          :selected-id="selectedElementId"
        />
        <div class="panel-divider"></div>
        <FormDataPanel
          v-if="rootElement"
          :attributes="attributes"
          :commands="commands"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.form-editor-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size, 13px);
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--vscode-panel-border);
  background: var(--vscode-sidebar-background);
}

.toolbar-group {
  display: flex;
  gap: 2px;
}

.toolbar-button {
  background: none;
  border: none;
  color: var(--vscode-foreground);
  padding: 4px 8px;
  cursor: pointer;
  font-size: 12px;
  border-radius: 2px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.toolbar-button:hover:not(:disabled) {
  background: var(--vscode-toolbar-hoverBackground);
}

.toolbar-button:disabled {
  opacity: 0.4;
  cursor: default;
}

.toolbar-button.active {
  background: var(--vscode-toolbar-activeBackground);
}

.toolbar-spacer {
  flex: 1;
}

.editor-grid {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.panel {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-tree {
  border-right: 1px solid var(--vscode-panel-border);
  min-width: 150px;
  width: 25%;
}

.panel-preview {
  flex: 1;
  min-width: 200px;
}

.panel-sidebar {
  border-left: 1px solid var(--vscode-panel-border);
  min-width: 200px;
  width: 25%;
  overflow-y: auto;
}

.panel-header {
  padding: 6px 12px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--vscode-descriptionForeground);
  border-bottom: 1px solid var(--vscode-panel-border);
  background: var(--vscode-sidebar-background);
}

.panel-empty {
  padding: 24px;
  text-align: center;
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
}

.panel-divider {
  height: 1px;
  background: var(--vscode-panel-border);
  margin: 8px 0;
}
</style>
