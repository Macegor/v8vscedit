/**
 * Волна 5b: единый mutation-gateway. ~30 call-sites в `V8McpServer.ts`
 * вызывают `this.afterMutation(result.changedFiles)` БЕЗ проверки
 * `result.success` — корректная проверка (`if (result.success) { ... }`)
 * есть только у `remove_metadata` (~строка 1583) и в `McpAddToolsRegistration.ts`.
 * `afterMutation` (~строка 1911) гардит исключительно `changedFiles.length===0`,
 * а не факт успеха мутации.
 *
 * Тест воспроизводит реальный call-site `v8vscedit_edit_role`
 * (V8McpServer.ts, ~строка 1201-1207):
 *   const result = this.services.roleRightsService.edit({ rightsPath, operations });
 *   this.afterMutation([...result.changedFiles]);
 * Сервис `roleRightsService` подменяется фейком (внешняя по отношению
 * к проверяемому call-site бизнес-логика — реальный `RoleRightsEditService`
 * всегда возвращает `changedFiles: []` при `success: false`, поэтому баг
 * НЕ проявляется на его настоящих ответах; тест обязан проверить сам
 * call-site вызовом с произвольной формой результата мутации, которую
 * контракт `MutationResult` в принципе допускает).
 *
 * `V8McpServer.registerTools` — приватный метод; вызывается через структурное
 * приведение типа (`as unknown`), как уже принято в `mcpAddTools.test.ts`
 * (`registerAllAddTools(server as never, ctx)`) и в
 * `metadataMutationServiceSupport.test.ts` (`as unknown as CommandServices`).
 * Реального HTTP/сессии/дерева VS Code не поднимаем — дерево строится как
 * чистый `MetadataNode`-граф, аналогично `createProvider` в
 * `mcpMetadataPathService.test.ts`.
 *
 * ЦЕЛЕВОЙ КОНТРАКТ для developer (5b): перед каждым вызовом `this.afterMutation(...)`
 * должна стоять проверка успеха результата мутации, единая для всех call-sites:
 *  - формы с явным булевым `success` (`RoleRightsEditResult`, `MetadataMutationResult`,
 *    `RemoveMetadataResult`, ...) — post-mutation только при `success === true`;
 *  - формы без явного `success`, где успех выражается количеством
 *    (`set_properties`: `{applied, failed, changedFiles}`; `cfe_borrow`: `{files}`,
 *    причём `CfeBorrowService` бросает исключение при ошибке, а не возвращает
 *    неуспех — значит `success` для него эквивалентен факту недостижения throw) —
 *    post-mutation по-прежнему только при непустом списке изменённых файлов.
 * Простейшая корректная реализация — `if (result.success !== false) { this.afterMutation(result.changedFiles) }`
 * либо явный `if (result.success)` на каждом call-site (по образцу remove_metadata).
 */
import * as assert from 'assert';
import * as vscode from 'vscode';
import { V8McpServer } from '../../ui/mcp/V8McpServer';
import { ConfigurationXmlEditor } from '../../infra/xml';
import { MetadataNode } from '../../ui/tree/TreeNode';
import type { MetadataTreeProvider } from '../../ui/tree/MetadataTreeProvider';
import type { CommandServices } from '../../ui/commands/_shared';
import type { RoleRightsEditResult } from '../../infra/role/types';

/** Мок McpServer.registerTool — фиксирует зарегистрированные обработчики по имени tool-а (образец mcpAddTools.test.ts). */
interface RegisteredTool {
  readonly handler: (args: Record<string, unknown>) => unknown;
}

function createMockMcpServer(): { tools: Map<string, RegisteredTool>; server: unknown } {
  const tools = new Map<string, RegisteredTool>();
  const server = {
    registerTool: (name: string, _config: unknown, handler: (args: Record<string, unknown>) => unknown) => {
      tools.set(name, { handler });
    },
  };
  return { tools, server };
}

/** Минимальный узел роли для McpMetadataPathService.resolveNode('Роли.ТестоваяРоль'). */
function createRoleTreeProvider(rightsXmlPath: string): MetadataTreeProvider {
  const roleNode = new MetadataNode(
    { label: 'ТестоваяРоль', nodeKind: 'Role', xmlPath: rightsXmlPath },
    vscode.TreeItemCollapsibleState.None,
  );
  const rolesGroup = new MetadataNode(
    { label: 'Роли', nodeKind: 'group-type', childrenLoader: () => [roleNode] },
    vscode.TreeItemCollapsibleState.Collapsed,
  );
  const configurationRoot = new MetadataNode(
    {
      label: 'Конфигурация',
      nodeKind: 'configuration',
      xmlPath: '/tmp/v8vscedit-fixture/Configuration.xml',
      childrenLoader: () => [rolesGroup],
    },
    vscode.TreeItemCollapsibleState.Collapsed,
  );

  return {
    getAutomationRoots: () => [configurationRoot],
    getEntries: () => [{ rootPath: '/tmp/v8vscedit-fixture', kind: 'cf' as const }],
  } as unknown as MetadataTreeProvider;
}

/** Фиксирует факт вызовов post-mutation колбэков; без побочных эффектов на реальной ФС. */
interface PostMutationSpy {
  readonly suppressCalls: (readonly string[])[];
  readonly markChangedCalls: (readonly string[])[];
  readonly refreshCacheForFilesCalls: (readonly string[])[];
  refreshActionsViewCalls: number;
}

function createServices(
  rightsXmlPath: string,
  editResult: RoleRightsEditResult,
): { services: CommandServices; spy: PostMutationSpy } {
  const spy: PostMutationSpy = {
    suppressCalls: [],
    markChangedCalls: [],
    refreshCacheForFilesCalls: [],
    refreshActionsViewCalls: 0,
  };

  const treeProvider = createRoleTreeProvider(rightsXmlPath);
  // treeProvider.refreshCacheForFiles/refresh дописываем поверх фейкового провайдера —
  // именно их вызов (или невызов) проверяется тестом как часть post-mutation пути.
  Object.assign(treeProvider, {
    refreshCacheForFiles: (filePaths: string[]) => {
      spy.refreshCacheForFilesCalls.push([...filePaths]);
      return true;
    },
    refresh: () => undefined,
  });

  const services = {
    treeProvider,
    outputChannel: { appendLine: () => undefined } as unknown as vscode.OutputChannel,
    // Внешняя недоступная в юнит-тесте бизнес-логика: реальный RoleRightsEditService
    // никогда не отдаёт success:false с непустым changedFiles (см. комментарий вверху
    // файла), поэтому подменяем фасад минимальным фейком с нужным результатом —
    // это не тест самого RoleRightsService, а тест call-site в V8McpServer.
    roleRightsService: {
      edit: (): RoleRightsEditResult => editResult,
    },
    repositoryService: { isEditRestricted: () => false },
    suppressConfigurationReloadForFiles: (filePaths: string[]) => {
      spy.suppressCalls.push([...filePaths]);
    },
    markChangedConfigurationByFiles: (filePaths: string[]) => {
      spy.markChangedCalls.push([...filePaths]);
    },
    refreshActionsView: () => {
      spy.refreshActionsViewCalls += 1;
    },
  } as unknown as CommandServices;

  return { services, spy };
}

suite('V8McpServer — v8vscedit_edit_role учитывает success результата мутации (5b)', () => {
  const rightsXmlPath = '/tmp/v8vscedit-fixture/Roles/ТестоваяРоль/Ext/Rights.xml';

  test('success:false с непустым changedFiles: post-mutation путь НЕ должен запускаться', () => {
    // Синтетический результат: сервис успел записать файл (changedFiles непустой),
    // но по контракту RoleRightsEditResult операция помечена неуспешной.
    // Реальный RoleRightsEditService так не делает (см. комментарий вверху файла),
    // но контракт результата это ДОПУСКАЕТ, а V8McpServer обязан быть устойчив
    // к любой форме, соответствующей типу, а не полагаться на побочный инвариант
    // конкретной текущей реализации сервиса.
    const failedResult: RoleRightsEditResult = {
      success: false,
      changed: false,
      rightsPath: rightsXmlPath,
      applied: 0,
      changedFiles: [rightsXmlPath],
      warnings: [],
      errors: ['Синтетическая ошибка для теста 5b'],
    };
    const { services, spy } = createServices(rightsXmlPath, failedResult);
    // Доработка жизненного цикла MCP-сервера (5c) добавляет обязательные
    // projectRoot/version в конструктор — этот тест конструирует V8McpServer
    // только чтобы вызвать приватный registerTools, поэтому значения фиктивны.
    const server = new V8McpServer(services, new ConfigurationXmlEditor(), '/tmp/v8vscedit-fixture', '0.0.0-test');
    const { tools, server: mockMcpServer } = createMockMcpServer();
    (server as unknown as { registerTools(mcp: unknown): void }).registerTools(mockMcpServer);

    const tool = tools.get('v8vscedit_edit_role');
    assert.ok(tool, 'v8vscedit_edit_role должен быть зарегистрирован');
    tool.handler({
      path: 'Роли.ТестоваяРоль',
      operations: [{ op: 'revoke', object: 'Catalog.Тест', rights: ['Read'] }],
    });

    assert.strictEqual(
      spy.suppressCalls.length, 0,
      'БАГ 5b: suppressConfigurationReloadForFiles вызван при success:false — конфигурация ошибочно помечается изменённой при провале мутации'
    );
    assert.strictEqual(
      spy.markChangedCalls.length, 0,
      'БАГ 5b: markChangedConfigurationByFiles вызван при success:false'
    );
    assert.strictEqual(
      spy.refreshCacheForFilesCalls.length, 0,
      'БАГ 5b: refreshCacheForFiles вызван при success:false — дерево рефрешится зря на провале'
    );
    assert.strictEqual(spy.refreshActionsViewCalls, 0, 'БАГ 5b: refreshActionsView вызван при success:false');
  });

  test('success:true с непустым changedFiles: post-mutation путь должен запускаться (регрессия happy-path)', () => {
    const okResult: RoleRightsEditResult = {
      success: true,
      changed: true,
      rightsPath: rightsXmlPath,
      applied: 1,
      changedFiles: [rightsXmlPath],
      warnings: [],
      errors: [],
    };
    const { services, spy } = createServices(rightsXmlPath, okResult);
    const server = new V8McpServer(services, new ConfigurationXmlEditor(), '/tmp/v8vscedit-fixture', '0.0.0-test');
    const { tools, server: mockMcpServer } = createMockMcpServer();
    (server as unknown as { registerTools(mcp: unknown): void }).registerTools(mockMcpServer);

    const tool = tools.get('v8vscedit_edit_role');
    assert.ok(tool, 'v8vscedit_edit_role должен быть зарегистрирован');
    tool.handler({
      path: 'Роли.ТестоваяРоль',
      operations: [{ op: 'revoke', object: 'Catalog.Тест', rights: ['Read'] }],
    });

    assert.deepStrictEqual(spy.suppressCalls, [[rightsXmlPath]], 'при реальном успехе suppressConfigurationReloadForFiles обязан вызваться');
    assert.deepStrictEqual(spy.markChangedCalls, [[rightsXmlPath]], 'при реальном успехе markChangedConfigurationByFiles обязан вызваться');
    assert.deepStrictEqual(spy.refreshCacheForFilesCalls, [[rightsXmlPath]], 'при реальном успехе refreshCacheForFiles обязан вызваться');
    assert.strictEqual(spy.refreshActionsViewCalls, 1, 'при реальном успехе refreshActionsView обязан вызваться ровно один раз');
  });

  test('success:true с пустым changedFiles: post-mutation путь НЕ должен запускаться (нет реально изменённых файлов)', () => {
    // Ветка `afterMutationIfSucceeded`: succeeded=true, но changedFiles пуст —
    // например операция не привела к реальным правкам (applied:0 без ошибок).
    // Гейт должен остановиться на проверке `files.length === 0`, не дойдя до afterMutation.
    const noopResult: RoleRightsEditResult = {
      success: true,
      changed: false,
      rightsPath: rightsXmlPath,
      applied: 0,
      changedFiles: [],
      warnings: [],
      errors: [],
    };
    const { services, spy } = createServices(rightsXmlPath, noopResult);
    const server = new V8McpServer(services, new ConfigurationXmlEditor(), '/tmp/v8vscedit-fixture', '0.0.0-test');
    const { tools, server: mockMcpServer } = createMockMcpServer();
    (server as unknown as { registerTools(mcp: unknown): void }).registerTools(mockMcpServer);

    const tool = tools.get('v8vscedit_edit_role');
    assert.ok(tool, 'v8vscedit_edit_role должен быть зарегистрирован');
    tool.handler({
      path: 'Роли.ТестоваяРоль',
      operations: [{ op: 'revoke', object: 'Catalog.Тест', rights: ['Read'] }],
    });

    assert.strictEqual(spy.suppressCalls.length, 0, 'success:true, но changedFiles пуст — suppressConfigurationReloadForFiles не должен вызываться');
    assert.strictEqual(spy.markChangedCalls.length, 0, 'success:true, но changedFiles пуст — markChangedConfigurationByFiles не должен вызываться');
    assert.strictEqual(spy.refreshCacheForFilesCalls.length, 0, 'success:true, но changedFiles пуст — refreshCacheForFiles не должен вызываться');
    assert.strictEqual(spy.refreshActionsViewCalls, 0, 'success:true, но changedFiles пуст — refreshActionsView не должен вызываться');
  });
});
