/**
 * Юнит-тесты чистого модуля идентичности MCP-сервера
 * (`src/infra/mcp/McpServerIdentity.ts`). Модуль не существует до реализации
 * жизненного цикла MCP-сервера — это первый "красный" слой TDD для доработки:
 * `V8McpServer` должен уметь публиковать на `GET /identity` эту форму, а
 * клиент (сам расширение при повторном старте) — надёжно отличать "свой"
 * процесс от чужого/неизвестного на занятом порту.
 *
 * Модуль относится к `infra/**`: vscode запрещён, `path`/`fs` не нужны здесь
 * вовсе (чистая сериализация/валидация формы), поэтому тест не поднимает
 * никакой сети — это работа `McpPortProbe`/`V8McpServer`-тестов ниже.
 */
import * as assert from 'assert';
import {
  PRODUCT_ID,
  IDENTITY_PROTOCOL,
  serializeIdentity,
  parseIdentity,
  type McpServerIdentity,
} from '../../infra/mcp/McpServerIdentity';

function buildIdentity(overrides: Partial<McpServerIdentity> = {}): McpServerIdentity {
  return {
    product: PRODUCT_ID,
    protocol: IDENTITY_PROTOCOL,
    pid: process.pid,
    projectRoot: '/tmp/v8vscedit-fixture-project',
    version: '0.4.1',
    endpoint: 'http://127.0.0.1:38481/mcp',
    ...overrides,
  };
}

suite('infra/mcp/McpServerIdentity', () => {
  test('serializeIdentity → parseIdentity: round-trip сохраняет все поля побайтово', () => {
    const identity = buildIdentity();
    const raw = serializeIdentity(identity);
    const parsedJson = JSON.parse(raw) as unknown;
    const parsed = parseIdentity(parsedJson);
    assert.deepStrictEqual(parsed, identity, 'после сериализации и парсинга identity обязана совпасть с исходной');
  });

  test('parseIdentity отвергает identity с чужим product (occupant — не наш сервер)', () => {
    const raw = JSON.parse(serializeIdentity(buildIdentity({ product: 'some-other-mcp-server' }))) as unknown;
    assert.strictEqual(
      parseIdentity(raw), undefined,
      'чужой product должен привести к undefined — иначе мы примем чужой процесс на порту за свой сервер',
    );
  });

  test('parseIdentity отвергает несовпадающий protocol (например будущую/чужую версию формы ответа)', () => {
    const raw = JSON.parse(serializeIdentity(buildIdentity({ protocol: IDENTITY_PROTOCOL + 1 }))) as unknown;
    assert.strictEqual(
      parseIdentity(raw), undefined,
      'несовпадающий protocol должен отвергаться — форма JSON-ответа может быть несовместимой',
    );
  });

  test('parseIdentity отвергает объект без любого из обязательных полей (по одному пропуску за раз)', () => {
    const full = JSON.parse(serializeIdentity(buildIdentity())) as Record<string, unknown>;
    for (const missingKey of Object.keys(full)) {
      const partial: Record<string, unknown> = {};
      for (const key of Object.keys(full)) {
        if (key !== missingKey) {
          partial[key] = full[key];
        }
      }
      assert.strictEqual(
        parseIdentity(partial), undefined,
        `отсутствие поля "${missingKey}" должно приводить к undefined`,
      );
    }
  });

  test('parseIdentity отвергает не-объекты и битые типы отдельных полей', () => {
    assert.strictEqual(parseIdentity(null), undefined, 'null — не валидная identity');
    assert.strictEqual(parseIdentity(undefined), undefined, 'undefined — не валидная identity');
    assert.strictEqual(parseIdentity('строка вместо объекта'), undefined, 'строка — не валидная identity');
    assert.strictEqual(parseIdentity(42), undefined, 'число — не валидная identity');
    assert.strictEqual(
      parseIdentity([buildIdentity()]), undefined,
      'массив — не валидная форма, даже если единственный элемент похож на identity',
    );

    const wrongPidType = { ...buildIdentity(), pid: 'не число' };
    assert.strictEqual(parseIdentity(wrongPidType), undefined, 'pid обязан быть числом');

    const wrongProtocolType = { ...buildIdentity(), protocol: String(IDENTITY_PROTOCOL) };
    assert.strictEqual(parseIdentity(wrongProtocolType), undefined, 'protocol обязан быть числом');

    const wrongEndpointType = { ...buildIdentity(), endpoint: 123 };
    assert.strictEqual(parseIdentity(wrongEndpointType), undefined, 'endpoint обязан быть строкой');
  });
});
