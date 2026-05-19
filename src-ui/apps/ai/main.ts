import { createApp } from 'vue';
import '@ui-shared/vscode-elements';
import '@ui-shared/styles/reset.css';
import '@ui-shared/styles/webview-base.css';
import { loadInitialState } from '@ui-shared/api/loadInitialState';
import { MessageBus } from '@ui-shared/api/messageBus';
import type { AiMcpSnapshot } from '@ui-shared/types/ai';
import AiMcpApp from './AiMcpApp.vue';

const initialState = loadInitialState<AiMcpSnapshot>('ai');
const messageBus = new MessageBus();

const app = createApp(AiMcpApp, { initialState, messageBus });
app.provide('messageBus', messageBus);
app.mount('#app');

messageBus.start();
messageBus.send({ type: 'ready' });
