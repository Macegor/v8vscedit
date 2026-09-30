/**
 * Тесты MCP-инструментов `v8vscedit_dump_cf`/`v8vscedit_load_cf`
 * (`src/ui/mcp/registration/McpConfigLifecycleTools.ts`, домен
 * «жизненный цикл конфигурации»).
 *
 * Тестируется ТОЛЬКО фабрика регистрации `registerConfigLifecycleTools` на
 * мок-`McpServer` (образец `mcpAddTools.test.ts`/`mcpToolsCatalog.test.ts`) —
 * `V8McpServer` целиком не поднимается.
 *
 * Первый suite ниже — guard-ветки БЕЗ спавна: ни платформа 1С, ни даже наш
 * собственный CLI не запускаются, потому что валидация вектора аргументов
 * (`infra/cfFile`) обрывает выполнение раньше (`services: {}` — обращение к
 * `services.workspaceFolder` там и не должно происходить).
 *
 * Второй suite (возврат со стадии qa-e2e — реальный пробел покрытия, а не
 * артефакт инструмента: строки 105-117/160-183/299-313
 * `McpConfigLifecycleTools.ts`, успешная обработка результата
 * `runDumpConfigurationToCf`/`runLoadConfigurationFromCf`, ветки `if (!dumped)`/
 * `if (!loaded)`, обе ветки `applyToDatabase` и `buildApplyTarget`) — той же
 * техникой, что `cfFileCommandRunner.test.ts`: реальный временный
 * каталог-воркспейс с настоящим `env.json`, реальный спавн НАШЕГО внутреннего
 * CLI (`dist/cli/onec-tools.js`, не платформы 1С). Ветка «неуспех»
 * детерминирована заведомо отсутствующим `--path` (платформа не установлена и
 * не трогается — `resolveExplicitV8Path` бросает синхронно ДО спавна
 * DESIGNER). Ветка «успех» использует минимальную POSIX-заглушку вместо
 * `1cv8` (единственный мок внешней недоступной системы, обоснование — в
 * комментарии у самой заглушки); на Windows POSIX-шебанг не работает —
 * соответствующие тесты пропускаются (`this.skip()`), остальные тесты файла
 * от платформы не зависят и на Windows остаются полными.
 *
 * `infra/cfFile/*` на фазе «красный» ещё не существует — лениво грузится
 * через `tryRequireProductionModule`. `McpConfigLifecycleTools.ts` уже
 * существует (используется для create_configuration/create_extension/…) —
 * импортируется статически, а тесты проверяют ДОБАВЛЕННЫЕ им новые tools.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { registerConfigLifecycleTools } from '../../ui/mcp/registration/McpConfigLifecycleTools';
import { McpMutationGate } from '../../ui/mcp/registration/McpMutationGate';
import type { McpRegistrationDeps } from '../../ui/mcp/registration/McpRegistrationDeps';
import { EXTENSION_MCP_TOOLS } from '../../infra/ai/AiMcpConfiguration';
import { tryRequireProductionModule } from './support/tryRequireProductionModule';

type CfFileOperation = 'dump' | 'load';

interface CfFileRequest {
  readonly operation: CfFileOperation;
  readonly filePath: string;
  readonly isExtension: boolean;
  readonly allExtensionsFlag?: boolean;
  readonly overwrite?: boolean;
}

interface CfFileValidationModule {
  validateCfFileRequest(request: CfFileRequest): void;
}

interface RegisteredToolConfig {
  readonly title: string;
  readonly description: string;
  readonly inputSchema: unknown;
  readonly annotations?: { readonly destructiveHint?: boolean };
}

interface RegisteredTool extends RegisteredToolConfig {
  readonly name: string;
  readonly handler: (args: Record<string, unknown>) => unknown;
}

interface MockMcpServer {
  readonly tools: Map<string, RegisteredTool>;
  registerTool: (name: string, config: RegisteredToolConfig, handler: (args: Record<string, unknown>) => unknown) => void;
}

function createMockServer(): MockMcpServer {
  const tools = new Map<string, RegisteredTool>();
  return {
    tools,
    registerTool: (name, config, handler) => {
      tools.set(name, { name, ...config, handler });
    },
  };
}

/** См. идентичный приём в `mcpToolsCatalog.test.ts` — обоснование там же. */
function schemaShapeSignature(inputSchema: unknown): Record<string, boolean> {
  const shape = (inputSchema as { shape?: Record<string, { def?: { type?: string } }> }).shape;
  assert.ok(shape, 'inputSchema должен быть z.object(...) с полем shape');
  const signature: Record<string, boolean> = {};
  for (const [key, fieldSchema] of Object.entries(shape)) {
    signature[key] = fieldSchema.def?.type === 'optional';
  }
  return signature;
}

function extractText(result: unknown): string {
  const part = (result as CallToolResult).content[0];
  return part.type === 'text' ? part.text : '';
}

function isErrorResult(result: unknown): boolean {
  return (result as CallToolResult).isError === true;
}

/**
 * Заглушка `McpRegistrationDeps`: для guard-веток `dump_cf`/`load_cf`
 * (единственное, что здесь тестируется) обращение к `services`/`xmlEditor`/
 * `paths`/`properties`/`mutations` не должно происходить вовсе — по контракту
 * задания guard'ы `infra/cfFile` обрываются раньше, чем тело инструмента
 * трогает что-либо из реального дерева метаданных. `gate` — единственное
 * реально используемое поле (форматирование ok/error), поэтому это НАСТОЯЩИЙ
 * `McpMutationGate`, а не заглушка.
 */
function createDeps(): McpRegistrationDeps {
  return {
    services: {},
    xmlEditor: {},
    paths: {},
    properties: {},
    mutations: {},
    gate: new McpMutationGate({} as never),
  } as unknown as McpRegistrationDeps;
}

suite('McpConfigLifecycleTools — v8vscedit_dump_cf/v8vscedit_load_cf', () => {
  let validationMod: CfFileValidationModule | undefined;
  let server: MockMcpServer;
  let tempDir: string;

  suiteSetup(() => {
    validationMod = tryRequireProductionModule('../../../infra/cfFile/CfFileValidation') as CfFileValidationModule | undefined;
  });

  setup(() => {
    server = createMockServer();
    registerConfigLifecycleTools(server as never, createDeps());
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-mcp-cf-'));
  });

  teardown(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('infra/cfFile/CfFileValidation.ts существует (нужен для сверки текста ошибок MCP с infra)', () => {
    assert.ok(validationMod, 'infra/cfFile/CfFileValidation.ts ещё не реализован (ожидаемо на фазе «красный» TDD)');
  });

  function validation(): CfFileValidationModule {
    if (!validationMod) {
      assert.fail('CfFileValidation.ts не реализован — см. первый тест сьюта');
    }
    return validationMod;
  }

  /** Вычисляет ожидаемое сообщение guard'а НАПРЯМУЮ через infra — то же, что обязан использовать MCP-инструмент. */
  function expectedGuardMessage(request: CfFileRequest): string {
    try {
      validation().validateCfFileRequest(request);
      assert.fail('ожидалось, что validateCfFileRequest бросит исключение для этого сценария');
    } catch (error) {
      assert.ok(error instanceof Error);
      return error.message;
    }
  }

  // ─── Часть 4, F.24: регистрация + метаданные tools ───

  test('оба tool-а зарегистрированы: v8vscedit_dump_cf и v8vscedit_load_cf', () => {
    assert.ok(server.tools.has('v8vscedit_dump_cf'), 'v8vscedit_dump_cf должен быть зарегистрирован');
    assert.ok(server.tools.has('v8vscedit_load_cf'), 'v8vscedit_load_cf должен быть зарегистрирован');
  });

  test('v8vscedit_load_cf: destructiveHint === true (загрузка необратимо меняет основную конфигурацию проекта)', () => {
    const tool = server.tools.get('v8vscedit_load_cf');
    assert.ok(tool);
    assert.strictEqual(tool.annotations?.destructiveHint, true);
  });

  test('v8vscedit_dump_cf: destructiveHint === false (выгрузка не меняет ни базу, ни проект)', () => {
    const tool = server.tools.get('v8vscedit_dump_cf');
    assert.ok(tool);
    assert.strictEqual(tool.annotations?.destructiveHint, false);
  });

  test('v8vscedit_dump_cf: inputSchema — outputFile обязателен, extensionName/overwrite опциональны, нет allExtensions', () => {
    const tool = server.tools.get('v8vscedit_dump_cf');
    assert.ok(tool);
    const shape = schemaShapeSignature(tool.inputSchema);
    assert.strictEqual(shape.outputFile, false, 'outputFile обязателен');
    assert.strictEqual(shape.extensionName, true, 'extensionName опционален');
    assert.strictEqual(shape.overwrite, true, 'overwrite опционален');
    assert.ok(!('allExtensions' in shape), 'схема НЕ должна содержать allExtensions ни в каком виде — см. эмпирику платформы (флаг проглатывается молча)');
  });

  test('v8vscedit_load_cf: inputFile и confirm обязательны, extensionName/applyToDatabase опциональны, нет allExtensions', () => {
    const tool = server.tools.get('v8vscedit_load_cf');
    assert.ok(tool);
    const shape = schemaShapeSignature(tool.inputSchema);
    assert.strictEqual(shape.inputFile, false, 'inputFile обязателен');
    assert.strictEqual(shape.confirm, false, 'confirm обязателен — без явного согласия необратимая загрузка не должна быть по умолчанию доступна');
    assert.strictEqual(shape.extensionName, true, 'extensionName опционален');
    assert.strictEqual(shape.applyToDatabase, true, 'applyToDatabase опционален');
    assert.ok(!('allExtensions' in shape), 'схема НЕ должна содержать allExtensions ни в каком виде');
  });

  test('паритет: оба tool-а присутствуют в каталоге EXTENSION_MCP_TOOLS для ИИ-агента', () => {
    const catalogued = new Set(EXTENSION_MCP_TOOLS.map((tool) => tool.name));
    assert.ok(catalogued.has('v8vscedit_dump_cf'), 'v8vscedit_dump_cf отсутствует в EXTENSION_MCP_TOOLS');
    assert.ok(catalogued.has('v8vscedit_load_cf'), 'v8vscedit_load_cf отсутствует в EXTENSION_MCP_TOOLS');
  });

  // ─── Часть 4, F.25: guard-ветки без спавна ───

  test('v8vscedit_load_cf: confirm=false → isError, текст предупреждает о необратимости', async () => {
    const tool = server.tools.get('v8vscedit_load_cf');
    assert.ok(tool);
    const result = await tool.handler({ inputFile: path.join(tempDir, 'whatever.cf'), confirm: false });
    assert.ok(isErrorResult(result), 'confirm=false обязан давать isError');
    const text = extractText(result).toLowerCase();
    assert.ok(text.includes('необратим'), `сообщение обязано предупреждать о необратимости операции: "${text}"`);
  });

  test('v8vscedit_load_cf: confirm не передан (undefined) → isError, текст предупреждает о необратимости', async () => {
    const tool = server.tools.get('v8vscedit_load_cf');
    assert.ok(tool);
    const result = await tool.handler({ inputFile: path.join(tempDir, 'whatever.cf') });
    assert.ok(isErrorResult(result), 'отсутствие confirm обязано давать isError (нет неявного согласия по умолчанию)');
    const text = extractText(result).toLowerCase();
    assert.ok(text.includes('необратим'), `сообщение обязано предупреждать о необратимости операции: "${text}"`);
  });

  test('v8vscedit_load_cf: confirm=true, но несуществующий inputFile → isError с ТЕМ ЖЕ текстом, что и infra-валидатор (доказывает переиспользование, а не дублирование логики)', async () => {
    const tool = server.tools.get('v8vscedit_load_cf');
    assert.ok(tool);
    const inputFile = path.join(tempDir, 'absent.cf');
    const result = await tool.handler({ inputFile, confirm: true });
    assert.ok(isErrorResult(result));
    const expected = expectedGuardMessage({ operation: 'load', filePath: inputFile, isExtension: false });
    assert.strictEqual(extractText(result), expected,
      'MCP обязан вернуть РОВНО то же сообщение, что и infra/cfFile/CfFileValidation — иначе он обходит/дублирует guard');
  });

  test('v8vscedit_load_cf: confirm=true, extensionName задан, но файл ".cf" (неверный суффикс) → isError с ТЕМ ЖЕ текстом, что и infra-валидатор', async () => {
    const tool = server.tools.get('v8vscedit_load_cf');
    assert.ok(tool);
    const inputFile = path.join(tempDir, 'mismatched.cf');
    fs.writeFileSync(inputFile, Buffer.from([1]));
    const result = await tool.handler({ inputFile, extensionName: 'EVOLC', confirm: true });
    assert.ok(isErrorResult(result));
    const expected = expectedGuardMessage({ operation: 'load', filePath: inputFile, isExtension: true });
    assert.strictEqual(extractText(result), expected);
  });

  test('v8vscedit_dump_cf: несуществующий каталог назначения → isError с ТЕМ ЖЕ текстом, что и infra-валидатор', async () => {
    const tool = server.tools.get('v8vscedit_dump_cf');
    assert.ok(tool);
    const outputFile = path.join(tempDir, 'no-such-dir', 'out.cf');
    const result = await tool.handler({ outputFile });
    assert.ok(isErrorResult(result));
    const expected = expectedGuardMessage({ operation: 'dump', filePath: outputFile, isExtension: false, overwrite: false });
    assert.strictEqual(extractText(result), expected);
  });

  test('v8vscedit_dump_cf: extensionName задан, но outputFile ".cf" (неверный суффикс) → isError с ТЕМ ЖЕ текстом, что и infra-валидатор', async () => {
    const tool = server.tools.get('v8vscedit_dump_cf');
    assert.ok(tool);
    const outputFile = path.join(tempDir, 'mismatched.cf');
    const result = await tool.handler({ outputFile, extensionName: 'EVOLC' });
    assert.ok(isErrorResult(result));
    const expected = expectedGuardMessage({ operation: 'dump', filePath: outputFile, isExtension: true, overwrite: false });
    assert.strictEqual(extractText(result), expected);
  });

  test('v8vscedit_dump_cf: outputFile уже существует, overwrite не передан (по умолчанию false) → isError с ТЕМ ЖЕ текстом, что и infra-валидатор', async () => {
    const tool = server.tools.get('v8vscedit_dump_cf');
    assert.ok(tool);
    const outputFile = path.join(tempDir, 'existing.cf');
    fs.writeFileSync(outputFile, 'data');
    const result = await tool.handler({ outputFile });
    assert.ok(isErrorResult(result));
    const expected = expectedGuardMessage({ operation: 'dump', filePath: outputFile, isExtension: false, overwrite: false });
    assert.strictEqual(extractText(result), expected);
  });

  test('v8vscedit_dump_cf: outputFile уже существует, overwrite=true → guard проходит (не isError с тем же сообщением про существующий файл)', async () => {
    const tool = server.tools.get('v8vscedit_dump_cf');
    assert.ok(tool);
    const outputFile = path.join(tempDir, 'existing-ow.cf');
    fs.writeFileSync(outputFile, 'data');
    const result = await tool.handler({ outputFile, overwrite: true }) as CallToolResult;
    // Инструмент не спавнит платформу и не подключается к базе в наших
    // тестах — этот сценарий лишь доказывает, что fs-guard (существующий
    // файл) снят флагом overwrite: результат не должен совпадать с текстом
    // ошибки "файл уже существует" для overwrite=false выше.
    const overwriteFalseMessage = expectedGuardMessage({ operation: 'dump', filePath: outputFile, isExtension: false, overwrite: false });
    if (isErrorResult(result)) {
      assert.notStrictEqual(extractText(result), overwriteFalseMessage,
        'с overwrite=true guard про "файл уже существует" обязан быть снят — ошибка (если есть) должна быть про что-то другое (например, недоступность подключения к базе)');
    }
  });
});

// ─── Возврат со стадии qa-e2e: успешный путь и обработка результата CLI ───

/** Пишет env.json в формате, который реально читает `resolveConnectionFromSettings`. */
function writeEnvJson(workspaceRoot: string, v8Path: string): void {
  const infobasePath = path.join(workspaceRoot, 'fake-infobase');
  const content = {
    default: {
      '--ibconnection': `/F${infobasePath}`,
      '--db-user': 'Admin',
      '--db-pwd': '',
      '--path': v8Path,
    },
  };
  fs.writeFileSync(path.join(workspaceRoot, 'env.json'), JSON.stringify(content, null, 2), 'utf-8');
}

function fakeWorkspaceFolder(root: string): vscode.WorkspaceFolder {
  return { uri: vscode.Uri.file(root), name: 'mcp-cf-runner-test', index: 0 };
}

/** Реальный `vscode.OutputChannel`-приёмник: продакшен-коду нужен только `appendLine`. */
function createOutputChannel(): vscode.OutputChannel {
  return { appendLine: () => undefined } as unknown as vscode.OutputChannel;
}

/**
 * Заведомо не существующий на диске путь: `resolveExplicitV8Path` обязан
 * бросить синхронно ДО спавна DESIGNER — платформа 1С не трогается вовсе.
 * Даёт детерминированную ветку «неуспех» (`dumped`/`loaded === false`) без
 * какой-либо зависимости от таймингов или окружения.
 */
function absentV8Path(root: string): string {
  return path.join(root, 'definitely', 'not', 'installed', 'v8vscedit-test-fixture', '1cv8');
}

/**
 * Минимальная POSIX-заглушка вместо Конфигуратора 1С — единственный мок
 * внешней недоступной системы в этом файле. `variant: 'noop'` только
 * завершается с кодом 0 (достаточно для `load-cf`/`update-configuration` —
 * они не переносят staging-файл сами). `variant: 'dump'` дополнительно
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

/**
 * В отличие от `createDeps()` выше (guard-ветки, `services: {}`), здесь нужен
 * НАСТОЯЩИЙ `workspaceFolder`/`outputChannel` — иначе `resolveConnectionArgs`
 * упадёт на первой строке ДО обращения к `env.json`, и успешный путь снова
 * останется непокрытым (см. шапку файла).
 */
function createDepsWithWorkspace(workspaceFolder: vscode.WorkspaceFolder, outputChannel: vscode.OutputChannel): McpRegistrationDeps {
  return {
    services: { workspaceFolder, outputChannel },
    xmlEditor: {},
    paths: {},
    properties: {},
    mutations: {},
    gate: new McpMutationGate({} as never),
  } as unknown as McpRegistrationDeps;
}

function parseResult(result: unknown): Record<string, unknown> {
  assert.ok(!isErrorResult(result), `ожидался успешный результат, реально: ${JSON.stringify(result)}`);
  return JSON.parse(extractText(result)) as Record<string, unknown>;
}

suite('McpConfigLifecycleTools — v8vscedit_dump_cf/v8vscedit_load_cf (успешный путь и обработка результата CLI)', () => {
  let tempDir: string;
  let workspaceFolder: vscode.WorkspaceFolder;
  let server: MockMcpServer;

  setup(() => {
    tempDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-mcp-cf-success-')));
    workspaceFolder = fakeWorkspaceFolder(tempDir);
    server = createMockServer();
    registerConfigLifecycleTools(server as never, createDepsWithWorkspace(workspaceFolder, createOutputChannel()));
  });

  teardown(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('v8vscedit_dump_cf: guard проходит, платформы нет → dumped=false → isError с сообщением про неуспех выгрузки (ветка if (!dumped))', async function () {
    this.timeout(15_000);
    writeEnvJson(tempDir, absentV8Path(tempDir));
    const tool = server.tools.get('v8vscedit_dump_cf');
    assert.ok(tool);

    const outputFile = path.join(tempDir, 'no-platform-dump.cf');
    const result = await tool.handler({ outputFile });
    assert.ok(isErrorResult(result), 'без платформы выгрузка обязана дать isError, а не тихо промолчать');
    assert.strictEqual(
      extractText(result),
      'Выгрузка в файл не выполнена. Подробности — в журнале «1С Редактор».'
    );
  });

  test('v8vscedit_dump_cf: успешный путь (заглушка вместо 1cv8, exit 0) — файл создан, ответ содержит outputFile/extensionName/overwrite', async function () {
    this.timeout(15_000);
    if (process.platform === 'win32') {
      this.skip();
    }
    const fakeV8 = createFakeDesignerExecutable(tempDir, 'dump');
    writeEnvJson(tempDir, fakeV8);
    const tool = server.tools.get('v8vscedit_dump_cf');
    assert.ok(tool);

    const outputFile = path.join(tempDir, 'success-dump.cf');
    const result = await tool.handler({ outputFile });
    const data = parseResult(result);
    assert.strictEqual(data.outputFile, outputFile);
    assert.strictEqual(data.extensionName, '');
    assert.strictEqual(data.overwrite, false);
    assert.ok(fs.existsSync(outputFile), 'успешная выгрузка обязана перенести staging-файл на целевой путь');
    assert.strictEqual(fs.readFileSync(outputFile, 'utf-8'), 'fake-cf-bytes');
  });

  test('v8vscedit_load_cf: guard проходит, платформы нет → loaded=false → isError с сообщением про неуспех загрузки (ветка if (!loaded))', async function () {
    this.timeout(15_000);
    writeEnvJson(tempDir, absentV8Path(tempDir));
    const tool = server.tools.get('v8vscedit_load_cf');
    assert.ok(tool);

    const inputFile = path.join(tempDir, 'no-platform-load.cf');
    fs.writeFileSync(inputFile, Buffer.from([1, 2, 3, 4]));
    const result = await tool.handler({ inputFile, confirm: true });
    assert.ok(isErrorResult(result), 'без платформы загрузка обязана дать isError, а не тихо промолчать');
    assert.match(
      extractText(result),
      /^Загрузка из файла не выполнена\. Часть изменений могла быть применена/
    );
  });

  test('v8vscedit_load_cf: успешный путь, applyToDatabase не передан → databaseConfigurationUpdated=false, в ответе есть предупреждение о рассинхроне выгрузки и базы (projectSourcesOutdated=true)', async function () {
    this.timeout(15_000);
    if (process.platform === 'win32') {
      this.skip();
    }
    const fakeV8 = createFakeDesignerExecutable(tempDir, 'noop');
    writeEnvJson(tempDir, fakeV8);
    const tool = server.tools.get('v8vscedit_load_cf');
    assert.ok(tool);

    const inputFile = path.join(tempDir, 'success-load.cf');
    fs.writeFileSync(inputFile, Buffer.from([1, 2, 3, 4]));
    const result = await tool.handler({ inputFile, confirm: true });
    const data = parseResult(result);
    assert.strictEqual(data.inputFile, inputFile);
    assert.strictEqual(data.extensionName, '');
    assert.strictEqual(data.databaseConfigurationUpdated, false, 'applyToDatabase не передан — /UpdateDBCfg не должен запускаться');
    assert.strictEqual(data.projectSourcesOutdated, true,
      'ответ обязан предупреждать, что XML-выгрузка проекта больше не соответствует базе — иначе агент решит, что дерево проекта уже актуально');
  });

  test('v8vscedit_load_cf: успешный путь, applyToDatabase=true, основная конфигурация → databaseConfigurationUpdated=true (buildApplyTarget: ветка cf)', async function () {
    this.timeout(15_000);
    if (process.platform === 'win32') {
      this.skip();
    }
    const fakeV8 = createFakeDesignerExecutable(tempDir, 'noop');
    writeEnvJson(tempDir, fakeV8);
    const tool = server.tools.get('v8vscedit_load_cf');
    assert.ok(tool);

    const inputFile = path.join(tempDir, 'success-load-apply.cf');
    fs.writeFileSync(inputFile, Buffer.from([1, 2, 3, 4]));
    const result = await tool.handler({ inputFile, confirm: true, applyToDatabase: true });
    const data = parseResult(result);
    assert.strictEqual(data.databaseConfigurationUpdated, true,
      '/UpdateDBCfg через заглушку обязан завершиться успешно (exit 0) и дать databaseConfigurationUpdated=true');
    assert.strictEqual(data.projectSourcesOutdated, true);
  });

  test('v8vscedit_load_cf: успешный путь, applyToDatabase=true, расширение → databaseConfigurationUpdated=true (buildApplyTarget: ветка cfe, -Extension в update-configuration)', async function () {
    this.timeout(15_000);
    if (process.platform === 'win32') {
      this.skip();
    }
    const fakeV8 = createFakeDesignerExecutable(tempDir, 'noop');
    writeEnvJson(tempDir, fakeV8);
    const tool = server.tools.get('v8vscedit_load_cf');
    assert.ok(tool);

    const inputFile = path.join(tempDir, 'success-load-apply.cfe');
    fs.writeFileSync(inputFile, Buffer.from([1, 2, 3, 4]));
    const result = await tool.handler({ inputFile, confirm: true, extensionName: 'EVOLC', applyToDatabase: true });
    const data = parseResult(result);
    assert.strictEqual(data.extensionName, 'EVOLC');
    assert.strictEqual(data.databaseConfigurationUpdated, true,
      '/UpdateDBCfg -Extension EVOLC через заглушку обязан завершиться успешно и дать databaseConfigurationUpdated=true');
    assert.strictEqual(data.projectSourcesOutdated, true);
  });
});
