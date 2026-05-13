<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { MessageBus } from '@ui-shared/api/messageBus';
import type { HostToUiMessage } from '@ui-shared/protocol/hostMessages';
import type { TreeNodeDto, TreeNodeActionDto } from '@ui-shared/types/tree';
import type { UniversalPanelState, StandaloneServerStatusDto } from './main';
import UniversalTree from './UniversalTree.vue';
import UniversalSearchBox from './UniversalSearchBox.vue';
import UniversalProcessingOverlay from './UniversalProcessingOverlay.vue';
import UniversalStandaloneActions from './UniversalStandaloneActions.vue';
import UniversalContextMenu from './UniversalContextMenu.vue';

const props = defineProps<{
  initialState: UniversalPanelState | null;
  messageBus: MessageBus;
}>();

const initialized = ref(props.initialState?.initialized ?? false);
const processing = ref(props.initialState?.processing ?? false);
const searchQuery = ref(props.initialState?.searchQuery ?? '');
const openNodeIds = ref<Set<string>>(new Set(props.initialState?.openNodeIds ?? []));
const rootNodes = ref<TreeNodeDto[]>([...(props.initialState?.rootNodes ?? [])]);
const standaloneStatus = ref<StandaloneServerStatusDto>(
  props.initialState?.standaloneStatus ?? { state: 'unconfigured' },
);

const selectedNodeId = ref<string | null>(null);

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
  const set = openNodeIds.value;
  if (open) {
    set.add(nodeId);
    const node = findNodeById(nodeId);
    if (node && !node.loaded) {
      props.messageBus.send({
        type: 'request',
        requestId: `load_${nodeId}`,
        name: 'loadChildren',
        payload: { nodeId },
      });
    }
  } else {
    set.delete(nodeId);
  }
  openNodeIds.value = new Set(set);
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

function onContextMenuAction(action: TreeNodeActionDto): void {
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
  function search(nodes: TreeNodeDto[]): TreeNodeDto | undefined {
    for (const node of nodes) {
      if (node.id === id) return node;
      if (node.children) {
        const found = search(node.children);
        if (found) return found;
      }
    }
    return undefined;
  }
  return search(rootNodes.value);
}

function handleHostMessage(msg: HostToUiMessage): void {
  if (msg.type === 'state' || msg.type === 'init') {
    const state = msg.state as Partial<UniversalPanelState>;
    if (state.initialized !== undefined) initialized.value = state.initialized;
    if (state.processing !== undefined) processing.value = state.processing;
    if (state.searchQuery !== undefined) searchQuery.value = state.searchQuery;
    if (state.openNodeIds) openNodeIds.value = new Set(state.openNodeIds);
    if (state.rootNodes) rootNodes.value = state.rootNodes as TreeNodeDto[];
    if (state.standaloneStatus) standaloneStatus.value = state.standaloneStatus as StandaloneServerStatusDto;
    return;
  }

  if (msg.type === 'childrenLoaded') {
    const updated = replaceNodeChildren(rootNodes.value, msg.nodeId, msg.children as TreeNodeDto[]);
    if (updated) {
      rootNodes.value = updated;
    }
  }
}

/** Заменяет children у узла по id, возвращает новый массив узлов (иммутабельно) */
function replaceNodeChildren(nodes: readonly TreeNodeDto[], targetId: string, children: TreeNodeDto[]): TreeNodeDto[] | null {
  for (let i = 0; i < nodes.length; i += 1) {
    if (nodes[i].id === targetId) {
      const updated = [...nodes];
      updated[i] = { ...nodes[i], children, loaded: true };
      return updated;
    }
    if (nodes[i].children) {
      const updatedChildren = replaceNodeChildren(nodes[i].children!, targetId, children);
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
});

onUnmounted(() => {
  props.messageBus.off('state', handleHostMessage);
  props.messageBus.off('init', handleHostMessage);
  props.messageBus.off('childrenLoaded', handleHostMessage);
});
</script>

<template>
  <div class="universal-panel">
    <UniversalProcessingOverlay v-if="processing" />

    <UniversalSearchBox
      :query="searchQuery"
      @search="onSearch"
      @clear="onClearSearch"
    />

    <div v-if="initialized" class="panel-content">
      <UniversalTree
        :nodes="rootNodes"
        :selected-id="selectedNodeId"
        :open-ids="openNodeIds"
        @toggle="onToggle"
        @select="onSelect"
        @action="onNodeAction"
        @context-menu="onContextMenu"
      />

      <UniversalStandaloneActions
        :status="standaloneStatus"
        :message-bus="messageBus"
      />
    </div>

    <div v-else class="uninitialized-state">
      <div class="empty-icon codicon codicon-folder-opened" />
      <p class="empty-title">Проект не открыт</p>
      <p class="empty-description">Откройте папку с XML-выгрузкой конфигурации 1С</p>
    </div>

    <UniversalContextMenu
      :visible="contextMenu.visible"
      :x="contextMenu.x"
      :y="contextMenu.y"
      :actions="contextMenu.actions"
      @action="onContextMenuAction"
      @close="closeContextMenu"
    />
  </div>
</template>

<style scoped>
.universal-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size, 13px);
  color: var(--vscode-foreground);
  background: var(--vscode-sidebar-background);
  position: relative;
  overflow: hidden;
}
.panel-content {
  flex: 1;
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
