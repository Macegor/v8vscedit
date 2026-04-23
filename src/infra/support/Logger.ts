/**
 * Минимальный контракт логгера в инфраструктурном слое.
 *
 * Структурно совместим с `vscode.OutputChannel`, что позволяет передавать
 * его напрямую, не импортируя `vscode` в `infra/*`.
 */
export interface Logger {
  appendLine(message: string): void;
}
