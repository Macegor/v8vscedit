<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import { MessageBus } from '@ui-shared/api/messageBus';
import type { HostToUiMessage } from '@ui-shared/protocol/hostMessages';
import type { ChangesSectionDto, ChangesViewState } from '@ui-shared/types/changes';
import UniversalTree from '@ui-shared/components/tree/UniversalTree.vue';
import AppContextMenu, { type ContextMenuItem } from '@ui-shared/components/AppContextMenu.vue';
import ChangesCommitBox from './ChangesCommitBox.vue';

const props = defineProps<{
  initialState: ChangesViewState | null;
  messageBus: MessageBus;
}>();

const EMPTY_SECTION = (kind: ChangesSectionDto['kind'], label: string): ChangesSectionDto => ({
  kind,
  label,
  nodes: [],
});

const state = ref<ChangesViewState>(
  props.initialState ?? {
    staged: EMPTY_SECTION('staged', 'Проиндексировано'),
    unstaged: EMPTY_SECTION('unstaged', 'Не проиндексировано'),
    unresolved: EMPTY_SECTION('other', 'Прочие'),
    canCommit: false,
    commitMessage: '',
  },
);

const openIds = reactive<Record<string, true>>({});
const loadingIds = reactive<Record<string, true>>({});
const selectedId = ref<string | null>(null);

const sections = computed<ChangesSectionDto[]>(() => [
  state.value.staged,
  state.value.unstaged,
  state.value.unresolved,
]);

const visibleSections = computed(() => sections.value.filter((section) => section.nodes.length > 0));

const hasChanges = computed(() => visibleSections.value.length > 0);

/**
 * Раскрывает ВСЮ обрезанную навигаторную ветвь (group-узлы «Справочники»/«Общие»,
 * объектные узлы и части), чтобы изменения были видны сразу без ручного разворота.
 */
function expandAll(): void {
  const visit = (nodes: ChangesViewState['staged']['nodes']): void => {
    for (const node of nodes) {
      if (node.hasChildren) {
        openIds[node.id] = true;
      }
      if (node.children) {
        visit(node.children);
      }
    }
  };
  for (const section of sections.value) {
    visit(section.nodes);
  }
}

expandAll();

const contextMenu = reactive<{ visible: boolean; x: number; y: number; items: ContextMenuItem[]; nodeId: string | null }>(
  { visible: false, x: 0, y: 0, items: [], nodeId: null },
);

function sendCommand(command: string, payload?: Record<string, unknown>): void {
  props.messageBus.send({ type: 'command', command, payload });
}

function onToggle(nodeId: string, open: boolean): void {
  if (open) {
    openIds[nodeId] = true;
  } else {
    delete openIds[nodeId];
  }
}

function onSelect(nodeId: string | null): void {
  selectedId.value = nodeId;
}

function onDefault(nodeId: string): void {
  sendCommand('openDiff', { nodeId });
}

/**
 * Инлайн-кнопка узла (проиндексировать/снять индексацию): `actionId` совпадает
 * со значением `command` протокола, поэтому просто прокидываем его провайдеру.
 */
function onAction(nodeId: string, actionId: string): void {
  sendCommand(actionId, { nodeId });
}

function contextItemsFor(kind: ChangesSectionDto['kind']): ContextMenuItem[] {
  if (kind === 'staged') {
    return [
      { id: 'openDiff', label: 'Открыть сравнение' },
      { id: 'unstage', label: 'Снять индексацию' },
      { id: 'discard', label: 'Отменить изменения' },
    ];
  }
  if (kind === 'unstaged') {
    return [
      { id: 'openDiff', label: 'Открыть сравнение' },
      { id: 'stage', label: 'Проиндексировать' },
      { id: 'discard', label: 'Отменить изменения' },
    ];
  }
  return [
    { id: 'stage', label: 'Проиндексировать' },
    { id: 'discard', label: 'Отменить изменения' },
  ];
}

function onContextMenu(kind: ChangesSectionDto['kind'], nodeId: string, event: MouseEvent): void {
  selectedId.value = nodeId;
  contextMenu.visible = true;
  contextMenu.x = event.clientX;
  contextMenu.y = event.clientY;
  contextMenu.items = contextItemsFor(kind);
  contextMenu.nodeId = nodeId;
}

function onContextMenuAction(item: ContextMenuItem): void {
  const nodeId = contextMenu.nodeId;
  closeContextMenu();
  if (nodeId) {
    sendCommand(item.id, { nodeId });
  }
}

function closeContextMenu(): void {
  contextMenu.visible = false;
  contextMenu.nodeId = null;
}

function onCommit(message: string): void {
  sendCommand('commit', { message });
}

function onRefresh(): void {
  sendCommand('refresh');
}

function onStageAll(): void {
  for (const node of state.value.unstaged.nodes) {
    sendCommand('stage', { nodeId: node.id });
  }
}

function handleState(message: HostToUiMessage<ChangesViewState>): void {
  if (message.type === 'state') {
    state.value = message.state;
    expandAll();
  }
}

onMounted(() => {
  props.messageBus.on('state', handleState);
});

onUnmounted(() => {
  props.messageBus.off('state', handleState);
});
</script>

<template>
  <div class="changes-panel">
    <ChangesCommitBox
      :can-commit="state.canCommit"
      :initial-message="state.commitMessage"
      @commit="onCommit"
      @refresh="onRefresh"
      @stage-all="onStageAll"
    />

    <div v-if="hasChanges" class="changes-content">
      <section v-for="section in visibleSections" :key="section.kind" class="changes-section">
        <div class="section-header">{{ section.label }}</div>
        <UniversalTree
          :nodes="section.nodes"
          :selected-id="selectedId"
          :open-ids="openIds"
          :loading-ids="loadingIds"
          @toggle="onToggle"
          @select="onSelect"
          @default="onDefault"
          @action="onAction"
          @context-menu="(nodeId: string, event: MouseEvent) => onContextMenu(section.kind, nodeId, event)"
        />
      </section>
    </div>

    <div v-else class="changes-empty">
      <div class="empty-icon codicon codicon-git-commit" />
      <p class="empty-title">Нет изменений метаданных</p>
    </div>

    <AppContextMenu
      :visible="contextMenu.visible"
      :x="contextMenu.x"
      :y="contextMenu.y"
      :items="contextMenu.items"
      @select="onContextMenuAction"
      @close="closeContextMenu"
    />
  </div>
</template>

<style scoped>
/* Панель изменений — встык к краям: снимаем внешние отступы, которые VS Code
   по умолчанию навешивает на body webview. Изолировано бандлом `changes`. */
:global(html),
:global(body),
:global(#app) {
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
}
.changes-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  color: var(--vscode-foreground);
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size, 13px);
}
.changes-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.changes-section {
  display: flex;
  flex-direction: column;
}
.section-header {
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--vscode-descriptionForeground);
}
.changes-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--vscode-descriptionForeground);
}
.empty-icon {
  font-size: 28px;
  opacity: 0.6;
}
.empty-title {
  margin: 0;
  font-size: 12px;
}
</style>
