export type HostStatusKind = 'idle' | 'loading' | 'success' | 'error';

export type HostToUiMessage<TState = unknown> =
  | { readonly type: 'init'; readonly state: TState }
  | { readonly type: 'state'; readonly state: TState }
  | { readonly type: 'childrenLoaded'; readonly nodeId: string; readonly children: unknown[] }
  | { readonly type: 'status'; readonly kind: HostStatusKind; readonly message: string }
  | { readonly type: 'error'; readonly requestId?: string; readonly message: string };

