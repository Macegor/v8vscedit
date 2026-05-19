export interface VscodeWebviewApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

let api: VscodeWebviewApi | undefined;

export function getVscodeApi(): VscodeWebviewApi {
  if (!api) {
    api = acquireVsCodeApi();
  }
  return api;
}

