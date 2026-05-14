import { createApp } from 'vue';
import '@ui-shared/vscode-elements';
import '@ui-shared/styles/reset.css';
import '@ui-shared/styles/webview-base.css';
import { loadInitialState } from '@ui-shared/api/loadInitialState';
import { MessageBus } from '@ui-shared/api/messageBus';
import type { ProjectEnvironmentSnapshot } from '@ui-shared/types/environment';
import EnvironmentApp from './EnvironmentApp.vue';

const initialState = loadInitialState<ProjectEnvironmentSnapshot>('environment');
const messageBus = new MessageBus();

const app = createApp(EnvironmentApp, { initialState, messageBus });
app.provide('messageBus', messageBus);
app.mount('#app');

messageBus.start();
messageBus.send({ type: 'ready' });
