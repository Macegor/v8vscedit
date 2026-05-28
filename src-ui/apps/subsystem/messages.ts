export interface SubsystemContentPayload {
  readonly ref: string;
}

export type SubsystemUiMessage =
  | { readonly type: 'command'; readonly command: 'addContent'; readonly payload: SubsystemContentPayload }
  | { readonly type: 'command'; readonly command: 'removeContent'; readonly payload: SubsystemContentPayload };
