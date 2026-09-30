/**
 * Тесты `infra/cfFile/CfeBatchReport.ts` — отчёт прогона `dump-cfe-all`/`load-cfe-all`.
 *
 * Отчёт — канал «CLI → UI/MCP» (file-handoff через `-ResultFile`: marker-блок в
 * stdout портится построчным декодером). Читающая сторона обязана пережить
 * ЛЮБОЙ файл: CLI мог быть убит на середине записи, файла мог не быть вовсе,
 * его мог подменить другой процесс — поэтому `parseCfeBatchReport` возвращает
 * `undefined`, а не бросает исключение, иначе сбой чтения отчёта затёр бы
 * настоящую причину сбоя операции.
 *
 * Форма отчёта (фиксируется этими тестами): `version: 1`, `operation`
 * (`dump`|`load`), `interrupted`, `items[]` со статусами `ok`|`failed`|
 * `notAttempted`; для load — `failedAt` (сбойный элемент: состояние в базе
 * неопределённо, поэтому это ОТДЕЛЬНАЯ категория, а не просто «failed»), а также
 * `missingInDb`/`notInDirectory`/`ignoredFiles`; `errors[]` — причины отказа до старта.
 */
import * as assert from 'assert';
import {
  parseCfeBatchReport,
  serializeCfeBatchReport,
  type CfeBatchReport,
} from '../../infra/cfFile/CfeBatchReport';

const DUMP_REPORT: CfeBatchReport = {
  version: 1,
  operation: 'dump',
  interrupted: false,
  items: [
    { extensionName: 'A:B', fileName: 'A_B.cfe', status: 'ok', sizeBytes: 100 },
    { extensionName: 'EVOLC', fileName: 'EVOLC.cfe', status: 'failed', message: 'код возврата 1' },
    { extensionName: 'Расш Тест', fileName: 'Расш Тест.cfe', status: 'ok', sizeBytes: 5 },
  ],
};

const LOAD_REPORT: CfeBatchReport = {
  version: 1,
  operation: 'load',
  interrupted: false,
  items: [
    { extensionName: 'Ext01', fileName: 'Ext01.cfe', status: 'ok' },
    { extensionName: 'Ext02', fileName: 'Ext02.cfe', status: 'failed' },
    { extensionName: 'Ext03', fileName: 'Ext03.cfe', status: 'notAttempted' },
  ],
  failedAt: { extensionName: 'Ext02', fileName: 'Ext02.cfe', stateUncertain: true },
  missingInDb: ['New'],
  notInDirectory: ['OnlyInDb'],
  ignoredFiles: ['notes.txt'],
};

suite('CfeBatchReport — сериализация и разбор', () => {
  test('round-trip отчёта выгрузки (ok + failed, кириллица, "A:B")', () => {
    assert.deepStrictEqual(parseCfeBatchReport(serializeCfeBatchReport(DUMP_REPORT)), DUMP_REPORT);
  });

  test('round-trip отчёта загрузки: failedAt, missingInDb, notInDirectory, ignoredFiles, notAttempted сохраняются', () => {
    assert.deepStrictEqual(parseCfeBatchReport(serializeCfeBatchReport(LOAD_REPORT)), LOAD_REPORT);
  });

  test('round-trip прерванного прогона: interrupted === true не теряется и не превращается в false', () => {
    const interrupted: CfeBatchReport = { ...DUMP_REPORT, interrupted: true };
    const parsed = parseCfeBatchReport(serializeCfeBatchReport(interrupted));
    assert.ok(parsed);
    assert.strictEqual(parsed.interrupted, true);
    assert.deepStrictEqual(parsed, interrupted);
  });

  test('round-trip отказа до старта: errors сохраняются, items пуст', () => {
    const preflight: CfeBatchReport = {
      version: 1,
      operation: 'dump',
      interrupted: false,
      items: [],
      errors: ['Файл уже существует: EVOLC.cfe'],
    };
    assert.deepStrictEqual(parseCfeBatchReport(serializeCfeBatchReport(preflight)), preflight);
  });

  test('round-trip пустого отчёта (0 расширений)', () => {
    const empty: CfeBatchReport = { version: 1, operation: 'dump', interrupted: false, items: [] };
    assert.deepStrictEqual(parseCfeBatchReport(serializeCfeBatchReport(empty)), empty);
  });

  test('сериализация — валидный JSON с version === 1', () => {
    const parsed = JSON.parse(serializeCfeBatchReport(DUMP_REPORT)) as { version?: unknown; operation?: unknown };
    assert.strictEqual(parsed.version, 1);
    assert.strictEqual(parsed.operation, 'dump');
  });

  test('в отчёт не попадают ни пароль, ни параметры подключения (отчёт читает UI и показывает агенту)', () => {
    const text = serializeCfeBatchReport({ ...LOAD_REPORT });
    assert.ok(!/password|infobase|connection|"user/i.test(text), text);
  });

  const rejected: readonly { readonly name: string; readonly text: string }[] = [
    { name: 'пустая строка', text: '' },
    { name: 'битый JSON (обрыв записи)', text: '{"version":1,"operation":"dump","items":[' },
    { name: 'не JSON', text: 'Error dumping configuration' },
    { name: 'null', text: 'null' },
    { name: 'массив', text: '[]' },
    { name: 'число', text: '7' },
    { name: 'чужая версия 999', text: JSON.stringify({ ...DUMP_REPORT, version: 999 }) },
    { name: 'нет version', text: JSON.stringify({ operation: 'dump', interrupted: false, items: [] }) },
    { name: 'нет operation', text: JSON.stringify({ version: 1, interrupted: false, items: [] }) },
    { name: 'неизвестный operation', text: JSON.stringify({ version: 1, operation: 'sync', interrupted: false, items: [] }) },
    { name: 'interrupted — не boolean', text: JSON.stringify({ version: 1, operation: 'dump', interrupted: 'yes', items: [] }) },
    { name: 'нет interrupted', text: JSON.stringify({ version: 1, operation: 'dump', items: [] }) },
    { name: 'нет items', text: JSON.stringify({ version: 1, operation: 'dump', interrupted: false }) },
    { name: 'items — не массив', text: JSON.stringify({ version: 1, operation: 'dump', interrupted: false, items: 'A' }) },
    { name: 'элемент items — не объект', text: JSON.stringify({ version: 1, operation: 'dump', interrupted: false, items: ['A'] }) },
    { name: 'элемент с неизвестным статусом', text: JSON.stringify({ version: 1, operation: 'dump', interrupted: false, items: [{ extensionName: 'A', fileName: 'A.cfe', status: 'done' }] }) },
    { name: 'элемент без extensionName', text: JSON.stringify({ version: 1, operation: 'dump', interrupted: false, items: [{ fileName: 'A.cfe', status: 'ok' }] }) },
  ];
  for (const { name, text } of rejected) {
    test(`${name} → undefined, не исключение`, () => {
      assert.doesNotThrow(() => parseCfeBatchReport(text));
      assert.strictEqual(parseCfeBatchReport(text), undefined);
    });
  }

  test('посторонние поля отчёта не мешают разбору известных', () => {
    const parsed = parseCfeBatchReport(JSON.stringify({ ...DUMP_REPORT, extra: { nested: true } }));
    assert.ok(parsed);
    assert.deepStrictEqual(parsed.items, DUMP_REPORT.items);
    assert.strictEqual(parsed.operation, 'dump');
  });
});
