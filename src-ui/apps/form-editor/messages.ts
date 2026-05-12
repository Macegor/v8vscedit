import type { HostToUiMessage } from '@ui-shared/protocol/hostMessages';

export type FormEditorHostMessage = HostToUiMessage;

export interface FormEditorSelectPayload {
  readonly id: number;
}

export interface FormEditorEditPayload {
  readonly elementId?: number;
  readonly property: string;
  readonly value: unknown;
}

export interface FormEditorSetPreviewModePayload {
  readonly mode: 'taxi' | 'onec85';
}

export type FormEditorUiMessage =
  | { readonly type: 'command'; readonly command: 'selectElement'; readonly payload: FormEditorSelectPayload }
  | { readonly type: 'command'; readonly command: 'updateProperty'; readonly payload: FormEditorEditPayload }
  | { readonly type: 'command'; readonly command: 'deleteElement'; readonly payload: { readonly id?: number } }
  | { readonly type: 'command'; readonly command: 'addElement' }
  | { readonly type: 'command'; readonly command: 'undo' }
  | { readonly type: 'command'; readonly command: 'redo' }
  | { readonly type: 'command'; readonly command: 'setPreviewMode'; readonly payload: FormEditorSetPreviewModePayload };
