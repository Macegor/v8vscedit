export interface SubsystemToggleContentPayload {
  readonly id: string;
  readonly included: boolean;
}

export interface SubsystemOpenChildPayload {
  readonly id: string;
}

export type SubsystemUiMessage =
  | { readonly type: 'command'; readonly command: 'toggleContent'; readonly payload: SubsystemToggleContentPayload }
  | { readonly type: 'command'; readonly command: 'openChild'; readonly payload: SubsystemOpenChildPayload }
  | { readonly type: 'command'; readonly command: 'propertyChanged'; readonly payload: { readonly key: string; readonly value: unknown } };
