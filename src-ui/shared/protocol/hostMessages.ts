export type HostStatusKind = 'idle' | 'loading' | 'success' | 'error';

export type HostToUiMessage<TState = unknown> =
  | { readonly type: 'init'; readonly state: TState }
  | { readonly type: 'state'; readonly state: TState }
  | { readonly type: 'standaloneStatus'; readonly status: unknown }
  | {
      readonly type: 'childrenLoaded';
      readonly nodeId: string;
      readonly children: unknown[];
      readonly append?: boolean;
      readonly done?: boolean;
    }
  | { readonly type: 'status'; readonly kind: HostStatusKind; readonly message: string }
  | { readonly type: 'reply'; readonly requestId: string; readonly payload: unknown }
  | { readonly type: 'error'; readonly requestId?: string; readonly message: string };
