import type { HostToUiMessage } from '@ui-shared/protocol/hostMessages';

/** Сообщения от host к webview панели tree-search */
export type TreeSearchHostMessage =
  | HostToUiMessage
  | { readonly type: 'searchState'; readonly value: string };

/** Сообщения от webview панели tree-search к host */
export type TreeSearchUiMessage =
  | { readonly type: 'command'; readonly command: string }
  | { readonly type: 'search'; readonly value: string }
  | { readonly type: 'clearSearch' };
