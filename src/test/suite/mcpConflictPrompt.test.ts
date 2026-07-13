/**
 * Юнит-тесты чистого helper'а `src/infra/mcp/McpConflictPrompt.ts` —
 * построение текста предупреждения/набора кнопок диалога конфликта порта MCP
 * (`buildMcpConflictPrompt`) и трансляция выбранной пользователем кнопки в
 * намерение (`resolveMcpConflictAction`). Модуль чистый (без vscode/http),
 * поэтому проверяется на реальных значениях `McpConflictInput`/`McpServerIdentity`
 * без моков.
 */
import * as assert from 'assert';
import {
  buildMcpConflictPrompt,
  resolveMcpConflictAction,
  FORCE_RESTART_LABEL,
  CHANGE_PORT_LABEL,
  type McpConflictInput,
} from '../../infra/mcp/McpConflictPrompt';
import { PRODUCT_ID, IDENTITY_PROTOCOL, type McpServerIdentity } from '../../infra/mcp/McpServerIdentity';

function buildIdentity(overrides: Partial<McpServerIdentity> = {}): McpServerIdentity {
  return {
    product: PRODUCT_ID,
    protocol: IDENTITY_PROTOCOL,
    pid: 12345,
    projectRoot: '/Users/dev/other-project',
    version: '0.4.1',
    endpoint: 'http://127.0.0.1:38481/mcp',
    ...overrides,
  };
}

suite('infra/mcp/McpConflictPrompt', () => {
  suite('buildMcpConflictPrompt', () => {
    test('conflict-foreign: сообщение содержит порт и projectRoot занявшего процесса, действия — обе кнопки', () => {
      const occupant = buildIdentity({ projectRoot: '/Users/dev/other-project' });
      const input: McpConflictInput = { kind: 'conflict-foreign', occupant };

      const prompt = buildMcpConflictPrompt(input, 38481);

      // Пользователю нужно понимать, ЧЕЙ именно процесс занял порт — иначе
      // решение "принудительно закрыть" принимается вслепую.
      assert.ok(
        prompt.message.includes('38481'),
        `сообщение должно содержать порт: ${prompt.message}`,
      );
      assert.ok(
        prompt.message.includes('/Users/dev/other-project'),
        `сообщение должно содержать projectRoot занявшего процесса: ${prompt.message}`,
      );
      // Свой же MCP-сервер другого проекта можно принудительно закрыть — это
      // отличает conflict-foreign от conflict-unknown, где такой кнопки нет.
      assert.deepStrictEqual(prompt.actions, [FORCE_RESTART_LABEL, CHANGE_PORT_LABEL]);
    });

    test('conflict-unknown: сообщение содержит порт и не упоминает project MCP, действие — только смена порта', () => {
      const input: McpConflictInput = { kind: 'conflict-unknown' };

      const prompt = buildMcpConflictPrompt(input, 12345);

      assert.ok(
        prompt.message.includes('12345'),
        `сообщение должно содержать порт: ${prompt.message}`,
      );
      // Чужой (не наш) процесс на порту принудительно закрывать нельзя — это
      // может оказаться посторонняя программа пользователя, поэтому доступна
      // только смена порта расширением.
      assert.deepStrictEqual(prompt.actions, [CHANGE_PORT_LABEL]);
    });
  });

  suite('resolveMcpConflictAction', () => {
    test('выбрана кнопка "Принудительно закрыть и запустить" → намерение force-restart', () => {
      const action = resolveMcpConflictAction(FORCE_RESTART_LABEL);
      assert.strictEqual(action, 'force-restart');
    });

    test('выбрана кнопка "Сменить порт" → намерение change-port', () => {
      const action = resolveMcpConflictAction(CHANGE_PORT_LABEL);
      assert.strictEqual(action, 'change-port');
    });

    test('диалог закрыт без выбора (undefined) → нет намерения', () => {
      // Модальное окно VS Code возвращает undefined при закрытии Escape/крестиком —
      // это не должно трактоваться как какое-то конкретное действие.
      const action = resolveMcpConflictAction(undefined);
      assert.strictEqual(action, undefined);
    });

    test('произвольная нераспознанная строка (защитная ветка) → нет намерения', () => {
      const action = resolveMcpConflictAction('какая-то другая метка');
      assert.strictEqual(action, undefined);
    });
  });
});
