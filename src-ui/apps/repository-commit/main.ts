import { createApp } from 'vue';
import '@ui-shared/vscode-elements';
import { loadInitialState } from '@ui-shared/api/loadInitialState';
import { MessageBus } from '@ui-shared/api/messageBus';
import RepositoryCommitApp from './RepositoryCommitApp.vue';

export interface RepositoryCommitState {
  readonly targetLabel: string;
  readonly initiallyLocked: boolean;
}

const initialState = loadInitialState<RepositoryCommitState>('repository-commit');
const messageBus = new MessageBus();

const app = createApp(RepositoryCommitApp, { initialState, messageBus });
app.provide('messageBus', messageBus);
app.mount('#app');

messageBus.start();
messageBus.send({ type: 'ready' });
