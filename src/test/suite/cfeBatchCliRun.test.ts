/**
 * Главный тест пакетных команд: `dump-cfe-all`/`load-cfe-all` целиком, ЦИКЛОМ,
 * на реальном собранном `dist/cli/onec-tools.js` (дочерний node-процесс) и
 * POSIX-заглушке вместо Конфигуратора (`support/cfeBatchFixtures.ts`).
 *
 * Что здесь защищается и почему именно так:
 *
 *  1. ВЕКТОР АРГУМЕНТОВ каждой итерации сверяется по `argv.log` заглушки. У
 *     `/DumpCfg` и `/LoadCfg` ключа `-AllExtensions` НЕ СУЩЕСТВУЕТ: платформа
 *     8.3.27.1989 принимает его молча (код 0) и работает с ОСНОВНОЙ конфигурацией,
 *     выдавая результат, неотличимый от обычной выгрузки. Поэтому «все расширения»
 *     — цикл с `-Extension <имя>` на итерацию, а ошибку в векторе не поймать ни
 *     кодом возврата, ни логом — только точным тестом самого argv. При этом у
 *     `/DumpDBCfgList` тот же ключ штатный и ОБЯЗАТЕЛЬНЫЙ — обе стороны фиксируются.
 *  2. Политика отказов РАЗНАЯ. dump продолжает (выгрузка базу не трогает,
 *     14 из 15 бэкапов ценны), причём при отказе элемента прежний одноимённый
 *     файл остаётся байт-в-байт нетронутым. load останавливается на первом отказе
 *     (каждый `/LoadCfg` необратимо меняет базу — остановка даёт точную границу),
 *     `/UpdateDBCfg` не выполняется вовсе, а сбойный элемент — отдельная
 *     категория `failedAt`: замерено, что неудачная загрузка НОВОГО расширения
 *     всё равно регистрирует его в базе, состояние неопределённо.
 *  3. Посторонние файлы каталога не трогаются и не удаляются НИКОГДА.
 *  4. Отчёт в `-ResultFile` пишется ВСЕГДА (коды 0, 1, 2).
 *
 * Прерывание: заглушка сама шлёт SIGTERM нашему CLI во время обработки
 * заданного расширения и живёт ещё полсекунды — сигнал гарантированно приходит
 * ДО завершения текущего элемента (нижняя граница ожидания, а не угадывание
 * тайминга), поэтому остановка наступает детерминированно «между итерациями».
 * Не запускается на Windows: POSIX-шебанг там не исполняется (прецедент —
 * `mcpConfigLifecycleCfTools.test.ts`); чистая логика покрыта в остальных файлах.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { planCfeDumpFiles } from '../../infra/cfFile/CfeBatchNaming';
import {
  CFE_MANIFEST_FILE_NAME,
  readCfeManifest,
  serializeCfeManifest,
  type CfeManifest,
} from '../../infra/cfFile/CfeBatchManifest';
import { parseCfeBatchReport, type CfeBatchReport } from '../../infra/cfFile/CfeBatchReport';
import {
  IS_WINDOWS,
  connectionCliArgs,
  createBatchWorkspace,
  expectedConnectionPrefix,
  extensionsOf,
  invocationsOf,
  listNames,
  makeExtensionNames,
  makeListFail,
  partFiles,
  readInvocations,
  runCli,
  setDbExtensions,
  setFakeControl,
  writeCfeFile,
  type BatchWorkspace,
  type DesignerInvocation,
} from './support/cfeBatchFixtures';
import { diffSnapshots, snapshotTree } from './support/fsSnapshot';

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function dumpArgs(ws: BatchWorkspace, extra: readonly string[] = []): string[] {
  return ['dump-cfe-all', '-OutputDir', ws.dataDir, '-ResultFile', ws.resultFile, ...connectionCliArgs(ws), ...extra];
}

function loadArgs(ws: BatchWorkspace, extra: readonly string[] = []): string[] {
  return ['load-cfe-all', '-InputDir', ws.dataDir, '-ResultFile', ws.resultFile, ...connectionCliArgs(ws), ...extra];
}

function readReport(ws: BatchWorkspace): CfeBatchReport {
  assert.ok(fs.existsSync(ws.resultFile), 'отчёт в -ResultFile обязан быть записан при ЛЮБОМ коде возврата');
  const report = parseCfeBatchReport(fs.readFileSync(ws.resultFile, 'utf-8'));
  assert.ok(report, `отчёт не разобран: ${fs.readFileSync(ws.resultFile, 'utf-8')}`);
  return report;
}

function statusOf(report: CfeBatchReport, extensionName: string): string | undefined {
  return report.items.find((item) => item.extensionName === extensionName)?.status;
}

function okNames(report: CfeBatchReport): string[] {
  return report.items.filter((item) => item.status === 'ok').map((item) => item.extensionName);
}

/** Вектор `/DumpDBCfgList`: единственное место, где `-AllExtensions` обязателен. */
function assertListVector(ws: BatchWorkspace, argv: DesignerInvocation): void {
  assert.strictEqual(argv.length, 10, `вектор списка: ${JSON.stringify(argv)}`);
  assert.deepStrictEqual(argv.slice(0, 5), expectedConnectionPrefix(ws));
  assert.strictEqual(argv[5], '/DumpDBCfgList');
  assert.strictEqual(argv[6], '-AllExtensions', 'у /DumpDBCfgList ключ -AllExtensions штатный и обязательный (без него платформа отвечает «Ошибка в параметрах командной строки»)');
  assert.strictEqual(argv[7], '/Out');
  assert.ok(path.isAbsolute(argv[8]), `/Out списка должен быть абсолютным путём: ${argv[8]}`);
  assert.strictEqual(argv[9], '/DisableStartupDialogs');
}

/** Вектор `/DumpCfg`: расширение — через `-Extension`, НИКАКОГО ключа на `-All…`, staging рядом с целью. */
function assertDumpVector(ws: BatchWorkspace, argv: DesignerInvocation, extensionName: string, fileName: string): void {
  assert.strictEqual(argv.length, 12, `вектор /DumpCfg: ${JSON.stringify(argv)}`);
  assert.deepStrictEqual(argv.slice(0, 5), expectedConnectionPrefix(ws));
  assert.strictEqual(argv[5], '/DumpCfg');
  // Выгрузка идёт в staging-файл рядом с целевым
  // (`.<имя>.<pid>-<время>-<индекс>.v8vscedit.part`; хвост — маркер принадлежности,
  // по нему уборка отличает свой остаток от чужого файла пользователя):
  // при сбое платформа всё равно создаёт файл-мусор, и прямая запись в цель затёрла бы бэкап.
  assert.match(
    argv[6],
    new RegExp(`^${escapeRegExp(path.join(ws.dataDir, `.${fileName}.`))}\\d+-\\d+-\\d+\\.v8vscedit\\.part$`),
    `staging-путь ${argv[6]}`
  );
  assert.strictEqual(argv[7], '-Extension');
  assert.strictEqual(argv[8], extensionName);
  assert.strictEqual(argv[9], '/Out');
  assert.ok(path.isAbsolute(argv[10]) && !argv[10].startsWith(ws.dataDir), `/Out лога не должен лежать в каталоге выгрузки: ${argv[10]}`);
  assert.strictEqual(argv[11], '/DisableStartupDialogs');
  assert.ok(argv.every((arg) => !arg.startsWith('-All')), `в /DumpCfg не должно быть ни одного ключа на "-All": ${JSON.stringify(argv)}`);
}

function assertLoadVector(ws: BatchWorkspace, argv: DesignerInvocation, extensionName: string, fileName: string): void {
  assert.strictEqual(argv.length, 12, `вектор /LoadCfg: ${JSON.stringify(argv)}`);
  assert.deepStrictEqual(argv.slice(0, 5), expectedConnectionPrefix(ws));
  assert.strictEqual(argv[5], '/LoadCfg');
  assert.strictEqual(argv[6], path.join(ws.dataDir, fileName), 'файл загрузки — прямой путь к .cfe каталога (копий и staging при загрузке нет)');
  assert.strictEqual(argv[7], '-Extension');
  assert.strictEqual(argv[8], extensionName);
  assert.strictEqual(argv[9], '/Out');
  assert.ok(path.isAbsolute(argv[10]), argv[10]);
  assert.strictEqual(argv[11], '/DisableStartupDialogs');
  assert.ok(argv.every((arg) => !arg.startsWith('-All')), `в /LoadCfg не должно быть ни одного ключа на "-All": ${JSON.stringify(argv)}`);
}

/** Кладёт в каталог загрузки набор бэкапов и (по умолчанию) манифест — как оставила бы выгрузка. */
function seedBackups(ws: BatchWorkspace, names: readonly string[], options: { readonly manifest?: boolean } = {}): void {
  const plan = planCfeDumpFiles(names, []);
  for (const item of plan.items) {
    writeCfeFile(ws.dataDir, item.fileName, item.extensionName);
  }
  if (options.manifest !== false) {
    const manifest: CfeManifest = {
      version: 1,
      createdAt: '2026-09-29T00:00:00.000Z',
      items: plan.items.map((item) => ({
        extensionName: item.extensionName,
        fileName: item.fileName,
        status: 'ok' as const,
        sizeBytes: `cfe:${item.extensionName}`.length,
      })),
    };
    fs.writeFileSync(path.join(ws.dataDir, CFE_MANIFEST_FILE_NAME), serializeCfeManifest(manifest), 'utf-8');
  }
}

/** Имена из обязательного набора, пригодные для файла построчного списка и argv (без NUL и краевых пробелов). */
const BATCH_NAME_SET: readonly string[] = [
  'EVOLC', 'Расш Тест',
  'A:B', 'A/B', 'A\\B', 'A*B', 'A?B', 'A"B', 'A<B>', 'A|B',
  'CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM9', 'LPT1', 'LPT9',
  'Имя.', 'ext', 'EXT', 'A\u0001B', 'A_B',
  'x'.repeat(300),
];

suite('CLI dump-cfe-all — цикл выгрузки на заглушке Конфигуратора', function () {
  this.timeout(120_000);
  let ws: BatchWorkspace;

  suiteSetup(function () {
    if (IS_WINDOWS) {
      this.skip();
    }
  });

  setup(() => {
    ws = createBatchWorkspace();
  });

  teardown(() => {
    ws.dispose();
  });

  test('вектор КАЖДОЙ итерации: список — с -AllExtensions, /DumpCfg — только -Extension <имя> и staging рядом с целью; ключей "-All*" у /DumpCfg нет', async () => {
    const names = ['Ext01', 'A:B', 'Расш Тест'];
    setDbExtensions(ws, names);

    const result = await runCli(dumpArgs(ws));

    assert.strictEqual(result.exitCode, 0, `stderr: ${result.stderr}`);
    const invocations = readInvocations(ws);
    assert.strictEqual(invocations.length, 1 + names.length, 'ровно один запрос списка и по одному /DumpCfg на расширение');
    assertListVector(ws, invocations[0]);
    const plan = planCfeDumpFiles(names, []);
    plan.items.forEach((item, index) => {
      assertDumpVector(ws, invocations[index + 1], item.extensionName, item.fileName);
    });
    // Обе стороны асимметрии одним взглядом: -AllExtensions есть ТОЛЬКО у списка.
    const withAll = invocations.filter((argv) => argv.includes('-AllExtensions'));
    assert.deepStrictEqual(withAll.map((argv) => argv[5]), ['/DumpDBCfgList']);
  });

  test('staging-пути разных итераций различны (по индексу элемента) — файлы не наступают друг на друга', async () => {
    setDbExtensions(ws, makeExtensionNames(5));
    await runCli(dumpArgs(ws));
    const stagings = invocationsOf(ws, '/DumpCfg').map((argv) => argv[6]);
    assert.strictEqual(new Set(stagings).size, 5, stagings.join('\n'));
  });

  for (const count of [0, 1, 15]) {
    test(`размер списка ${String(count)}: ${String(count)} файлов + манифест + отчёт, код 0, остатков нет`, async () => {
      const names = makeExtensionNames(count);
      setDbExtensions(ws, names);

      const result = await runCli(dumpArgs(ws));

      assert.strictEqual(result.exitCode, 0, `stderr: ${result.stderr}`);
      assert.strictEqual(invocationsOf(ws, '/DumpCfg').length, count);
      assert.deepStrictEqual(
        listNames(ws.dataDir),
        [...names.map((name) => `${name}.cfe`), CFE_MANIFEST_FILE_NAME].sort()
      );
      for (const name of names) {
        assert.strictEqual(fs.readFileSync(path.join(ws.dataDir, `${name}.cfe`), 'utf-8'), `cfe:${name}`, 'содержимое — байты именно этого расширения');
      }
      const manifest = readCfeManifest(ws.dataDir);
      assert.ok(manifest, 'манифест обязан быть записан даже для пустого списка — он результат прогона');
      assert.deepStrictEqual(
        manifest.items.map((item) => [item.extensionName, item.fileName, item.status, item.sizeBytes]),
        names.map((name) => [name, `${name}.cfe`, 'ok', `cfe:${name}`.length])
      );
      const report = readReport(ws);
      assert.strictEqual(report.operation, 'dump');
      assert.strictEqual(report.interrupted, false);
      assert.deepStrictEqual(okNames(report), names);
      assert.deepStrictEqual(partFiles(ws.dataDir), []);
    });
  }

  test('весь набор имён из ТЗ: у каждого расширения свой файл, содержимое и манифест указывают на ТО ЖЕ исходное имя, коллизий и остатков нет', async () => {
    setDbExtensions(ws, BATCH_NAME_SET);

    const result = await runCli(dumpArgs(ws));

    assert.strictEqual(result.exitCode, 0, `stderr: ${result.stderr}`);
    const manifest = readCfeManifest(ws.dataDir);
    assert.ok(manifest);
    assert.deepStrictEqual(manifest.items.map((item) => item.extensionName).sort(), [...BATCH_NAME_SET].sort());
    const files = manifest.items.map((item) => item.fileName);
    assert.strictEqual(new Set(files.map((file) => file.toLowerCase())).size, files.length, `коллизия имён файлов: ${files.join(', ')}`);
    for (const item of manifest.items) {
      assert.strictEqual(item.status, 'ok');
      // Сопоставление «файл ↔ расширение» проверяется по СОДЕРЖИМОМУ: тихая
      // перезапись бэкапа одного расширения другим дала бы верный счётчик файлов.
      assert.strictEqual(fs.readFileSync(path.join(ws.dataDir, item.fileName), 'utf-8'), `cfe:${item.extensionName}`, `файл ${item.fileName}`);
    }
    assert.deepStrictEqual(listNames(ws.dataDir), [...files, CFE_MANIFEST_FILE_NAME].sort());
    assert.deepStrictEqual(partFiles(ws.dataDir), []);
  });

  test('коллизии имён файлов: A:B, A/B, A_B, ext, EXT — пять разных файлов и манифест, восстанавливающий каждое имя', async () => {
    const names = ['A:B', 'A/B', 'A_B', 'ext', 'EXT'];
    setDbExtensions(ws, names);

    const result = await runCli(dumpArgs(ws));

    assert.strictEqual(result.exitCode, 0, `stderr: ${result.stderr}`);
    const manifest = readCfeManifest(ws.dataDir);
    assert.ok(manifest);
    assert.strictEqual(manifest.items.length, 5);
    assert.deepStrictEqual(manifest.items.map((item) => item.extensionName).sort(), [...names].sort());
    for (const item of manifest.items) {
      assert.strictEqual(fs.readFileSync(path.join(ws.dataDir, item.fileName), 'utf-8'), `cfe:${item.extensionName}`);
    }
    assert.deepStrictEqual(
      listNames(ws.dataDir).filter((file) => /^a_b/i.test(file)).map((file) => file.toLowerCase()).sort(),
      ['a_b.cfe', 'a_b~2.cfe', 'a_b~3.cfe']
    );
  });

  const FAIL_POSITIONS: readonly { readonly label: string; readonly position: number }[] = [
    { label: 'первая', position: 1 },
    { label: 'седьмая', position: 7 },
    { label: 'последняя', position: 15 },
  ];
  for (const { label, position } of FAIL_POSITIONS) {
    test(`отказ ${label} (${String(position)} из 15): выгрузка ПРОДОЛЖАЕТСЯ, 14 файлов целы, у сбойного целевого файла нет, staging убран, код 1`, async () => {
      const names = makeExtensionNames(15);
      const failing = names[position - 1];
      setDbExtensions(ws, names);
      setFakeControl(ws, 'fail-dump.txt', [failing]);

      const result = await runCli(dumpArgs(ws));

      assert.strictEqual(result.exitCode, 1, `stderr: ${result.stderr}`);
      assert.strictEqual(invocationsOf(ws, '/DumpCfg').length, 15, 'выгрузка не останавливается на отказе: базу она не трогает');
      const expectedFiles = names.filter((name) => name !== failing).map((name) => `${name}.cfe`);
      assert.deepStrictEqual(listNames(ws.dataDir), [...expectedFiles, CFE_MANIFEST_FILE_NAME].sort(), 'целевого файла сбойного быть не должно (заглушка кладёт в staging 16 байт мусора, как платформа)');
      assert.deepStrictEqual(partFiles(ws.dataDir), []);
      for (const name of names.filter((n) => n !== failing)) {
        assert.strictEqual(fs.readFileSync(path.join(ws.dataDir, `${name}.cfe`), 'utf-8'), `cfe:${name}`);
      }
      const manifest = readCfeManifest(ws.dataDir);
      assert.ok(manifest);
      assert.strictEqual(manifest.items.find((item) => item.extensionName === failing)?.status, 'failed');
      assert.strictEqual(manifest.items.filter((item) => item.status === 'ok').length, 14);
      const report = readReport(ws);
      assert.strictEqual(statusOf(report, failing), 'failed');
      assert.strictEqual(okNames(report).length, 14);
      assert.strictEqual(report.interrupted, false);
    });

    test(`отказ ${label} (${String(position)} из 15) при уже существующем одноимённом файле и -Overwrite: старый файл остаётся БАЙТ-В-БАЙТ`, async () => {
      const names = makeExtensionNames(15);
      const failing = names[position - 1];
      const oldBytes = Buffer.from([0x00, 0xff, 0x10, 0x20, 0x30, 0x40, 0x50]);
      fs.writeFileSync(path.join(ws.dataDir, `${failing}.cfe`), oldBytes);
      setDbExtensions(ws, names);
      setFakeControl(ws, 'fail-dump.txt', [failing]);

      const result = await runCli(dumpArgs(ws, ['-Overwrite']));

      assert.strictEqual(result.exitCode, 1, `stderr: ${result.stderr}`);
      assert.ok(fs.readFileSync(path.join(ws.dataDir, `${failing}.cfe`)).equals(oldBytes), 'прежний бэкап затёрт мусором сбойной выгрузки');
      assert.deepStrictEqual(partFiles(ws.dataDir), []);
      for (const name of names.filter((n) => n !== failing)) {
        assert.strictEqual(fs.readFileSync(path.join(ws.dataDir, `${name}.cfe`), 'utf-8'), `cfe:${name}`);
      }
      assert.strictEqual(readCfeManifest(ws.dataDir)?.items.find((item) => item.extensionName === failing)?.status, 'failed');
    });
  }

  test('несколько отказов подряд: все сбойные отмечены, остальные выгружены, код 1', async () => {
    const names = makeExtensionNames(6);
    setDbExtensions(ws, names);
    setFakeControl(ws, 'fail-dump.txt', [names[1], names[2], names[5]]);

    const result = await runCli(dumpArgs(ws));

    assert.strictEqual(result.exitCode, 1);
    const report = readReport(ws);
    assert.deepStrictEqual(okNames(report), [names[0], names[3], names[4]]);
    assert.deepStrictEqual(report.items.filter((item) => item.status === 'failed').map((item) => item.extensionName), [names[1], names[2], names[5]]);
    assert.deepStrictEqual(partFiles(ws.dataDir), []);
  });

  test('повторный запуск в НЕПУСТОЙ каталог без -Overwrite: отказ до старта (код 1), ни одного /DumpCfg, файлы и манифест нетронуты', async () => {
    const names = makeExtensionNames(3);
    setDbExtensions(ws, names);
    assert.strictEqual((await runCli(dumpArgs(ws))).exitCode, 0);
    const before = snapshotTree(ws.dataDir);
    const dumpCallsBefore = invocationsOf(ws, '/DumpCfg').length;

    const second = await runCli(dumpArgs(ws));

    assert.strictEqual(second.exitCode, 1, `stderr: ${second.stderr}`);
    assert.strictEqual(invocationsOf(ws, '/DumpCfg').length, dumpCallsBefore, 'после отказа pre-flight ни один /DumpCfg запускаться не должен');
    assert.deepStrictEqual(diffSnapshots(before, snapshotTree(ws.dataDir)), []);
    const report = readReport(ws);
    assert.ok((report.errors ?? []).length > 0, 'причина отказа до старта обязана быть в отчёте');
  });

  test('повторный запуск с -Overwrite: файлы заменяются, код 0', async () => {
    const names = makeExtensionNames(3);
    setDbExtensions(ws, names);
    assert.strictEqual((await runCli(dumpArgs(ws))).exitCode, 0);
    fs.writeFileSync(path.join(ws.dataDir, 'Ext02.cfe'), 'stale');

    const second = await runCli(dumpArgs(ws, ['-Overwrite']));

    assert.strictEqual(second.exitCode, 0, `stderr: ${second.stderr}`);
    assert.strictEqual(fs.readFileSync(path.join(ws.dataDir, 'Ext02.cfe'), 'utf-8'), 'cfe:Ext02');
    assert.deepStrictEqual(partFiles(ws.dataDir), []);
  });

  const DIR_STATES: readonly { readonly label: string; readonly conflicting: boolean; readonly foreign: boolean }[] = [
    { label: 'пустой', conflicting: false, foreign: false },
    { label: 'с конфликтующим файлом', conflicting: true, foreign: false },
    { label: 'с посторонним файлом', conflicting: false, foreign: true },
    { label: 'с конфликтующим и посторонним', conflicting: true, foreign: true },
  ];
  for (const overwrite of [false, true]) {
    for (const state of DIR_STATES) {
      const shouldRun = overwrite || !state.conflicting;
      test(`overwrite=${String(overwrite)} × каталог ${state.label}: ${shouldRun ? 'выгрузка выполняется (код 0)' : 'отказ до старта (код 1), ноль /DumpCfg'}; посторонний файл нетронут`, async () => {
        const names = makeExtensionNames(3);
        setDbExtensions(ws, names);
        if (state.conflicting) {
          fs.writeFileSync(path.join(ws.dataDir, 'Ext02.cfe'), 'CONFLICT-OLD');
        }
        if (state.foreign) {
          fs.writeFileSync(path.join(ws.dataDir, 'notes.txt'), 'мои заметки, не трогать');
          fs.writeFileSync(path.join(ws.dataDir, 'Unrelated.cfe'), 'чужой бэкап');
        }
        const before = snapshotTree(ws.dataDir);

        const result = await runCli(dumpArgs(ws, overwrite ? ['-Overwrite'] : []));

        if (shouldRun) {
          assert.strictEqual(result.exitCode, 0, `stderr: ${result.stderr}`);
          assert.strictEqual(fs.readFileSync(path.join(ws.dataDir, 'Ext02.cfe'), 'utf-8'), 'cfe:Ext02', 'конфликтующий/новый файл содержит свежую выгрузку');
          assert.strictEqual(invocationsOf(ws, '/DumpCfg').length, 3);
        } else {
          assert.strictEqual(result.exitCode, 1, `stderr: ${result.stderr}`);
          assert.strictEqual(invocationsOf(ws, '/DumpCfg').length, 0);
          assert.deepStrictEqual(diffSnapshots(before, snapshotTree(ws.dataDir)), [], 'при отказе до старта каталог не должен измениться вообще');
        }
        if (state.foreign) {
          assert.strictEqual(fs.readFileSync(path.join(ws.dataDir, 'notes.txt'), 'utf-8'), 'мои заметки, не трогать');
          assert.strictEqual(fs.readFileSync(path.join(ws.dataDir, 'Unrelated.cfe'), 'utf-8'), 'чужой бэкап');
        }
        assert.deepStrictEqual(partFiles(ws.dataDir), []);
        assert.ok(fs.existsSync(ws.resultFile), 'отчёт пишется всегда');
      });
    }
  }

  test('старый манифест заменяется манифестом ТЕКУЩЕГО прогона целиком (записи прошлых прогонов не сливаются)', async () => {
    const stale: CfeManifest = { version: 1, createdAt: '2020-01-01T00:00:00.000Z', items: [{ extensionName: 'Gone', fileName: 'Gone.cfe', status: 'ok', sizeBytes: 1 }] };
    fs.writeFileSync(path.join(ws.dataDir, CFE_MANIFEST_FILE_NAME), serializeCfeManifest(stale), 'utf-8');
    setDbExtensions(ws, ['Ext01']);

    const result = await runCli(dumpArgs(ws));

    assert.strictEqual(result.exitCode, 0, `stderr: ${result.stderr}`);
    const manifest = readCfeManifest(ws.dataDir);
    assert.ok(manifest);
    assert.deepStrictEqual(manifest.items.map((item) => item.extensionName), ['Ext01']);
    assert.deepStrictEqual(listNames(ws.dataDir), ['Ext01.cfe', CFE_MANIFEST_FILE_NAME]);
  });

  test('отказ запроса списка (/DumpDBCfgList → код 1): код 1, ни одного /DumpCfg, манифест не создаётся, отчёт записан', async () => {
    makeListFail(ws);

    const result = await runCli(dumpArgs(ws));

    assert.strictEqual(result.exitCode, 1, `stderr: ${result.stderr}`);
    assert.strictEqual(invocationsOf(ws, '/DumpCfg').length, 0);
    assert.strictEqual(invocationsOf(ws, '/DumpDBCfgList').length, 1);
    assert.deepStrictEqual(listNames(ws.dataDir), [], 'ничего не выгружено — и манифеста, описывающего выгрузку, быть не должно');
    assert.deepStrictEqual(readReport(ws).items, []);
  });

  test('остаток staging прерванного прогона убирается на старте следующего; чужой ".part" пользователя не трогается', async () => {
    // Свой staging каждая итерация убирает сама, но SIGKILL (отмена операции из
    // UI добивает CLI через 5 с после SIGTERM) до `finally` не доводит. Такой
    // остаток с планом выгрузки не конфликтует и сам не исчезнет — если его не
    // убрать здесь, он остаётся в каталоге бэкапов навсегда.
    const names = makeExtensionNames(2);
    setDbExtensions(ws, names);
    const leftover = path.join(ws.dataDir, `.${names[0]}.cfe.999-1-0.v8vscedit.part`);
    fs.writeFileSync(leftover, '0123456789abcdef');
    fs.writeFileSync(path.join(ws.dataDir, 'notes.txt'), 'мои заметки, не трогать');
    fs.writeFileSync(path.join(ws.dataDir, '.hidden.part'), 'не наш формат имени');
    fs.writeFileSync(path.join(ws.dataDir, '.backup.2024-01-15.part'), 'чужой файл пользователя');

    const result = await runCli(dumpArgs(ws));

    assert.strictEqual(result.exitCode, 0, `stderr: ${result.stderr}`);
    assert.ok(!fs.existsSync(leftover), 'остаток прошлого прогона обязан быть убран');
    assert.deepStrictEqual(partFiles(ws.dataDir), ['.backup.2024-01-15.part', '.hidden.part'],
      'убираются ТОЛЬКО файлы с нашим маркером; чужой ".part" пользователя обязан уцелеть');
    assert.strictEqual(fs.readFileSync(path.join(ws.dataDir, '.backup.2024-01-15.part'), 'utf-8'), 'чужой файл пользователя');
    assert.strictEqual(fs.readFileSync(path.join(ws.dataDir, 'notes.txt'), 'utf-8'), 'мои заметки, не трогать');
    assert.deepStrictEqual(okNames(readReport(ws)), names);
  });

  test('прерывание SIGTERM после 2-го из 4: код 2, отчёт interrupted=true, 3-е и 4-е не запускались, .part нет, готовые файлы и манифест целы', async () => {
    const names = makeExtensionNames(4);
    setDbExtensions(ws, names);
    setFakeControl(ws, 'sigterm-dump.txt', [names[1]]);

    const result = await runCli(dumpArgs(ws));

    assert.strictEqual(result.exitCode, 2, `stderr: ${result.stderr}`);
    assert.strictEqual(invocationsOf(ws, '/DumpCfg').length, 2, 'после сигнала новая итерация начинаться не должна');
    const report = readReport(ws);
    assert.strictEqual(report.interrupted, true);
    assert.deepStrictEqual(okNames(report), [names[0], names[1]]);
    assert.notStrictEqual(statusOf(report, names[2]), 'ok');
    assert.notStrictEqual(statusOf(report, names[3]), 'ok');
    assert.deepStrictEqual(partFiles(ws.dataDir), []);
    assert.deepStrictEqual(listNames(ws.dataDir), [`${names[0]}.cfe`, `${names[1]}.cfe`, CFE_MANIFEST_FILE_NAME].sort());
    assert.deepStrictEqual(readCfeManifest(ws.dataDir)?.items.filter((item) => item.status === 'ok').map((item) => item.extensionName), [names[0], names[1]]);
  });
});

suite('CLI load-cfe-all — цикл загрузки на заглушке Конфигуратора', function () {
  this.timeout(120_000);
  let ws: BatchWorkspace;

  suiteSetup(function () {
    if (IS_WINDOWS) {
      this.skip();
    }
  });

  setup(() => {
    ws = createBatchWorkspace();
  });

  teardown(() => {
    ws.dispose();
  });

  test('вектор КАЖДОЙ итерации: список — с -AllExtensions, /LoadCfg — только путь .cfe и -Extension <имя>; ключей "-All*" нет; /UpdateDBCfg не запускается', async () => {
    const names = ['Ext01', 'A:B', 'Расш Тест'];
    seedBackups(ws, names);
    setDbExtensions(ws, names);

    const result = await runCli(loadArgs(ws));

    assert.strictEqual(result.exitCode, 0, `stderr: ${result.stderr}`);
    const invocations = readInvocations(ws);
    assert.strictEqual(invocations.length, 1 + names.length);
    assertListVector(ws, invocations[0]);
    planCfeDumpFiles(names, []).items.forEach((item, index) => {
      assertLoadVector(ws, invocations[index + 1], item.extensionName, item.fileName);
    });
    assert.strictEqual(invocationsOf(ws, '/UpdateDBCfg').length, 0, 'применение к базе — отдельный шаг вызывающей стороны, CLI его не делает');
    assert.deepStrictEqual(invocations.filter((argv) => argv.includes('-AllExtensions')).map((argv) => argv[5]), ['/DumpDBCfgList']);
    const report = readReport(ws);
    assert.strictEqual(report.operation, 'load');
    assert.deepStrictEqual(okNames(report), planCfeDumpFiles(names, []).items.map((item) => item.extensionName));
  });

  for (const count of [1, 15]) {
    test(`размер набора ${String(count)}: ровно ${String(count)} /LoadCfg, код 0, /UpdateDBCfg нет`, async () => {
      const names = makeExtensionNames(count);
      seedBackups(ws, names);
      setDbExtensions(ws, names);

      const result = await runCli(loadArgs(ws));

      assert.strictEqual(result.exitCode, 0, `stderr: ${result.stderr}`);
      assert.deepStrictEqual(extensionsOf(ws, '/LoadCfg'), names);
      assert.strictEqual(invocationsOf(ws, '/UpdateDBCfg').length, 0);
      assert.deepStrictEqual(okNames(readReport(ws)), names);
    });
  }

  test('размер набора 0 (каталог без .cfe): ни одного /LoadCfg и /UpdateDBCfg, отчёт записан с пустым items', async () => {
    fs.writeFileSync(path.join(ws.dataDir, 'notes.txt'), 'x');
    setDbExtensions(ws, ['Ext01']);

    await runCli(loadArgs(ws));

    assert.strictEqual(invocationsOf(ws, '/LoadCfg').length, 0);
    assert.strictEqual(invocationsOf(ws, '/UpdateDBCfg').length, 0);
    assert.deepStrictEqual(readReport(ws).items, []);
  });

  const FAIL_POSITIONS: readonly { readonly label: string; readonly position: number }[] = [
    { label: 'первая', position: 1 },
    { label: 'седьмая', position: 7 },
    { label: 'последняя', position: 15 },
  ];
  for (const { label, position } of FAIL_POSITIONS) {
    test(`отказ ${label} (${String(position)} из 15): остановка НА ПЕРВОМ отказе — /LoadCfg ровно ${String(position)}, /UpdateDBCfg нет, failedAt = сбойный, код 1`, async () => {
      const names = makeExtensionNames(15);
      const failing = names[position - 1];
      seedBackups(ws, names);
      setDbExtensions(ws, names);
      setFakeControl(ws, 'fail-load.txt', [failing]);
      const before = snapshotTree(ws.dataDir);

      const result = await runCli(loadArgs(ws));

      assert.strictEqual(result.exitCode, 1, `stderr: ${result.stderr}`);
      const loaded = extensionsOf(ws, '/LoadCfg');
      assert.strictEqual(loaded.length, position, 'каждый /LoadCfg необратимо меняет базу: после отказа продолжать нельзя');
      assert.strictEqual(loaded[position - 1], failing);
      assert.strictEqual(invocationsOf(ws, '/UpdateDBCfg').length, 0, '/UpdateDBCfg не должен выполняться, если хоть один /LoadCfg не удался');
      const report = readReport(ws);
      assert.strictEqual(report.interrupted, false);
      assert.strictEqual(report.failedAt?.extensionName, failing, 'сбойный элемент — отдельная категория failedAt');
      assert.strictEqual(report.failedAt.stateUncertain, true, 'состояние сбойного расширения в базе неопределённо (замерено: расширение регистрируется даже при неудаче)');
      assert.deepStrictEqual(okNames(report), names.slice(0, position - 1));
      for (const notReached of names.slice(position)) {
        assert.notStrictEqual(statusOf(report, notReached), 'ok', `${notReached} не загружалось`);
      }
      assert.deepStrictEqual(diffSnapshots(before, snapshotTree(ws.dataDir)), [], 'загрузка не изменяет каталог с бэкапами');
    });
  }

  for (const createMissing of [false, true]) {
    test(`расширение есть в каталоге, но нет в базе, createMissing=${String(createMissing)}: ${createMissing ? 'загружаются оба (новое создастся в базе), код 0' : 'отказ до старта (код 1), ноль /LoadCfg, причина в отчёте'}`, async () => {
      seedBackups(ws, ['Ext01', 'New']);
      setDbExtensions(ws, ['Ext01']);

      const result = await runCli(loadArgs(ws, createMissing ? ['-CreateMissing'] : []));

      const report = readReport(ws);
      assert.deepStrictEqual(report.missingInDb, ['New']);
      if (createMissing) {
        assert.strictEqual(result.exitCode, 0, `stderr: ${result.stderr}`);
        assert.deepStrictEqual(extensionsOf(ws, '/LoadCfg'), ['Ext01', 'New']);
      } else {
        assert.strictEqual(result.exitCode, 1, `stderr: ${result.stderr}`);
        assert.strictEqual(invocationsOf(ws, '/LoadCfg').length, 0, 'pre-flight обязан остановить ВСЁ, включая расширения, которые в базе есть');
        assert.ok((report.errors ?? []).some((error) => error.includes('New')), `errors: ${JSON.stringify(report.errors)}`);
      }
      assert.strictEqual(invocationsOf(ws, '/UpdateDBCfg').length, 0);
    });
  }

  test('расширение есть в базе, но файла нет: не трогается, попадает в notInDirectory, код 0', async () => {
    seedBackups(ws, ['Ext01']);
    setDbExtensions(ws, ['Ext01', 'OnlyInDb']);

    const result = await runCli(loadArgs(ws));

    assert.strictEqual(result.exitCode, 0, `stderr: ${result.stderr}`);
    assert.deepStrictEqual(extensionsOf(ws, '/LoadCfg'), ['Ext01']);
    assert.deepStrictEqual(readReport(ws).notInDirectory, ['OnlyInDb']);
  });

  test('посторонние файлы каталога не трогаются и не берутся в загрузку; они перечислены в ignoredFiles', async () => {
    seedBackups(ws, ['Ext01']);
    fs.writeFileSync(path.join(ws.dataDir, 'notes.txt'), 'заметки');
    fs.writeFileSync(path.join(ws.dataDir, 'Main.cf'), 'основная конфигурация, не расширение');
    fs.writeFileSync(path.join(ws.dataDir, 'Empty.cfe'), '');
    setDbExtensions(ws, ['Ext01', 'Empty']);
    const before = snapshotTree(ws.dataDir);

    const result = await runCli(loadArgs(ws));

    assert.strictEqual(result.exitCode, 0, `stderr: ${result.stderr}`);
    assert.deepStrictEqual(extensionsOf(ws, '/LoadCfg'), ['Ext01']);
    assert.deepStrictEqual(diffSnapshots(before, snapshotTree(ws.dataDir)), []);
    assert.deepStrictEqual([...(readReport(ws).ignoredFiles ?? [])].sort(), ['Empty.cfe', 'Main.cf', 'notes.txt']);
  });

  interface ManifestScenario {
    readonly label: string;
    /** Записывает манифест (или его порчу) в каталог загрузки. */
    readonly write: (dir: string) => void;
    /** Ожидаемое множество загруженных имён при createMissing=false; `undefined` — отказ до старта. */
    readonly loadedWithoutCreate: readonly string[] | undefined;
  }
  const item = (extensionName: string, fileName: string, status: 'ok' | 'failed' = 'ok') =>
    ({ extensionName, fileName, status, sizeBytes: 10 }) as const;
  const writeManifest = (dir: string, items: CfeManifest['items']): void => {
    fs.writeFileSync(path.join(dir, CFE_MANIFEST_FILE_NAME), serializeCfeManifest({ version: 1, createdAt: '2026-09-29T00:00:00.000Z', items }), 'utf-8');
  };
  const MANIFEST_SCENARIOS: readonly ManifestScenario[] = [
    { label: 'полный', write: (dir) => writeManifest(dir, [item('A:B', 'A_B.cfe'), item('Ext02', 'Ext02.cfe')]), loadedWithoutCreate: ['A:B', 'Ext02'] },
    { label: 'частичный (записан только A:B)', write: (dir) => writeManifest(dir, [item('A:B', 'A_B.cfe')]), loadedWithoutCreate: ['A:B', 'Ext02'] },
    { label: 'отсутствует', write: () => undefined, loadedWithoutCreate: undefined },
    { label: 'битый JSON', write: (dir) => fs.writeFileSync(path.join(dir, CFE_MANIFEST_FILE_NAME), '{"version":1,"items":['), loadedWithoutCreate: undefined },
    { label: 'чужая version:999', write: (dir) => fs.writeFileSync(path.join(dir, CFE_MANIFEST_FILE_NAME), JSON.stringify({ version: 999, createdAt: 'x', items: [] })), loadedWithoutCreate: undefined },
    { label: 'запись на несуществующий файл', write: (dir) => writeManifest(dir, [item('A:B', 'A_B.cfe'), item('Ext02', 'Ext02.cfe'), item('Ghost', 'Ghost.cfe')]), loadedWithoutCreate: undefined },
    { label: 'запись со status:failed', write: (dir) => writeManifest(dir, [item('A:B', 'A_B.cfe'), item('Ext02', 'Ext02.cfe', 'failed')]), loadedWithoutCreate: ['A:B'] },
  ];
  for (const scenario of MANIFEST_SCENARIOS) {
    test(`манифест ${scenario.label}: ${scenario.loadedWithoutCreate ? `загружаются ${scenario.loadedWithoutCreate.join(', ')}` : 'отказ до старта, ноль /LoadCfg'}`, async () => {
      // В каталоге лежат A_B.cfe (в базе это расширение "A:B") и Ext02.cfe.
      writeCfeFile(ws.dataDir, 'A_B.cfe', 'A:B');
      writeCfeFile(ws.dataDir, 'Ext02.cfe', 'Ext02');
      scenario.write(ws.dataDir);
      setDbExtensions(ws, ['A:B', 'Ext02']);

      const result = await runCli(loadArgs(ws));

      if (scenario.loadedWithoutCreate) {
        assert.strictEqual(result.exitCode, 0, `stderr: ${result.stderr}`);
        assert.deepStrictEqual([...extensionsOf(ws, '/LoadCfg')].sort(), [...scenario.loadedWithoutCreate].sort());
      } else {
        // Без манифеста «A_B.cfe» — это расширение "A_B", которого в базе нет:
        // угадывать "A:B" нельзя (тот же файл дало бы и "A/B"), а тихая загрузка
        // в чужое/новое расширение необратима.
        assert.strictEqual(result.exitCode, 1, `stderr: ${result.stderr}`);
        assert.strictEqual(invocationsOf(ws, '/LoadCfg').length, 0);
        assert.ok((readReport(ws).errors ?? []).length > 0);
      }
      assert.strictEqual(invocationsOf(ws, '/UpdateDBCfg').length, 0);
    });
  }

  test('манифеста нет, createMissing=true: файл "A_B.cfe" грузится как расширение "A_B" (имя — из файла), а не "A:B" — вот зачем нужен манифест', async () => {
    writeCfeFile(ws.dataDir, 'A_B.cfe', 'A:B');
    writeCfeFile(ws.dataDir, 'Ext02.cfe', 'Ext02');
    setDbExtensions(ws, ['A:B', 'Ext02']);

    const result = await runCli(loadArgs(ws, ['-CreateMissing']));

    assert.strictEqual(result.exitCode, 0, `stderr: ${result.stderr}`);
    assert.deepStrictEqual([...extensionsOf(ws, '/LoadCfg')].sort(), ['A_B', 'Ext02']);
  });

  test('отказ запроса списка (/DumpDBCfgList → код 1): код 1, ни одного /LoadCfg, отчёт записан', async () => {
    seedBackups(ws, ['Ext01']);
    makeListFail(ws);

    const result = await runCli(loadArgs(ws));

    assert.strictEqual(result.exitCode, 1, `stderr: ${result.stderr}`);
    assert.strictEqual(invocationsOf(ws, '/LoadCfg').length, 0);
    assert.deepStrictEqual(readReport(ws).items, []);
  });

  test('прерывание SIGTERM после 2-го из 4: код 2, отчёт interrupted=true, /LoadCfg ровно 2, /UpdateDBCfg нет', async () => {
    const names = makeExtensionNames(4);
    seedBackups(ws, names);
    setDbExtensions(ws, names);
    setFakeControl(ws, 'sigterm-load.txt', [names[1]]);
    const before = snapshotTree(ws.dataDir);

    const result = await runCli(loadArgs(ws));

    assert.strictEqual(result.exitCode, 2, `stderr: ${result.stderr}`);
    assert.deepStrictEqual(extensionsOf(ws, '/LoadCfg'), [names[0], names[1]]);
    assert.strictEqual(invocationsOf(ws, '/UpdateDBCfg').length, 0);
    const report = readReport(ws);
    assert.strictEqual(report.interrupted, true);
    assert.deepStrictEqual(okNames(report), [names[0], names[1]]);
    assert.deepStrictEqual(diffSnapshots(before, snapshotTree(ws.dataDir)), []);
  });

  test('круговой обход dump → load: имена с недопустимыми символами возвращаются в исходном виде через манифест', async () => {
    const names = ['A:B', 'A/B', 'A_B', 'Расш Тест', 'CON', 'ext', 'EXT'];
    setDbExtensions(ws, names);
    assert.strictEqual((await runCli(dumpArgs(ws))).exitCode, 0);
    fs.rmSync(path.join(ws.binDir, 'argv.log'));

    const result = await runCli(loadArgs(ws));

    assert.strictEqual(result.exitCode, 0, `stderr: ${result.stderr}`);
    assert.deepStrictEqual([...extensionsOf(ws, '/LoadCfg')].sort(), [...names].sort(), 'загружены ровно те расширения, что были выгружены, под исходными именами');
    for (const argv of invocationsOf(ws, '/LoadCfg')) {
      const fileName = path.basename(argv[6]);
      const manifestItem = readCfeManifest(ws.dataDir)?.items.find((entry) => entry.fileName === fileName);
      assert.strictEqual(argv[8], manifestItem?.extensionName, `файл ${fileName} загружен не в то расширение`);
    }
  });
});
