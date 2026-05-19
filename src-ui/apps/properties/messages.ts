export interface PropertyChangePayload {
  readonly controlId: string;
  readonly value: unknown;
}

export interface PropertiesEditorMessage {
  readonly type: 'command';
  readonly command: 'propertyChanged';
  readonly payload: PropertyChangePayload;
}
