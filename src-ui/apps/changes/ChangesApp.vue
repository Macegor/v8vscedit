<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import { MessageBus } from '@ui-shared/api/messageBus';
import type { HostToUiMessage } from '@ui-shared/protocol/hostMessages';
import type { ChangesSectionDto, ChangesViewState } from '@ui-shared/types/changes';
import type { HistoryGraphState } from '@ui-shared/types/history';
import type { TreeNodeDto } from '@ui-shared/types/tree';
import UniversalTree from '@ui-shared/components/tree/UniversalTree.vue';
import AppContextMenu, { type ContextMenuItem } from '@ui-shared/components/AppContextMenu.vue';
import ChangesCommitBox from './ChangesCommitBox.vue';
import CommitGraph from './CommitGraph.vue';

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

// Сворачиваемые блоки панели: «Изменения» открыт по умолчанию, «История» — по требованию.
const changesOpen = ref(true);
const historyOpen = ref(false);
const historyLoaded = ref(false);

const history = ref<HistoryGraphState>({ rows: [], laneCount: 0, hasMore: false });
const commitSection = ref<ChangesSectionDto | null>(null);
const commitSelectedHash = ref<string | undefined>(undefined);

// Состояние дерева изменений выбранного коммита. Держим ОТДЕЛЬНО от `openIds`
// дерева блока «Изменения»: id узлов (`staged#…`) совпадают по форме, смешивание
// раскрытия двух деревьев ломало бы отображение.
const commitOpenIds = reactive<Record<string, true>>({});
const commitSelectedId = ref<string | null>(null);
const commitLoadingIds = reactive<Record<string, true>>({});

// Порядок секций: сверху «Не проиндексировано» (рабочие правки), ниже
// «Проиндексировано» (готовое к коммиту) — как в стандартном SCM; «Прочие» в конце.
const sections = computed<ChangesSectionDto[]>(() => [
  state.value.unstaged,
  state.value.staged,
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

/** Раскрывает всю навигаторную ветвь секции выбранного коммита. */
function expandCommitSection(): void {
  const section = commitSection.value;
  if (!section) {
    return;
  }
  const visit = (nodes: readonly TreeNodeDto[]): void => {
    for (const node of nodes) {
      if (node.hasChildren) {
        commitOpenIds[node.id] = true;
      }
      if (node.children) {
        visit(node.children);
      }
    }
  };
  visit(section.nodes);
}

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
  // Индексацию всех изменений выполняет host по модели (объектные части +
  // «Прочие»): перебирать здесь узлы секции нельзя — верхнеуровневые узлы
  // навигаторные (group-узлы), их id не адресуют файлы.
  sendCommand('stageAll');
}

function onUnstageAll(): void {
  sendCommand('unstageAll');
}

function toggleChanges(): void {
  changesOpen.value = !changesOpen.value;
}

function toggleHistory(): void {
  historyOpen.value = !historyOpen.value;
  if (historyOpen.value && !historyLoaded.value) {
    sendCommand('loadHistory');
    historyLoaded.value = true;
  }
}

function onSelectCommit(hash: string): void {
  commitSelectedHash.value = hash;
  sendCommand('selectCommit', { hash });
}

function onCommitToggle(nodeId: string, open: boolean): void {
  if (open) {
    commitOpenIds[nodeId] = true;
  } else {
    delete commitOpenIds[nodeId];
  }
}

function onCommitSelect(nodeId: string | null): void {
  commitSelectedId.value = nodeId;
}

function onCommitDefault(nodeId: string): void {
  sendCommand('openCommitDiff', { nodeId });
}

function onHistoryRefresh(): void {
  sendCommand('historyRefresh');
}

function onHistoryLoadMore(): void {
  sendCommand('historyLoadMore');
}

/** Короткая относительная дата выбранного коммита в блоке деталей. */
const commitRow = computed(() => {
  const hash = commitSelectedHash.value;
  if (!hash) {
    return null;
  }
  return history.value.rows.find((row) => row.hash === hash) ?? null;
});

function handleState(message: HostToUiMessage<ChangesViewState>): void {
  if (message.type === 'state') {
    state.value = message.state;
    expandAll();
  }
}

function handleHistory(message: HostToUiMessage): void {
  if (message.type === 'history') {
    history.value = message.state;
    commitSelectedHash.value = message.state.selectedHash;
  }
}

function handleCommitChanges(message: HostToUiMessage): void {
  if (message.type === 'commitChanges') {
    commitSection.value = message.section;
    commitSelectedHash.value = message.hash;
    for (const key of Object.keys(commitOpenIds)) {
      delete commitOpenIds[key];
    }
    expandCommitSection();
  }
}

onMounted(() => {
  props.messageBus.on('state', handleState);
  props.messageBus.on('history', handleHistory);
  props.messageBus.on('commitChanges', handleCommitChanges);
});

onUnmounted(() => {
  props.messageBus.off('state', handleState);
  props.messageBus.off('history', handleHistory);
  props.messageBus.off('commitChanges', handleCommitChanges);
});
</script>

<template>
  <div class="changes-panel">
    <section class="panel-block changes-block" :class="changesOpen ? 'expanded' : 'collapsed'">
      <div
        class="block-header"
        role="button"
        tabindex="0"
        @click="toggleChanges"
        @keydown.enter.prevent="toggleChanges"
        @keydown.space.prevent="toggleChanges"
      >
        <span class="codicon" :class="changesOpen ? 'codicon-chevron-down' : 'codicon-chevron-right'" />
        <span class="block-title">Изменения</span>
        <span v-if="changesOpen" class="block-actions">
          <button
            type="button"
            class="header-button"
            title="Обновить"
            @click.stop="onRefresh"
          >
            <span class="codicon codicon-refresh" />
          </button>
        </span>
      </div>

      <div v-if="changesOpen" class="block-body">
        <ChangesCommitBox
          :can-commit="state.canCommit"
          :initial-message="state.commitMessage"
          @commit="onCommit"
        />

        <div class="block-scroll">
          <div v-if="hasChanges" class="changes-content">
            <section v-for="section in visibleSections" :key="section.kind" class="changes-section">
              <div class="section-header">
                <span class="section-title">{{ section.label }}</span>
                <button
                  v-if="section.kind === 'unstaged'"
                  type="button"
                  class="header-button"
                  title="Проиндексировать все изменения"
                  @click="onStageAll"
                >
                  <span class="codicon codicon-add" />
                </button>
                <button
                  v-if="section.kind === 'staged'"
                  type="button"
                  class="header-button"
                  title="Снять индексацию со всех изменений"
                  @click="onUnstageAll"
                >
                  <span class="codicon codicon-remove" />
                </button>
              </div>
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
        </div>
      </div>
    </section>

    <section class="panel-block history-block" :class="historyOpen ? 'expanded' : 'collapsed'">
      <div
        class="block-header"
        role="button"
        tabindex="0"
        @click="toggleHistory"
        @keydown.enter.prevent="toggleHistory"
        @keydown.space.prevent="toggleHistory"
      >
        <span class="codicon" :class="historyOpen ? 'codicon-chevron-down' : 'codicon-chevron-right'" />
        <span class="block-title">История</span>
        <span v-if="historyOpen" class="block-actions">
          <button
            type="button"
            class="header-button"
            title="Обновить"
            @click.stop="onHistoryRefresh"
          >
            <span class="codicon codicon-refresh" />
          </button>
          <button
            v-if="history.hasMore"
            type="button"
            class="header-button"
            title="Загрузить ещё"
            @click.stop="onHistoryLoadMore"
          >
            <span class="codicon codicon-chevron-down" />
          </button>
        </span>
      </div>

      <div v-if="historyOpen" class="block-body">
        <div class="block-scroll">
          <CommitGraph
            :rows="history.rows"
            :lane-count="history.laneCount"
            :selected-hash="commitSelectedHash"
            @select="onSelectCommit"
          >
            <template #details="{ row }">
              <div v-if="row.hash === commitSelectedHash && commitSection" class="commit-details-content">
                <div class="commit-meta">
                  <span class="meta-hash">{{ commitRow?.shortHash ?? row.shortHash }}</span>
                  <span class="meta-author">{{ commitRow?.author ?? row.author }}</span>
                  <span class="meta-date" :title="commitRow?.absoluteDate ?? row.absoluteDate">
                    {{ commitRow?.relativeDate ?? row.relativeDate }}
                  </span>
                </div>
                <div class="commit-subject-full">{{ commitRow?.subject ?? row.subject }}</div>
                <UniversalTree
                  :nodes="commitSection.nodes"
                  :selected-id="commitSelectedId"
                  :open-ids="commitOpenIds"
                  :loading-ids="commitLoadingIds"
                  @toggle="onCommitToggle"
                  @select="onCommitSelect"
                  @default="onCommitDefault"
                />
              </div>
            </template>
          </CommitGraph>
        </div>
      </div>
    </section>

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
/* Два блока делят высоту 60/40, каждый скроллится независимо. Свёрнутый блок
   ужимается до высоты шапки, раскрытый занимает оставшееся пространство. */
.panel-block {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.panel-block.collapsed {
  flex: 0 0 auto;
}
.changes-block.expanded {
  flex: 3 1 0;
}
.history-block.expanded {
  flex: 2 1 0;
}
.block-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}
.block-header {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 4px 8px;
  background: transparent;
  border: none;
  color: var(--vscode-sideBarSectionHeader-foreground, var(--vscode-foreground));
  cursor: pointer;
  text-align: left;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.block-header:hover {
  background: var(--vscode-list-hoverBackground);
}
.block-title {
  flex: 1 1 auto;
}
.block-actions {
  flex: 0 0 auto;
  display: inline-flex;
  gap: 2px;
}
.header-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px;
  background: transparent;
  border: none;
  color: var(--vscode-foreground);
  cursor: pointer;
  border-radius: 3px;
}
.header-button:hover {
  background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground));
}
.block-body {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
}
.changes-content {
  display: flex;
  flex-direction: column;
}
.changes-section {
  display: flex;
  flex-direction: column;
}
.section-header {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px 2px 10px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--vscode-descriptionForeground);
}
.section-title {
  flex: 1 1 auto;
}
.changes-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px 8px;
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
.commit-details-content {
  display: flex;
  flex-direction: column;
  padding: 4px 8px 8px 0;
}
.commit-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
}
.meta-hash {
  font-family: var(--vscode-editor-font-family, monospace);
}
.meta-author {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.commit-subject-full {
  margin: 2px 0 4px;
  color: var(--vscode-foreground);
  white-space: normal;
  overflow-wrap: anywhere;
}
</style>
