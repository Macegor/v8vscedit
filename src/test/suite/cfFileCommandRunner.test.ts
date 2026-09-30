/**
 * Прямой тест раннера `src/ui/commands/ext/CfFileCommandRunner.ts` — единственного
 * места, которое строит РЕАЛЬНЫЙ вектор аргументов внутреннего CLI для
 * dump-cf/load-cf (включая `-Password <пароль базы>`) и передаёт его в
 * `runInternalCliCommand`, логирующий вектор в OutputChannel «1С Редактор».
 *
 * ПРИЧИНА добавления (возврат со стадии qa-e2e, а не гипотеза): до этого файла
 * `CfFileCommandRunner` ни разу не импортировался по имени ни одним тестом.
 * Транзитивно он задевался только из `mcpConfigLifecycleCfTools.test.ts`, но
 * там `services: {}` — `workspaceFolder === undefined`, и `resolveConnectionArgs`
 * падает на первой строке, ДО `resolveSettingsPath`/`resolveConnectionFromSettings`/
 * `buildConnectionCliArgs`/`runInternalCliCommand`. Из-за этого маскирование
 * пароля (`maskSensitiveCliArgs`, см. `sensitiveArgs.test.ts`) было проверено
 * только на голой функции — НЕ интеграционно, то есть реальная цель правки
 * (пароль не должен попасть в OutputChannel) фактически не подтверждена.
 *
 * Спавн РЕАЛЬНОГО Конфигуратора 1С здесь недопустим и не производится. Вместо
 * этого:
 *  - guard-тесты (`validateCfFileRequest`) проверяют документированный в самом
 *    файле инвариант «валидация ПЕРВОЙ» — ей физически не с чем сравнивать
 *    workspaceFolder/env.json, поэтому в этих тестах передан заведомо битый
 *    workspaceFolder, а env.json в рабочей папке вовсе отсутствует;
 *  - тесты «доходит до реального запуска CLI» дают `env.json` с ЗАВЕДОМО
 *    несуществующим `--path` — внутренний CLI (`dist/cli/onec-tools.js`,
 *    НАШ собственный, не платформа) стартует по-настоящему, но детерминированно
 *    и быстро падает на `resolveExplicitV8Path` (throws СИНХРОННО, до спавна
 *    самого Конфигуратора) — 1cv8 в CI не устанавливается и не трогается;
 *  - две «true success»-проверки (результат `true`, а не просто «не бросило»)
 *    используют минимальную POSIX-заглушку вместо `1cv8` (единственная внешняя
 *    недоступная система здесь и единственный мок в этом файле, что явно
 *    обосновано в комментарии у самой заглушки) — она НЕ имитирует поведение
 *    платформы, а только подтверждает код завершения 0 и (для dump) кладёт
 *    несколько байт по пути `/DumpCfg <файл>`, который наш же `dumpCfFile.ts`
 *    ожидает найти для переноса staging-файла. На Windows заглушка пропускается
 *    (`this.skip()`) — POSIX-шебанг там не работает, а остальные тесты файла
 *    от платформы не зависят и на Windows остаются полными.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  runDumpConfigurationToCf,
  runLoadConfigurationFromCf,
} from '../../ui/commands/ext/CfFileCommandRunner';

const REAL_PASSWORD = 'Qz7!SuperSecretDbPwd_42';
const MASK = '********';
// Заведомо не существующий на диске путь: `resolveExplicitV8Path` обязан
// бросить синхронно ДО спавна DESIGNER — платформа 1С не трогается вовсе.
const ABSENT_V8_PATH_SEGMENTS = ['definitely', 'not', 'installed', 'v8vscedit-test-fixture', '1cv8'];

function absentV8Path(root: string): string {
  return path.join(root, ...ABSENT_V8_PATH_SEGMENTS);
}

/** Пишет env.json в формате, который реально читает `resolveConnectionFromSettings`. */
function writeEnvJson(workspaceRoot: string, v8Path: string): void {
  const infobasePath = path.join(workspaceRoot, 'fake-infobase');
  const content = {
    default: {
      '--ibconnection': `/F${infobasePath}`,
      '--db-user': 'Admin',
      '--db-pwd': REAL_PASSWORD,
      '--path': v8Path,
    },
  };
  fs.writeFileSync(path.join(workspaceRoot, 'env.json'), JSON.stringify(content, null, 2), 'utf-8');
}

/**
 * Реальный `vscode.OutputChannel` собрать без видимой панели канала нельзя —
 * единственное, что реально нужно продакшен-коду из этого интерфейса, это
 * `appendLine`, поэтому подставляется приёмник с настоящей семантикой
 * накопления строк (не фиксация факта вызова, а реальный лог, который потом
 * построчно проверяется).
 */
function createOutputChannel(): { channel: vscode.OutputChannel; lines: string[] } {
  const lines: string[] = [];
  const channel = {
    appendLine: (message: string) => { lines.push(message); },
  } as unknown as vscode.OutputChannel;
  return { channel, lines };
}

function fakeWorkspaceFolder(root: string): vscode.WorkspaceFolder {
  return { uri: vscode.Uri.file(root), name: 'cf-runner-test', index: 0 };
}

/**
 * Минимальная POSIX-заглушка вместо Конфигуратора 1С — единственный мок
 * внешней недоступной системы в этом файле (обоснование см. в шапке файла).
 * `variant: 'noop'` только завершается с кодом 0 (достаточно для load-cf,
 * который не переносит staging-файл сам). `variant: 'dump'` дополнительно
 * сканирует argv и по паре `/DumpCfg <путь>` кладёт по этому пути несколько
 * байт — ровно то, что `dumpCfFile.ts` (НАШ код, не платформа) ожидает найти,
 * чтобы перенести staging-файл на целевой путь.
 */
function createFakeDesignerExecutable(dir: string, variant: 'noop' | 'dump'): string {
  const scriptPath = path.join(dir, '1cv8');
  const body = variant === 'dump'
    ? [
      '#!/bin/sh',
      'prev=""',
      'for arg in "$@"; do',
      '  if [ "$prev" = "/DumpCfg" ]; then',
      '    printf \'fake-cf-bytes\' > "$arg"',
      '  fi',
      '  prev="$arg"',
      'done',
      'exit 0',
      '',
    ].join('\n')
    : '#!/bin/sh\nexit 0\n';
  fs.writeFileSync(scriptPath, body, 'utf-8');
  fs.chmodSync(scriptPath, 0o755);
  return scriptPath;
}

suite('CfFileCommandRunner — runDumpConfigurationToCf/runLoadConfigurationFromCf (прямой тест раннера)', () => {
  let tempDir: string;

  setup(() => {
    tempDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-cf-runner-')));
  });

  teardown(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // ─── Ветка «неуспех»: validateCfFileRequest бросает ДО обращения к workspaceFolder/env.json ───

  test('runDumpConfigurationToCf: несуществующий каталог назначения — guard бросает раньше, чем код тронет workspaceFolder/env.json', async () => {
    // workspaceFolder заведомо битый (каталога нет вовсе, env.json никто не
    // писал) — если бы валидация не была первой, ошибка была бы про env.json,
    // а не про каталог назначения.
    const bogusWorkspaceFolder = fakeWorkspaceFolder(path.join(tempDir, 'no-such-workspace'));
    const { channel, lines } = createOutputChannel();
    const outputFile = path.join(tempDir, 'no-such-subdir', 'out.cf');

    await assert.rejects(
      runDumpConfigurationToCf({
        workspaceFolder: bogusWorkspaceFolder,
        outputChannel: channel,
        outputFile,
        silent: true,
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /Каталог назначения не существует/);
        return true;
      }
    );
    assert.deepStrictEqual(lines, [], 'guard обязан сработать ДО первого обращения к outputChannel/CLI');
  });

  test('runLoadConfigurationFromCf: несуществующий входной файл — guard бросает раньше, чем код тронет workspaceFolder/env.json', async () => {
    const bogusWorkspaceFolder = fakeWorkspaceFolder(path.join(tempDir, 'no-such-workspace'));
    const { channel, lines } = createOutputChannel();
    const inputFile = path.join(tempDir, 'absent.cf');

    await assert.rejects(
      runLoadConfigurationFromCf({
        workspaceFolder: bogusWorkspaceFolder,
        outputChannel: channel,
        inputFile,
        silent: true,
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /Файл не найден/);
        return true;
      }
    );
    assert.deepStrictEqual(lines, [], 'guard обязан сработать ДО первого обращения к outputChannel/CLI');
  });

  // ─── Ветка «доходит до реального запуска CLI»: guard проходит, строится cliArgs, стартует внутренний CLI ───
  //
  // Реального 1cv8 в CI нет — эти сценарии детерминированно завершаются
  // неуспехом на `resolveExplicitV8Path` (throws до спавна DESIGNER), но
  // ГЛАВНОЕ здесь — не итоговый exitCode, а то, что случилось ДО него: вектор
  // аргументов построен и залогирован С МАСКИРОВАННЫМ паролем.

  test('runDumpConfigurationToCf: основная конфигурация (isExtension=false, overwrite=true) — реально строит cliArgs и запускает внутренний CLI, пароль в логе замаскирован', async function () {
    this.timeout(15_000);
    const workspaceFolder = fakeWorkspaceFolder(tempDir);
    writeEnvJson(tempDir, absentV8Path(tempDir));
    const { channel, lines } = createOutputChannel();
    const outputFile = path.join(tempDir, 'main-dump.cf');
    fs.writeFileSync(outputFile, 'stale-content-to-overwrite');

    const result = await runDumpConfigurationToCf({
      workspaceFolder,
      outputChannel: channel,
      outputFile,
      overwrite: true,
      silent: true,
    });

    // Без установленной платформы CLI не может успешно завершиться — это
    // ОЖИДАЕМОЕ и задокументированное поведение окружения без 1cv8, а не
    // дефект: важно, что раннер ДОШЁЛ до реального запуска (см. проверки ниже).
    assert.strictEqual(result, false, 'без платформы 1С раннер обязан вернуть false, а не бросить исключение');

    const joined = lines.join('\n');
    const startLine = lines.find((line) => line.startsWith('[actions] Старт:'));
    assert.ok(startLine, `ожидалась строка старта CLI, реально накоплено: ${JSON.stringify(lines)}`);
    assert.ok(!joined.includes(REAL_PASSWORD), `реальный пароль не должен попасть в лог ни в одной строке: ${joined}`);
    assert.ok(startLine.includes(`-Password ${MASK}`), `значение -Password обязано быть замаскировано: "${startLine}"`);
    assert.ok(startLine.includes('-InfoBasePath'), 'путь базы обязан остаться в логе (маскирование не должно съедать лишнее)');
    assert.ok(startLine.includes('-UserName Admin'), 'имя пользователя обязано остаться в логе');
    assert.ok(startLine.includes('-Overwrite'), 'overwrite=true обязан попасть в вектор аргументов');
    assert.ok(startLine.includes('-OutputFile'), 'путь целевого файла обязан попасть в вектор аргументов');
    assert.ok(!startLine.includes('-Extension'), 'основная конфигурация не должна нести -Extension');
    assert.ok(lines.some((line) => line.startsWith('[actions][error]')), 'ожидалась строка об ошибке CLI (нет платформы)');
  });

  test('runDumpConfigurationToCf: расширение (isExtension=true, overwrite не задан) — -Extension присутствует, -Overwrite отсутствует, пароль замаскирован', async function () {
    this.timeout(15_000);
    const workspaceFolder = fakeWorkspaceFolder(tempDir);
    writeEnvJson(tempDir, absentV8Path(tempDir));
    const { channel, lines } = createOutputChannel();
    const outputFile = path.join(tempDir, 'ext-dump.cfe');

    const result = await runDumpConfigurationToCf({
      workspaceFolder,
      outputChannel: channel,
      outputFile,
      extensionName: 'EVOLC',
      silent: true,
    });

    assert.strictEqual(result, false, 'без платформы 1С раннер обязан вернуть false, а не бросить исключение');
    const startLine = lines.find((line) => line.startsWith('[actions] Старт:'));
    assert.ok(startLine, `ожидалась строка старта CLI, реально накоплено: ${JSON.stringify(lines)}`);
    assert.ok(!lines.join('\n').includes(REAL_PASSWORD), 'реальный пароль не должен попасть в лог');
    assert.ok(startLine.includes(`-Password ${MASK}`), 'значение -Password обязано быть замаскировано');
    assert.ok(startLine.includes('-Extension EVOLC'), '-Extension с именем расширения обязан попасть в вектор');
    assert.ok(!startLine.includes('-Overwrite'), 'overwrite не задан — флага -Overwrite быть не должно');
  });

  test('runLoadConfigurationFromCf: основная конфигурация (isExtension=false) — -InputFile присутствует, -Extension отсутствует, пароль замаскирован', async function () {
    this.timeout(15_000);
    const workspaceFolder = fakeWorkspaceFolder(tempDir);
    writeEnvJson(tempDir, absentV8Path(tempDir));
    const { channel, lines } = createOutputChannel();
    const inputFile = path.join(tempDir, 'main-load.cf');
    fs.writeFileSync(inputFile, Buffer.from([1, 2, 3, 4]));

    const result = await runLoadConfigurationFromCf({
      workspaceFolder,
      outputChannel: channel,
      inputFile,
      silent: true,
    });

    assert.strictEqual(result, false, 'без платформы 1С раннер обязан вернуть false, а не бросить исключение');
    const startLine = lines.find((line) => line.startsWith('[actions] Старт:'));
    assert.ok(startLine, `ожидалась строка старта CLI, реально накоплено: ${JSON.stringify(lines)}`);
    assert.ok(!lines.join('\n').includes(REAL_PASSWORD), 'реальный пароль не должен попасть в лог');
    assert.ok(startLine.includes(`-Password ${MASK}`), 'значение -Password обязано быть замаскировано');
    assert.ok(startLine.includes('-InputFile'), 'путь входного файла обязан попасть в вектор аргументов');
    assert.ok(!startLine.includes('-Extension'), 'основная конфигурация не должна нести -Extension');
  });

  test('runLoadConfigurationFromCf: расширение (isExtension=true) — -Extension присутствует, пароль замаскирован', async function () {
    this.timeout(15_000);
    const workspaceFolder = fakeWorkspaceFolder(tempDir);
    writeEnvJson(tempDir, absentV8Path(tempDir));
    const { channel, lines } = createOutputChannel();
    const inputFile = path.join(tempDir, 'ext-load.cfe');
    fs.writeFileSync(inputFile, Buffer.from([1, 2, 3, 4]));

    const result = await runLoadConfigurationFromCf({
      workspaceFolder,
      outputChannel: channel,
      inputFile,
      extensionName: 'EVOLC',
      silent: true,
    });

    assert.strictEqual(result, false, 'без платформы 1С раннер обязан вернуть false, а не бросить исключение');
    const startLine = lines.find((line) => line.startsWith('[actions] Старт:'));
    assert.ok(startLine, `ожидалась строка старта CLI, реально накоплено: ${JSON.stringify(lines)}`);
    assert.ok(!lines.join('\n').includes(REAL_PASSWORD), 'реальный пароль не должен попасть в лог');
    assert.ok(startLine.includes(`-Password ${MASK}`), 'значение -Password обязано быть замаскировано');
    assert.ok(startLine.includes('-Extension EVOLC'), '-Extension с именем расширения обязан попасть в вектор');
  });

  // ─── Ветка «успех» (result === true), без спавна реального 1cv8 (см. заглушку в шапке файла) ───

  test('runLoadConfigurationFromCf: с заглушкой вместо 1cv8 (exit 0) — result === true, лог без пароля', async function () {
    this.timeout(15_000);
    if (process.platform === 'win32') {
      // POSIX-шебанг-заглушка на Windows не исполняется — остальные тесты
      // файла от платформы не зависят и на Windows остаются полными.
      this.skip();
    }
    const workspaceFolder = fakeWorkspaceFolder(tempDir);
    const fakeV8 = createFakeDesignerExecutable(tempDir, 'noop');
    writeEnvJson(tempDir, fakeV8);
    const { channel, lines } = createOutputChannel();
    const inputFile = path.join(tempDir, 'main-load-success.cf');
    fs.writeFileSync(inputFile, Buffer.from([1, 2, 3, 4]));

    const result = await runLoadConfigurationFromCf({
      workspaceFolder,
      outputChannel: channel,
      inputFile,
      silent: true,
    });

    assert.strictEqual(result, true, 'заглушка завершается с кодом 0 — раннер обязан вернуть true');
    assert.ok(!lines.join('\n').includes(REAL_PASSWORD), 'реальный пароль не должен попасть в лог даже на успешной ветке');
    assert.ok(lines.some((line) => line.startsWith('[actions] Завершено:')), 'ожидалась строка завершения успеха');
    assert.ok(!lines.some((line) => line.startsWith('[actions][error]')), 'на успешной ветке не должно быть строки ошибки');
  });

  test('runDumpConfigurationToCf: с заглушкой вместо 1cv8 (пишет staging-файл, exit 0) — result === true, файл создан, лог без пароля', async function () {
    this.timeout(15_000);
    if (process.platform === 'win32') {
      this.skip();
    }
    const workspaceFolder = fakeWorkspaceFolder(tempDir);
    const fakeV8 = createFakeDesignerExecutable(tempDir, 'dump');
    writeEnvJson(tempDir, fakeV8);
    const { channel, lines } = createOutputChannel();
    const outputFile = path.join(tempDir, 'dump-success.cf');

    const result = await runDumpConfigurationToCf({
      workspaceFolder,
      outputChannel: channel,
      outputFile,
      silent: true,
    });

    assert.strictEqual(result, true, 'заглушка завершается с кодом 0 и создаёт staging-файл — раннер обязан вернуть true');
    assert.ok(fs.existsSync(outputFile), 'успешная выгрузка обязана перенести staging-файл на целевой путь');
    assert.strictEqual(fs.readFileSync(outputFile, 'utf-8'), 'fake-cf-bytes');
    assert.ok(!lines.join('\n').includes(REAL_PASSWORD), 'реальный пароль не должен попасть в лог даже на успешной ветке');
    assert.ok(lines.some((line) => line.startsWith('[actions] Завершено:')), 'ожидалась строка завершения успеха');
    assert.ok(!lines.some((line) => line.startsWith('[actions][error]')), 'на успешной ветке не должно быть строки ошибки');
  });
});
