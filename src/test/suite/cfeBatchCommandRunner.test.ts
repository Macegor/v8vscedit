/**
 * Прямой тест `src/ui/commands/ext/CfeBatchCommandRunner.ts` — единственного
 * места, которое строит вектор аргументов внутреннего CLI для `dump-cfe-all`/
 * `load-cfe-all` (включая `-Password <пароль базы>`), запускает его через
 * `runInternalCliCommand` и читает отчёт из `-ResultFile`.
 *
 * Принятый контракт обёртки: `runDumpAllExtensionsToCfe({ workspaceFolder,
 * outputChannel, outputDir, overwrite?, silent? })` и
 * `runLoadAllExtensionsFromCfe({ …, inputDir, createMissing?, silent? })`
 * возвращают `{ success: boolean; report: CfeBatchReport | undefined }`.
 *
 * Ключевое требование: отчёт читается при ЛЮБОМ коде возврата CLI. При коде 1
 * `runInternalCliCommand` не «падает» наружу, а возвращает false (и показывает
 * ошибку) — обёртка не имеет права принять это за «отчёта нет»: именно в отчёте
 * лежит список сбойных расширений и `failedAt` (состояние в базе неопределённо),
 * без которых вызывающий не может ни объяснить пользователю, что случилось, ни
 * вернуть агенту точный результат частичного отказа.
 *
 * Спавн реального Конфигуратора недопустим. Вектор аргументов проверяется по
 * строке `[actions] Старт:` журнала (пароль там маскируется) на прогоне с ЗАВЕДОМО
 * отсутствующей платформой — CLI детерминированно падает на `resolveConnection`
 * до спавна. Коды 0/1/2 воспроизводятся POSIX-заглушкой Конфигуратора
 * (`support/cfeBatchFixtures.ts`); на Windows эти тесты пропускаются.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { planCfeDumpFiles } from '../../infra/cfFile/CfeBatchNaming';
import { maskSensitiveCliArgs } from '../../infra/process/SensitiveArgs';
import { serializeCfeManifest } from '../../infra/cfFile/CfeBatchManifest';
import {
  runDumpAllExtensionsToCfe,
  runLoadAllExtensionsFromCfe,
} from '../../ui/commands/ext/CfeBatchCommandRunner';
import {
  IS_WINDOWS,
  TEST_PASSWORD,
  absentV8Path,
  createBatchWorkspace,
  makeExtensionNames,
  setDbExtensions,
  setFakeControl,
  writeCfeFile,
  type BatchWorkspace,
} from './support/cfeBatchFixtures';

const MASK = '********';

function fakeWorkspaceFolder(root: string): vscode.WorkspaceFolder {
  return { uri: vscode.Uri.file(root), name: 'cfe-batch-runner-test', index: 0 };
}

/** Приёмник журнала с настоящей семантикой накопления строк (не факт вызова, а реальный лог для разбора). */
function createOutputChannel(): { channel: vscode.OutputChannel; lines: string[] } {
  const lines: string[] = [];
  const channel = { appendLine: (message: string) => { lines.push(message); } } as unknown as vscode.OutputChannel;
  return { channel, lines };
}

/** Переписывает `--path` в env.json на несуществующую платформу. */
function pointEnvToAbsentPlatform(ws: BatchWorkspace): void {
  const envPath = path.join(ws.root, 'env.json');
  const env = JSON.parse(fs.readFileSync(envPath, 'utf-8')) as { default: Record<string, string> };
  env.default['--path'] = absentV8Path(ws.root);
  fs.writeFileSync(envPath, JSON.stringify(env), 'utf-8');
}

function startLineOf(lines: readonly string[]): string {
  const line = lines.find((entry) => entry.startsWith('[actions] Старт:'));
  assert.ok(line, `не найдена строка старта CLI: ${JSON.stringify(lines)}`);
  return line;
}

/** Значение, следующее в строке-векторе за ключом (`-ResultFile <путь>`). */
function tokenAfter(line: string, key: string): string | undefined {
  const tokens = line.split(' ');
  const index = tokens.indexOf(key);
  return index >= 0 ? tokens[index + 1] : undefined;
}

/**
 * Как значение выглядит в журнале: журнал маскирует секреты (`maskSensitiveCliArgs`),
 * и любой аргумент, начинающийся с `/p`, попадает под правило слитного `/P<пароль>`.
 * Ожидание строится ТЕМ ЖЕ фильтром, а не переписывается вручную, чтобы тест не
 * зависел от того, с какой буквы начинается временный каталог платформы.
 */
function loggedForm(value: string): string {
  return maskSensitiveCliArgs([value])[0];
}

/**
 * Файл отчёта обязан быть удалён после прогона. Проверка возможна, только если журнал
 * не замаскировал путь (временный каталог, начинающийся с `/p`, превращается в `/P********`
 * — см. `loggedForm`): тогда настоящий путь тесту неизвестен, и эта проверка вырождается
 * в пропуск, а остальные проверки теста продолжают действовать.
 */
function assertResultFileRemoved(loggedPath: string): void {
  if (loggedPath.includes('********')) {
    return;
  }
  assert.ok(!fs.existsSync(loggedPath), 'временный файл отчёта обязан быть удалён после прогона');
}

function seedBackups(ws: BatchWorkspace, names: readonly string[]): void {
  const plan = planCfeDumpFiles(names, []);
  for (const item of plan.items) {
    writeCfeFile(ws.dataDir, item.fileName, item.extensionName);
  }
  fs.writeFileSync(
    path.join(ws.dataDir, 'cfe-dump.json'),
    serializeCfeManifest({
      version: 1,
      createdAt: '2026-09-29T00:00:00.000Z',
      items: plan.items.map((item) => ({ extensionName: item.extensionName, fileName: item.fileName, status: 'ok' as const, sizeBytes: 5 })),
    }),
    'utf-8'
  );
}

suite('CfeBatchCommandRunner — валидация ДО любых приготовлений', function () {
  this.timeout(30_000);
  let ws: BatchWorkspace;

  setup(() => {
    ws = createBatchWorkspace();
  });

  teardown(() => {
    ws.dispose();
  });

  test('runDumpAllExtensionsToCfe: несуществующий каталог выгрузки — бросает раньше, чем код тронет workspaceFolder/env.json/журнал', async () => {
    // workspaceFolder заведомо битый: если бы валидация не шла первой, ошибка
    // была бы про env.json, а не про каталог назначения.
    const bogus = fakeWorkspaceFolder(path.join(ws.root, 'no-such-workspace'));
    const { channel, lines } = createOutputChannel();
    const outputDir = path.join(ws.root, 'no-such-dir');

    await assert.rejects(
      async () => runDumpAllExtensionsToCfe({ workspaceFolder: bogus, outputChannel: channel, outputDir, silent: true }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(error.message.includes(outputDir), error.message);
        return true;
      }
    );
    assert.deepStrictEqual(lines, [], 'валидация обязана сработать ДО первого обращения к CLI');
  });

  test('runDumpAllExtensionsToCfe: вместо каталога — файл → бросает', async () => {
    const bogus = fakeWorkspaceFolder(path.join(ws.root, 'no-such-workspace'));
    const { channel, lines } = createOutputChannel();
    const filePath = path.join(ws.root, 'file.txt');
    fs.writeFileSync(filePath, 'x');

    await assert.rejects(async () => runDumpAllExtensionsToCfe({ workspaceFolder: bogus, outputChannel: channel, outputDir: filePath, silent: true }));
    assert.deepStrictEqual(lines, []);
  });

  test('runLoadAllExtensionsFromCfe: несуществующий каталог загрузки — бросает до обращения к workspaceFolder/env.json/журналу', async () => {
    const bogus = fakeWorkspaceFolder(path.join(ws.root, 'no-such-workspace'));
    const { channel, lines } = createOutputChannel();
    const inputDir = path.join(ws.root, 'no-such-dir');

    await assert.rejects(
      async () => runLoadAllExtensionsFromCfe({ workspaceFolder: bogus, outputChannel: channel, inputDir, silent: true }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(error.message.includes(inputDir), error.message);
        return true;
      }
    );
    assert.deepStrictEqual(lines, []);
  });

  test('runLoadAllExtensionsFromCfe: вместо каталога — файл → бросает', async () => {
    const bogus = fakeWorkspaceFolder(path.join(ws.root, 'no-such-workspace'));
    const { channel, lines } = createOutputChannel();
    const filePath = path.join(ws.root, 'file.cfe');
    fs.writeFileSync(filePath, 'x');

    await assert.rejects(async () => runLoadAllExtensionsFromCfe({ workspaceFolder: bogus, outputChannel: channel, inputDir: filePath, silent: true }));
    assert.deepStrictEqual(lines, []);
  });
});

suite('CfeBatchCommandRunner — сборка cliArgs (по журналу старта CLI)', function () {
  this.timeout(30_000);
  let ws: BatchWorkspace;

  setup(() => {
    ws = createBatchWorkspace();
    pointEnvToAbsentPlatform(ws);
  });

  teardown(() => {
    ws.dispose();
  });

  for (const overwrite of [false, true]) {
    test(`dump: overwrite=${String(overwrite)} — -OutputDir и -ResultFile есть, -Overwrite ${overwrite ? 'есть' : 'отсутствует'}, пароль замаскирован, ни -AllExtensions, ни -NamesFile`, async () => {
      const { channel, lines } = createOutputChannel();

      const result = await runDumpAllExtensionsToCfe({
        workspaceFolder: fakeWorkspaceFolder(ws.root),
        outputChannel: channel,
        outputDir: ws.dataDir,
        overwrite,
        silent: true,
      });

      assert.strictEqual(result.success, false, 'платформы нет — успеха быть не может, но и исключения тоже');
      const start = startLineOf(lines);
      assert.ok(start.includes(' dump-cfe-all '), start);
      assert.strictEqual(tokenAfter(start, '-OutputDir'), loggedForm(ws.dataDir));
      assert.strictEqual(start.split(' ').includes('-Overwrite'), overwrite, start);
      assert.ok(start.includes('-InfoBasePath'), 'параметры подключения обязаны быть в векторе');
      assert.ok(start.includes(`-Password ${MASK}`), start);
      assert.ok(!lines.join('\n').includes(TEST_PASSWORD), 'реальный пароль не должен попасть в журнал');
      assert.ok(!start.includes('-AllExtensions'), 'ключа -AllExtensions у пакетной команды нет (платформа приняла бы его молча)');
      assert.ok(!start.includes('-NamesFile'), 'список имён обёртка не передаёт — команда сама спрашивает базу');
      const resultFile = tokenAfter(start, '-ResultFile');
      assert.ok(resultFile, `нет -ResultFile: ${start}`);
      assert.ok(!path.resolve(resultFile).startsWith(`${ws.dataDir}${path.sep}`), 'файл отчёта не должен лежать в каталоге выгрузки — он стал бы посторонним файлом среди бэкапов');
      assertResultFileRemoved(resultFile);
      assert.deepStrictEqual(fs.readdirSync(ws.dataDir), [], 'каталог выгрузки не должен пострадать');
    });
  }

  for (const createMissing of [false, true]) {
    test(`load: createMissing=${String(createMissing)} — -InputDir и -ResultFile есть, -CreateMissing ${createMissing ? 'есть' : 'отсутствует'}, пароль замаскирован, ни -AllExtensions, ни -NamesFile`, async () => {
      const { channel, lines } = createOutputChannel();
      fs.writeFileSync(path.join(ws.dataDir, 'Ext01.cfe'), 'bytes');

      const result = await runLoadAllExtensionsFromCfe({
        workspaceFolder: fakeWorkspaceFolder(ws.root),
        outputChannel: channel,
        inputDir: ws.dataDir,
        createMissing,
        silent: true,
      });

      assert.strictEqual(result.success, false);
      const start = startLineOf(lines);
      assert.ok(start.includes(' load-cfe-all '), start);
      assert.strictEqual(tokenAfter(start, '-InputDir'), loggedForm(ws.dataDir));
      assert.strictEqual(start.split(' ').includes('-CreateMissing'), createMissing, start);
      assert.ok(start.includes(`-Password ${MASK}`), start);
      assert.ok(!lines.join('\n').includes(TEST_PASSWORD));
      assert.ok(!start.includes('-AllExtensions'));
      assert.ok(!start.includes('-NamesFile'));
      const resultFile = tokenAfter(start, '-ResultFile');
      assert.ok(resultFile, `нет -ResultFile: ${start}`);
      assertResultFileRemoved(resultFile);
      assert.deepStrictEqual(fs.readdirSync(ws.dataDir), ['Ext01.cfe'], 'каталог загрузки не должен пострадать');
    });
  }

  test('платформа недоступна (CLI падает до записи отчёта): результат осмысленный — success=false, исключения нет, отчёта с успехами нет', async () => {
    const { channel } = createOutputChannel();

    const dump = await runDumpAllExtensionsToCfe({ workspaceFolder: fakeWorkspaceFolder(ws.root), outputChannel: channel, outputDir: ws.dataDir, silent: true });
    const load = await runLoadAllExtensionsFromCfe({ workspaceFolder: fakeWorkspaceFolder(ws.root), outputChannel: channel, inputDir: ws.dataDir, silent: true });

    for (const result of [dump, load]) {
      assert.strictEqual(result.success, false);
      assert.ok(
        result.report === undefined || result.report.items.every((item) => item.status !== 'ok'),
        `отсутствующий/пустой отчёт не должен выдавать успехов: ${JSON.stringify(result.report)}`
      );
    }
  });
});

suite('CfeBatchCommandRunner — коды возврата CLI 0/1/2 и чтение отчёта (заглушка Конфигуратора)', function () {
  this.timeout(60_000);
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

  /** Контекст запуска обёртки и журнал, который можно разобрать после прогона. */
  function options(): { context: { workspaceFolder: vscode.WorkspaceFolder; outputChannel: vscode.OutputChannel }; lines: string[] } {
    const { channel, lines } = createOutputChannel();
    return { context: { workspaceFolder: fakeWorkspaceFolder(ws.root), outputChannel: channel }, lines };
  }

  test('dump, код 0: success=true, отчёт прочитан — все расширения ok, файлы созданы', async () => {
    const names = makeExtensionNames(3);
    setDbExtensions(ws, names);
    const { lines, context } = options();

    const result = await runDumpAllExtensionsToCfe({ ...context, outputDir: ws.dataDir, silent: true });

    assert.strictEqual(result.success, true, lines.join('\n'));
    assert.ok(result.report, 'отчёт обязан быть прочитан');
    assert.strictEqual(result.report.operation, 'dump');
    assert.strictEqual(result.report.interrupted, false);
    assert.deepStrictEqual(result.report.items.map((item) => [item.extensionName, item.status]), names.map((name) => [name, 'ok']));
    assert.ok(fs.existsSync(path.join(ws.dataDir, 'Ext03.cfe')));
    assert.ok(lines.some((line) => line.startsWith('[actions] Завершено:')));
  });

  test('dump, код 1 (частичный отказ): success=false, но отчёт ПРОЧИТАН — сбойное расширение названо, остальные ok; исключения нет', async () => {
    const names = makeExtensionNames(4);
    setDbExtensions(ws, names);
    setFakeControl(ws, 'fail-dump.txt', [names[2]]);
    const { lines, context } = options();

    const result = await runDumpAllExtensionsToCfe({ ...context, outputDir: ws.dataDir, silent: true });

    assert.strictEqual(result.success, false);
    assert.ok(result.report, 'отчёт при коде 1 обязан быть прочитан — в нём единственный список сбойных расширений');
    assert.strictEqual(result.report.items.find((item) => item.extensionName === names[2])?.status, 'failed');
    assert.strictEqual(result.report.items.filter((item) => item.status === 'ok').length, 3);
    assert.strictEqual(result.report.interrupted, false);
    assert.ok(lines.some((line) => line.startsWith('[actions][error]')), 'сбой должен быть в журнале');
  });

  test('dump, код 1 (отказ до старта: конфликт без overwrite): success=false, отчёт с причиной прочитан', async () => {
    setDbExtensions(ws, ['Ext01']);
    fs.writeFileSync(path.join(ws.dataDir, 'Ext01.cfe'), 'old');
    const { context } = options();

    const result = await runDumpAllExtensionsToCfe({ ...context, outputDir: ws.dataDir, overwrite: false, silent: true });

    assert.strictEqual(result.success, false);
    assert.ok(result.report);
    assert.ok((result.report.errors ?? []).length > 0, 'причина отказа до старта — в отчёте');
    assert.strictEqual(fs.readFileSync(path.join(ws.dataDir, 'Ext01.cfe'), 'utf-8'), 'old');
  });

  test('dump, код 2 (прервано SIGTERM): success=false, отчёт прочитан, interrupted=true', async () => {
    const names = makeExtensionNames(4);
    setDbExtensions(ws, names);
    setFakeControl(ws, 'sigterm-dump.txt', [names[1]]);
    const { context } = options();

    const result = await runDumpAllExtensionsToCfe({ ...context, outputDir: ws.dataDir, silent: true });

    assert.strictEqual(result.success, false);
    assert.ok(result.report);
    assert.strictEqual(result.report.interrupted, true);
    assert.deepStrictEqual(result.report.items.filter((item) => item.status === 'ok').map((item) => item.extensionName), [names[0], names[1]]);
  });

  test('load, код 0: success=true, отчёт прочитан — все расширения ok', async () => {
    const names = makeExtensionNames(3);
    seedBackups(ws, names);
    setDbExtensions(ws, names);
    const { lines, context } = options();

    const result = await runLoadAllExtensionsFromCfe({ ...context, inputDir: ws.dataDir, silent: true });

    assert.strictEqual(result.success, true, lines.join('\n'));
    assert.ok(result.report);
    assert.strictEqual(result.report.operation, 'load');
    assert.deepStrictEqual(result.report.items.map((item) => item.status), ['ok', 'ok', 'ok']);
    assert.strictEqual(result.report.failedAt, undefined);
  });

  test('load, код 1 (отказ на 2-м): success=false, отчёт прочитан — failedAt назван, остановка после первого отказа', async () => {
    const names = makeExtensionNames(4);
    seedBackups(ws, names);
    setDbExtensions(ws, names);
    setFakeControl(ws, 'fail-load.txt', [names[1]]);
    const { context } = options();

    const result = await runLoadAllExtensionsFromCfe({ ...context, inputDir: ws.dataDir, silent: true });

    assert.strictEqual(result.success, false);
    assert.ok(result.report, 'отчёт при коде 1 обязан быть прочитан');
    assert.strictEqual(result.report.failedAt?.extensionName, names[1]);
    assert.strictEqual(result.report.failedAt.stateUncertain, true);
    assert.deepStrictEqual(result.report.items.filter((item) => item.status === 'ok').map((item) => item.extensionName), [names[0]]);
  });

  test('load, код 1 (расширения нет в базе, createMissing=false): success=false, отчёт с причиной прочитан', async () => {
    seedBackups(ws, ['Ext01', 'New']);
    setDbExtensions(ws, ['Ext01']);
    const { context } = options();

    const result = await runLoadAllExtensionsFromCfe({ ...context, inputDir: ws.dataDir, createMissing: false, silent: true });

    assert.strictEqual(result.success, false);
    assert.ok(result.report);
    assert.ok((result.report.errors ?? []).length > 0);
    assert.deepStrictEqual(result.report.missingInDb, ['New']);
  });

  test('load, createMissing=true: расширение, которого нет в базе, загружается, success=true', async () => {
    seedBackups(ws, ['Ext01', 'New']);
    setDbExtensions(ws, ['Ext01']);
    const { context } = options();

    const result = await runLoadAllExtensionsFromCfe({ ...context, inputDir: ws.dataDir, createMissing: true, silent: true });

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(result.report?.items.map((item) => item.extensionName), ['Ext01', 'New']);
  });

  test('load, код 2 (прервано SIGTERM): success=false, отчёт прочитан, interrupted=true', async () => {
    const names = makeExtensionNames(4);
    seedBackups(ws, names);
    setDbExtensions(ws, names);
    setFakeControl(ws, 'sigterm-load.txt', [names[1]]);
    const { context } = options();

    const result = await runLoadAllExtensionsFromCfe({ ...context, inputDir: ws.dataDir, silent: true });

    assert.strictEqual(result.success, false);
    assert.ok(result.report);
    assert.strictEqual(result.report.interrupted, true);
    assert.deepStrictEqual(result.report.items.filter((item) => item.status === 'ok').map((item) => item.extensionName), [names[0], names[1]]);
  });
});
