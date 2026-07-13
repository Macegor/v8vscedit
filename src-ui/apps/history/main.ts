import { createApp } from 'vue';
import '@vscode/codicons/dist/codicon.css';
import '@ui-shared/vscode-elements';
import { loadInitialState } from '@ui-shared/api/loadInitialState';
import { MessageBus } from '@ui-shared/api/messageBus';
import type { HistoryGraphState } from '@ui-shared/types/history';
import HistoryApp from './HistoryApp.vue';

export type { HistoryGraphState };

const initialState = loadInitialState<HistoryGraphState | null>('history');
const messageBus = new MessageBus();

const app = createApp(HistoryApp, { initialState, messageBus });
app.mount('#app');

messageBus.start();
messageBus.send({ type: 'ready' });
