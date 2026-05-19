/** Payload запроса загрузки дочерних узлов */
export interface UniversalTogglePayload {
  readonly nodeId: string;
}

/** Payload выбора узла */
export interface UniversalSelectPayload {
  readonly nodeId: string | null;
}

/** Payload выполнения действия над узлом */
export interface UniversalActionPayload {
  readonly nodeId: string;
  readonly actionId: string;
}

/** Payload загруженных дочерних узлов */
export interface UniversalLoadChildrenPayload {
  readonly nodeId: string;
  readonly children: import('@ui-shared/types/tree').TreeNodeDto[];
}

/** Сообщения от webview к host */
export type UniversalUiMessage =
  | { readonly type: 'command'; readonly command: 'selectNode'; readonly payload: UniversalSelectPayload }
  | { readonly type: 'command'; readonly command: 'executeNodeAction'; readonly payload: UniversalActionPayload }
  | { readonly type: 'request'; readonly requestId: string; readonly name: 'loadChildren'; readonly payload: UniversalTogglePayload }
  | { readonly type: 'request'; readonly requestId: string; readonly name: 'search'; readonly payload: { readonly query: string } };

/** Сообщения от host к webview */
export interface UniversalHostMessage {
  readonly type: 'childrenLoaded';
  readonly requestId: string;
  readonly payload: UniversalLoadChildrenPayload;
}
