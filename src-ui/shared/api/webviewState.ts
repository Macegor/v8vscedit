import { getVscodeApi } from './vscodeApi';

/** Прочитать постоянное состояние webview */
export function getPersistentState<T>(): T | undefined {
  return getVscodeApi().getState() as T | undefined;
}

/** Записать постоянное состояние webview */
export function setPersistentState<T>(state: T): void {
  getVscodeApi().setState(state);
}

/** Частично обновить постоянное состояние webview */
export function updatePersistentState<T extends Record<string, unknown>>(patch: Partial<T>): void {
  const current = getPersistentState<T>() ?? {} as T;
  setPersistentState({ ...current, ...patch });
}
