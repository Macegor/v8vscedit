import { createApp } from 'vue';
import '@ui-shared/vscode-elements';
import '@ui-shared/styles/reset.css';
import { loadInitialState } from '@ui-shared/api/loadInitialState';
import { MessageBus } from '@ui-shared/api/messageBus';
import type { StandaloneServerSettingsSnapshot } from '@ui-shared/types/standalone';
import StandaloneApp from './StandaloneApp.vue';

const initialState = loadInitialState<StandaloneServerSettingsSnapshot>('standalone');
const messageBus = new MessageBus();

const app = createApp(StandaloneApp, { initialState, messageBus });
app.provide('messageBus', messageBus);
app.mount('#app');

messageBus.start();
messageBus.send({ type: 'ready' });
