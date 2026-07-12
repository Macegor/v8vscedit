<script setup lang="ts">
import { ref, shallowRef, watchEffect, onMounted, onUnmounted } from 'vue';
import { MessageBus } from '@ui-shared/api/messageBus';
import type { HostToUiMessage } from '@ui-shared/protocol/hostMessages';
import type { TreeNodeDto, TreeNodeActionDto } from '@ui-shared/types/tree';
import type { UniversalPanelState, StandaloneServerStatusDto } from './main';
import UniversalTree from '@ui-shared/components/tree/UniversalTree.vue';
import UniversalSearchBox from './UniversalSearchBox.vue';
import UniversalProcessingOverlay from './UniversalProcessingOverlay.vue';
import UniversalStandaloneActions from './UniversalStandaloneActions.vue';
import AppContextMenu, { type ContextMenuItem } from '@ui-shared/components/AppContextMenu.vue';

type IdMap = Readonly<Record<string, true>>;

const props = defineProps<{
  initialState: UniversalPanelState | null;
  messageBus: MessageBus;
}>();

const initialized = ref(props.initialState?.initialized ?? false);
const processing = ref(props.initialState?.processing ?? false);
const processingTitle = ref(props.initialState?.processingTitle ?? '');
const processingMessage = ref(props.initialState?.processingMessage ?? '');
const searchQuery = ref(props.initialState?.searchQuery ?? '');
const openNodeIds = ref<IdMap>(toIdMap(props.initialState?.openNodeIds));
const loadingNodeIds = ref<IdMap>(Object.freeze({}));
const rootNodes = ref<TreeNodeDto[]>([...(props.initialState?.rootNodes ?? [])]);
const standaloneStatus = ref<StandaloneServerStatusDto>(
  props.initialState?.standaloneStatus ?? { configured: false, state: 'unconfigured' },
);

const selectedNodeId = ref<string | null>(props.initialState?.selectedNodeId ?? null);

/** Плоский индекс по id — обновляется watchEffect-ом при изменении rootNodes. shallowRef — Map не нужно делать реактивной. */
const nodeIndex = shallowRef<Map<string, TreeNodeDto>>(new Map());
watchEffect(() => {
  const index = new Map<string, TreeNodeDto>();
  buildNodeIndex(rootNodes.value, index);
  nodeIndex.value = index;
});

const STANDALONE_POLL_INTERVAL_MS = 1_000;
const STANDALONE_POLL_DURATION_MS = 8_000;
let standalonePollTimer: ReturnType<typeof setInterval> | undefined;
let standalonePollStopAt = 0;

const contextMenu = ref<{
  visible: boolean;
  x: number;
  y: number;
  actions: readonly TreeNodeActionDto[];
}>({
  visible: false,
  x: 0,
  y: 0,
  actions: [],
});

function onToggle(nodeId: string, open: boolean): void {
  if (open) {
    if (!openNodeIds.value[nodeId]) {
      openNodeIds.value = { ...openNodeIds.value, [nodeId]: true };
    }
    const node = findNodeById(nodeId);
    if (node && !node.loaded && !loadingNodeIds.value[nodeId]) {
      loadingNodeIds.value = { ...loadingNodeIds.value, [nodeId]: true };
      props.messageBus.send({
        type: 'request',
        requestId: `load_${nodeId}`,
        name: 'loadChildren',
        payload: { nodeId },
      });
    }
  } else if (openNodeIds.value[nodeId]) {
    const { [nodeId]: _removed, ...rest } = openNodeIds.value;
    openNodeIds.value = rest;
  }
  props.messageBus.send({
    type: 'command',
    command: 'toggleNode',
    payload: { nodeId, open },
  });
}

function onSelect(nodeId: string | null): void {
  selectedNodeId.value = nodeId;
  if (nodeId) {
    props.messageBus.send({
      type: 'command',
      command: 'selectNode',
      payload: { nodeId },
    });
  }
}

function onNodeAction(nodeId: string, actionId: string): void {
  props.messageBus.send({
    type: 'command',
    command: 'executeNodeAction',
    payload: { nodeId, actionId },
  });
}

function onNodeDefault(nodeId: string): void {
  selectedNodeId.value = nodeId;
  props.messageBus.send({
    type: 'command',
    command: 'nodeDefault',
    payload: { nodeId },
  });
}

function sendCommand(command: string): void {
  props.messageBus.send({ type: 'command', command });
  if (command.startsWith('v8vscedit.standalone.')) {
    startStandalonePollBurst();
  }
}

function requestStandaloneStatus(): void {
  props.messageBus.send({
    type: 'request',
    requestId: 'standaloneStatus',
    name: 'refreshStandaloneStatus',
  });
}

/** После команды управления автономным сервером кратко поллим статус — пока хост не эмитит push. */
function startStandalonePollBurst(): void {
  standalonePollStopAt = Date.now() + STANDALONE_POLL_DURATION_MS;
  requestStandaloneStatus();
  if (standalonePollTimer) {
    return;
  }
  standalonePollTimer = setInterval(() => {
    if (Date.now() >= standalonePollStopAt) {
      stopStandalonePollBurst();
      return;
    }
    requestStandaloneStatus();
  }, STANDALONE_POLL_INTERVAL_MS);
}

function stopStandalonePollBurst(): void {
  if (standalonePollTimer) {
    clearInterval(standalonePollTimer);
    standalonePollTimer = undefined;
  }
}

function onSearch(query: string): void {
  searchQuery.value = query;
  props.messageBus.send({
    type: 'request',
    requestId: 'search',
    name: 'search',
    payload: { query },
  });
}

function onClearSearch(): void {
  searchQuery.value = '';
  onSearch('');
}

function onContextMenu(nodeId: string, event: MouseEvent): void {
  const node = findNodeById(nodeId);
  if (!node?.actions?.length) return;
  selectedNodeId.value = nodeId;
  contextMenu.value = {
    visible: true,
    x: event.clientX,
    y: event.clientY,
    actions: node.actions,
  };
}

function onContextMenuAction(action: ContextMenuItem): void {
  contextMenu.value.visible = false;
  const nodeId = selectedNodeId.value;
  if (nodeId) {
    onNodeAction(nodeId, action.id);
  }
}

function closeContextMenu(): void {
  contextMenu.value.visible = false;
}

function findNodeById(id: string): TreeNodeDto | undefined {
  return nodeIndex.value.get(id);
}

function buildNodeIndex(nodes: readonly TreeNodeDto[], target: Map<string, TreeNodeDto>): void {
  for (const node of nodes) {
    target.set(node.id, node);
    if (node.children?.length) {
      buildNodeIndex(node.children, target);
    }
  }
}

function toIdMap(ids: readonly string[] | undefined): IdMap {
  if (!ids?.length) return Object.freeze({});
  const map: Record<string, true> = {};
  for (const id of ids) {
    map[id] = true;
  }
  return Object.freeze(map);
}

function handleHostMessage(msg: HostToUiMessage): void {
  if (msg.type === 'state' || msg.type === 'init') {
    const state = msg.state as Partial<UniversalPanelState>;
    if (state.initialized !== undefined) initialized.value = state.initialized;
    if (state.processing !== undefined) processing.value = state.processing;
    if (state.processingTitle !== undefined) processingTitle.value = state.processingTitle;
    if (state.processingMessage !== undefined) processingMessage.value = state.processingMessage;
    if (state.searchQuery !== undefined) searchQuery.value = state.searchQuery;
    if (state.openNodeIds) openNodeIds.value = toIdMap(state.openNodeIds);
    if (state.selectedNodeId !== undefined) selectedNodeId.value = state.selectedNodeId;
    if (state.rootNodes) {
      rootNodes.value = state.rootNodes as TreeNodeDto[];
      // Чистим loadingNodeIds от уже подгруженных узлов.
      // nodeIndex обновится автоматически через watchEffect.
      const stillLoading: Record<string, true> = {};
      const tmpIndex = new Map<string, TreeNodeDto>();
      buildNodeIndex(rootNodes.value, tmpIndex);
      for (const id of Object.keys(loadingNodeIds.value)) {
        const node = tmpIndex.get(id);
        if (node && !node.loaded) stillLoading[id] = true;
      }
      loadingNodeIds.value = Object.freeze(stillLoading);
    }
    if (state.standaloneStatus) standaloneStatus.value = state.standaloneStatus as StandaloneServerStatusDto;
    return;
  }

  if (msg.type === 'childrenLoaded') {
    const updated = replaceNodeChildren(
      rootNodes.value,
      msg.nodeId,
      msg.children as TreeNodeDto[],
      msg.append === true,
      msg.done !== false,
    );
    if (updated) {
      rootNodes.value = updated;
    }
    if (msg.done !== false && loadingNodeIds.value[msg.nodeId]) {
      const { [msg.nodeId]: _removed, ...rest } = loadingNodeIds.value;
      loadingNodeIds.value = rest;
    }
    return;
  }

  if (msg.type === 'standaloneStatus') {
    standaloneStatus.value = msg.status as StandaloneServerStatusDto;
  }
}

/** Заменяет children у узла по id, возвращает новый массив узлов (иммутабельно) */
function replaceNodeChildren(
  nodes: readonly TreeNodeDto[],
  targetId: string,
  children: TreeNodeDto[],
  append: boolean,
  done: boolean,
): TreeNodeDto[] | null {
  for (let i = 0; i < nodes.length; i += 1) {
    if (nodes[i].id === targetId) {
      const updated = [...nodes];
      updated[i] = {
        ...nodes[i],
        children: append ? [...(nodes[i].children ?? []), ...children] : children,
        loaded: done,
      };
      return updated;
    }
    if (nodes[i].children) {
      const updatedChildren = replaceNodeChildren(nodes[i].children!, targetId, children, append, done);
      if (updatedChildren) {
        const updated = [...nodes];
        updated[i] = { ...nodes[i], children: updatedChildren };
        return updated;
      }
    }
  }
  return null;
}

onMounted(() => {
  props.messageBus.on('state', handleHostMessage);
  props.messageBus.on('init', handleHostMessage);
  props.messageBus.on('childrenLoaded', handleHostMessage);
  props.messageBus.on('standaloneStatus', handleHostMessage);
  // Однократный pull при монтировании — далее статус приходит push-ом в state
  // или burst-поллингом после команд автономного сервера.
  requestStandaloneStatus();
});

onUnmounted(() => {
  props.messageBus.off('state', handleHostMessage);
  props.messageBus.off('init', handleHostMessage);
  props.messageBus.off('childrenLoaded', handleHostMessage);
  props.messageBus.off('standaloneStatus', handleHostMessage);
  stopStandalonePollBurst();
});
</script>

<template>
  <div class="universal-panel">
    <UniversalProcessingOverlay
      v-if="processing"
      :title="processingTitle"
      :message="processingMessage"
    />

    <section class="operations" aria-label="Операции">
      <section v-if="!initialized" class="initialization" aria-label="Инициализация проекта">
        <div class="init-title">Проект не инициализирован</div>
        <div class="init-text">Будут созданы env.json и минимальные каталоги src/cf, src/cfe.</div>
        <button class="primary-action" type="button" @click="sendCommand('v8vscedit.initializeProject')">
          Инициализировать проект
        </button>
      </section>

      <template v-else>
        <div class="actions">
          <button type="button" title="Импортировать конфигурации из базы" aria-label="Импортировать конфигурации из базы" @click="sendCommand('v8vscedit.importConfigurations')">
            <span class="codicon codicon-cloud-download" aria-hidden="true" />
          </button>
          <button type="button" title="Обновить изменённые конфигурации" aria-label="Обновить изменённые конфигурации" @click="sendCommand('v8vscedit.updateChangedConfigurations')">
            <span class="codicon codicon-sync" aria-hidden="true" />
          </button>
          <button type="button" title="Запустить тонкий клиент" aria-label="Запустить тонкий клиент" @click="sendCommand('v8vscedit.runThinClient')">
            <span class="codicon codicon-play" aria-hidden="true" />
          </button>
          <button type="button" title="Запустить конфигуратор" aria-label="Запустить конфигуратор" @click="sendCommand('v8vscedit.runConfigurator')">
            <span class="codicon codicon-tools" aria-hidden="true" />
          </button>
          <button type="button" title="Настройки проекта" aria-label="Настройки проекта" @click="sendCommand('v8vscedit.configureEnvironment')">
            <span class="codicon codicon-settings-gear" aria-hidden="true" />
          </button>
          <button type="button" title="ИИ и MCP" aria-label="ИИ и MCP" @click="sendCommand('v8vscedit.openAiSettings')">
            <span class="ai-mark" aria-hidden="true">AI</span>
          </button>
        </div>

        <UniversalStandaloneActions
          :status="standaloneStatus"
          :message-bus="messageBus"
        />

        <UniversalSearchBox
          :query="searchQuery"
          @search="onSearch"
          @clear="onClearSearch"
        />
      </template>
    </section>

    <div v-if="initialized" class="panel-content">
      <UniversalTree
        :nodes="rootNodes"
        :selected-id="selectedNodeId"
        :open-ids="openNodeIds"
        :loading-ids="loadingNodeIds"
        @toggle="onToggle"
        @select="onSelect"
        @default="onNodeDefault"
        @action="onNodeAction"
        @context-menu="onContextMenu"
      />
    </div>

    <div v-else class="uninitialized-state">
      <div class="empty-icon codicon codicon-folder-opened" />
      <p class="empty-title">Проект не открыт</p>
      <p class="empty-description">Откройте папку с XML-выгрузкой конфигурации 1С</p>
    </div>

    <AppContextMenu
      :visible="contextMenu.visible"
      :x="contextMenu.x"
      :y="contextMenu.y"
      :items="contextMenu.actions"
      @select="onContextMenuAction"
      @close="closeContextMenu"
    />
  </div>
</template>

<style scoped>
:global(html),
:global(body),
:global(#app) {
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  overflow: hidden;
}
.universal-panel {
  display: flex;
  flex-direction: column;
  height: 100vh;
  min-height: 100vh;
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size, 13px);
  color: var(--vscode-foreground);
  background: var(--vscode-sideBar-background);
  position: relative;
  overflow: hidden;
}
.operations {
  flex: 0 0 auto;
  padding: 4px 6px 6px;
}
.actions {
  display: flex;
  align-items: center;
  gap: 3px;
}
button {
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid transparent;
  color: var(--vscode-icon-foreground);
  background: transparent;
  border-radius: 4px;
  font: inherit;
  cursor: pointer;
}
button:hover {
  background: var(--vscode-toolbar-hoverBackground);
  outline: 1px solid var(--vscode-toolbar-hoverOutline, transparent);
}
.ai-mark {
  font-size: 11px;
  line-height: 1;
  font-weight: 700;
  letter-spacing: 0;
}
.primary-action {
  width: 100%;
  height: auto;
  min-height: 30px;
  padding: 5px 10px;
  color: var(--vscode-button-foreground);
  background: var(--vscode-button-background);
  border-color: var(--vscode-button-border, transparent);
}
.primary-action:hover {
  background: var(--vscode-button-hoverBackground);
}
.panel-content {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.uninitialized-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
}
.initialization {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.init-title {
  font-weight: 600;
  color: var(--vscode-sideBarTitle-foreground, var(--vscode-foreground));
}
.init-text {
  color: var(--vscode-descriptionForeground);
  line-height: 1.35;
}
.empty-icon {
  font-size: 48px;
  color: var(--vscode-descriptionForeground);
  opacity: 0.4;
}
.empty-title {
  font-size: 14px;
  font-weight: 600;
  margin: 0;
  color: var(--vscode-foreground);
}
.empty-description {
  font-size: 12px;
  margin: 0;
  color: var(--vscode-descriptionForeground);
  text-align: center;
}
</style>
