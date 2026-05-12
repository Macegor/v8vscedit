export type UiToHostMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'refresh' }
  | { readonly type: 'command'; readonly command: string; readonly payload?: unknown }
  | { readonly type: 'request'; readonly requestId: string; readonly name: string; readonly payload?: unknown };

