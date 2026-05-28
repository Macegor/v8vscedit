import { createApp } from 'vue';
import '@ui-shared/vscode-elements';
import { loadInitialState } from '@ui-shared/api/loadInitialState';
import { MessageBus } from '@ui-shared/api/messageBus';
import type { TreeNodeDto } from '@ui-shared/types/tree';
import SubsystemApp from './SubsystemApp.vue';

export interface SubsystemState {
  readonly initialized: boolean;
  readonly subsystemId: string;
  readonly subsystemName: string;
  readonly locked: boolean;
  readonly availableTree: SubsystemTreeNodeDto[];
  readonly contentTree: SubsystemTreeNodeDto[];
}

export interface SubsystemTreeNodeDto extends TreeNodeDto {
  readonly ref?: string;
  readonly children?: SubsystemTreeNodeDto[];
}

const initialState = loadInitialState<SubsystemState | null>('subsystem');
const messageBus = new MessageBus();

const app = createApp(SubsystemApp, { initialState, messageBus });
app.provide('messageBus', messageBus);
app.mount('#app');

messageBus.start();
messageBus.send({ type: 'ready' });
