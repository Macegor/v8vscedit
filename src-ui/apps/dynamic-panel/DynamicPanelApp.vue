<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { MessageBus } from '@ui-shared/api/messageBus';
import type { HostToUiMessage } from '@ui-shared/protocol/hostMessages';
import type { DynamicPanelState, RangeDto } from '@ui-shared/types/dynamicPanel';
import EmptyView from './views/EmptyView.vue';
import ModuleStructureView from './views/ModuleStructureView.vue';
import PropertiesView from './views/properties/PropertiesView.vue';

const props = defineProps<{
  initialState: DynamicPanelState | null;
  messageBus: MessageBus;
}>();

const state = ref<DynamicPanelState>(props.initialState ?? { kind: 'empty' });

function handleHostMessage(msg: HostToUiMessage): void {
  if (msg.type === 'state') {
    state.value = (msg.state as DynamicPanelState | null) ?? { kind: 'empty' };
  }
}

function sendCommand(command: string, payload?: Record<string, unknown>): void {
  // payload может содержать Vue Proxy (если пришёл из реактивного state);
  // postMessage через structuredClone не клонирует Proxy → DataCloneError.
  const safePayload = payload === undefined
    ? undefined
    : (JSON.parse(JSON.stringify(payload)) as Record<string, unknown>);
  props.messageBus.send({ type: 'command', command, payload: safePayload });
}

function onRevealSymbol(range: RangeDto): void {
  sendCommand('revealSymbol', { range });
}

onMounted(() => {
  props.messageBus.on('state', handleHostMessage);
});

onUnmounted(() => {
  props.messageBus.off('state', handleHostMessage);
});
</script>

<template>
  <div class="dynamic-panel">
    <EmptyView v-if="state.kind === 'empty'" :message="state.message" />
    <ModuleStructureView
      v-else-if="state.kind === 'module-structure'"
      :document="state.document"
      :symbols="state.symbols"
      :loading="state.loading"
      @reveal="onRevealSymbol"
    />
    <PropertiesView
      v-else-if="state.kind === 'properties'"
      :state="state.view"
      @command="(name, payload) => sendCommand(name, payload)"
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

.dynamic-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 0 10px;
  box-sizing: border-box;
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size, 13px);
  color: var(--vscode-foreground);
  background: var(--vscode-sideBar-background);
  overflow: hidden;
}
</style>
