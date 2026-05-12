import { createApp } from 'vue';
import '@ui-shared/styles/reset.css';
import './styles.css';
import { loadInitialState } from '@ui-shared/api/loadInitialState';
import { MessageBus } from '@ui-shared/api/messageBus';
import FormEditorApp from './FormEditorApp.vue';

/**
 * DTO-типы состояния редактора формы,
 * приходящие от extension host через initial state / state-сообщения.
 */

export interface FormEditorState {
  readonly model: FormModelDto;
  readonly selectedElementId?: number;
  readonly previewMode: 'taxi' | 'onec85';
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

export interface FormModelDto {
  readonly root: FormElementDto;
  readonly attributes: FormAttributeDto[];
  readonly commands: FormCommandDto[];
}

export interface FormElementDto {
  readonly id: number;
  readonly name: string;
  readonly type: string;
  readonly group?: string;
  readonly dataPath?: string;
  readonly title?: string;
  readonly showTitle?: boolean;
  readonly horizontalStretch?: boolean;
  readonly verticalStretch?: boolean;
  readonly width?: number;
  readonly height?: number;
  readonly readOnly?: boolean;
  readonly visible?: boolean;
  readonly children: FormElementDto[];
}

export interface FormAttributeDto {
  readonly id: number;
  readonly name: string;
  readonly valueType: string;
  readonly isMain?: boolean;
  readonly savedData?: boolean;
}

export interface FormCommandDto {
  readonly id: number;
  readonly name: string;
  readonly title?: string;
  readonly action?: string;
  readonly representation?: string;
}

const initialState = loadInitialState<FormEditorState | null>('form-editor');
const messageBus = new MessageBus();

const app = createApp(FormEditorApp, { initialState, messageBus });
app.provide('messageBus', messageBus);
app.mount('#app');

messageBus.start();
messageBus.send({ type: 'ready' });
