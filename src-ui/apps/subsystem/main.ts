import { createApp } from 'vue';
import { loadInitialState } from '@ui-shared/api/loadInitialState';
import { MessageBus } from '@ui-shared/api/messageBus';
import SubsystemApp from './SubsystemApp.vue';

export interface SubsystemState {
  readonly initialized: boolean;
  readonly subsystemId: string;
  readonly subsystemName: string;
  readonly locked: boolean;
  readonly properties: Record<string, unknown>;
  readonly content: SubsystemContentItemDto[];
  readonly children: SubsystemChildDto[];
  readonly activeTab: 'properties' | 'content' | 'children' | 'commandInterface';
}

export interface SubsystemContentItemDto {
  readonly id: string;
  readonly label: string;
  readonly included: boolean;
  readonly kind?: string;
}

export interface SubsystemChildDto {
  readonly id: string;
  readonly name: string;
  readonly label: string;
}

const initialState = loadInitialState<SubsystemState | null>('subsystem');
const messageBus = new MessageBus();

const app = createApp(SubsystemApp, { initialState, messageBus });
app.provide('messageBus', messageBus);
app.mount('#app');

messageBus.start();
messageBus.send({ type: 'ready' });
