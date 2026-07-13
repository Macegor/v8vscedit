/**
 * Чистое решение о старте MCP-сервера при занятом preferred-порту.
 *
 * `V8McpServer.start` больше не авто-инкрементит порт: при `EADDRINUSE` он один
 * раз зондирует занявший порт процесс (`McpPortProbe.probeIdentity`) и передаёт
 * результат сюда. Здесь решается, переиспользовать ли чужой (но «свой» по
 * product+projectRoot) endpoint, сообщить ли о конфликте с v8vscedit другого
 * проекта или о конфликте с процессом, который вообще не наш MCP-сервер.
 */
import * as path from 'path';
import { PRODUCT_ID, type McpServerIdentity } from './McpServerIdentity';

export type McpStartDecision =
  | { readonly kind: 'reuse'; readonly endpoint: string }
  | { readonly kind: 'conflict-foreign'; readonly occupant: McpServerIdentity }
  | { readonly kind: 'conflict-unknown' };

/**
 * Обрезает хвостовой разделитель пути (кроме корня). На разных ОС/оболочках
 * `workspaceFolder.uri.fsPath` приходит то с `/` на конце, то без — без
 * нормализации reuse во втором окне того же проекта никогда бы не срабатывал.
 */
function normalizeProjectRoot(root: string): string {
  if (root.length > 1 && (root.endsWith(path.sep) || root.endsWith('/'))) {
    return root.slice(0, -1);
  }
  return root;
}

export function decideMcpStart(
  probe: McpServerIdentity | undefined,
  currentProjectRoot: string
): McpStartDecision {
  if (probe?.product !== PRODUCT_ID) {
    return { kind: 'conflict-unknown' };
  }
  if (normalizeProjectRoot(probe.projectRoot) === normalizeProjectRoot(currentProjectRoot)) {
    return { kind: 'reuse', endpoint: probe.endpoint };
  }
  return { kind: 'conflict-foreign', occupant: probe };
}
