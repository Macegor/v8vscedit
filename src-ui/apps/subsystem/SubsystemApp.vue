<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { MessageBus } from '@ui-shared/api/messageBus';
import type { HostToUiMessage } from '@ui-shared/protocol/hostMessages';
import type { SubsystemState, SubsystemContentItemDto } from './main';
import SubsystemPropertiesTab from './tabs/SubsystemPropertiesTab.vue';
import SubsystemContentTab from './tabs/SubsystemContentTab.vue';
import SubsystemChildrenTab from './tabs/SubsystemChildrenTab.vue';

const props = defineProps<{
  initialState: SubsystemState | null;
  messageBus: MessageBus;
}>();

const tabs = [
  { id: 'properties', label: 'Свойства' },
  { id: 'content', label: 'Состав' },
  { id: 'children', label: 'Подсистемы' },
  { id: 'commandInterface', label: 'Командный интерфейс' },
] as const;

type TabId = typeof tabs[number]['id'];

const subsystemName = ref(props.initialState?.subsystemName ?? '');
const locked = ref(props.initialState?.locked ?? true);
const activeTab = ref<TabId>(props.initialState?.activeTab ?? 'properties');
const properties = ref(props.initialState?.properties ?? {});
const content = ref<SubsystemContentItemDto[]>(props.initialState?.content ?? []);
const children = ref(props.initialState?.children ?? []);

function handleHostMessage(msg: HostToUiMessage): void {
  if (msg.type === 'state') {
    const state = msg.state as Partial<SubsystemState>;
    if (state.subsystemName !== undefined) subsystemName.value = state.subsystemName;
    if (state.locked !== undefined) locked.value = state.locked;
    if (state.properties) properties.value = state.properties;
    if (state.content) content.value = state.content;
    if (state.children) children.value = state.children;
    if (state.activeTab) activeTab.value = state.activeTab;
  }
}

function onToggleContent(item: SubsystemContentItemDto): void {
  if (locked.value) return;
  props.messageBus.send({
    type: 'command',
    command: 'toggleContent',
    payload: { id: item.id, included: !item.included },
  });
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
    <div class="editor-header">
      <h2 class="editor-title">{{ subsystemName }}</h2>
      <span v-if="locked" class="locked-badge">Заблокировано</span>
    </div>

    <div class="tabs-bar" role="tablist">
      <vscode-button
        v-for="tab in tabs"
        :key="tab.id"
        class="tab-button"
        :class="{ active: activeTab === tab.id }"
        role="tab"
        :aria-selected="activeTab === tab.id"
        @click="activeTab = tab.id"
      >
        {{ tab.label }}
      </vscode-button>
    </div>

    <div class="tab-content">
      <SubsystemPropertiesTab
        v-if="activeTab === 'properties'"
        :properties="properties"
        :locked="locked"
        :message-bus="messageBus"
      />
      <SubsystemContentTab
        v-if="activeTab === 'content'"
        :items="content"
        :locked="locked"
        @toggle="onToggleContent"
      />
      <SubsystemChildrenTab
        v-if="activeTab === 'children'"
        :children="children"
        :locked="locked"
        :message-bus="messageBus"
      />
      <div v-if="activeTab === 'commandInterface'" class="tab-placeholder">
        Командный интерфейс (в разработке)
      </div>
    </div>
  </div>
</template>

<style scoped>
.subsystem-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size, 13px);
  color: var(--vscode-foreground);
}

.editor-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--vscode-panel-border);
}

.editor-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  flex: 1;
}

.locked-badge {
  font-size: 11px;
  padding: 2px 8px;
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
  border-radius: 2px;
}

.tabs-bar {
  display: flex;
  border-bottom: 1px solid var(--vscode-panel-border);
  background: var(--vscode-sidebar-background);
}

.tab-button {
  border-bottom: 2px solid transparent !important;
  border-radius: 0 !important;
}

.tab-button.active {
  border-bottom-color: var(--vscode-tab-activeForeground, var(--vscode-foreground)) !important;
}

.tab-content {
  flex: 1;
  overflow-y: auto;
}

.tab-placeholder {
  padding: 24px;
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
  text-align: center;
}
</style>
