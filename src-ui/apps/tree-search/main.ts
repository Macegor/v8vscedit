import { createApp } from 'vue';
import '@ui-shared/vscode-elements';
import { loadInitialState } from '@ui-shared/api/loadInitialState';
import { MessageBus } from '@ui-shared/api/messageBus';
import TreeSearchApp from './TreeSearchApp.vue';

/** Начальное состояние панели быстрых действий/поиска */
export interface TreeSearchState {
  readonly searchQuery: string;
  readonly initialized: boolean;
  readonly serverStatus: StandaloneServerStatusDto;
}

/** DTO состояния автономного сервера */
export interface StandaloneServerStatusDto {
  readonly state: 'unconfigured' | 'running' | 'unresponsive' | 'stopped' | 'stale' | 'busy';
  readonly port?: number;
  readonly pid?: number;
  readonly name?: string;
}

const initialState = loadInitialState<TreeSearchState>('tree-search');
const messageBus = new MessageBus();

const app = createApp(TreeSearchApp, { initialState, messageBus });
app.provide('messageBus', messageBus);
app.mount('#app');

messageBus.start();
messageBus.send({ type: 'ready' });
