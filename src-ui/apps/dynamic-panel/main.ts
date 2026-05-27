import { createApp } from 'vue';
import '@vscode/codicons/dist/codicon.css';
import '@ui-shared/vscode-elements';
import './styles/controls.css';
import { loadInitialState } from '@ui-shared/api/loadInitialState';
import { MessageBus } from '@ui-shared/api/messageBus';
import type { DynamicPanelState } from '@ui-shared/types/dynamicPanel';
import DynamicPanelApp from './DynamicPanelApp.vue';

const initialState = loadInitialState<DynamicPanelState | null>('dynamic-panel');
const messageBus = new MessageBus();

const app = createApp(DynamicPanelApp, { initialState, messageBus });
app.provide('messageBus', messageBus);
app.mount('#app');

messageBus.start();
messageBus.send({ type: 'ready' });
