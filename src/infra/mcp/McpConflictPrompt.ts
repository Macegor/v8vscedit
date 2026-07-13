/**
 * Чистое ветвление «результат старта MCP-сервера → намерение диалога».
 *
 * Выделено из `Container`, чтобы соответствие конфликта тексту предупреждения и
 * набору действий было покрываемо unit-тестом без `vscode`. Сам показ окна и
 * исполнение выбора остаются в `Container` (тонкий vscode-адаптер).
 */
import type { McpServerIdentity } from './McpServerIdentity';

export const FORCE_RESTART_LABEL = 'Принудительно закрыть и запустить';
export const CHANGE_PORT_LABEL = 'Сменить порт';

export type McpConflictInput =
  | { readonly kind: 'conflict-foreign'; readonly occupant: McpServerIdentity }
  | { readonly kind: 'conflict-unknown' };

export type McpConflictAction = 'force-restart' | 'change-port';

export interface McpConflictPrompt {
  readonly message: string;
  readonly actions: readonly string[];
}

/** Строит текст предупреждения и допустимые действия по типу конфликта старта. */
export function buildMcpConflictPrompt(input: McpConflictInput, port: number): McpConflictPrompt {
  if (input.kind === 'conflict-foreign') {
    return {
      message: `Порт ${String(port)} занят MCP-сервером другого проекта: ${input.occupant.projectRoot}`,
      actions: [FORCE_RESTART_LABEL, CHANGE_PORT_LABEL],
    };
  }
  return {
    message: `Порт ${String(port)} занят другим процессом (не MCP v8vscedit).`,
    actions: [CHANGE_PORT_LABEL],
  };
}

/** Транслирует выбранную пользователем метку действия в намерение. */
export function resolveMcpConflictAction(picked: string | undefined): McpConflictAction | undefined {
  if (picked === FORCE_RESTART_LABEL) {
    return 'force-restart';
  }
  if (picked === CHANGE_PORT_LABEL) {
    return 'change-port';
  }
  return undefined;
}
