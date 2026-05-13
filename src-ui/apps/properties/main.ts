import { createApp } from 'vue';
import '@ui-shared/vscode-elements';
import { loadInitialState } from '@ui-shared/api/loadInitialState';
import { MessageBus } from '@ui-shared/api/messageBus';
import type { PropertiesViewState } from '@ui-shared/types/property';
import PropertiesApp from './PropertiesApp.vue';

const initialState = loadInitialState<PropertiesViewState | null>('properties');
const messageBus = new MessageBus();

const app = createApp(PropertiesApp, { initialState, messageBus });
app.provide('messageBus', messageBus);
app.mount('#app');

messageBus.start();
messageBus.send({ type: 'ready' });
