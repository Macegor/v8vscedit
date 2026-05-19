export interface WebviewBootstrapState<T> {
  readonly viewKind: string;
  readonly state: T | null;
}

export function loadInitialState<T>(expectedViewKind: string): T | null {
  const script = document.getElementById('v8vscedit-initial-state');
  if (!script?.textContent) {
    return null;
  }

  const value = JSON.parse(script.textContent) as WebviewBootstrapState<T>;
  if (value.viewKind !== expectedViewKind) {
    throw new Error(`Ожидался webview "${expectedViewKind}", получен "${value.viewKind}"`);
  }
  return value.state;
}

