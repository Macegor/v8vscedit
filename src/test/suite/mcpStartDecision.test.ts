/**
 * Юнит-тесты чистой функции принятия решения при старте MCP-сервера
 * (`src/infra/mcp/McpStartDecision.ts`). `V8McpServer.start` больше не
 * авто-инкрементит порт — при `EADDRINUSE` он один раз зондирует занявший
 * порт процесс (`McpPortProbe.probeIdentity`) и передаёт результат сюда,
 * чтобы решить: переиспользовать чужой (но "свой" по product+projectRoot)
 * endpoint, сообщить о конфликте с чужим v8vscedit другого проекта или о
 * конфликте с процессом, который вообще не является нашим MCP-сервером.
 *
 * Модуль чистый (без vscode/http) — тестируется без сети, на реальных
 * значениях `McpServerIdentity` из `McpServerIdentity.ts` (не мок — это тот
 * же самый производственный модуль, которым `decideMcpStart` оперирует).
 */
import * as assert from 'assert';
import { decideMcpStart } from '../../infra/mcp/McpStartDecision';
import { PRODUCT_ID, IDENTITY_PROTOCOL, type McpServerIdentity } from '../../infra/mcp/McpServerIdentity';

function buildIdentity(overrides: Partial<McpServerIdentity> = {}): McpServerIdentity {
  return {
    product: PRODUCT_ID,
    protocol: IDENTITY_PROTOCOL,
    pid: 12345,
    projectRoot: '/Users/dev/project-a',
    version: '0.4.1',
    endpoint: 'http://127.0.0.1:38481/mcp',
    ...overrides,
  };
}

suite('infra/mcp/McpStartDecision', () => {
  test('наш product + совпадающий projectRoot → reuse с endpoint занявшего порт процесса', () => {
    const occupant = buildIdentity({ projectRoot: '/Users/dev/project-a' });
    const decision = decideMcpStart(occupant, '/Users/dev/project-a');
    assert.deepStrictEqual(decision, { kind: 'reuse', endpoint: occupant.endpoint });
  });

  test('reuse нормализует хвостовой разделитель пути при сравнении projectRoot', () => {
    // На разных ОС/оболочках workspaceFolder.uri.fsPath может приходить то
    // с хвостовым "/", то без — без нормализации reuse никогда бы не
    // срабатывал во втором открытом окне того же проекта.
    const occupant = buildIdentity({ projectRoot: '/Users/dev/project-a' });
    const decisionWithSlash = decideMcpStart(occupant, '/Users/dev/project-a/');
    assert.deepStrictEqual(decisionWithSlash, { kind: 'reuse', endpoint: occupant.endpoint });

    const occupantWithSlash = buildIdentity({ projectRoot: '/Users/dev/project-a/' });
    const decisionWithoutSlash = decideMcpStart(occupantWithSlash, '/Users/dev/project-a');
    assert.deepStrictEqual(decisionWithoutSlash, { kind: 'reuse', endpoint: occupantWithSlash.endpoint });
  });

  test('наш product + другой projectRoot → conflict-foreign c occupant занявшего порт процесса', () => {
    const occupant = buildIdentity({ projectRoot: '/Users/dev/project-b', pid: 777 });
    const decision = decideMcpStart(occupant, '/Users/dev/project-a');
    assert.deepStrictEqual(decision, { kind: 'conflict-foreign', occupant });
  });

  test('probe отсутствует (не удалось получить identity вовсе) → conflict-unknown', () => {
    const decision = decideMcpStart(undefined, '/Users/dev/project-a');
    assert.deepStrictEqual(decision, { kind: 'conflict-unknown' });
  });

  test('на порту процесс без нашего product → conflict-unknown, а не conflict-foreign', () => {
    const occupant = buildIdentity({ product: 'какой-то-другой-mcp-сервер' });
    const decision = decideMcpStart(occupant, '/Users/dev/project-a');
    assert.deepStrictEqual(
      decision, { kind: 'conflict-unknown' },
      'чужой product — это вообще другой процесс на порту, не "чужой v8vscedit"; выдавать occupant для него нельзя',
    );
  });
});
