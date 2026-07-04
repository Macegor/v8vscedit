/**
 * Guard для команд, инициируемых из webview (S2).
 *
 * Webview не должен уметь исполнять произвольную VS Code-команду: при пробое CSP
 * или подмене контента скомпрометированный webview иначе смог бы дёрнуть любую
 * системную команду (`workbench.action.*`, команды других расширений). Разрешаем
 * только команды расширения (`v8vscedit.*`), которые реально зарегистрированы в
 * системе, — префикс сам по себе доверия не даёт (иначе обход подделкой имени).
 */

/** Префикс идентификаторов команд этого расширения. */
export const WEBVIEW_COMMAND_PREFIX = 'v8vscedit.';

/**
 * Разрешена ли команда к исполнению из webview.
 *
 * Список зарегистрированных команд передаётся параметром (обычно результат
 * `vscode.commands.getCommands(true)`), чтобы функция оставалась чистой и
 * детерминированно тестируемой. Сравнение строгое, с учётом регистра — как в
 * самом VS Code.
 */
export function isWebviewCommandAllowed(
  command: string,
  registeredCommands: readonly string[]
): boolean {
  if (!command.startsWith(WEBVIEW_COMMAND_PREFIX)) {
    return false;
  }
  // Отсекаем «голый» префикс без имени команды — он не может быть осмысленным
  // зарегистрированным идентификатором.
  if (command.length <= WEBVIEW_COMMAND_PREFIX.length) {
    return false;
  }
  return registeredCommands.includes(command);
}
