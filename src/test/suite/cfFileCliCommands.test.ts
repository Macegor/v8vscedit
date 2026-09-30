/**
 * Тесты CLI-команд `dump-cf`/`load-cf` (`src/cli/commands/dumpCfFile.ts`,
 * `src/cli/commands/loadCfFile.ts`) и их регистрации в `CLI_COMMANDS`.
 *
 * Ключевое архитектурное требование задания: ВСЕ guard'ы (`-AllExtensions`,
 * обязательность пути, суффикс `.cf`/`.cfe`, существование/пустота файла,
 * `-Overwrite`) обязаны отрабатывать ДО `resolveConnection()`. Тесты это
 * доказывают, вызывая оркестраторы `dumpCfFile`/`loadCfFile` НАПРЯМУЮ в
 * окружении БЕЗ параметров подключения к базе и БЕЗ установленной платформы:
 * если бы порядок проверок был обратным, тест упал бы с ДРУГИМ сообщением
 * («Error: specify -InfoBasePath...», см. `src/cli/core/connection.ts`) —
 * этого не происходит, что и фиксируется явной проверкой отсутствия
 * подстроки "InfoBasePath" в сообщении об ошибке guard'а.
 *
 * Спавн реального Конфигуратора 1С здесь НЕДОПУСТИМ и не производится —
 * все guard-сценарии обрываются исключением до старта процесса.
 *
 * `dumpCfFile.ts`/`loadCfFile.ts` на фазе «красный» ещё не существуют —
 * лениво грузятся через `tryRequireProductionModule`.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CLI_COMMANDS } from '../../cli/commands';
import type { CliArgs } from '../../cli/core/types';
import { runProcess } from '../../infra/process/ProcessRunner';
import { tryRequireProductionModule } from './support/tryRequireProductionModule';

interface DumpCfRequest {
  readonly outputFile: string;
  readonly extensionName: string;
  readonly isExtension: boolean;
  readonly overwrite: boolean;
  readonly verbose: boolean;
}

interface LoadCfRequest {
  readonly inputFile: string;
  readonly extensionName: string;
  readonly isExtension: boolean;
  readonly verbose: boolean;
}

interface DumpCfFileModule {
  parseDumpCfArgs(args: CliArgs): DumpCfRequest;
  dumpCfFile(args: CliArgs): Promise<number>;
}

interface LoadCfFileModule {
  parseLoadCfArgs(args: CliArgs): LoadCfRequest;
  loadCfFile(args: CliArgs): Promise<number>;
}

suite('CLI-команды dump-cf/load-cf — регистрация и guard-ветки (без спавна платформы)', () => {
  let dumpMod: DumpCfFileModule | undefined;
  let loadMod: LoadCfFileModule | undefined;
  let tempDir: string;

  suiteSetup(() => {
    dumpMod = tryRequireProductionModule('../../../cli/commands/dumpCfFile') as DumpCfFileModule | undefined;
    loadMod = tryRequireProductionModule('../../../cli/commands/loadCfFile') as LoadCfFileModule | undefined;
  });

  setup(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-cf-cli-'));
  });

  teardown(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('модули dumpCfFile.ts и loadCfFile.ts существуют', () => {
    assert.ok(dumpMod, 'src/cli/commands/dumpCfFile.ts ещё не реализован (ожидаемо на фазе «красный» TDD)');
    assert.ok(loadMod, 'src/cli/commands/loadCfFile.ts ещё не реализован (ожидаемо на фазе «красный» TDD)');
  });

  function dump(): DumpCfFileModule {
    if (!dumpMod) {
      assert.fail('dumpCfFile.ts не реализован — см. первый тест сьюта');
    }
    return dumpMod;
  }

  function load(): LoadCfFileModule {
    if (!loadMod) {
      assert.fail('loadCfFile.ts не реализован — см. первый тест сьюта');
    }
    return loadMod;
  }

  // ─── Часть 4, C.12: регистрация в CLI_COMMANDS + алиасы ───

  test('CLI_COMMANDS содержит dump-cf/load-cf и алиасы db-dump-cf/db-load-cf; алиас === основной хендлер (ссылки)', () => {
    assert.ok(CLI_COMMANDS['dump-cf'], 'dump-cf должен быть зарегистрирован в CLI_COMMANDS');
    assert.ok(CLI_COMMANDS['load-cf'], 'load-cf должен быть зарегистрирован в CLI_COMMANDS');
    assert.ok(CLI_COMMANDS['db-dump-cf'], 'db-dump-cf (алиас 1С-скила) должен быть зарегистрирован');
    assert.ok(CLI_COMMANDS['db-load-cf'], 'db-load-cf (алиас 1С-скила) должен быть зарегистрирован');
    assert.strictEqual(CLI_COMMANDS['db-dump-cf'], CLI_COMMANDS['dump-cf'], 'алиас обязан ссылаться на ТОТ ЖЕ хендлер (не копию/обёртку)');
    assert.strictEqual(CLI_COMMANDS['db-load-cf'], CLI_COMMANDS['load-cf'], 'алиас обязан ссылаться на ТОТ ЖЕ хендлер (не копию/обёртку)');
  });

  // ─── Часть 4, C.13: обязательные параметры ───

  test('parseDumpCfArgs без -OutputFile → Error', () => {
    assert.throws(() => dump().parseDumpCfArgs({}), /OutputFile/);
  });

  test('parseLoadCfArgs без -InputFile → Error', () => {
    assert.throws(() => load().parseLoadCfArgs({}), /InputFile/);
  });

  // ─── Часть 4, C.14: -AllExtensions обязан падать ДО resolveConnection ───

  test('dumpCfFile с -AllExtensions падает с ошибкой про -Extension/list-db-extensions, а НЕ с ошибкой "specify -InfoBasePath" (доказывает порядок guard → connection)', async () => {
    await assert.rejects(
      dump().dumpCfFile({ OutputFile: path.join(tempDir, 'out.cf'), AllExtensions: true }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(!error.message.includes('InfoBasePath'), `guard обязан сработать раньше resolveConnection: "${error.message}"`);
        assert.ok(error.message.includes('list-db-extensions'), `ожидалось сообщение про -AllExtensions: "${error.message}"`);
        return true;
      }
    );
  });

  test('loadCfFile с -AllExtensions падает с ошибкой про -Extension/list-db-extensions, а НЕ с ошибкой "specify -InfoBasePath" (доказывает порядок guard → connection)', async () => {
    const inputFile = path.join(tempDir, 'in.cf');
    fs.writeFileSync(inputFile, Buffer.from([1, 2, 3]));
    await assert.rejects(
      load().loadCfFile({ InputFile: inputFile, AllExtensions: true }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(!error.message.includes('InfoBasePath'), `guard обязан сработать раньше resolveConnection: "${error.message}"`);
        assert.ok(error.message.includes('list-db-extensions'), `ожидалось сообщение про -AllExtensions: "${error.message}"`);
        return true;
      }
    );
  });

  // ─── Часть 4, C.15: рассинхрон -Extension и суффикса файла ───

  test('load-cf: -Extension задан, но файл ".cf" (не ".cfe") → Error до спавна', async () => {
    // Прогон-обоснование (T7/T9 из эмпирики платформы): при таком рассинхроне
    // Конфигуратор падает ПОСЛЕ того, как расширение уже создано в базе —
    // чинить состояние базы после спавна нечем, поэтому проверка обязана
    // остановить операцию до старта процесса.
    const inputFile = path.join(tempDir, 'mismatched.cf');
    fs.writeFileSync(inputFile, Buffer.from([1]));
    await assert.rejects(load().loadCfFile({ InputFile: inputFile, Extension: 'EVOLC' }), /\.cfe/);
  });

  test('load-cf: -Extension НЕ задан, но файл ".cfe" (не ".cf") → Error до спавна', async () => {
    const inputFile = path.join(tempDir, 'mismatched.cfe');
    fs.writeFileSync(inputFile, Buffer.from([1]));
    await assert.rejects(load().loadCfFile({ InputFile: inputFile }), /\.cf\b/);
  });

  /**
   * Ошибка обязана прийти от НАШЕГО guard'а, а не от `resolveConnection`.
   * Голый `assert.rejects` без матчера остался бы зелёным и после удаления
   * валидации: код упал бы позже, на отсутствии параметров подключения, — то
   * есть тест перестал бы проверять то, ради чего написан.
   */
  function assertOwnGuardFailure(error: Error, what: string): true {
    assert.ok(
      !error.message.includes('InfoBasePath'),
      `${what}: guard обязан сработать раньше resolveConnection, а упало на подключении: "${error.message}"`
    );
    return true;
  }

  // ─── Часть 4, C.16: входной файл load-cf ───

  test('load-cf: несуществующий входной файл → Error до спавна', async () => {
    await assert.rejects(
      load().loadCfFile({ InputFile: path.join(tempDir, 'absent.cf') }),
      (error: Error) => assertOwnGuardFailure(error, 'несуществующий входной файл')
    );
  });

  test('load-cf: каталог вместо файла → Error до спавна', async () => {
    const dirPath = path.join(tempDir, 'as-dir.cf');
    fs.mkdirSync(dirPath);
    await assert.rejects(
      load().loadCfFile({ InputFile: dirPath }),
      (error: Error) => assertOwnGuardFailure(error, 'каталог вместо файла')
    );
  });

  test('load-cf: входной файл 0 байт → Error до спавна', async () => {
    const filePath = path.join(tempDir, 'zero.cf');
    fs.writeFileSync(filePath, Buffer.alloc(0));
    await assert.rejects(
      load().loadCfFile({ InputFile: filePath }),
      (error: Error) => assertOwnGuardFailure(error, 'пустой входной файл')
    );
  });

  // ─── Часть 4, C.17: -Overwrite для dump-cf ───

  test('dump-cf: целевой файл уже существует, -Overwrite не задан → Error до спавна (и до resolveConnection)', async () => {
    const outputFile = path.join(tempDir, 'existing.cf');
    fs.writeFileSync(outputFile, 'data');
    await assert.rejects(
      dump().dumpCfFile({ OutputFile: outputFile }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(!error.message.includes('InfoBasePath'), `guard обязан сработать раньше resolveConnection: "${error.message}"`);
        return true;
      }
    );
  });

  test('dump-cf: целевой файл существует, -Overwrite задан → guard-проверка проходит, падение уже на resolveConnection (нет параметров подключения)', async () => {
    const outputFile = path.join(tempDir, 'existing-ow.cf');
    fs.writeFileSync(outputFile, 'data');
    await assert.rejects(
      dump().dumpCfFile({ OutputFile: outputFile, Overwrite: true }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        // Раз в сообщении именно про InfoBasePath — все guard'ы (включая
        // -Overwrite) успешно пройдены, и код дошёл до resolveConnection.
        assert.ok(error.message.includes('InfoBasePath'), `ожидалось, что -Overwrite снял fs-проверку и код дошёл до resolveConnection: "${error.message}"`);
        return true;
      }
    );
  });

  // ─── Часть 4, C.18: BOOLEAN_SWITCHES/-Overwrite и printUsage через собранный CLI ───
  //
  // `BOOLEAN_SWITCHES` — приватная константа `onec-tools.ts`, не экспортируется,
  // а сам модуль исполняет `void main()` безусловно на верхнем уровне и обрывает
  // процесс через `process.exit` — импортировать его в тестовый процесс нельзя
  // (см. соответствующий тест-комментарий в `cliProcess.test.ts`). Поэтому
  // поведение проверяется на РЕАЛЬНОМ дочернем node-процессе собранного
  // `dist/cli/onec-tools.js` — как и в `cliProcess.test.ts` (это не спавн
  // платформы 1С, а спавн нашего собственного CLI).

  test('собранный CLI: usage упоминает все четыре новых имени команды (dump-cf/db-dump-cf/load-cf/db-load-cf)', async () => {
    const cliPath = path.join(__dirname, '..', '..', '..', 'dist', 'cli', 'onec-tools.js');
    assert.ok(fs.existsSync(cliPath), `собранный CLI не найден: ${cliPath} (ожидается build:node из pretest)`);

    const stdoutLines: string[] = [];
    await runProcess({
      command: process.execPath,
      args: [cliPath],
      onStdout: (line) => stdoutLines.push(line),
    });
    const usage = stdoutLines.join('\n');
    for (const name of ['dump-cf', 'db-dump-cf', 'load-cf', 'db-load-cf']) {
      assert.match(usage, new RegExp(name.replace(/-/g, '\\-')), `usage должен упоминать команду "${name}"`);
    }
  });

  test('собранный CLI: -Overwrite распознаётся как булев переключатель (dump-cf без обязательного -OutputFile падает с ошибкой про -OutputFile, а НЕ "value required for -Overwrite")', async () => {
    // Если бы -Overwrite не был в BOOLEAN_SWITCHES, parseArgs увидел бы за ним
    // конец массива и бросил бы "Error: value required for -Overwrite" —
    // раньше, чем дело дойдёт до parseDumpCfArgs и его проверки -OutputFile.
    const cliPath = path.join(__dirname, '..', '..', '..', 'dist', 'cli', 'onec-tools.js');
    assert.ok(fs.existsSync(cliPath), `собранный CLI не найден: ${cliPath} (ожидается build:node из pretest)`);

    const stderrLines: string[] = [];
    const result = await runProcess({
      command: process.execPath,
      args: [cliPath, 'dump-cf', '-Overwrite'],
      onStderr: (line) => stderrLines.push(line),
    });
    assert.notStrictEqual(result.exitCode, 0);
    const stderr = stderrLines.join('\n');
    assert.ok(!stderr.includes('value required for -Overwrite'), `-Overwrite не должен требовать значения: "${stderr}"`);
    // Положительная половина: дело реально дошло до parseDumpCfArgs и упало
    // на отсутствии -OutputFile. Без этого ассерта тест остался бы зелёным
    // и при падении по любой посторонней причине.
    assert.match(stderr, /OutputFile/, `ожидалась ошибка про -OutputFile: "${stderr}"`);
  });
});
