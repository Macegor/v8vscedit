import { createApp } from 'vue';
import '@vscode/codicons/dist/codicon.css';
import '@ui-shared/vscode-elements';
import { loadInitialState } from '@ui-shared/api/loadInitialState';
import { MessageBus } from '@ui-shared/api/messageBus';
import type { ChangesViewState } from '@ui-shared/types/changes';
import ChangesApp from './ChangesApp.vue';

export type { ChangesViewState };

const initialState = loadInitialState<ChangesViewState | null>('changes');
const messageBus = new MessageBus();

const app = createApp(ChangesApp, { initialState, messageBus });
app.provide('messageBus', messageBus);
app.mount('#app');

messageBus.start();
messageBus.send({ type: 'ready' });
