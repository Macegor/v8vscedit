import { createApp } from 'vue';
import { loadInitialState } from '@ui-shared/api/loadInitialState';
import { MessageBus } from '@ui-shared/api/messageBus';
import RepositoryConnectionApp from './RepositoryConnectionApp.vue';

/** Режим диалога: подключение или создание хранилища */
export type ConnectionMode = 'connect' | 'create';

/** Начальное состояние, переданное host-провайдером */
export interface RepositoryConnectionState {
  readonly mode: ConnectionMode;
  readonly target: string;
  readonly initialBinding: RepositoryBindingDto | null;
}

/** DTO ранее сохранённых параметров подключения */
export interface RepositoryBindingDto {
  readonly repoPath: string;
  readonly repoUser: string;
  readonly repoPassword: string;
}

const initialState = loadInitialState<RepositoryConnectionState>('repository-connection');
const messageBus = new MessageBus();

const app = createApp(RepositoryConnectionApp, { initialState, messageBus });
app.provide('messageBus', messageBus);
app.mount('#app');

messageBus.start();
messageBus.send({ type: 'ready' });
