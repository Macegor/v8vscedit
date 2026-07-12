<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { MessageBus } from '@ui-shared/api/messageBus';
import type { HostToUiMessage } from '@ui-shared/protocol/hostMessages';
import UniversalTree from '@ui-shared/components/tree/UniversalTree.vue';
import type { SubsystemState, SubsystemTreeNodeDto } from './main';

type IdMap = Readonly<Record<string, true>>;

const props = defineProps<{
  initialState: SubsystemState | null;
  messageBus: MessageBus;
}>();

const locked = ref(props.initialState?.locked ?? true);
const availableTree = ref<SubsystemTreeNodeDto[]>(props.initialState?.availableTree ?? []);
const contentTree = ref<SubsystemTreeNodeDto[]>(props.initialState?.contentTree ?? []);
const selectedAvailableId = ref<string | null>(null);
const selectedContentId = ref<string | null>(null);
const availableOpenIds = ref<IdMap>(openTopLevel(availableTree.value));
const contentOpenIds = ref<IdMap>(openTopLevel(contentTree.value));
const loadingIds = ref<IdMap>({});

const availableById = computed(() => indexTree(availableTree.value));
const contentById = computed(() => indexTree(contentTree.value));
const contentRefs = computed(() => collectRefs(contentTree.value));
const selectedAvailableRef = computed(() => refById(availableById.value, selectedAvailableId.value));
const selectedContentRef = computed(() => refById(contentById.value, selectedContentId.value));
const canAdd = computed(() => Boolean(selectedAvailableRef.value && !contentRefs.value.has(selectedAvailableRef.value) && !locked.value));
const canRemove = computed(() => Boolean(selectedContentRef.value && !locked.value));

function handleHostMessage(msg: HostToUiMessage): void {
  if (msg.type !== 'state') {
    return;
  }
  const state = msg.state as Partial<SubsystemState>;
  if (state.locked !== undefined) locked.value = state.locked;
  if (state.availableTree) availableTree.value = state.availableTree;
  if (state.contentTree) contentTree.value = state.contentTree;
  availableOpenIds.value = mergeOpenIds(availableOpenIds.value, openTopLevel(availableTree.value));
  contentOpenIds.value = mergeOpenIds(contentOpenIds.value, openTopLevel(contentTree.value));
  keepValidSelection();
}

function onAvailableToggle(nodeId: string, open: boolean): void {
  availableOpenIds.value = updateOpenIds(availableOpenIds.value, nodeId, open);
}

function onContentToggle(nodeId: string, open: boolean): void {
  contentOpenIds.value = updateOpenIds(contentOpenIds.value, nodeId, open);
}

function addSelected(): void {
  if (!canAdd.value || !selectedAvailableRef.value) {
    return;
  }
  props.messageBus.send({
    type: 'command',
    command: 'addContent',
    payload: { ref: selectedAvailableRef.value },
  });
}

function removeSelected(): void {
  if (!canRemove.value || !selectedContentRef.value) {
    return;
  }
  props.messageBus.send({
    type: 'command',
    command: 'removeContent',
    payload: { ref: selectedContentRef.value },
  });
}

function onAvailableDefault(nodeId: string): void {
  selectedAvailableId.value = nodeId;
  addSelected();
}

function onContentDefault(nodeId: string): void {
  selectedContentId.value = nodeId;
  removeSelected();
}

function keepValidSelection(): void {
  if (selectedAvailableId.value && !availableById.value.has(selectedAvailableId.value)) {
    selectedAvailableId.value = null;
  }
  if (selectedContentId.value && !contentById.value.has(selectedContentId.value)) {
    selectedContentId.value = null;
  }
}

function indexTree(nodes: readonly SubsystemTreeNodeDto[]): Map<string, SubsystemTreeNodeDto> {
  const result = new Map<string, SubsystemTreeNodeDto>();
  const walk = (items: readonly SubsystemTreeNodeDto[]): void => {
    for (const item of items) {
      result.set(item.id, item);
      walk(item.children ?? []);
    }
  };
  walk(nodes);
  return result;
}

function collectRefs(nodes: readonly SubsystemTreeNodeDto[]): Set<string> {
  const result = new Set<string>();
  const walk = (items: readonly SubsystemTreeNodeDto[]): void => {
    for (const item of items) {
      if (item.ref) {
        result.add(item.ref);
      }
      walk(item.children ?? []);
    }
  };
  walk(nodes);
  return result;
}

function refById(index: ReadonlyMap<string, SubsystemTreeNodeDto>, id: string | null): string | null {
  if (!id) {
    return null;
  }
  return index.get(id)?.ref ?? null;
}

function openTopLevel(nodes: readonly SubsystemTreeNodeDto[]): IdMap {
  const result: Record<string, true> = {};
  for (const node of nodes) {
    if (node.hasChildren) {
      result[node.id] = true;
    }
  }
  return result;
}

function mergeOpenIds(left: IdMap, right: IdMap): IdMap {
  return { ...right, ...left };
}

function updateOpenIds(openIds: IdMap, nodeId: string, open: boolean): IdMap {
  const next: Record<string, true> = { ...openIds };
  if (open) {
    next[nodeId] = true;
  } else {
    delete next[nodeId];
  }
  return next;
}

onMounted(() => {
  props.messageBus.on('state', handleHostMessage);
});

onUnmounted(() => {
  props.messageBus.off('state', handleHostMessage);
});
</script>

<template>
  <div class="subsystem-editor">
    <main class="content-layout">
      <section class="tree-pane" aria-label="Дерево конфигурации">
        <div class="pane-header">
          <span class="pane-title">Конфигурация</span>
          <span v-if="locked" class="locked-badge">Заблокировано</span>
        </div>
        <div class="tree-pane-body">
          <UniversalTree
            :nodes="availableTree"
            :selected-id="selectedAvailableId"
            :open-ids="availableOpenIds"
            :loading-ids="loadingIds"
            @toggle="onAvailableToggle"
            @select="selectedAvailableId = $event"
            @default="onAvailableDefault"
            @action="() => undefined"
            @context-menu="() => undefined"
          />
        </div>
      </section>

      <div class="transfer-actions" aria-label="Изменение состава">
        <vscode-button
          appearance="icon"
          title="Добавить в состав"
          aria-label="Добавить в состав"
          :disabled="!canAdd"
          @click="addSelected"
        >
          <span class="codicon codicon-arrow-right" aria-hidden="true"></span>
        </vscode-button>
        <vscode-button
          appearance="icon"
          title="Удалить из состава"
          aria-label="Удалить из состава"
          :disabled="!canRemove"
          @click="removeSelected"
        >
          <span class="codicon codicon-arrow-left" aria-hidden="true"></span>
        </vscode-button>
      </div>

      <section class="tree-pane" aria-label="Объекты в составе подсистемы">
        <div class="pane-header">
          <span class="pane-title">Состав</span>
        </div>
        <div class="tree-pane-body">
          <UniversalTree
            :nodes="contentTree"
            :selected-id="selectedContentId"
            :open-ids="contentOpenIds"
            :loading-ids="loadingIds"
            @toggle="onContentToggle"
            @select="selectedContentId = $event"
            @default="onContentDefault"
            @action="() => undefined"
            @context-menu="() => undefined"
          />
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
.subsystem-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size, 13px);
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
}

.locked-badge {
  flex: 0 0 auto;
  font-size: 11px;
  padding: 2px 8px;
  color: var(--vscode-badge-foreground);
  background: var(--vscode-badge-background);
  border-radius: 2px;
}

.content-layout {
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(260px, 1fr) 38px minmax(260px, 1fr);
  gap: 8px;
  padding: 8px;
  box-sizing: border-box;
}

.tree-pane {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 6px;
  background: var(--vscode-sideBar-background);
  overflow: hidden;
}

.pane-header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 30px;
  padding: 0 8px;
  border-bottom: 1px solid var(--vscode-panel-border);
  box-sizing: border-box;
}

.pane-title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 600;
}

.tree-pane-body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
}

.transfer-actions {
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.transfer-actions vscode-button {
  width: 28px;
  height: 28px;
}

@media (max-width: 720px) {
  .content-layout {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(180px, 1fr) auto minmax(180px, 1fr);
  }

  .transfer-actions {
    min-height: 36px;
    flex-direction: row;
  }

  .transfer-actions .codicon-arrow-right {
    transform: rotate(90deg);
  }

  .transfer-actions .codicon-arrow-left {
    transform: rotate(90deg);
  }
}
</style>
