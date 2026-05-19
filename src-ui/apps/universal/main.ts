import { createApp } from 'vue';
import '@vscode/codicons/dist/codicon.css';
import '@ui-shared/vscode-elements';
import { loadInitialState } from '@ui-shared/api/loadInitialState';
import { MessageBus } from '@ui-shared/api/messageBus';
import type { TreeNodeDto, OwnershipKind, SupportMode } from '@ui-shared/types/tree';
import UniversalApp from './UniversalApp.vue';

export { TreeNodeDto, OwnershipKind, SupportMode };

export type StandaloneServerState = 'unconfigured' | 'running' | 'unresponsive' | 'stopped' | 'stale' | 'busy';

export interface StandaloneServerStatusDto {
  readonly configured: boolean;
  readonly state: StandaloneServerState;
  readonly port?: number;
  readonly pid?: number;
  readonly name?: string;
}

export interface UniversalPanelState {
  readonly initialized: boolean;
  readonly processing: boolean;
  readonly processingTitle?: string;
  readonly processingMessage?: string;
  readonly searchQuery: string;
  readonly openNodeIds: readonly string[];
  readonly selectedNodeId?: string;
  readonly rootNodes: readonly TreeNodeDto[];
  readonly standaloneStatus: StandaloneServerStatusDto;
}

const initialState = loadInitialState<UniversalPanelState | null>('universal');
const messageBus = new MessageBus();

const app = createApp(UniversalApp, { initialState, messageBus });
app.provide('messageBus', messageBus);
app.mount('#app');

messageBus.start();
messageBus.send({ type: 'ready' });
