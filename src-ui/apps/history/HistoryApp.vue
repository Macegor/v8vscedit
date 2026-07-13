<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import { MessageBus } from '@ui-shared/api/messageBus';
import type { ChangesSectionDto } from '@ui-shared/types/changes';
import type { TreeNodeDto } from '@ui-shared/types/tree';
import type { HistoryGraphState } from '@ui-shared/types/history';
import UniversalTree from '@ui-shared/components/tree/UniversalTree.vue';
import CommitGraph from './CommitGraph.vue';

const props = defineProps<{
  initialState: HistoryGraphState | null;
  messageBus: MessageBus;
}>();

const EMPTY_GRAPH: HistoryGraphState = { rows: [], laneCount: 0, hasMore: false };

const graph = ref<HistoryGraphState>(props.initialState ?? EMPTY_GRAPH);
const selectedHash = ref<string | undefined>(props.initialState?.selectedHash);
const commitSection = ref<ChangesSectionDto | null>(null);

const openIds = reactive<Record<string, true>>({});
const loadingIds = reactive<Record<string, true>>({});
const selectedNodeId = ref<string | null>(null);

/** Заголовок секции изменений: короткий хеш и тема выбранного коммита. */
const commitHeader = computed<string | null>(() => {
  const hash = selectedHash.value;
  if (!hash) {
    return null;
  }
  const row = graph.value.rows.find((candidate) => candidate.hash === hash);
  if (!row) {
    return null;
  }
  return `Изменения коммита ${row.shortHash}: ${row.subject}`;
});

const hasCommitChanges = computed(() => (commitSection.value?.nodes.length ?? 0) > 0);

/**
 * Раскрывает всю навигаторную ветвь секции коммита, чтобы изменения были видны
 * сразу без ручного разворота (как в панели изменений).
 */
function expandSection(section: ChangesSectionDto): void {
  const visit = (nodes: readonly TreeNodeDto[]): void => {
    for (const node of nodes) {
      if (node.hasChildren) {
        openIds[node.id] = true;
      }
      if (node.children) {
        visit(node.children);
      }
    }
  };
  visit(section.nodes);
}

function sendCommand(command: string, payload?: Record<string, unknown>): void {
  props.messageBus.send({ type: 'command', command, payload });
}

function onSelectCommit(hash: string): void {
  selectedHash.value = hash;
  sendCommand('selectCommit', { hash });
}

function onToggle(nodeId: string, open: boolean): void {
  if (open) {
    openIds[nodeId] = true;
  } else {
    delete openIds[nodeId];
  }
}

function onSelectNode(nodeId: string | null): void {
  selectedNodeId.value = nodeId;
}

function onDefault(nodeId: string): void {
  sendCommand('openDiff', { nodeId });
}

function onLoadMore(): void {
  sendCommand('loadMore');
}

function onRefresh(): void {
  sendCommand('refresh');
}

function handleGraph(message: { type: 'graph'; state: HistoryGraphState }): void {
  graph.value = message.state;
  selectedHash.value = message.state.selectedHash;
}

function handleCommitChanges(message: { type: 'commitChanges'; hash: string; section: ChangesSectionDto }): void {
  commitSection.value = message.section;
  for (const key of Object.keys(openIds)) {
    delete openIds[key];
  }
  expandSection(message.section);
}

onMounted(() => {
  props.messageBus.on('graph', handleGraph);
  props.messageBus.on('commitChanges', handleCommitChanges);
});

onUnmounted(() => {
  props.messageBus.off('graph', handleGraph);
  props.messageBus.off('commitChanges', handleCommitChanges);
});
</script>

<template>
  <div class="history-panel">
    <div class="history-toolbar">
      <button class="toolbar-button" title="Обновить" @click="onRefresh">
        <span class="codicon codicon-refresh" />
        <span>Обновить</span>
      </button>
    </div>

    <div class="history-split">
      <section class="graph-pane">
        <CommitGraph
          :rows="graph.rows"
          :lane-count="graph.laneCount"
          :selected-hash="selectedHash"
          @select="onSelectCommit"
        />
        <div v-if="graph.hasMore" class="load-more">
          <button class="toolbar-button" @click="onLoadMore">Загрузить ещё</button>
        </div>
      </section>

      <section class="changes-pane">
        <div v-if="hasCommitChanges && commitSection" class="changes-content">
          <div class="section-header">{{ commitHeader ?? commitSection.label }}</div>
          <UniversalTree
            :nodes="commitSection.nodes"
            :selected-id="selectedNodeId"
            :open-ids="openIds"
            :loading-ids="loadingIds"
            @toggle="onToggle"
            @select="onSelectNode"
            @default="onDefault"
          />
        </div>
        <div v-else class="changes-empty">
          <div class="empty-icon codicon codicon-git-commit" />
          <p class="empty-title">Выберите коммит</p>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
/* Панель истории — во всю ширину вкладки редактора: снимаем внешние отступы,
   которые VS Code по умолчанию навешивает на body webview. Изолировано
   бандлом `history`. */
:global(html),
:global(body),
:global(#app) {
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
}
.history-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  color: var(--vscode-foreground);
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size, 13px);
}
.history-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--vscode-panel-border);
}
.toolbar-button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  background: transparent;
  color: var(--vscode-foreground);
  border: 1px solid var(--vscode-button-border, transparent);
  border-radius: 3px;
  cursor: pointer;
  font-size: 12px;
}
.toolbar-button:hover {
  background: var(--vscode-list-hoverBackground);
}
.history-split {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.graph-pane {
  flex: 1 1 60%;
  min-height: 0;
  overflow-y: auto;
  border-bottom: 1px solid var(--vscode-panel-border);
}
.load-more {
  padding: 6px 10px;
  text-align: center;
}
.changes-pane {
  flex: 1 1 40%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.changes-content {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
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
