/**
 * Тесты MCP-инструментов `v8vscedit_dump_all_cfe` / `v8vscedit_load_all_cfe`
 * (регистрируются в `registerConfigLifecycleTools`, домен «жизненный цикл
 * конфигурации», рядом с `v8vscedit_dump_cf`/`v8vscedit_load_cf`).
 *
 * Как и в `mcpConfigLifecycleCfTools.test.ts`, тестируется фабрика регистрации
 * на мок-`McpServer`; успешные и отказные сценарии идут по-настоящему: реальный
 * внутренний CLI и POSIX-заглушка Конфигуратора (`support/cfeBatchFixtures.ts`)
 * — единственный мок внешней недоступной системы. На Windows такие тесты
 * пропускаются (`this.skip()`), схемные и guard-тесты работают везде.
 *
 * Политика отказов у инструментов ЗЕРКАЛЬНО разная — она следует из природы
 * операций:
 *  - dump при частичном отказе возвращает УСПЕХ со списком `failed`: выгрузка
 *    базу не меняет, 14 готовых бэкапов из 15 ценны, а исключение скрыло бы их;
 *  - load при частичном отказе БРОСАЕТ: база в промежуточном состоянии, и
 *    «успех со списком» агент легко принял бы за штатный итог.
 * Поля `allExtensions` в схемах нет вовсе: платформа принимает `-AllExtensions`
 * у `/DumpCfg`/`/LoadCfg` молча и работает с основной конфигурацией.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { EXTENSION_MCP_TOOLS } from '../../infra/ai/AiMcpConfiguration';
import { planCfeDumpFiles } from '../../infra/cfFile/CfeBatchNaming';
import { serializeCfeManifest } from '../../infra/cfFile/CfeBatchManifest';
import { registerConfigLifecycleTools } from '../../ui/mcp/registration/McpConfigLifecycleTools';
import { McpMutationGate } from '../../ui/mcp/registration/McpMutationGate';
import type { McpRegistrationDeps } from '../../ui/mcp/registration/McpRegistrationDeps';
import {
  endConfigurationOperation,
  isConfigurationOperationRunning,
  tryBeginConfigurationOperation,
} from '../../ui/commands/ext/configurationOperationLock';
import {
  IS_WINDOWS,
  absentV8Path,
  expectedConnectionPrefix,
  createBatchWorkspace,
  extensionsOf,
  invocationsOf,
  listNames,
  makeExtensionNames,
  makeListFail,
  partFiles,
  readInvocations,
  setDbExtensions,
  setFakeControl,
  writeCfeFile,
  type BatchWorkspace,
} from './support/cfeBatchFixtures';

const DUMP_TOOL = 'v8vscedit_dump_all_cfe';
const LOAD_TOOL = 'v8vscedit_load_all_cfe';

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

/** Сигнатура схемы: имя поля → «опционально ли» (тот же приём, что в `mcpConfigLifecycleCfTools.test.ts`). */
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

function parseResult(result: unknown): Record<string, unknown> {
  assert.ok(!isErrorResult(result), `ожидался успешный результат, реально: ${JSON.stringify(result)}`);
  return JSON.parse(extractText(result)) as Record<string, unknown>;
}

/** Имена в списке `failed`: элементы могут быть и строками, и объектами с `extensionName`. */
function failedNames(data: Record<string, unknown>): string[] {
  assert.ok(Array.isArray(data.failed), `в ответе нет массива failed: ${JSON.stringify(data)}`);
  return (data.failed as unknown[]).map((entry) => {
    if (typeof entry === 'string') {
      return entry;
    }
    const name = (entry as { extensionName?: unknown }).extensionName;
    assert.strictEqual(typeof name, 'string', `элемент failed без extensionName: ${JSON.stringify(entry)}`);
    return name as string;
  });
}

function createDepsWithWorkspace(ws: BatchWorkspace): McpRegistrationDeps {
  const workspaceFolder: vscode.WorkspaceFolder = { uri: vscode.Uri.file(ws.root), name: 'mcp-cfe-batch-test', index: 0 };
  const outputChannel = { appendLine: () => undefined } as unknown as vscode.OutputChannel;
  return {
    services: { workspaceFolder, outputChannel },
    xmlEditor: {},
    paths: {},
    properties: {},
    mutations: {},
    gate: new McpMutationGate({} as never),
  } as unknown as McpRegistrationDeps;
}

function tool(server: MockMcpServer, name: string): RegisteredTool {
  const registered = server.tools.get(name);
  assert.ok(registered, `${name} не зарегистрирован`);
  return registered;
}

/**
 * Переписывает `--path` в `env.json` на несуществующую платформу: CLI падает на
 * `resolveConnection` ДО спавна и ДО записи отчёта — единственный штатный путь,
 * которым инструмент получает `report === undefined`.
 */
function pointEnvToAbsentPlatform(ws: BatchWorkspace): void {
  const envPath = path.join(ws.root, 'env.json');
  const env = JSON.parse(fs.readFileSync(envPath, 'utf-8')) as { default: Record<string, string> };
  env.default['--path'] = absentV8Path(ws.root);
  fs.writeFileSync(envPath, JSON.stringify(env), 'utf-8');
}

/** Бэкапы + манифест в каталоге загрузки — как оставила бы выгрузка. */
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

suite('McpCfeBatchTools — схемы, каталог, аннотации', () => {
  let server: MockMcpServer;

  setup(() => {
    server = createMockServer();
    registerConfigLifecycleTools(server as never, { services: {}, gate: new McpMutationGate({} as never) } as unknown as McpRegistrationDeps);
  });

  test('оба инструмента зарегистрированы', () => {
    assert.ok(server.tools.has(DUMP_TOOL));
    assert.ok(server.tools.has(LOAD_TOOL));
  });

  test('dump_all_cfe: схема — ровно outputDir (обязателен) и overwrite (опционален); поля allExtensions нет', () => {
    const shape = schemaShapeSignature(tool(server, DUMP_TOOL).inputSchema);
    assert.deepStrictEqual(shape, { outputDir: false, overwrite: true });
    assert.ok(!('allExtensions' in shape), 'схема НЕ должна содержать allExtensions ни в каком виде');
  });

  test('load_all_cfe: схема — ровно inputDir и confirm (обязательны), createMissing и applyToDatabase (опциональны); поля allExtensions нет', () => {
    const shape = schemaShapeSignature(tool(server, LOAD_TOOL).inputSchema);
    assert.deepStrictEqual(shape, { inputDir: false, confirm: false, createMissing: true, applyToDatabase: true });
    assert.ok(!('allExtensions' in shape), 'схема НЕ должна содержать allExtensions ни в каком виде');
  });

  test('dump_all_cfe: destructiveHint === false (выгрузка не меняет ни базу, ни проект)', () => {
    assert.strictEqual(tool(server, DUMP_TOOL).annotations?.destructiveHint, false);
  });

  test('load_all_cfe: destructiveHint === true (загрузка необратимо меняет базу)', () => {
    assert.strictEqual(tool(server, LOAD_TOOL).annotations?.destructiveHint, true);
  });

  test('у инструментов непустые title и description; description load предупреждает о необратимости и confirm', () => {
    for (const name of [DUMP_TOOL, LOAD_TOOL]) {
      assert.ok(tool(server, name).title.trim().length > 0, `${name}: пустой title`);
      assert.ok(tool(server, name).description.trim().length > 0, `${name}: пустой description`);
    }
    const description = tool(server, LOAD_TOOL).description.toLowerCase();
    assert.ok(description.includes('необратим'), description);
    assert.ok(description.includes('confirm'), description);
  });

  test('паритет: обе записи присутствуют в каталоге EXTENSION_MCP_TOOLS для ИИ-агента', () => {
    const catalogued = new Map(EXTENSION_MCP_TOOLS.map((entry) => [entry.name, entry]));
    for (const name of [DUMP_TOOL, LOAD_TOOL]) {
      const entry = catalogued.get(name);
      assert.ok(entry, `${name} отсутствует в EXTENSION_MCP_TOOLS`);
      assert.ok(entry.description.trim().length > 0, `${name}: пустое описание в каталоге`);
    }
  });

  test('описание одиночного v8vscedit_dump_cf больше не утверждает, что выгрузить все расширения нельзя, а отсылает к пакетному инструменту', () => {
    // Раньше описание прямо запрещало «все расширения одним вызовом» — после
    // появления пакетного инструмента это ложь, которая направит агента в цикл вручную.
    const description = tool(server, 'v8vscedit_dump_cf').description;
    assert.ok(!/все расширения одним вызовом нельзя/i.test(description), description);
    assert.ok(description.includes(DUMP_TOOL), `описание не отсылает к ${DUMP_TOOL}: ${description}`);
  });
});

suite('McpCfeBatchTools — guard-ветки без спавна Конфигуратора', function () {
  this.timeout(30_000);
  let ws: BatchWorkspace;
  let server: MockMcpServer;

  setup(() => {
    ws = createBatchWorkspace();
    server = createMockServer();
    registerConfigLifecycleTools(server as never, createDepsWithWorkspace(ws));
  });

  teardown(() => {
    ws.dispose();
  });

  test('load_all_cfe: confirm=false → isError, предупреждение о необратимости, ноль спавнов', async () => {
    const result = await tool(server, LOAD_TOOL).handler({ inputDir: ws.dataDir, confirm: false });
    assert.ok(isErrorResult(result), 'confirm=false обязан давать isError');
    assert.ok(extractText(result).toLowerCase().includes('необратим'), extractText(result));
    assert.deepStrictEqual(readInvocations(ws), []);
  });

  test('load_all_cfe: confirm не передан → isError, предупреждение о необратимости, ноль спавнов (неявного согласия нет)', async () => {
    const result = await tool(server, LOAD_TOOL).handler({ inputDir: ws.dataDir });
    assert.ok(isErrorResult(result));
    assert.ok(extractText(result).toLowerCase().includes('необратим'), extractText(result));
    assert.deepStrictEqual(readInvocations(ws), []);
  });

  test('load_all_cfe: confirm=true, но каталога нет → isError с путём, ноль спавнов', async () => {
    const inputDir = path.join(ws.root, 'no-such-dir');
    const result = await tool(server, LOAD_TOOL).handler({ inputDir, confirm: true });
    assert.ok(isErrorResult(result));
    assert.ok(extractText(result).includes(inputDir), extractText(result));
    assert.deepStrictEqual(readInvocations(ws), []);
  });

  test('dump_all_cfe: каталога нет → isError с путём, ноль спавнов', async () => {
    const outputDir = path.join(ws.root, 'no-such-dir');
    const result = await tool(server, DUMP_TOOL).handler({ outputDir });
    assert.ok(isErrorResult(result));
    assert.ok(extractText(result).includes(outputDir), extractText(result));
    assert.deepStrictEqual(readInvocations(ws), []);
  });

  test('dump_all_cfe: вместо каталога файл → isError, ноль спавнов', async () => {
    const filePath = path.join(ws.root, 'file.txt');
    fs.writeFileSync(filePath, 'x');
    const result = await tool(server, DUMP_TOOL).handler({ outputDir: filePath });
    assert.ok(isErrorResult(result));
    assert.deepStrictEqual(readInvocations(ws), []);
  });

  for (const toolName of [DUMP_TOOL, LOAD_TOOL]) {
    test(`${toolName}: замок операций занят → isError «уже выполняется», ноль спавнов, чужой замок НЕ освобождён`, async () => {
      const acquired = await tryBeginConfigurationOperation();
      assert.strictEqual(acquired, true, 'подготовка теста: замок обязан быть свободен в начале');
      try {
        const args = toolName === DUMP_TOOL
          ? { outputDir: ws.dataDir }
          : { inputDir: ws.dataDir, confirm: true };
        const result = await tool(server, toolName).handler(args);
        assert.ok(isErrorResult(result));
        assert.ok(/уже выполняется/i.test(extractText(result)), extractText(result));
        assert.deepStrictEqual(readInvocations(ws), []);
        assert.strictEqual(isConfigurationOperationRunning(), true, 'инструмент не должен освобождать замок, которого не брал');
      } finally {
        await endConfigurationOperation();
      }
    });
  }
});

suite('McpCfeBatchTools — dump_all_cfe на заглушке Конфигуратора', function () {
  this.timeout(60_000);
  let ws: BatchWorkspace;
  let server: MockMcpServer;

  suiteSetup(function () {
    if (IS_WINDOWS) {
      this.skip();
    }
  });

  setup(() => {
    ws = createBatchWorkspace();
    server = createMockServer();
    registerConfigLifecycleTools(server as never, createDepsWithWorkspace(ws));
  });

  teardown(() => {
    ws.dispose();
  });

  test('успех: все расширения выгружены, failed пуст, вектор — список с -AllExtensions и /DumpCfg только с -Extension', async () => {
    const names = ['Ext01', 'A:B', 'Расш Тест'];
    setDbExtensions(ws, names);

    const result = await tool(server, DUMP_TOOL).handler({ outputDir: ws.dataDir });

    const data = parseResult(result);
    assert.deepStrictEqual(failedNames(data), []);
    const dumps = invocationsOf(ws, '/DumpCfg');
    assert.strictEqual(dumps.length, 3);
    assert.deepStrictEqual([...extensionsOf(ws, '/DumpCfg')].sort(), [...names].sort());
    for (const argv of dumps) {
      assert.deepStrictEqual(argv.slice(0, 5), expectedConnectionPrefix(ws));
      assert.ok(argv.every((arg) => !arg.startsWith('-All')), `в /DumpCfg не должно быть ключей "-All*": ${JSON.stringify(argv)}`);
    }
    const lists = invocationsOf(ws, '/DumpDBCfgList');
    assert.strictEqual(lists.length, 1);
    assert.ok(lists[0].includes('-AllExtensions'), 'у /DumpDBCfgList ключ штатный и обязательный');
    const files = planCfeDumpFiles(names, []).items.map((item) => item.fileName);
    assert.deepStrictEqual(listNames(ws.dataDir), [...files, 'cfe-dump.json'].sort());
    assert.strictEqual(isConfigurationOperationRunning(), false, 'замок освобождён после операции');
  });

  test('успех для пустой базы (0 расширений): не ошибка, failed пуст, ни одного /DumpCfg', async () => {
    setDbExtensions(ws, []);

    const data = parseResult(await tool(server, DUMP_TOOL).handler({ outputDir: ws.dataDir }));

    assert.deepStrictEqual(failedNames(data), []);
    assert.strictEqual(invocationsOf(ws, '/DumpCfg').length, 0);
  });

  test('частичный отказ (2-е из 4): УСПЕХ (не исключение) с непустым failed, остальные бэкапы выгружены, staging убран', async () => {
    const names = makeExtensionNames(4);
    setDbExtensions(ws, names);
    setFakeControl(ws, 'fail-dump.txt', [names[1]]);

    const result = await tool(server, DUMP_TOOL).handler({ outputDir: ws.dataDir });

    assert.ok(!isErrorResult(result), `частичный отказ выгрузки не должен быть ошибкой инструмента: ${extractText(result)}`);
    const data = parseResult(result);
    assert.deepStrictEqual(failedNames(data), [names[1]]);
    assert.strictEqual(invocationsOf(ws, '/DumpCfg').length, 4, 'выгрузка продолжается после отказа');
    assert.deepStrictEqual(listNames(ws.dataDir), [`${names[0]}.cfe`, `${names[2]}.cfe`, `${names[3]}.cfe`, 'cfe-dump.json'].sort());
    assert.deepStrictEqual(partFiles(ws.dataDir), []);
    assert.strictEqual(isConfigurationOperationRunning(), false);
  });

  test('частичный отказ при существующем файле и overwrite=true: старый файл сбойного расширения остаётся нетронутым', async () => {
    const names = makeExtensionNames(3);
    fs.writeFileSync(path.join(ws.dataDir, `${names[1]}.cfe`), 'OLD-BYTES');
    setDbExtensions(ws, names);
    setFakeControl(ws, 'fail-dump.txt', [names[1]]);

    const data = parseResult(await tool(server, DUMP_TOOL).handler({ outputDir: ws.dataDir, overwrite: true }));

    assert.deepStrictEqual(failedNames(data), [names[1]]);
    assert.strictEqual(fs.readFileSync(path.join(ws.dataDir, `${names[1]}.cfe`), 'utf-8'), 'OLD-BYTES');
  });

  test('конфликт с существующим файлом без overwrite → isError (ничего не выгружено), ноль /DumpCfg, файл нетронут', async () => {
    setDbExtensions(ws, ['Ext01']);
    fs.writeFileSync(path.join(ws.dataDir, 'Ext01.cfe'), 'OLD');

    const result = await tool(server, DUMP_TOOL).handler({ outputDir: ws.dataDir });

    assert.ok(isErrorResult(result), 'отказ до старта — это ошибка, а не «успех с пустым результатом»');
    assert.strictEqual(invocationsOf(ws, '/DumpCfg').length, 0);
    assert.strictEqual(fs.readFileSync(path.join(ws.dataDir, 'Ext01.cfe'), 'utf-8'), 'OLD');
    assert.strictEqual(isConfigurationOperationRunning(), false);
  });

  test('тот же конфликт с overwrite=true → успех, файл заменён', async () => {
    setDbExtensions(ws, ['Ext01']);
    fs.writeFileSync(path.join(ws.dataDir, 'Ext01.cfe'), 'OLD');

    const data = parseResult(await tool(server, DUMP_TOOL).handler({ outputDir: ws.dataDir, overwrite: true }));

    assert.deepStrictEqual(failedNames(data), []);
    assert.strictEqual(fs.readFileSync(path.join(ws.dataDir, 'Ext01.cfe'), 'utf-8'), 'cfe:Ext01');
  });

  test('платформа недоступна (CLI падает до записи отчёта): isError, ни одного спавна, замок освобождён', async () => {
    // Отчёта в этом сценарии нет вовсе — «успехом с пустым результатом» это быть
    // не может: агент принял бы отсутствие выгрузки за штатный итог.
    pointEnvToAbsentPlatform(ws);
    setDbExtensions(ws, ['Ext01']);

    const result = await tool(server, DUMP_TOOL).handler({ outputDir: ws.dataDir });

    assert.ok(isErrorResult(result), `ожидалась ошибка, реально: ${extractText(result)}`);
    assert.deepStrictEqual(readInvocations(ws), []);
    assert.deepStrictEqual(listNames(ws.dataDir), [], 'ни файлов, ни манифеста появиться не должно');
    assert.strictEqual(isConfigurationOperationRunning(), false);
  });

  test('отказ запроса списка расширений → isError, ноль /DumpCfg, замок освобождён', async () => {
    makeListFail(ws);

    const result = await tool(server, DUMP_TOOL).handler({ outputDir: ws.dataDir });

    assert.ok(isErrorResult(result));
    assert.strictEqual(invocationsOf(ws, '/DumpCfg').length, 0);
    assert.strictEqual(isConfigurationOperationRunning(), false);
  });
});

suite('McpCfeBatchTools — load_all_cfe на заглушке Конфигуратора', function () {
  this.timeout(60_000);
  let ws: BatchWorkspace;
  let server: MockMcpServer;

  suiteSetup(function () {
    if (IS_WINDOWS) {
      this.skip();
    }
  });

  setup(() => {
    ws = createBatchWorkspace();
    server = createMockServer();
    registerConfigLifecycleTools(server as never, createDepsWithWorkspace(ws));
  });

  teardown(() => {
    ws.dispose();
  });

  test('успех без applyToDatabase: все расширения загружены, /UpdateDBCfg не запускается, ответ предупреждает о рассинхроне выгрузки проекта', async () => {
    const names = ['Ext01', 'A:B', 'Расш Тест'];
    seedBackups(ws, names);
    setDbExtensions(ws, names);

    const data = parseResult(await tool(server, LOAD_TOOL).handler({ inputDir: ws.dataDir, confirm: true }));

    assert.deepStrictEqual([...extensionsOf(ws, '/LoadCfg')].sort(), [...names].sort());
    for (const argv of invocationsOf(ws, '/LoadCfg')) {
      assert.ok(argv.every((arg) => !arg.startsWith('-All')), `в /LoadCfg не должно быть ключей "-All*": ${JSON.stringify(argv)}`);
    }
    assert.strictEqual(invocationsOf(ws, '/UpdateDBCfg').length, 0);
    assert.strictEqual(data.projectSourcesOutdated, true,
      'XML-выгрузка проекта после загрузки не соответствует базе — агент должен получить это предупреждение');
    assert.strictEqual(isConfigurationOperationRunning(), false);
  });

  test('applyToDatabase=true, полный успех: /UpdateDBCfg -Extension ровно по числу загруженных, под ИСХОДНЫМИ именами, ПОСЛЕ последнего /LoadCfg, без -AllExtensions', async () => {
    const names = ['Ext01', 'A:B', 'Расш Тест'];
    seedBackups(ws, names);
    setDbExtensions(ws, names);

    const data = parseResult(await tool(server, LOAD_TOOL).handler({ inputDir: ws.dataDir, confirm: true, applyToDatabase: true }));

    const updates = invocationsOf(ws, '/UpdateDBCfg');
    assert.strictEqual(updates.length, names.length, 'по одному /UpdateDBCfg на загруженное расширение');
    assert.deepStrictEqual([...extensionsOf(ws, '/UpdateDBCfg')].sort(), [...names].sort());
    for (const argv of updates) {
      assert.ok(!argv.includes('-AllExtensions'), '/UpdateDBCfg -AllExtensions применил бы и расширения, которых мы не грузили');
    }
    const all = readInvocations(ws);
    const lastLoad = Math.max(...all.map((argv, index) => (argv.includes('/LoadCfg') ? index : -1)));
    const firstUpdate = all.findIndex((argv) => argv.includes('/UpdateDBCfg'));
    assert.ok(firstUpdate > lastLoad, 'применение к базе допустимо только после успешной загрузки ВСЕХ расширений');
    assert.strictEqual(data.projectSourcesOutdated, true);
  });

  test('частичный отказ (2-е из 4) → инструмент БРОСАЕТ: isError, названо сбойное расширение и неопределённость состояния; /LoadCfg ровно 2, /UpdateDBCfg нет даже с applyToDatabase', async () => {
    const names = makeExtensionNames(4);
    seedBackups(ws, names);
    setDbExtensions(ws, names);
    setFakeControl(ws, 'fail-load.txt', [names[1]]);

    const result = await tool(server, LOAD_TOOL).handler({ inputDir: ws.dataDir, confirm: true, applyToDatabase: true });

    assert.ok(isErrorResult(result), 'база в промежуточном состоянии — «успех со списком» агент принял бы за штатный итог');
    const text = extractText(result);
    assert.ok(text.includes(names[1]), `в тексте ошибки нет сбойного расширения: ${text}`);
    assert.ok(/неопредел/i.test(text), `в тексте ошибки нет пометки о неопределённом состоянии базы: ${text}`);
    assert.deepStrictEqual(extensionsOf(ws, '/LoadCfg'), [names[0], names[1]]);
    assert.strictEqual(invocationsOf(ws, '/UpdateDBCfg').length, 0);
    assert.strictEqual(isConfigurationOperationRunning(), false, 'замок освобождается и при отказе');
  });

  test('расширения из каталога нет в базе, createMissing не передан → isError, ноль /LoadCfg', async () => {
    seedBackups(ws, ['Ext01', 'New']);
    setDbExtensions(ws, ['Ext01']);

    const result = await tool(server, LOAD_TOOL).handler({ inputDir: ws.dataDir, confirm: true });

    assert.ok(isErrorResult(result));
    assert.ok(extractText(result).includes('New'), extractText(result));
    assert.strictEqual(invocationsOf(ws, '/LoadCfg').length, 0);
  });

  test('то же при createMissing=true → успех, оба расширения загружены', async () => {
    seedBackups(ws, ['Ext01', 'New']);
    setDbExtensions(ws, ['Ext01']);

    parseResult(await tool(server, LOAD_TOOL).handler({ inputDir: ws.dataDir, confirm: true, createMissing: true }));

    assert.deepStrictEqual(extensionsOf(ws, '/LoadCfg'), ['Ext01', 'New']);
  });

  test('applyToDatabase=true, но расширение из базы без файла (notInDirectory): применяются ТОЛЬКО загруженные', async () => {
    seedBackups(ws, ['Ext01']);
    setDbExtensions(ws, ['Ext01', 'OnlyInDb']);

    parseResult(await tool(server, LOAD_TOOL).handler({ inputDir: ws.dataDir, confirm: true, applyToDatabase: true }));

    assert.deepStrictEqual(extensionsOf(ws, '/UpdateDBCfg'), ['Ext01']);
  });

  test('платформа недоступна (CLI падает до записи отчёта): isError, ни одного спавна, замок освобождён', async () => {
    seedBackups(ws, ['Ext01']);
    pointEnvToAbsentPlatform(ws);

    const result = await tool(server, LOAD_TOOL).handler({ inputDir: ws.dataDir, confirm: true });

    assert.ok(isErrorResult(result), `ожидалась ошибка, реально: ${extractText(result)}`);
    assert.deepStrictEqual(readInvocations(ws), []);
    assert.strictEqual(isConfigurationOperationRunning(), false);
  });

  test('applyToDatabase=true и отказ /UpdateDBCfg на 2-м расширении → isError с его именем; загрузка при этом состоялась', async () => {
    // Молчаливое «применено» при неудаче применения хуже отсутствия шага: база
    // осталась со старой конфигурацией, а агент считал бы её обновлённой.
    const names = makeExtensionNames(3);
    seedBackups(ws, names);
    setDbExtensions(ws, names);
    setFakeControl(ws, 'fail-update.txt', [names[1]]);

    const result = await tool(server, LOAD_TOOL).handler({ inputDir: ws.dataDir, confirm: true, applyToDatabase: true });

    assert.ok(isErrorResult(result), 'отказ применения обязан быть ошибкой инструмента');
    assert.ok(extractText(result).includes(names[1]), `в тексте ошибки нет сбойного расширения: ${extractText(result)}`);
    assert.deepStrictEqual(extensionsOf(ws, '/LoadCfg'), names, 'загрузка прошла полностью — отказало именно применение');
    assert.deepStrictEqual(extensionsOf(ws, '/UpdateDBCfg'), [names[0], names[1]], 'после отказа применение следующих не продолжается');
    assert.strictEqual(isConfigurationOperationRunning(), false);
  });

  test('отказ запроса списка расширений → isError, ноль /LoadCfg', async () => {
    seedBackups(ws, ['Ext01']);
    makeListFail(ws);

    const result = await tool(server, LOAD_TOOL).handler({ inputDir: ws.dataDir, confirm: true });

    assert.ok(isErrorResult(result));
    assert.strictEqual(invocationsOf(ws, '/LoadCfg').length, 0);
    assert.strictEqual(isConfigurationOperationRunning(), false);
  });
});
