/**
 * Тесты `infra/cfFile/CfeBatchManifest.ts` — манифест `cfe-dump.json`.
 *
 * Манифест — ЕДИНСТВЕННЫЙ способ при загрузке восстановить исходное имя
 * расширения по имени файла: `A:B` и `A/B` оба превращаются в `A_B.cfe`, а
 * содержимое `.cfe` не парсится никогда (формат закрытый и в проекте не
 * измерен). Поэтому чтение обязано быть «недоверчивым»: отсутствующий, битый
 * или чужой версии манифест означает «манифеста нет» (`undefined`), а не
 * исключение и не частично принятые данные.
 *
 * Запись идёт через `AtomicFileWriter` (единственная реализация temp+rename в
 * проекте): обрыв процесса не должен оставить обрезанный манифест — он делал
 * бы нечитаемым весь набор бэкапов, а не один файл.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  CFE_MANIFEST_FILE_NAME,
  parseCfeManifest,
  readCfeManifest,
  serializeCfeManifest,
  writeCfeManifest,
  type CfeManifest,
} from '../../infra/cfFile/CfeBatchManifest';

const FULL_MANIFEST: CfeManifest = {
  version: 1,
  createdAt: '2026-09-29T10:11:12.000Z',
  items: [
    { extensionName: 'A:B', fileName: 'A_B.cfe', status: 'ok', sizeBytes: 1234 },
    { extensionName: 'Расш Тест', fileName: 'Расш Тест.cfe', status: 'ok', sizeBytes: 1 },
    { extensionName: 'EVOLC', fileName: 'EVOLC.cfe', status: 'failed' },
  ],
};

function validJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ version: 1, createdAt: '2026-09-29T00:00:00.000Z', items: [], ...overrides });
}

suite('CfeBatchManifest — имя файла и сериализация', () => {
  test('имя файла манифеста — cfe-dump.json (по нему загрузка отличает манифест от посторонних файлов)', () => {
    assert.strictEqual(CFE_MANIFEST_FILE_NAME, 'cfe-dump.json');
  });

  test('round-trip: serialize → parse возвращает тот же манифест (включая "A:B", кириллицу, отсутствие sizeBytes у failed)', () => {
    assert.deepStrictEqual(parseCfeManifest(serializeCfeManifest(FULL_MANIFEST)), FULL_MANIFEST);
  });

  test('round-trip пустого манифеста: пустой items сохраняется как пустой массив, а не превращается в отсутствие', () => {
    const empty: CfeManifest = { version: 1, createdAt: '2026-09-29T00:00:00.000Z', items: [] };
    assert.deepStrictEqual(parseCfeManifest(serializeCfeManifest(empty)), empty);
  });

  test('сериализация — валидный JSON версии 1 с ровно тремя ключами верхнего уровня', () => {
    const parsed = JSON.parse(serializeCfeManifest(FULL_MANIFEST)) as Record<string, unknown>;
    assert.strictEqual(parsed.version, 1);
    assert.deepStrictEqual(Object.keys(parsed).sort(), ['createdAt', 'items', 'version']);
  });

  test('в манифест не попадают ни пароль, ни подключение: у элемента только extensionName/fileName/status/sizeBytes', () => {
    // Манифест лежит рядом с бэкапами и уезжает вместе с ними (git, архив, чат) —
    // любой секрет подключения там был бы утечкой.
    const text = serializeCfeManifest(FULL_MANIFEST);
    assert.ok(!/password|passwd|pwd|infobase|connection|user/i.test(text.replace(/"extensionName"/g, '')), `подозрительное поле в манифесте: ${text}`);
    const parsed = JSON.parse(text) as { items: Record<string, unknown>[] };
    const allowed = new Set(['extensionName', 'fileName', 'status', 'sizeBytes']);
    for (const item of parsed.items) {
      for (const key of Object.keys(item)) {
        assert.ok(allowed.has(key), `неожиданный ключ элемента манифеста: ${key}`);
      }
    }
  });
});

suite('CfeBatchManifest.parseCfeManifest — недоверчивый разбор', () => {
  test('корректный JSON версии 1 разбирается', () => {
    assert.deepStrictEqual(parseCfeManifest(validJson()), { version: 1, createdAt: '2026-09-29T00:00:00.000Z', items: [] });
  });

  const rejected: readonly { readonly name: string; readonly text: string }[] = [
    { name: 'пустая строка', text: '' },
    { name: 'битый JSON (обрыв записи)', text: '{"version": 1, "items": [' },
    { name: 'не JSON вовсе', text: 'это не json' },
    { name: 'null', text: 'null' },
    { name: 'массив вместо объекта', text: '[]' },
    { name: 'строка', text: '"строка"' },
    { name: 'число', text: '42' },
    { name: 'чужая версия 999', text: validJson({ version: 999 }) },
    { name: 'версия 0', text: validJson({ version: 0 }) },
    { name: 'версия строкой "1"', text: validJson({ version: '1' }) },
    { name: 'нет version', text: JSON.stringify({ createdAt: 'x', items: [] }) },
    { name: 'нет items', text: JSON.stringify({ version: 1, createdAt: 'x' }) },
    { name: 'items — не массив (объект)', text: validJson({ items: {} }) },
    { name: 'items — не массив (строка)', text: validJson({ items: 'A' }) },
  ];
  for (const { name, text } of rejected) {
    test(`${name} → undefined, не исключение`, () => {
      assert.doesNotThrow(() => parseCfeManifest(text));
      assert.strictEqual(parseCfeManifest(text), undefined);
    });
  }

  test('посторонние поля (верхнего уровня и у элемента) допустимы и не ломают чтение известных', () => {
    // Манифест могли дописать вручную или новой версией расширения в рамках
    // той же version — известные поля обязаны читаться.
    const text = JSON.stringify({
      version: 1,
      createdAt: '2026-09-29T00:00:00.000Z',
      generator: 'v8vscedit',
      items: [{ extensionName: 'EVOLC', fileName: 'EVOLC.cfe', status: 'ok', sizeBytes: 5, note: 'заметка' }],
    });
    const parsed = parseCfeManifest(text);
    assert.ok(parsed);
    assert.strictEqual(parsed.items.length, 1);
    assert.strictEqual(parsed.items[0].extensionName, 'EVOLC');
    assert.strictEqual(parsed.items[0].fileName, 'EVOLC.cfe');
    assert.strictEqual(parsed.items[0].status, 'ok');
    assert.strictEqual(parsed.items[0].sizeBytes, 5);
  });

  const badItems: readonly { readonly name: string; readonly item: unknown }[] = [
    { name: 'элемент — не объект (строка)', item: 'EVOLC.cfe' },
    { name: 'элемент — null', item: null },
    { name: 'нет extensionName', item: { fileName: 'A.cfe', status: 'ok' } },
    { name: 'пустое extensionName', item: { extensionName: '', fileName: 'A.cfe', status: 'ok' } },
    { name: 'extensionName — число', item: { extensionName: 5, fileName: 'A.cfe', status: 'ok' } },
    { name: 'нет fileName', item: { extensionName: 'A', status: 'ok' } },
    { name: 'пустое fileName', item: { extensionName: 'A', fileName: '', status: 'ok' } },
    { name: 'fileName с разделителем пути (выход из каталога)', item: { extensionName: 'A', fileName: '../A.cfe', status: 'ok' } },
    { name: 'fileName с обратным разделителем пути', item: { extensionName: 'A', fileName: '..\\A.cfe', status: 'ok' } },
    { name: 'неизвестный status', item: { extensionName: 'A', fileName: 'A.cfe', status: 'weird' } },
    { name: 'нет status', item: { extensionName: 'A', fileName: 'A.cfe' } },
    { name: 'sizeBytes — строка', item: { extensionName: 'A', fileName: 'A.cfe', status: 'ok', sizeBytes: '5' } },
    { name: 'sizeBytes отрицательный', item: { extensionName: 'A', fileName: 'A.cfe', status: 'ok', sizeBytes: -1 } },
  ];
  for (const { name, item } of badItems) {
    test(`испорченный элемент (${name}) → манифест целиком недоверенный (undefined): частично принятым данным верить нельзя`, () => {
      // fileName из манифеста потом склеивается с каталогом загрузки: значение
      // с "../" без этой проверки читало бы файлы за пределами каталога.
      assert.strictEqual(parseCfeManifest(validJson({ items: [item] })), undefined);
    });
  }

  test('элементы с обоими допустимыми статусами и sizeBytes = 0 принимаются', () => {
    const parsed = parseCfeManifest(validJson({
      items: [
        { extensionName: 'A', fileName: 'A.cfe', status: 'ok', sizeBytes: 0 },
        { extensionName: 'B', fileName: 'B.cfe', status: 'failed' },
      ],
    }));
    assert.ok(parsed);
    assert.deepStrictEqual(parsed.items.map((item) => item.status), ['ok', 'failed']);
  });
});

suite('CfeBatchManifest.readCfeManifest / writeCfeManifest — на реальной ФС', () => {
  let dir: string;

  setup(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-cfe-manifest-'));
  });

  teardown(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('read: манифеста в каталоге нет → undefined', () => {
    assert.strictEqual(readCfeManifest(dir), undefined);
  });

  test('read: каталога нет вовсе → undefined, не исключение', () => {
    assert.strictEqual(readCfeManifest(path.join(dir, 'no-such-dir')), undefined);
  });

  test('read: битый JSON → undefined', () => {
    fs.writeFileSync(path.join(dir, CFE_MANIFEST_FILE_NAME), '{"version":1,"items":[');
    assert.strictEqual(readCfeManifest(dir), undefined);
  });

  test('read: чужая версия (999) → undefined', () => {
    fs.writeFileSync(path.join(dir, CFE_MANIFEST_FILE_NAME), validJson({ version: 999 }));
    assert.strictEqual(readCfeManifest(dir), undefined);
  });

  test('read: JSON, не являющийся объектом, → undefined', () => {
    fs.writeFileSync(path.join(dir, CFE_MANIFEST_FILE_NAME), '[1,2,3]');
    assert.strictEqual(readCfeManifest(dir), undefined);
  });

  test('read: без items → undefined', () => {
    fs.writeFileSync(path.join(dir, CFE_MANIFEST_FILE_NAME), JSON.stringify({ version: 1, createdAt: 'x' }));
    assert.strictEqual(readCfeManifest(dir), undefined);
  });

  test('read: манифест с посторонними полями читается', () => {
    fs.writeFileSync(path.join(dir, CFE_MANIFEST_FILE_NAME), validJson({ extra: true }));
    assert.deepStrictEqual(readCfeManifest(dir)?.items, []);
  });

  test('read: вместо файла каталог с таким именем → undefined, а не EISDIR наружу', () => {
    fs.mkdirSync(path.join(dir, CFE_MANIFEST_FILE_NAME));
    assert.strictEqual(readCfeManifest(dir), undefined);
  });

  test('read: BOM в начале файла (редактор Windows) не делает манифест «битым»', () => {
    fs.writeFileSync(path.join(dir, CFE_MANIFEST_FILE_NAME), `\uFEFF${serializeCfeManifest(FULL_MANIFEST)}`, 'utf-8');
    assert.deepStrictEqual(readCfeManifest(dir), FULL_MANIFEST);
  });

  test('write → read: round-trip через настоящий файл', () => {
    writeCfeManifest(dir, FULL_MANIFEST);
    assert.deepStrictEqual(readCfeManifest(dir), FULL_MANIFEST);
  });

  test('write: после записи в пустом каталоге ровно ОДИН новый файл cfe-dump.json — временных остатков нет', () => {
    writeCfeManifest(dir, FULL_MANIFEST);
    assert.deepStrictEqual(fs.readdirSync(dir), [CFE_MANIFEST_FILE_NAME]);
  });

  test('write: повторная запись заменяет манифест целиком (результат ТЕКУЩЕГО прогона, без слияния со старым), остатков нет', () => {
    writeCfeManifest(dir, FULL_MANIFEST);
    const second: CfeManifest = { version: 1, createdAt: '2027-01-01T00:00:00.000Z', items: [{ extensionName: 'Only', fileName: 'Only.cfe', status: 'ok', sizeBytes: 9 }] };
    writeCfeManifest(dir, second);
    assert.deepStrictEqual(readCfeManifest(dir), second);
    assert.deepStrictEqual(fs.readdirSync(dir), [CFE_MANIFEST_FILE_NAME]);
  });

  test('write: соседние файлы каталога (бэкапы, посторонние) не затрагиваются', () => {
    fs.writeFileSync(path.join(dir, 'EVOLC.cfe'), 'binary');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'мои заметки');
    writeCfeManifest(dir, FULL_MANIFEST);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'EVOLC.cfe'), 'utf-8'), 'binary');
    assert.strictEqual(fs.readFileSync(path.join(dir, 'notes.txt'), 'utf-8'), 'мои заметки');
    assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['EVOLC.cfe', CFE_MANIFEST_FILE_NAME, 'notes.txt']);
  });

  test('write: несуществующий каталог → исключение, ничего не создано (молчаливый откат на прямую запись запрещён)', () => {
    const missing = path.join(dir, 'no-such-dir');
    assert.throws(() => writeCfeManifest(missing, FULL_MANIFEST));
    assert.ok(!fs.existsSync(missing), 'каталог не должен создаваться записью манифеста');
    assert.deepStrictEqual(fs.readdirSync(dir), []);
  });
});
