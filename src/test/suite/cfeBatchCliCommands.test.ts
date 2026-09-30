/**
 * Тесты CLI-команд `dump-cfe-all`/`load-cfe-all` (`src/cli/commands/dumpCfeAll.ts`,
 * `src/cli/commands/loadCfeAll.ts`): регистрация в `CLI_COMMANDS` и ВСЕ
 * guard-ветки разбора аргументов.
 *
 * Валидация обязана быть ПОЛНОЙ и идти ДО `resolveConnection`: платформа не
 * диагностирует ни неверный ключ, ни рассинхрон, а при сбое всё равно оставляет
 * побочные эффекты (замерено на 8.3.27.1989). Приём доказательства — как в
 * `cfFileCliCommands.test.ts`: команда вызывается напрямую БЕЗ параметров
 * подключения; если бы порядок был обратным, сообщение было бы «specify
 * -InfoBasePath…», а его в тексте ошибки guard'а быть не должно.
 *
 * Спавн Конфигуратора здесь не производится: все сценарии обрываются
 * исключением до старта процесса. Полный цикл на заглушке — в `cfeBatchCliRun.test.ts`.
 *
 * Принятая форма разобранного запроса: `parseDumpCfeAllArgs` →
 * `{ outputDir, overwrite, verbose }`, `parseLoadCfeAllArgs` →
 * `{ inputDir, createMissing, verbose }` (пути абсолютные). Отдельного входа со
 * списком имён у команд нет: список расширений — всегда из `/DumpDBCfgList`.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CLI_COMMANDS } from '../../cli/commands';
import { dumpCfeAll, parseDumpCfeAllArgs } from '../../cli/commands/dumpCfeAll';
import { loadCfeAll, parseLoadCfeAllArgs } from '../../cli/commands/loadCfeAll';
import { runCli } from './support/cfeBatchFixtures';

/** Ошибка guard'а обязана быть про причину, а не про подключение к базе. */
function assertGuardError(error: unknown, pattern: RegExp): true {
  assert.ok(error instanceof Error);
  assert.ok(!error.message.includes('InfoBasePath'), `guard обязан сработать раньше resolveConnection: "${error.message}"`);
  assert.match(error.message, pattern);
  return true;
}

suite('CLI dump-cfe-all/load-cfe-all — регистрация', () => {
  test('CLI_COMMANDS содержит dump-cfe-all/load-cfe-all и алиасы db-dump-cfe-all/db-load-cfe-all; алиас — ТА ЖЕ ссылка на хендлер', () => {
    assert.ok(CLI_COMMANDS['dump-cfe-all'], 'dump-cfe-all не зарегистрирован');
    assert.ok(CLI_COMMANDS['load-cfe-all'], 'load-cfe-all не зарегистрирован');
    assert.ok(CLI_COMMANDS['db-dump-cfe-all'], 'алиас db-dump-cfe-all не зарегистрирован');
    assert.ok(CLI_COMMANDS['db-load-cfe-all'], 'алиас db-load-cfe-all не зарегистрирован');
    assert.strictEqual(CLI_COMMANDS['db-dump-cfe-all'], CLI_COMMANDS['dump-cfe-all']);
    assert.strictEqual(CLI_COMMANDS['db-load-cfe-all'], CLI_COMMANDS['load-cfe-all']);
  });

  test('хендлеры регистрации — именно экспортируемые dumpCfeAll/loadCfeAll (а не обёртки, скрывающие guard)', () => {
    assert.strictEqual(CLI_COMMANDS['dump-cfe-all'], dumpCfeAll);
    assert.strictEqual(CLI_COMMANDS['load-cfe-all'], loadCfeAll);
  });

  test('одиночные dump-cf/load-cf остаются отдельными командами (пакетные их не подменяют)', () => {
    assert.ok(CLI_COMMANDS['dump-cf']);
    assert.ok(CLI_COMMANDS['load-cf']);
    assert.notStrictEqual(CLI_COMMANDS['dump-cfe-all'], CLI_COMMANDS['dump-cf']);
    assert.notStrictEqual(CLI_COMMANDS['load-cfe-all'], CLI_COMMANDS['load-cf']);
  });
});

suite('CLI dump-cfe-all — parseDumpCfeAllArgs (guard-ветки без подключения к базе)', () => {
  let tempDir: string;
  let outputDir: string;

  setup(() => {
    tempDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-dump-cfe-all-args-')));
    outputDir = path.join(tempDir, 'out');
    fs.mkdirSync(outputDir);
  });

  teardown(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('минимально валидные аргументы: outputDir абсолютный, overwrite=false, verbose=false', () => {
    const request = parseDumpCfeAllArgs({ OutputDir: outputDir });
    assert.strictEqual(request.outputDir, outputDir);
    assert.strictEqual(request.overwrite, false);
    assert.strictEqual(request.verbose, false);
  });

  test('-Overwrite и -Verbose переходят в запрос', () => {
    const request = parseDumpCfeAllArgs({ OutputDir: outputDir, Overwrite: true, Verbose: true });
    assert.strictEqual(request.overwrite, true);
    assert.strictEqual(request.verbose, true);
  });

  test('относительный -OutputDir приводится к абсолютному (path.resolve)', () => {
    const relative = path.relative(process.cwd(), outputDir);
    assert.strictEqual(parseDumpCfeAllArgs({ OutputDir: relative }).outputDir, path.resolve(relative));
  });

  test('пробелы вокруг -OutputDir не считаются частью пути', () => {
    assert.strictEqual(parseDumpCfeAllArgs({ OutputDir: `  ${outputDir}  ` }).outputDir, outputDir);
  });

  test('без -OutputDir → Error про OutputDir', () => {
    assert.throws(() => parseDumpCfeAllArgs({}), (error) => assertGuardError(error, /OutputDir/));
  });

  test('пустой и пробельный -OutputDir → Error про OutputDir', () => {
    for (const value of ['', '   ']) {
      assert.throws(() => parseDumpCfeAllArgs({ OutputDir: value }), (error) => assertGuardError(error, /OutputDir/), JSON.stringify(value));
    }
  });

  test('-AllExtensions отвергается: пакетность — это цикл по списку, а не ключ платформы (она бы молча выгрузила ОСНОВНУЮ конфигурацию)', () => {
    assert.throws(
      () => parseDumpCfeAllArgs({ OutputDir: outputDir, AllExtensions: true }),
      (error) => assertGuardError(error, /AllExtensions/)
    );
  });

  test('-OutputDir не существует → Error с путём каталога', () => {
    const missing = path.join(tempDir, 'no-such-dir');
    assert.throws(() => parseDumpCfeAllArgs({ OutputDir: missing }), (error) => assertGuardError(error, new RegExp(missing.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))));
  });

  test('-OutputDir указывает на файл → Error', () => {
    const filePath = path.join(tempDir, 'file.txt');
    fs.writeFileSync(filePath, 'x');
    assert.throws(() => parseDumpCfeAllArgs({ OutputDir: filePath }), (error) => assertGuardError(error, /file\.txt/));
  });

  test('dumpCfeAll: guard отрабатывает ДО resolveConnection — без параметров подключения ошибка про причину, а не про InfoBasePath', async () => {
    await assert.rejects(dumpCfeAll({ OutputDir: path.join(tempDir, 'no-such-dir') }), (error) => assertGuardError(error, /no-such-dir/));
    await assert.rejects(dumpCfeAll({ OutputDir: outputDir, AllExtensions: true }), (error) => assertGuardError(error, /AllExtensions/));
    await assert.rejects(dumpCfeAll({}), (error) => assertGuardError(error, /OutputDir/));
  });

  test('dumpCfeAll: валидные аргументы без подключения → ошибка именно про InfoBasePath (порядок: разбор → подключение), каталог не тронут', async () => {
    await assert.rejects(
      dumpCfeAll({ OutputDir: outputDir }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(error.message.includes('InfoBasePath'), error.message);
        return true;
      }
    );
    assert.deepStrictEqual(fs.readdirSync(outputDir), [], 'до подключения к базе в каталог ничего писать нельзя');
  });
});

suite('CLI load-cfe-all — parseLoadCfeAllArgs (guard-ветки без подключения к базе)', () => {
  let tempDir: string;
  let inputDir: string;

  setup(() => {
    tempDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-load-cfe-all-args-')));
    inputDir = path.join(tempDir, 'in');
    fs.mkdirSync(inputDir);
  });

  teardown(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('минимально валидные аргументы: inputDir абсолютный, createMissing=false, verbose=false', () => {
    const request = parseLoadCfeAllArgs({ InputDir: inputDir });
    assert.strictEqual(request.inputDir, inputDir);
    assert.strictEqual(request.createMissing, false);
    assert.strictEqual(request.verbose, false);
  });

  test('-CreateMissing и -Verbose переходят в запрос', () => {
    const request = parseLoadCfeAllArgs({ InputDir: inputDir, CreateMissing: true, Verbose: true });
    assert.strictEqual(request.createMissing, true);
    assert.strictEqual(request.verbose, true);
  });

  test('относительный -InputDir приводится к абсолютному', () => {
    const relative = path.relative(process.cwd(), inputDir);
    assert.strictEqual(parseLoadCfeAllArgs({ InputDir: relative }).inputDir, path.resolve(relative));
  });

  test('без -InputDir, пустой и пробельный → Error про InputDir', () => {
    assert.throws(() => parseLoadCfeAllArgs({}), (error) => assertGuardError(error, /InputDir/));
    for (const value of ['', '   ']) {
      assert.throws(() => parseLoadCfeAllArgs({ InputDir: value }), (error) => assertGuardError(error, /InputDir/), JSON.stringify(value));
    }
  });

  test('-AllExtensions отвергается', () => {
    assert.throws(
      () => parseLoadCfeAllArgs({ InputDir: inputDir, AllExtensions: true }),
      (error) => assertGuardError(error, /AllExtensions/)
    );
  });

  test('-InputDir не существует → Error с путём', () => {
    assert.throws(() => parseLoadCfeAllArgs({ InputDir: path.join(tempDir, 'no-such-dir') }), (error) => assertGuardError(error, /no-such-dir/));
  });

  test('-InputDir указывает на файл → Error', () => {
    const filePath = path.join(tempDir, 'file.cfe');
    fs.writeFileSync(filePath, 'x');
    assert.throws(() => parseLoadCfeAllArgs({ InputDir: filePath }), (error) => assertGuardError(error, /file\.cfe/));
  });

  test('loadCfeAll: guard отрабатывает ДО resolveConnection', async () => {
    await assert.rejects(loadCfeAll({ InputDir: path.join(tempDir, 'no-such-dir') }), (error) => assertGuardError(error, /no-such-dir/));
    await assert.rejects(loadCfeAll({ InputDir: inputDir, AllExtensions: true }), (error) => assertGuardError(error, /AllExtensions/));
    await assert.rejects(loadCfeAll({}), (error) => assertGuardError(error, /InputDir/));
  });

  test('loadCfeAll: валидные аргументы без подключения → ошибка про InfoBasePath, каталог не тронут', async () => {
    fs.writeFileSync(path.join(inputDir, 'Ext01.cfe'), 'bytes');
    await assert.rejects(
      loadCfeAll({ InputDir: inputDir }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(error.message.includes('InfoBasePath'), error.message);
        return true;
      }
    );
    assert.deepStrictEqual(fs.readdirSync(inputDir), ['Ext01.cfe']);
  });
});

suite('CLI dump-cfe-all/load-cfe-all — собранный dist/cli/onec-tools.js', function () {
  // Каждый тест — реальный дочерний node-процесс нашего CLI (не платформы 1С).
  this.timeout(60_000);

  test('usage упоминает все четыре имени команды', async () => {
    const result = await runCli([]);
    assert.notStrictEqual(result.exitCode, 0, 'без команды CLI обязан завершаться ненулевым кодом');
    for (const name of ['dump-cfe-all', 'db-dump-cfe-all', 'load-cfe-all', 'db-load-cfe-all']) {
      assert.ok(result.stdout.includes(name), `usage не упоминает "${name}": ${result.stdout}`);
    }
  });

  test('-Overwrite распознаётся как булев переключатель (падает на отсутствующем -OutputDir, а не на "value required for -Overwrite")', async () => {
    const result = await runCli(['dump-cfe-all', '-Overwrite']);
    assert.notStrictEqual(result.exitCode, 0);
    assert.ok(!result.stderr.includes('value required for -Overwrite'), result.stderr);
    assert.match(result.stderr, /OutputDir/);
  });

  test('-CreateMissing распознаётся как булев переключатель (падает на отсутствующем -InputDir, а не на "value required for -CreateMissing")', async () => {
    const result = await runCli(['load-cfe-all', '-CreateMissing']);
    assert.notStrictEqual(result.exitCode, 0);
    assert.ok(!result.stderr.includes('value required for -CreateMissing'), result.stderr);
    assert.match(result.stderr, /InputDir/);
  });

  test('алиасы db-dump-cfe-all/db-load-cfe-all доступны из собранного CLI (не "unknown command")', async () => {
    for (const [alias, expected] of [['db-dump-cfe-all', /OutputDir/], ['db-load-cfe-all', /InputDir/]] as const) {
      const result = await runCli([alias]);
      assert.notStrictEqual(result.exitCode, 0);
      assert.ok(!result.stderr.includes('unknown command'), `${alias}: ${result.stderr}`);
      assert.match(result.stderr, expected);
    }
  });
});
