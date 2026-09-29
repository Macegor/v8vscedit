import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import * as vscode from 'vscode';
import type { ConfigEntry } from '../../../domain/Configuration';
import type { SupportMode, SupportInfoService } from '../../../infra/support/SupportInfoService';
import { ConfigurationScaffoldService, FormToolsService, MetadataXmlCreator } from '../../../infra/xml';
import { McpMetadataPathService } from '../../../ui/mcp/McpMetadataPathService';
import { registerFormTools } from '../../../ui/mcp/registration/McpFormTools';
import { McpMutationGate } from '../../../ui/mcp/registration/McpMutationGate';
import type { McpCommandServices, McpRegistrationDeps } from '../../../ui/mcp/registration/McpRegistrationDeps';
import { registerFormToolsCommands } from '../../../ui/commands/form/FormToolsCommands';
import { MetadataTreeProvider } from '../../../ui/tree/MetadataTreeProvider';
import type { MetadataNode } from '../../../ui/tree/TreeNode';

/**
 * Корень репозитория (для `extensionUri` дерева навигатора). `__dirname` здесь —
 * `out/test/suite/support`, как и у `formFixtures.EXAMPLE_ROOT`.
 */
export const REPO_ROOT = path.resolve(__dirname, '../../../../');

/**
 * Обвязка для проверки MCP-инструментов форм на РЕАЛЬНОМ дереве навигатора.
 *
 * Главный урок дефекта: прежние тесты собирали узел формы вручную и подставляли в
 * `xmlPath` путь тела формы, которого продакшн-билдер не ставит никогда, — поэтому
 * `edit_form` был зелёным в тестах и разрушающим в жизни. Здесь дерево строит
 * настоящий `MetadataTreeProvider` (JSON-кэш по настоящей выгрузке на диске), а
 * канонические пути резолвит настоящий `McpMetadataPathService`, так что форма
 * узла — ровно та, что видит ИИ-агент.
 *
 * Подменено только то, чего нет вне живого VS Code/платформы: сервис поддержки
 * (читает `ParentConfigurations.bin` реальной конфигурации) и репозиторий
 * хранилища (нужна живая база). Мутирующие сервисы форм и пост-мутационный шлюз —
 * настоящие; шлюзу подставлены лишь регистраторы вызовов для проверки гейта.
 */

/** Журнал вызовов единого post-mutation пути (образец `PostMutationSpy` из mcpToolsCatalog). */
export interface PostMutationLog {
  readonly suppress: string[][];
  readonly markChanged: string[][];
  refreshActionsView: number;
}

export interface FormMcpHarnessOptions {
  /** Режим поддержки, который вернёт стаб `SupportInfoService`. Без опции сервис поддержки отсутствует. */
  readonly supportMode?: SupportMode;
  /** Стаб хранилища: `true` — объект не захвачен (`isEditRestricted`). */
  readonly repositoryRestricted?: boolean;
}

export interface FormMcpHarness {
  readonly treeProvider: MetadataTreeProvider;
  readonly paths: McpMetadataPathService;
  /**
   * Тот же набор сервисов, что получают MCP-инструменты. Нужен командам навигатора
   * (`registerFormToolsCommands`): UI-команда и MCP-инструмент одного действия обязаны
   * ходить одним кодом, поэтому и стенд у них один.
   */
  readonly services: McpCommandServices;
  readonly postMutation: PostMutationLog;
  /** Пути, по которым гейт спрашивал `supportService.getSupportMode`. */
  readonly supportQueries: string[];
  /** Пути, по которым гейт спрашивал `repositoryService.isEditRestricted`. */
  readonly repositoryQueries: string[];
  /**
   * Строки, ушедшие в канал «1С Редактор». Нужны, чтобы проверять не только тост,
   * но и запись отказа в журнал: тост пользователь закрывает, и разбираться потом
   * не по чему.
   */
  readonly logLines: string[];
  call(tool: string, args: Record<string, unknown>): Promise<CallToolResult>;
  dispose(): void;
}

export function createFormMcpHarnessOverEntry(entry: ConfigEntry, options: FormMcpHarnessOptions = {}): FormMcpHarness {
  const cacheRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-mcp-form-cache-')));
  const treeProvider = new MetadataTreeProvider([entry], vscode.Uri.file(REPO_ROOT), cacheRoot);
  const paths = new McpMetadataPathService(treeProvider);

  const postMutation: PostMutationLog = { suppress: [], markChanged: [], refreshActionsView: 0 };
  const supportQueries: string[] = [];
  const repositoryQueries: string[] = [];
  const logLines: string[] = [];
  const supportMode = options.supportMode;
  const services = {
    treeProvider,
    formToolsService: new FormToolsService(),
    supportService: supportMode === undefined
      ? undefined
      : {
        getSupportMode: (filePath: string) => {
          supportQueries.push(filePath);
          return supportMode;
        },
      } as unknown as SupportInfoService,
    repositoryService: {
      isEditRestricted: (filePath: string) => {
        repositoryQueries.push(filePath);
        return options.repositoryRestricted === true;
      },
      // Пара методов UI-ветки той же проверки захвата: команды навигатора сначала
      // ищут подключённое хранилище по XML объекта, затем спрашивают ограничение.
      resolveTargetByXmlPath: (filePath: string) => (options.repositoryRestricted === undefined ? undefined : { xmlPath: filePath }),
      isMetadataEditRestricted: (_target: unknown, filePath: string) => {
        repositoryQueries.push(filePath);
        return options.repositoryRestricted === true;
      },
    },
    suppressConfigurationReloadForFiles: (files: string[]) => { postMutation.suppress.push([...files]); },
    markChangedConfigurationByFiles: (files: string[]) => { postMutation.markChanged.push([...files]); },
    refreshActionsView: () => { postMutation.refreshActionsView += 1; },
    outputChannel: { appendLine: (line: string) => { logLines.push(line); } },
  } as unknown as McpCommandServices;

  const gate = new McpMutationGate(services);
  const handlers = new Map<string, (args: Record<string, unknown>) => unknown>();
  const server = {
    registerTool: (name: string, _config: unknown, handler: (args: Record<string, unknown>) => unknown) => {
      handlers.set(name, handler);
    },
  };
  // registerFormTools читает из deps только paths/services/gate; xmlEditor/properties/
  // mutations нужны другим доменам регистрации и здесь намеренно не создаются.
  registerFormTools(server as never, { services, paths, gate } as unknown as McpRegistrationDeps);

  return {
    treeProvider,
    paths,
    services,
    postMutation,
    supportQueries,
    repositoryQueries,
    logLines,
    call: async (tool, args) => {
      const handler = handlers.get(tool);
      if (!handler) {
        throw new Error(`MCP-инструмент ${tool} не зарегистрирован в registerFormTools`);
      }
      return await Promise.resolve(handler(args)) as CallToolResult;
    },
    dispose: () => {
      treeProvider.dispose();
      fs.rmSync(cacheRoot, { recursive: true, force: true });
    },
  };
}

/** Заголовки форм-фикстур: по ним `form_info` отличает заголовок ФОРМЫ от имени объекта. */
export const CATALOG_FORM_TITLE = 'Заголовок формы элемента';
export const COMMON_FORM_TITLE = 'Заголовок общей формы';

/** Раскладка временной выгрузки, на которой строятся все формо-тесты MCP. */
export interface FormFixtureExport {
  readonly configRoot: string;
  readonly configName: string;
  readonly catalogName: string;
  readonly catalogXml: string;
  readonly catalogFormName: string;
  /** `Catalogs/<Имя>/Forms/<Форма>.xml` — дескриптор формы объекта. */
  readonly catalogFormDescriptor: string;
  /** `Catalogs/<Имя>/Forms/<Форма>/Ext/Form.xml` — тело формы объекта. */
  readonly catalogFormBody: string;
  readonly attributeName: string;
  readonly templateName: string;
  readonly subsystemName: string;
  readonly commonFormName: string;
  /** `CommonForms/<Имя>.xml` — дескриптор общей формы. */
  readonly commonFormXml: string;
  /** `CommonForms/<Имя>/Ext/Form.xml` — тело общей формы. */
  readonly commonFormBody: string;
}

function requireOk(label: string, result: { readonly success: boolean; readonly errors: readonly string[] }): void {
  if (!result.success) {
    throw new Error(`Подготовка фикстуры: ${label} не удалось: ${result.errors.join('; ')}`);
  }
}

/**
 * Создаёт во временном каталоге настоящую выгрузку: справочник с реквизитом, макетом и
 * формой, подсистему и общую форму. Формы получают заголовки (см. `*_FORM_TITLE`).
 */
export function createFormFixtureExport(): FormFixtureExport {
  const configRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-mcp-form-')));
  const configName = 'Тест';
  const catalogName = 'Товары';
  const catalogFormName = 'ФормаЭлемента';
  const commonFormName = 'ОбщаяФорма';
  new ConfigurationScaffoldService().createConfiguration({ name: configName, outputDir: configRoot });

  const creator = new MetadataXmlCreator();
  const forms = new FormToolsService();
  const catalogXml = path.join(configRoot, 'Catalogs', `${catalogName}.xml`);
  requireOk('справочник', creator.addRootObject({ configRoot, kind: 'Catalog', name: catalogName }));
  requireOk('реквизит', creator.addChildElement({ ownerObjectXmlPath: catalogXml, childTag: 'Attribute', name: 'Реквизит1' }));
  requireOk('макет', creator.addChildElement({
    ownerObjectXmlPath: catalogXml, childTag: 'Template', name: 'Макет1', templateType: 'SpreadsheetDocument',
  }));
  requireOk('подсистема', creator.addRootObject({ configRoot, kind: 'Subsystem', name: 'Продажи' }));
  requireOk('общая форма', creator.addRootObject({ configRoot, kind: 'CommonForm', name: commonFormName }));
  forms.addForm({ objectPath: catalogXml, formName: catalogFormName, purpose: 'Object', synonym: 'Форма элемента', setDefault: true });

  const catalogFormBody = path.join(configRoot, 'Catalogs', catalogName, 'Forms', catalogFormName, 'Ext', 'Form.xml');
  const commonFormBody = path.join(configRoot, 'CommonForms', commonFormName, 'Ext', 'Form.xml');
  forms.compile({
    outputPath: catalogFormBody,
    definition: {
      title: CATALOG_FORM_TITLE,
      events: { OnCreateAtServer: 'ПриСозданииНаСервере' },
      attributes: [{ name: 'Объект', type: `CatalogObject.${catalogName}`, main: true }],
    },
  });
  forms.compile({ outputPath: commonFormBody, definition: { title: COMMON_FORM_TITLE } });

  return {
    configRoot,
    configName,
    catalogName,
    catalogXml,
    catalogFormName,
    catalogFormDescriptor: path.join(configRoot, 'Catalogs', catalogName, 'Forms', `${catalogFormName}.xml`),
    catalogFormBody,
    attributeName: 'Реквизит1',
    templateName: 'Макет1',
    subsystemName: 'Продажи',
    commonFormName,
    commonFormXml: path.join(configRoot, 'CommonForms', `${commonFormName}.xml`),
    commonFormBody,
  };
}

export interface FormMcpFixture extends FormFixtureExport {
  readonly harness: FormMcpHarness;
  /** Удаляет и дерево (кэш), и временную выгрузку. */
  dispose(): void;
}

/** Выгрузка-фикстура + настоящее дерево + MCP-инструменты форм одним вызовом. */
export function createFormMcpFixture(options: FormMcpHarnessOptions = {}): FormMcpFixture {
  const exportInfo = createFormFixtureExport();
  const harness = createFormMcpHarnessOverEntry({ rootPath: exportInfo.configRoot, kind: 'cf' }, options);
  return {
    ...exportInfo,
    harness,
    dispose: () => {
      harness.dispose();
      fs.rmSync(exportInfo.configRoot, { recursive: true, force: true });
    },
  };
}

export function toolText(result: CallToolResult): string {
  const part = result.content[0];
  return part.type === 'text' ? part.text : '';
}

export function isToolError(result: CallToolResult): boolean {
  return result.isError === true;
}

/**
 * Команды навигатора (`v8vscedit.form.*`) поверх ТЕХ ЖЕ сервисов, что и MCP-инструменты стенда.
 *
 * `vscode.commands.registerCommand` подменяется на время регистрации: настоящая регистрация
 * упала бы на конфликте идентификаторов с уже активированным расширением, а проверять надо
 * поведение обработчика, а не факт регистрации.
 */
export interface FormCommandsStand {
  /** Идентификаторы, которые команда-регистратор действительно зарегистрировала. */
  readonly registered: readonly string[];
  /** Число disposables, сложенных в `context.subscriptions`. */
  readonly subscriptions: number;
  run(command: string, node?: MetadataNode): Promise<void>;
}

export function createFormCommandsStand(harness: FormMcpHarness): FormCommandsStand {
  const handlers = new Map<string, (node?: MetadataNode) => unknown>();
  const subscriptions: { dispose(): void }[] = [];
  const commandsRef = vscode.commands as { registerCommand: typeof vscode.commands.registerCommand };
  const original = commandsRef.registerCommand;
  commandsRef.registerCommand = ((command: string, handler: (...args: unknown[]) => unknown) => {
    handlers.set(command, (node) => handler(node));
    return { dispose: () => undefined };
  }) as typeof vscode.commands.registerCommand;
  try {
    registerFormToolsCommands(
      { subscriptions } as unknown as vscode.ExtensionContext,
      harness.services,
    );
  } finally {
    commandsRef.registerCommand = original;
  }
  return {
    registered: [...handlers.keys()],
    subscriptions: subscriptions.length,
    run: async (command, node) => {
      const handler = handlers.get(command);
      if (!handler) {
        throw new Error(`Команда ${command} не зарегистрирована registerFormToolsCommands`);
      }
      await Promise.resolve(handler(node));
    },
  };
}
