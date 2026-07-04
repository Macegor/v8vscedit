/**
 * CHARACTERIZATION/GOLDEN-тест для `V8McpServer.registerTools` перед
 * декомпозицией God-класса (`src/ui/mcp/V8McpServer.ts`, ~2182 строки) на
 * `src/ui/mcp/registration/*` по образцу уже вынесенного
 * `McpAddToolsRegistration.ts` (тот декомпозирован раньше и уже застрахован
 * `mcpAddTools.test.ts` — дублировать его каталог здесь не нужно).
 *
 * Это НЕ тест новой функциональности — рефакторинг чисто косметический,
 * поэтому тест обязан быть ЗЕЛЁНЫМ на текущем HEAD. Его смысл — стать
 * ловушкой регресса: любое случайное изменение состава/схемы/текста
 * инструментов или пост-мутационного гейта при дроблении файла должно
 * провалить именно этот тест.
 *
 * Зафиксировано:
 *  1) Полный каталог из 57 tools, регистрируемых НЕПОСРЕДСТВЕННО телом
 *     `registerTools` (`server.registerTool(...)` прямо в V8McpServer.ts).
 *     Для каждого — имя, title, description (построчно, дословно) и набор
 *     ключей inputSchema с их опциональностью. Ровно 57 — см. `grep`/`awk`
 *     подсчёт по исходнику; ~60 из архитектурной оценки включает round-off.
 *     Отдельно вызываемые `registerAllAddTools` (45 root + 11 child = 56 tools)
 *     сюда не входят — они уже застрахованы `mcpAddTools.test.ts` как
 *     самостоятельный декомпозированный модуль.
 *  2) Инвариант единого post-mutation пути (`suppressConfigurationReloadForFiles`
 *     → `markChangedConfigurationByFiles` → `refreshCacheForFiles`/`refresh`
 *     → `refreshActionsView`) на репрезентативных tools из разных будущих
 *     доменов регистрации: метаданные (`remove_metadata`, `set_type`,
 *     `rename_metadata`), роли (`set_default_roles`), формы (`add_form`,
 *     `edit_form`), подсистемы (`edit_subsystem_content`), внешние объекты
 *     (`create_epf`), жизненный цикл (`create_configuration`).
 *     `edit_role` уже полностью покрыт `mcpServerAfterMutationGate.test.ts` —
 *     здесь не дублируется.
 *
 * Приватный `registerTools` вызывается через структурное приведение типа
 * (`as unknown`), как уже принято в `mcpServerAfterMutationGate.test.ts`.
 * Мутационные сценарии используют реальные временные каталоги и реальные
 * сервисы (без моков бизнес-логики) — по образцу `mcpAddTools.test.ts` и
 * `mcpSetProperties.test.ts`; мокается только сам транспортный `McpServer`
 * (внешняя недоступная в юните MCP SDK инфраструктура) и минимальный набор
 * сервисов `CommandServices`, не участвующих в проверяемом call-site.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import * as vscode from 'vscode';
import { V8McpServer } from '../../ui/mcp/V8McpServer';
import { ConfigurationXmlEditor } from '../../infra/xml';
import { MetadataXmlCreator } from '../../infra/xml/MetadataXmlCreator';
import { MetadataXmlRemover } from '../../infra/xml/MetadataXmlRemover';
import { ExternalObjectService } from '../../infra/xml/ExternalObjectService';
import { ConfigurationScaffoldService } from '../../infra/xml/ConfigurationScaffoldService';
import { SubsystemXmlService } from '../../infra/xml/SubsystemXmlService';
import { FormToolsService } from '../../infra/xml/form/FormToolsService';
import { RoleRightsService } from '../../infra/role';
import { MetadataNode } from '../../ui/tree/TreeNode';
import type { MetadataTreeProvider } from '../../ui/tree/MetadataTreeProvider';
import type { CommandServices } from '../../ui/commands/_shared';

// ─── Инфраструктура мока McpServer (образец mcpAddTools.test.ts / mcpServerAfterMutationGate.test.ts) ───

interface RegisteredTool {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: unknown;
  readonly handler: (args: Record<string, unknown>) => unknown;
}

interface MockMcpServer {
  readonly tools: Map<string, RegisteredTool>;
  registerTool: (
    name: string,
    config: { title: string; description: string; inputSchema: unknown },
    handler: (args: Record<string, unknown>) => unknown,
  ) => void;
}

function createMockServer(): MockMcpServer {
  const tools = new Map<string, RegisteredTool>();
  return {
    tools,
    registerTool: (name, config, handler) => {
      tools.set(name, {
        name,
        title: config.title,
        description: config.description,
        inputSchema: config.inputSchema,
        handler,
      });
    },
  };
}

/** Пустой `MetadataTreeProvider`-стаб — регистрация tools его методы не вызывает. */
function createEmptyTreeProvider(): MetadataTreeProvider {
  return {
    getAutomationRoots: () => [],
    getEntries: () => [],
    refreshCacheForFiles: () => false,
    refresh: () => undefined,
  } as unknown as MetadataTreeProvider;
}

/**
 * Минимальный набор `CommandServices`, достаточный, чтобы тело
 * `registerTools` целиком отработало без исключений (регистрирует все tools,
 * не вызывая их handlers). Все поля, не участвующие ни в одном мутационном
 * сценарии теста, — заглушки, которые бросят понятную ошибку при случайном
 * вызове (чтобы не маскировать регресс тихим no-op).
 */
function createBaselineServices(overrides: Partial<CommandServices> = {}): CommandServices {
  const notImplemented = (member: string) => () => {
    throw new Error(`Стаб CommandServices: "${member}" не должен вызываться в этом тесте.`);
  };
  const base: CommandServices = {
    treeProvider: createEmptyTreeProvider(),
    workspaceFolder: { uri: vscode.Uri.file('/tmp/v8vscedit-fixture'), name: 'fixture', index: 0 },
    metadataXmlCreator: new MetadataXmlCreator(),
    metadataXmlRemover: new MetadataXmlRemover(),
    configurationInfoService: notImplemented('configurationInfoService') as never,
    configurationScaffoldService: new ConfigurationScaffoldService(),
    configurationValidationService: notImplemented('configurationValidationService') as never,
    metadataInfoService: notImplemented('metadataInfoService') as never,
    metadataValidationService: notImplemented('metadataValidationService') as never,
    subsystemToolsService: notImplemented('subsystemToolsService') as never,
    subsystemXmlService: new SubsystemXmlService(),
    commandInterfaceService: notImplemented('commandInterfaceService') as never,
    mxlTemplateService: notImplemented('mxlTemplateService') as never,
    dataCompositionSchemaService: notImplemented('dataCompositionSchemaService') as never,
    externalObjectService: new ExternalObjectService(),
    formToolsService: new FormToolsService(),
    cfeBorrowService: notImplemented('cfeBorrowService') as never,
    cfeDiffService: notImplemented('cfeDiffService') as never,
    cfePatchMethodService: notImplemented('cfePatchMethodService') as never,
    roleRightsService: new RoleRightsService(),
    reloadEntries: () => undefined,
    dynamicPanelController: { handleMetadataRemoved: () => undefined } as never,
    subsystemEditorViewProvider: { handleMetadataRemoved: () => undefined } as never,
    outputChannel: { appendLine: () => undefined } as unknown as vscode.OutputChannel,
    supportService: undefined,
    repositoryService: { isEditRestricted: () => false } as never,
    projectSecretStorage: notImplemented('projectSecretStorage') as never,
    repositoryConnectionViewProvider: notImplemented('repositoryConnectionViewProvider') as never,
    repositoryCommitViewProvider: notImplemented('repositoryCommitViewProvider') as never,
    bslAnalyzerConfigService: notImplemented('bslAnalyzerConfigService') as never,
    projectEnvironmentViewProvider: notImplemented('projectEnvironmentViewProvider') as never,
    aiMcpViewProvider: undefined,
    standaloneServerService: notImplemented('standaloneServerService') as never,
    standaloneServerViewProvider: notImplemented('standaloneServerViewProvider') as never,
    aiSkillsInstaller: notImplemented('aiSkillsInstaller') as never,
    refreshChangedConfigurationState: () => undefined,
    markChangedConfigurationByFiles: () => undefined,
    getChangedConfigurations: () => [],
    markConfigurationsClean: () => undefined,
    suppressConfigurationReloadForFiles: () => undefined,
    revealTreeNode: () => Promise.resolve(false),
    setTreeMessage: () => undefined,
    setTreeProcessingState: () => undefined,
    refreshActionsView: () => undefined,
  };
  return { ...base, ...overrides };
}

/** Создаёт `V8McpServer` и вызывает приватный `registerTools` на mock-сервере. */
function registerAllTools(services: CommandServices): { tools: Map<string, RegisteredTool> } {
  const server = new V8McpServer(services, new ConfigurationXmlEditor());
  const mock = createMockServer();
  (server as unknown as { registerTools(mcp: unknown): void }).registerTools(mock);
  return { tools: mock.tools };
}

/**
 * Ключи `z.object({...}).shape` вместе с флагом «поле обёрнуто в `.optional()`».
 *
 * `isOptional()` здесь не годится: в zod v4 он возвращает `true` и для
 * `z.any()`/`z.unknown()` без явного `.optional()` (эти типы в принципе
 * допускают `undefined`), что дало бы ложные срабатывания на `definition:
 * z.any()` (compile_mxl/compile_skd/edit_form) и `value: z.unknown()`
 * (set_property_by_path). Реальная обёртка `.optional()` отличается по
 * внутреннему дискриминатору схемы `def.type === 'optional'` — именно он
 * значим для дробления: агент обязан видеть один и тот же набор required/
 * optional полей независимо от того, как физически собран tool.
 */
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

// ─── 1. Полный каталог инструментов ────────────────────────────────────────

/**
 * Эталон построен построчно из текущего исходника `V8McpServer.ts`
 * (`server.registerTool('name', { title, description, inputSchema }, handler)`),
 * взятого дословно — намеренно хрупкая проверка: дробление файла обязано
 * сохранить каждый символ title/description и состав inputSchema.
 */
interface ExpectedTool {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly schemaKeys: Record<string, boolean>;
}

const EXPECTED_TOOLS: readonly ExpectedTool[] = [
  {
    name: 'v8vscedit_workspace_overview',
    title: 'Обзор конфигураций и расширений',
    description: 'Возвращает основную конфигурацию, расширения, корневые пути и счётчики объектов без обхода дерева по nodeId.',
    schemaKeys: {},
  },
  {
    name: 'v8vscedit_search_metadata',
    title: 'Поиск метаданных по пути',
    description: 'Ищет по части строки в предметных путях метаданных выбранной конфигурации: например "Польз" найдёт Справочники.Пользователи.',
    schemaKeys: { query: false, configuration: false, kind: true, limit: true },
  },
  {
    name: 'v8vscedit_list_metadata',
    title: 'Список метаданных по группе или объекту',
    description: 'Возвращает объекты группы или дочерние элементы по предметному пути без nodeId: список справочников, форм, реквизитов, измерений, ресурсов и т.п.',
    schemaKeys: { configuration: true, parentPath: true, kind: true, group: true, query: true, limit: true },
  },
  {
    name: 'v8vscedit_tree',
    title: 'Плоское дерево канонических путей',
    description: 'Возвращает плоский список канонических путей метаданных. Используй для быстрой ориентации в конфигурации без пагинации. Канон путей: множественное число корня, прямые реквизиты/ТЧ, без английских алиасов (Справочники.Контрагенты.ИНН, не Catalog.Counterparties.Attribute.TIN).',
    schemaKeys: { configuration: true, scope: true, depth: true, include: true, limit: true },
  },
  {
    name: 'v8vscedit_resolve_path',
    title: 'Резолв канонического пути',
    description: 'Нормализует канонический путь и проверяет наличие узла в дереве. Возвращает каноническую форму входа и exists. На вход принимает только канонические русские пути; английские/legacy формы (Catalog.X) отбиваются с подсказкой канона. exists=false без ошибки означает «узла нет».',
    schemaKeys: { path: false, configuration: true },
  },
  {
    name: 'v8vscedit_list_supported_types',
    title: 'Реестр платформенных типов',
    description: 'Возвращает доступные типы для свойства по контексту: реквизит метаданных, реквизит формы, параметр команды, источник подписки. Для metadataAttribute / formAttribute базовая группа выдаётся даже без configuration; ссылочные группы (Справочник/Документ/…) появляются только при указанной configuration.',
    schemaKeys: { context: false, configuration: true },
  },
  {
    name: 'v8vscedit_configuration_info',
    title: 'Информация о конфигурации',
    description: 'Свойства конфигурации/расширения и счётчики ChildObjects. Принимает канонический путь корня: Конфигурация или Расширение.',
    schemaKeys: { path: false, configuration: true, mode: true, limit: true, offset: true },
  },
  {
    name: 'v8vscedit_validate_configuration',
    title: 'Валидировать конфигурацию',
    description: 'Проверяет Configuration.xml, ChildObjects, DefaultLanguage и базовые enum-значения. Принимает канонический путь корня: Конфигурация или Расширение.',
    schemaKeys: { path: false, configuration: true, detailed: true, maxErrors: true },
  },
  {
    name: 'v8vscedit_metadata_info',
    title: 'Информация об объекте метаданных',
    description: 'Возвращает структуру объекта: реквизиты, табличные части, формы, команды, макеты. Принимает канонический путь объекта: Справочники.Контрагенты, Документы.РасходТовара, РегистрыСведений.КурсыВалют, Перечисления.СтатусыЗаказа и т.п.',
    schemaKeys: { path: false, configuration: true, mode: true, name: true, limit: true, offset: true },
  },
  {
    name: 'v8vscedit_validate_metadata',
    title: 'Валидировать объект метаданных',
    description: 'Проверяет XML объекта, тип, имя, UUID, дочерние элементы и связанные файлы. Принимает канонический путь объекта (Справочники.Контрагенты) либо массив таких путей через `paths` для пакетной проверки.',
    schemaKeys: { path: true, paths: true, configuration: true, detailed: true, maxErrors: true },
  },
  {
    name: 'v8vscedit_subsystem_info',
    title: 'Информация о подсистеме',
    description: 'Возвращает свойства подсистемы, состав, дерево дочерних подсистем и CommandInterface.xml. Принимает канонический путь подсистемы: Подсистема.Продажи.Розница.',
    schemaKeys: { path: false, configuration: true, mode: true, name: true, limit: true, offset: true },
  },
  {
    name: 'v8vscedit_validate_subsystem',
    title: 'Валидировать подсистему',
    description: 'Проверяет XML подсистемы: свойства, Content, ChildObjects, файлы и CommandInterface.xml. Принимает канонический путь подсистемы: Подсистема.Продажи.Розница.',
    schemaKeys: { path: false, configuration: true, detailed: true, maxErrors: true },
  },
  {
    name: 'v8vscedit_mxl_info',
    title: 'Информация о MXL-макете',
    description: 'Возвращает области, параметры, текст и статистику табличного документа. Принимает канонический путь макета: Справочники.X.Макет.СчетФактура или ОбщиеМакеты.X.',
    schemaKeys: { path: false, configuration: true, withText: true, maxParams: true, limit: true, offset: true },
  },
  {
    name: 'v8vscedit_validate_mxl',
    title: 'Валидировать MXL-макет',
    description: 'Проверяет Template.xml табличного документа: строки, колонки, палитры, области. Принимает канонический путь макета: Справочники.X.Макет.СчетФактура или ОбщиеМакеты.X.',
    schemaKeys: { path: false, configuration: true, detailed: true, maxErrors: true },
  },
  {
    name: 'v8vscedit_compile_mxl',
    title: 'Скомпилировать MXL-макет',
    description: 'Перезаписывает содержимое существующего MXL Template.xml из JSON DSL. Для нового макета сначала используй v8vscedit_add_template с templateType="Табличный документ". Принимает канонический путь существующего макета: Справочники.X.Макет.Y.',
    schemaKeys: { path: false, configuration: true, definition: false },
  },
  {
    name: 'v8vscedit_decompile_mxl',
    title: 'Декомпилировать MXL-макет',
    description: 'Возвращает редактируемый JSON DSL по существующему Template.xml табличного документа. Принимает канонический путь макета: Справочники.X.Макет.СчетФактура или ОбщиеМакеты.X.',
    schemaKeys: { path: false, configuration: true },
  },
  {
    name: 'v8vscedit_skd_info',
    title: 'Информация о СКД',
    description: 'Возвращает наборы, запросы, поля, итоги, параметры и варианты СКД. Принимает канонический путь макета: Отчеты.X.Макет.ОсновнаяСхема.',
    schemaKeys: { path: false, configuration: true, mode: true, name: true, limit: true, offset: true },
  },
  {
    name: 'v8vscedit_validate_skd',
    title: 'Валидировать СКД',
    description: 'Проверяет Template.xml схемы компоновки данных: XML, дубли наборов, полей и параметров. Принимает канонический путь макета: Отчеты.X.Макет.ОсновнаяСхема.',
    schemaKeys: { path: false, configuration: true, detailed: true, maxErrors: true },
  },
  {
    name: 'v8vscedit_compile_skd',
    title: 'Скомпилировать СКД',
    description: 'Перезаписывает содержимое существующей СКД Template.xml из JSON DSL. Для новой СКД сначала используй v8vscedit_add_template с templateType="Схема компоновки данных". Принимает канонический путь существующего макета СКД.',
    schemaKeys: { path: false, configuration: true, definition: false },
  },
  {
    name: 'v8vscedit_edit_skd',
    title: 'Изменить СКД',
    description: 'Точечно редактирует Template.xml СКД: поля, итоги, параметры, запрос, выборку, фильтры. Принимает канонический путь макета: Отчеты.X.Макет.ОсновнаяСхема.',
    schemaKeys: {
      path: false, configuration: true, operation: false, value: false,
      dataSet: true, variant: true, noSelection: true,
    },
  },
  {
    name: 'v8vscedit_add_help',
    title: 'Добавить встроенную справку',
    description: 'Создаёт Ext/Help.xml и Ext/Help/<lang>.html для объекта и проставляет IncludeHelpInContents у форм при отсутствии. Принимает канонический путь объекта: Справочники.Контрагенты.',
    schemaKeys: { path: false, configuration: true, lang: true, title: true },
  },
  {
    name: 'v8vscedit_create_epf',
    title: 'Создать внешнюю обработку EPF',
    description: 'Создаёт минимальные XML-исходники внешней обработки: корневой XML, каталог Ext и ObjectModule.bsl.',
    schemaKeys: { name: false, synonym: true, outputDir: false },
  },
  {
    name: 'v8vscedit_create_erf',
    title: 'Создать внешний отчёт ERF',
    description: 'Создаёт минимальные XML-исходники внешнего отчёта; опционально добавляет основную СКД и привязку MainDataCompositionSchema.',
    schemaKeys: { name: false, synonym: true, outputDir: false, withSkd: true },
  },
  {
    name: 'v8vscedit_validate_external_object',
    title: 'Валидировать EPF/ERF XML',
    description: 'Проверяет структуру XML-исходников внешней обработки или отчёта: InternalInfo, Properties, ChildObjects, ссылки и файлы.',
    schemaKeys: { objectPath: false, detailed: true, maxErrors: true },
  },
  {
    name: 'v8vscedit_epf_bsp_init',
    title: 'Добавить регистрацию БСП',
    description: 'Добавляет функцию СведенияОВнешнейОбработке в ObjectModule.bsl внешней обработки/отчёта и базовый обработчик команды.',
    schemaKeys: { objectPath: false, kind: false, targets: true },
  },
  {
    name: 'v8vscedit_epf_bsp_add_command',
    title: 'Добавить команду БСП',
    description: 'Добавляет команду в СведенияОВнешнейОбработке и создаёт/дополняет серверный, клиентский или печатный обработчик.',
    schemaKeys: { objectPath: false, identifier: false, commandType: true, presentation: true, formModulePath: true },
  },
  {
    name: 'v8vscedit_form_info',
    title: 'Информация о форме',
    description: 'Возвращает структуру управляемой формы: иерархию элементов, реквизиты, команды и события. Принимает канонический путь формы: Справочники.Контрагенты.Форма.ФормаСписка или общую форму ОбщиеФормы.X.',
    schemaKeys: { path: false, configuration: true, expand: true, limit: true, offset: true },
  },
  {
    name: 'v8vscedit_validate_form',
    title: 'Валидировать форму',
    description: 'Проверяет Form.xml: версию, уникальность ID, DataPath, CommandName, события, callType, типы. Принимает канонический путь формы: Справочники.Контрагенты.Форма.ФормаСписка или ОбщиеФормы.X.',
    schemaKeys: { path: false, configuration: true, detailed: true, maxErrors: true },
  },
  {
    name: 'v8vscedit_add_form',
    title: 'Добавить форму',
    description: 'Создаёт управляемую форму у объекта: Forms/<Имя>.xml, Form.xml, Module.bsl, регистрирует <Form>Имя</Form> в ChildObjects. parentPath — канонический путь объекта-владельца (Справочники.Контрагенты); name — идентификатор формы 1С (ФормаЭлемента/ФормаСписка/…).',
    schemaKeys: {
      parentPath: false, name: false, configuration: true, purpose: true,
      synonym: true, setDefault: true, autoFill: true,
    },
  },
  {
    name: 'v8vscedit_remove_form',
    title: 'Удалить форму',
    description: 'Удаляет форму у объекта: каталог формы, дескриптор Forms/<Имя>.xml, снимает регистрацию из ChildObjects и очищает DefaultForm/DefaultObjectForm/… Принимает канонический путь формы: Справочники.Контрагенты.Форма.ФормаСписка.',
    schemaKeys: { path: false, configuration: true },
  },
  {
    name: 'v8vscedit_compile_form',
    title: 'Скомпилировать форму',
    description: 'Перезаписывает Form.xml из JSON DSL (целиком). Для создания новой формы с регистрацией в объекте и Module.bsl используй v8vscedit_add_form. Принимает канонический путь существующей формы: Справочники.X.Форма.Y или ОбщиеФормы.X.',
    schemaKeys: { path: false, configuration: true, definition: true, fromObject: true },
  },
  {
    name: 'v8vscedit_edit_form',
    title: 'Изменить форму',
    description: 'Точечно добавляет элементы, реквизиты, команды и события в существующий Form.xml. Не перезаписывает форму целиком (в отличие от compile). Принимает канонический путь формы: Справочники.X.Форма.Y или ОбщиеФормы.X.',
    schemaKeys: { path: false, configuration: true, definition: false },
  },
  {
    name: 'v8vscedit_compile_subsystem',
    title: 'Создать подсистему',
    description: 'Создаёт XML подсистемы из JSON DSL и регистрирует её в Configuration.xml или родительской подсистеме. parentPath — канонический путь: Конфигурация / Расширение (по умолчанию) или Подсистема.X.Y.',
    schemaKeys: { parentPath: true, configuration: true, definition: false },
  },
  {
    name: 'v8vscedit_edit_subsystem_content',
    title: 'Изменить состав подсистемы',
    description: 'Добавляет и убирает объекты из Content подсистемы по каноническим путям или ссылкам вида Catalog.Товары. Свойства подсистемы — через v8vscedit_get_properties и v8vscedit_set_property_by_path. Принимает канонический путь подсистемы: Подсистема.Продажи.Розница.',
    schemaKeys: { path: false, configuration: true, add: true, remove: true },
  },
  {
    name: 'v8vscedit_edit_command_interface',
    title: 'Изменить командный интерфейс',
    description: 'Редактирует CommandInterface.xml подсистемы: hide/show/place/order/subsystem-order/group-order. Принимает канонический путь подсистемы: Подсистема.Продажи.Розница. CommandInterface.xml ищется рядом с её XML; createIfMissing создаёт его, если отсутствует.',
    schemaKeys: { path: false, configuration: true, createIfMissing: true, operations: false },
  },
  {
    name: 'v8vscedit_validate_command_interface',
    title: 'Валидировать командный интерфейс',
    description: 'Проверяет CommandInterface.xml: разделы, порядок, ссылки команд, дубли и форматы списков. Принимает канонический путь подсистемы: Подсистема.Продажи.Розница.',
    schemaKeys: { path: false, configuration: true, detailed: true, maxErrors: true },
  },
  {
    name: 'v8vscedit_role_info',
    title: 'Информация о правах роли',
    description: 'Возвращает разрешённые/запрещённые права, RLS и шаблоны ограничений из Rights.xml. Принимает канонический путь роли: Роли.БазовыеПрава.',
    schemaKeys: { path: false, configuration: true, showDenied: true, limit: true, offset: true },
  },
  {
    name: 'v8vscedit_validate_role',
    title: 'Валидировать роль',
    description: 'Проверяет Rights.xml роли: XML, глобальные флаги, права объектов, RLS, шаблоны и регистрацию в Configuration.xml. Принимает канонический путь роли: Роли.БазовыеПрава.',
    schemaKeys: { path: false, configuration: true, detailed: true, maxErrors: true },
  },
  {
    name: 'v8vscedit_compile_role',
    title: 'Создать роль из DSL',
    description: 'Создаёт Roles/<Имя>.xml и Roles/<Имя>/Ext/Rights.xml из JSON DSL и регистрирует роль в Configuration.xml через ChildObjects. DefaultRoles не затрагивается. parentPath — канонический путь корня: Конфигурация (по умолчанию) или Расширение.',
    schemaKeys: { parentPath: true, configuration: true, definition: false },
  },
  {
    name: 'v8vscedit_edit_role',
    title: 'Точечное редактирование прав роли',
    description: 'Применяет операции к Rights.xml роли. Объекты задаются именами 1С с типами (Catalog.Контрагенты или Справочник.Контрагенты). Поддерживаются операции: grant/revoke/setRls/setFlags/addTemplate/removeTemplate. Принимает канонический путь роли: Роли.БазовыеПрава.',
    schemaKeys: { path: false, configuration: true, operations: false },
  },
  {
    name: 'v8vscedit_list_default_roles',
    title: 'Список ролей по умолчанию',
    description: 'Возвращает текущий список <DefaultRoles> из Configuration.xml. Принимает канонический путь корня: Конфигурация или Расширение.',
    schemaKeys: { path: false, configuration: true },
  },
  {
    name: 'v8vscedit_add_default_role',
    title: 'Добавить роль в DefaultRoles',
    description: 'Добавляет роль в <DefaultRoles> Configuration.xml. role — имя роли (БазовыеПрава) или полная ссылка (Role.БазовыеПрава). Принимает канонический путь корня: Конфигурация или Расширение.',
    schemaKeys: { path: false, configuration: true, role: false },
  },
  {
    name: 'v8vscedit_remove_default_role',
    title: 'Удалить роль из DefaultRoles',
    description: 'Убирает роль из <DefaultRoles> Configuration.xml. role — имя роли (БазовыеПрава) или полная ссылка (Role.БазовыеПрава). Принимает канонический путь корня: Конфигурация или Расширение.',
    schemaKeys: { path: false, configuration: true, role: false },
  },
  {
    name: 'v8vscedit_set_default_roles',
    title: 'Задать список DefaultRoles',
    description: 'Полностью заменяет список <DefaultRoles> в Configuration.xml. Каждое имя нормализуется в форму Role.<Имя>. Принимает канонический путь корня: Конфигурация или Расширение.',
    schemaKeys: { path: false, configuration: true, roles: false },
  },
  {
    name: 'v8vscedit_create_configuration',
    title: 'Создать пустую конфигурацию',
    description: 'Создаёт scaffold CF: Configuration.xml и Languages/Русский.xml.',
    schemaKeys: {
      name: false, synonym: true, outputDir: false, version: true,
      vendor: true, compatibilityMode: true,
    },
  },
  {
    name: 'v8vscedit_create_extension',
    title: 'Создать расширение',
    description: 'Создаёт scaffold CFE: Configuration.xml, язык и опциональную основную роль.',
    schemaKeys: {
      name: false, synonym: true, namePrefix: true, outputDir: false, purpose: true,
      version: true, vendor: true, compatibilityMode: true, configPath: true, noRole: true,
    },
  },
  {
    name: 'v8vscedit_get_properties',
    title: 'Свойства объекта по пути',
    description: 'Возвращает ВСЕ свойства узла, включая readonly, со всеми допустимыми enum/multiEnum-значениями. Каждый контракт содержит propertyKey, title, kind, currentValue, supportedBySetProperty и notes. Свойства с kind= "metadataType" (Type/Source/CommandParameterType) сами список значений не несут — в notes указано, какой tool вызывать для смены и получения списка доступных типов.',
    schemaKeys: { path: false, configuration: true },
  },
  {
    name: 'v8vscedit_set_property_by_path',
    title: 'Изменить свойство по пути',
    description: 'Меняет простое свойство объекта по каноническому пути с проверками enum/boolean/readonly. Корневые свойства доступны по path="Конфигурация" или "Расширение". Для DefaultRoles удобнее v8vscedit_add_default_role / set_default_roles.',
    schemaKeys: { path: false, configuration: true, propertyKey: false, value: false },
  },
  {
    name: 'v8vscedit_set_properties',
    title: 'Пакетная смена свойств по пути',
    description: 'Меняет несколько простых свойств объекта за один вызов. properties — объект вида { propertyKey: value, ... }, ключи — английские имена свойств из v8vscedit_get_properties. Применяет последовательно, в отчёте показывает результат каждой пары. Для типов (Type/Source/CommandParameterType) используй v8vscedit_set_type — set_properties их пропустит.',
    schemaKeys: { path: false, configuration: true, properties: false },
  },
  {
    name: 'v8vscedit_list_available_types',
    title: 'Доступные типы 1С',
    description: 'Возвращает стандартные и конфигурационные типы для свойства Тип / Источник / Тип параметра команды. Для CFE показывает только собственные и заимствованные объекты текущего расширения. Используй русское поле value при вызове set_type.',
    schemaKeys: { path: true, configuration: true, propertyKey: true },
  },
  {
    name: 'v8vscedit_set_type',
    title: 'Изменить тип объекта',
    description: 'Меняет свойство Тип / Источник / Тип параметра команды по каноническому пути. Перед ссылочным типом вызови v8vscedit_list_available_types для того же path. Принимает русские имена типов и квалификаторы (длина/точность).',
    schemaKeys: {
      path: false, configuration: true, propertyKey: true, value: true, type: true, items: true,
      length: true, allowedLength: true, digits: true, fractionDigits: true, precision: true,
      allowedSign: true, dateFractions: true,
    },
  },
  {
    name: 'v8vscedit_rename_metadata',
    title: 'Переименовать метаданные',
    description: 'Переименовывает объект или дочерний элемент по каноническому пути. Для корневого объекта обновляет файл, каталог, ChildObjects и ссылки. Принимает канонический путь: Справочники.Контрагенты.',
    schemaKeys: { path: false, configuration: true, newName: false },
  },
  {
    name: 'v8vscedit_remove_metadata',
    title: 'Удалить метаданные',
    description: 'Удаляет объект или дочерний элемент по каноническому пути через общий сервис удаления (используется и UI). Не удаляй XML/каталоги вручную. Принимает канонический путь: Справочники.Контрагенты или Справочники.X.ИНН.',
    schemaKeys: { path: false, configuration: true, keepFiles: true },
  },
  {
    name: 'v8vscedit_cfe_borrow',
    title: 'Заимствовать объект в расширение',
    description: 'Заимствует объект, форму или дочерний элемент из CF в CFE через CfeBorrowService.',
    schemaKeys: {
      configRoot: false, extensionRoot: false, typeName: false, objectName: false,
      formName: true, childTag: true, childName: true,
    },
  },
  {
    name: 'v8vscedit_cfe_patch_method',
    title: 'Добавить перехватчик метода CFE',
    description: 'Создаёт или дописывает BSL-модуль расширения перехватчиком &Перед/&После/&ИзменениеИКонтроль. path — канонический путь модуля расширения: Справочники.X.МодульОбъекта, Справочники.X.Форма.Y.МодульФормы, ОбщиеМодули.X. Модуль может пока отсутствовать.',
    schemaKeys: { extensionPath: false, path: false, methodName: false, interceptorType: false, context: true, isFunction: true },
  },
  {
    name: 'v8vscedit_cfe_diff',
    title: 'Анализ расширения CFE',
    description: 'Возвращает состав расширения, заимствованные объекты, BSL-перехватчики и опционально проверку переноса #Вставка.',
    schemaKeys: { extensionPath: false, configPath: true, mode: true },
  },
  {
    name: 'v8vscedit_execute_command',
    title: 'Выполнить команду расширения',
    description: 'Безопасный мост только для явно разрешённых команд расширения: refresh, importConfigurations, updateChangedConfigurations.',
    schemaKeys: { command: false },
  },
];

suite('V8McpServer.registerTools — golden-каталог перед декомпозицией (характеризационный)', () => {
  test('регистрирует ровно 57 прямых tools (без учёта registerAllAddTools)', () => {
    const { tools } = registerAllTools(createBaselineServices());
    // registerAllAddTools добавляет ещё 45 root + 11 child = 56 tool-ов поверх
    // этих 57 — их каталог отдельно застрахован mcpAddTools.test.ts. Здесь
    // фиксируем именно прямые регистрации, чтобы дробление не потеряло и не
    // задвоило ни одну из них.
    assert.strictEqual(tools.size, EXPECTED_TOOLS.length + 56,
      `фактический размер каталога (${String(tools.size)}) разошёлся с ожидаемым (57 прямых + 56 add-tools)`);
    for (const expected of EXPECTED_TOOLS) {
      assert.ok(tools.has(expected.name), `должен быть зарегистрирован tool "${expected.name}"`);
    }
  });

  test('ровно 57 прямых tools описаны в эталоне EXPECTED_TOOLS (защита от рассинхронизации самого теста)', () => {
    assert.strictEqual(EXPECTED_TOOLS.length, 57);
    const uniqueNames = new Set(EXPECTED_TOOLS.map((tool) => tool.name));
    assert.strictEqual(uniqueNames.size, EXPECTED_TOOLS.length, 'имена tools в эталоне не должны повторяться');
  });

  for (const expected of EXPECTED_TOOLS) {
    test(`каталог: "${expected.name}" — title/description/inputSchema побайтово совпадают с эталоном`, () => {
      const { tools } = registerAllTools(createBaselineServices());
      const actual = tools.get(expected.name);
      assert.ok(actual, `tool "${expected.name}" должен быть зарегистрирован`);
      assert.strictEqual(actual.title, expected.title, `title "${expected.name}" разошёлся с эталоном`);
      assert.strictEqual(actual.description, expected.description, `description "${expected.name}" разошёлся с эталоном`);
      const actualShape = schemaShapeSignature(actual.inputSchema);
      assert.deepStrictEqual(actualShape, expected.schemaKeys,
        `форма inputSchema "${expected.name}" (ключи + опциональность) разошлась с эталоном`);
    });
  }
});

// ─── 2. Инвариант единого post-mutation пути на репрезентативных доменах ───

interface PostMutationSpy {
  readonly suppressCalls: (readonly string[])[];
  readonly markChangedCalls: (readonly string[])[];
  readonly refreshCacheForFilesCalls: (readonly string[])[];
  refreshActionsViewCalls: number;
}

function createSpy(): PostMutationSpy {
  return {
    suppressCalls: [],
    markChangedCalls: [],
    refreshCacheForFilesCalls: [],
    refreshActionsViewCalls: 0,
  };
}

/**
 * Оборачивает `treeProvider` (свой у каждого мутационного теста — строит его
 * `createNodeResolvingTreeProvider`, чтобы `resolveNode` находил нужные
 * канонические пути) шпионскими `refreshCacheForFiles`/`refresh`, сохраняя
 * `getAutomationRoots`/`getEntries` исходного провайдера нетронутыми.
 */
function withSpiedGate(spy: PostMutationSpy, overrides: Partial<CommandServices> = {}): CommandServices {
  const baseTreeProvider = overrides.treeProvider ?? ({
    getAutomationRoots: () => [],
    getEntries: () => [],
  } as unknown as MetadataTreeProvider);
  const spiedTreeProvider = {
    ...(baseTreeProvider as unknown as Record<string, unknown>),
    refreshCacheForFiles: (filePaths: string[]) => {
      spy.refreshCacheForFilesCalls.push([...filePaths]);
      return true;
    },
    refresh: () => undefined,
  } as unknown as MetadataTreeProvider;

  return createBaselineServices({
    ...overrides,
    treeProvider: spiedTreeProvider,
    suppressConfigurationReloadForFiles: (filePaths: string[]) => {
      spy.suppressCalls.push([...filePaths]);
    },
    markChangedConfigurationByFiles: (filePaths: string[]) => {
      spy.markChangedCalls.push([...filePaths]);
    },
    refreshActionsView: () => {
      spy.refreshActionsViewCalls += 1;
    },
  });
}

function assertGateFired(spy: PostMutationSpy, expectedFiles: readonly string[], label: string): void {
  assert.strictEqual(spy.suppressCalls.length, 1, `${label}: suppressConfigurationReloadForFiles должен вызваться ровно один раз`);
  assert.deepStrictEqual(spy.suppressCalls[0], [...expectedFiles], `${label}: suppressConfigurationReloadForFiles должен получить изменённые файлы`);
  assert.strictEqual(spy.markChangedCalls.length, 1, `${label}: markChangedConfigurationByFiles должен вызваться ровно один раз`);
  assert.strictEqual(spy.refreshCacheForFilesCalls.length, 1, `${label}: refreshCacheForFiles должен вызваться ровно один раз`);
  assert.strictEqual(spy.refreshActionsViewCalls, 1, `${label}: refreshActionsView должен вызваться ровно один раз`);
}

function assertGateNotFired(spy: PostMutationSpy, label: string): void {
  assert.strictEqual(spy.suppressCalls.length, 0, `${label}: suppressConfigurationReloadForFiles НЕ должен вызываться`);
  assert.strictEqual(spy.markChangedCalls.length, 0, `${label}: markChangedConfigurationByFiles НЕ должен вызываться`);
  assert.strictEqual(spy.refreshCacheForFilesCalls.length, 0, `${label}: refreshCacheForFiles НЕ должен вызываться`);
  assert.strictEqual(spy.refreshActionsViewCalls, 0, `${label}: refreshActionsView НЕ должен вызываться`);
}

function buildEmptyConfigXml(): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<MetaDataObject>',
    '  <Configuration>',
    '    <Properties>',
    '      <Name>ТестоваяКонфигурация</Name>',
    '      <Synonym/>',
    // <DefaultRoles/> нужен v8vscedit_set_default_roles/add_default_role: без
    // него ConfigurationXmlEditor.updateDefaultRoles возвращает success:false
    // («В Configuration.xml отсутствует блок <DefaultRoles>») ещё до попытки
    // реальной записи ролей.
    '      <DefaultRoles/>',
    '    </Properties>',
    '    <ChildObjects/>',
    '  </Configuration>',
    '</MetaDataObject>',
  ].join('\n');
}

function mkTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

suite('V8McpServer — единый post-mutation гейт на репрезентативных доменах дробления', () => {
  test('домен «метаданные»: v8vscedit_remove_metadata — success:true запускает гейт, success:false — нет', async () => {
    const configRoot = mkTmpDir('v8vscedit-catalog-remove-');
    fs.writeFileSync(path.join(configRoot, 'Configuration.xml'), buildEmptyConfigXml(), 'utf-8');
    const creator = new MetadataXmlCreator();
    assert.strictEqual(creator.addRootObject({ configRoot, kind: 'Catalog', name: 'Контрагенты' }).success, true);
    const catalogXmlPath = path.join(configRoot, 'Catalogs', 'Контрагенты.xml');
    const node = new MetadataNode({ label: 'Контрагенты', nodeKind: 'Catalog', xmlPath: catalogXmlPath, canRemoveMetadata: true }, vscode.TreeItemCollapsibleState.None);

    // success:false — реальный сценарий: узел ссылается на реальный XML и
    // помечен как поддерживающий удаление (canRemoveMetadata:true), но
    // указывает на объект, не зарегистрированный в Configuration.xml и без
    // собственного файла/каталога — removeRootObject.fail без исключения.
    const missingNode = new MetadataNode({
      label: 'НетТакого', nodeKind: 'Catalog', xmlPath: catalogXmlPath, canRemoveMetadata: true,
    }, vscode.TreeItemCollapsibleState.None);
    const spyFail = createSpy();
    const { tools: toolsFail } = registerAllTools(withSpiedGate(spyFail, {
      treeProvider: createNodeResolvingTreeProvider({ objectNodes: [missingNode] }),
    }));
    const removeToolFail = toolsFail.get('v8vscedit_remove_metadata');
    assert.ok(removeToolFail, 'v8vscedit_remove_metadata должен быть зарегистрирован');
    const failResult = await Promise.resolve(removeToolFail.handler({ path: 'Справочники.НетТакого' }));
    assert.ok(!isErrorResult(failResult), `удаление несуществующего объекта не должно бросать исключение верхнего уровня: ${extractText(failResult)}`);
    const failParsed = JSON.parse(extractText(failResult)) as { success: boolean };
    assert.strictEqual(failParsed.success, false, 'удаление незарегистрированного объекта должно вернуть success:false');
    assertGateNotFired(spyFail, 'remove_metadata success:false');

    // success:true — реальное удаление существующего, зарегистрированного справочника.
    const spyOk = createSpy();
    const { tools: toolsOk } = registerAllTools(withSpiedGate(spyOk, {
      treeProvider: createNodeResolvingTreeProvider({ objectNodes: [node] }),
    }));
    const removeToolOk = toolsOk.get('v8vscedit_remove_metadata');
    assert.ok(removeToolOk);
    const okResult = await Promise.resolve(removeToolOk.handler({ path: 'Справочники.Контрагенты' }));
    assert.ok(!isErrorResult(okResult), `удаление существующего справочника не должно падать: ${extractText(okResult)}`);
    const okParsed = JSON.parse(extractText(okResult)) as { success: boolean; changedFiles: string[] };
    assert.strictEqual(okParsed.success, true, `удаление должно быть успешным: ${extractText(okResult)}`);
    assert.ok(okParsed.changedFiles.length > 0, 'успешное удаление должно вернуть непустой changedFiles');
    assertGateFired(spyOk, okParsed.changedFiles, 'remove_metadata success:true');

    fs.rmSync(configRoot, { recursive: true, force: true });
  });

  test('домен «метаданные»: v8vscedit_set_type — success:true запускает гейт, success:false — нет', async () => {
    const root = mkTmpDir('v8vscedit-catalog-settype-');
    const xmlPath = path.join(root, 'Параметр.xml');
    fs.writeFileSync(xmlPath, [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<MetaDataObject>',
      '  <SessionParameter>',
      '    <Properties>',
      '      <Name>Параметр</Name>',
      '      <Type>',
      '        <v8:Type>xs:string</v8:Type>',
      '      </Type>',
      '    </Properties>',
      '  </SessionParameter>',
      '</MetaDataObject>',
    ].join('\n'), 'utf-8');
    const node = new MetadataNode({ label: 'Параметр', nodeKind: 'SessionParameter', xmlPath }, vscode.TreeItemCollapsibleState.None);

    // success:true: реальная смена типа существующего SessionParameter (первый вызов —
    // формат XML-блока меняется с исходного «плоского» на нормализованный, поэтому
    // hasRealChange фиксирует реальное отличие).
    const spyOk = createSpy();
    const { tools: toolsOk } = registerAllTools(withSpiedGate(spyOk, {
      treeProvider: createNodeResolvingTreeProvider({ objectNodes: [node] }),
    }));
    const setTypeOk = toolsOk.get('v8vscedit_set_type');
    assert.ok(setTypeOk, 'v8vscedit_set_type должен быть зарегистрирован');
    const okResult = await Promise.resolve(setTypeOk.handler({
      path: 'ПараметрыСеанса.Параметр',
      value: 'Число',
      length: 10,
      precision: 2,
    }));
    assert.ok(!isErrorResult(okResult), `смена типа существующего параметра не должна падать: ${extractText(okResult)}`);
    const okParsed = JSON.parse(extractText(okResult)) as { success: boolean; changedFiles: string[] };
    assert.strictEqual(okParsed.success, true, `смена типа должна быть успешной: ${extractText(okResult)}`);
    assertGateFired(spyOk, okParsed.changedFiles, 'set_type success:true');

    // success:false: повторный вызов с ТЕМИ ЖЕ параметрами на уже нормализованном
    // XML — блок при замене собирается побайтово идентичным (regex-замена уже
    // отформатированного <Type>...</Type> на такой же), hasRealChange возвращает
    // false, а modifyObjectType транслирует это в success:false без исключения
    // (ConfigurationXmlEditor.modifyObjectType: `changed ? this.ok(...) : this.fail(...)`).
    const spyFail = createSpy();
    const { tools: toolsFail } = registerAllTools(withSpiedGate(spyFail, {
      treeProvider: createNodeResolvingTreeProvider({ objectNodes: [node] }),
    }));
    const setTypeFail = toolsFail.get('v8vscedit_set_type');
    assert.ok(setTypeFail);
    const failResult = await Promise.resolve(setTypeFail.handler({
      path: 'ПараметрыСеанса.Параметр',
      value: 'Число',
      length: 10,
      precision: 2,
    }));
    assert.ok(!isErrorResult(failResult), `повторная установка уже действующего типа не должна приводить к исключению верхнего уровня: ${extractText(failResult)}`);
    const failParsed = JSON.parse(extractText(failResult)) as { success: boolean };
    assert.strictEqual(failParsed.success, false, 'повторная установка уже действующего типа не меняет XML и должна вернуть success:false');
    assertGateNotFired(spyFail, 'set_type success:false');

    fs.rmSync(root, { recursive: true, force: true });
  });

  test('домен «метаданные»: v8vscedit_rename_metadata — success:true запускает гейт, success:false — нет', async () => {
    const configRoot = mkTmpDir('v8vscedit-catalog-rename-');
    fs.writeFileSync(path.join(configRoot, 'Configuration.xml'), buildEmptyConfigXml(), 'utf-8');
    const creator = new MetadataXmlCreator();
    assert.strictEqual(creator.addRootObject({ configRoot, kind: 'Catalog', name: 'Партнёры' }).success, true);
    const xmlPath = path.join(configRoot, 'Catalogs', 'Партнёры.xml');
    const node = new MetadataNode({ label: 'Партнёры', nodeKind: 'Catalog', xmlPath }, vscode.TreeItemCollapsibleState.None);

    // success:false: невалидное новое имя (пробел недопустим в имени объекта 1С) —
    // validateRenameMetadataObject возвращает success:false без исключения.
    const spyFail = createSpy();
    const { tools: toolsFail } = registerAllTools(withSpiedGate(spyFail, {
      treeProvider: createNodeResolvingTreeProvider({ objectNodes: [node] }),
    }));
    const renameFail = toolsFail.get('v8vscedit_rename_metadata');
    assert.ok(renameFail, 'v8vscedit_rename_metadata должен быть зарегистрирован');
    const failResult = await Promise.resolve(renameFail.handler({ path: 'Справочники.Партнёры', newName: 'Невалидное Имя' }));
    assert.ok(!isErrorResult(failResult), `невалидное имя не должно приводить к исключению верхнего уровня: ${extractText(failResult)}`);
    const failParsed = JSON.parse(extractText(failResult)) as { success: boolean };
    assert.strictEqual(failParsed.success, false, 'переименование в невалидное имя должно вернуть success:false');
    assertGateNotFired(spyFail, 'rename_metadata success:false');

    // success:true: валидное новое имя реального справочника.
    const spyOk = createSpy();
    const { tools: toolsOk } = registerAllTools(withSpiedGate(spyOk, {
      treeProvider: createNodeResolvingTreeProvider({ objectNodes: [node] }),
    }));
    const renameOk = toolsOk.get('v8vscedit_rename_metadata');
    assert.ok(renameOk);
    const okResult = await Promise.resolve(renameOk.handler({ path: 'Справочники.Партнёры', newName: 'Клиенты' }));
    assert.ok(!isErrorResult(okResult), `валидное переименование не должно падать: ${extractText(okResult)}`);
    const okParsed = JSON.parse(extractText(okResult)) as { success: boolean; changedFiles: string[] };
    assert.strictEqual(okParsed.success, true, `переименование должно быть успешным: ${extractText(okResult)}`);
    assert.ok(okParsed.changedFiles.length > 0, 'успешное переименование должно вернуть непустой changedFiles');
    assertGateFired(spyOk, okParsed.changedFiles, 'rename_metadata success:true');

    fs.rmSync(configRoot, { recursive: true, force: true });
  });

  test('домен «роли»: v8vscedit_set_default_roles — успешное изменение запускает гейт, ошибка конфигурации — нет', async () => {
    const configRoot = mkTmpDir('v8vscedit-catalog-roles-');
    const configXmlPath = path.join(configRoot, 'Configuration.xml');
    fs.writeFileSync(configXmlPath, buildEmptyConfigXml(), 'utf-8');
    const configNode = new MetadataNode({ label: 'Конфигурация', nodeKind: 'configuration', xmlPath: configXmlPath }, vscode.TreeItemCollapsibleState.None);

    // success:false без исключения: конфигурация указывает на несуществующий
    // Configuration.xml — ConfigurationXmlEditor.updateDefaultRoles ловит это через
    // fs.existsSync и возвращает this.fail(...) (success:false), а не throw —
    // RoleDefaultRolesService и tool этот неуспех не эскалируют в isError.
    const missingXmlPath = path.join(configRoot, 'НетТакого', 'Configuration.xml');
    const missingConfigNode = new MetadataNode({ label: 'Конфигурация', nodeKind: 'configuration', xmlPath: missingXmlPath }, vscode.TreeItemCollapsibleState.None);
    const spyFail = createSpy();
    const { tools: toolsFail } = registerAllTools(withSpiedGate(spyFail, {
      treeProvider: createNodeResolvingTreeProvider({ configurationNode: missingConfigNode }),
    }));
    const setRolesFail = toolsFail.get('v8vscedit_set_default_roles');
    assert.ok(setRolesFail, 'v8vscedit_set_default_roles должен быть зарегистрирован');
    const failResult = await Promise.resolve(setRolesFail.handler({ path: 'Конфигурация', roles: ['БазовыеПрава'] }));
    assert.ok(!isErrorResult(failResult), `отсутствие Configuration.xml не должно приводить к исключению верхнего уровня: ${extractText(failResult)}`);
    const failParsed = JSON.parse(extractText(failResult)) as { success: boolean };
    assert.strictEqual(failParsed.success, false, 'запись в несуществующий Configuration.xml должна вернуть success:false');
    assertGateNotFired(spyFail, 'set_default_roles failure');

    // Успех: реальная запись DefaultRoles в существующий Configuration.xml.
    const spyOk = createSpy();
    const { tools: toolsOk } = registerAllTools(withSpiedGate(spyOk, {
      treeProvider: createNodeResolvingTreeProvider({ configurationNode: configNode }),
    }));
    const setRolesOk = toolsOk.get('v8vscedit_set_default_roles');
    assert.ok(setRolesOk);
    const okResult = await Promise.resolve(setRolesOk.handler({ path: 'Конфигурация', roles: ['БазовыеПрава'] }));
    assert.ok(!isErrorResult(okResult), `запись DefaultRoles не должна падать: ${extractText(okResult)}`);
    const okParsed = JSON.parse(extractText(okResult)) as { success: boolean; changedFiles: string[] };
    assert.strictEqual(okParsed.success, true, `запись DefaultRoles должна быть успешной: ${extractText(okResult)}`);
    assert.ok(okParsed.changedFiles.length > 0, 'успешная запись DefaultRoles должна вернуть непустой changedFiles');
    assertGateFired(spyOk, okParsed.changedFiles, 'set_default_roles success');

    fs.rmSync(configRoot, { recursive: true, force: true });
  });

  test('домен «формы»: v8vscedit_add_form — успех запускает гейт (happy-path через реальный FormToolsService)', async () => {
    const configRoot = mkTmpDir('v8vscedit-catalog-addform-');
    fs.writeFileSync(path.join(configRoot, 'Configuration.xml'), buildEmptyConfigXml(), 'utf-8');
    const creator = new MetadataXmlCreator();
    assert.strictEqual(creator.addRootObject({ configRoot, kind: 'Catalog', name: 'Контрагенты' }).success, true);
    const xmlPath = path.join(configRoot, 'Catalogs', 'Контрагенты.xml');
    const node = new MetadataNode({ label: 'Контрагенты', nodeKind: 'Catalog', xmlPath }, vscode.TreeItemCollapsibleState.None);

    const spy = createSpy();
    const { tools } = registerAllTools(withSpiedGate(spy, {
      treeProvider: createNodeResolvingTreeProvider({ objectNodes: [node] }),
    }));
    const addForm = tools.get('v8vscedit_add_form');
    assert.ok(addForm, 'v8vscedit_add_form должен быть зарегистрирован');
    const result = await Promise.resolve(addForm.handler({ parentPath: 'Справочники.Контрагенты', name: 'ФормаСписка' }));
    assert.ok(!isErrorResult(result), `добавление формы не должно падать: ${extractText(result)}`);
    const parsed = JSON.parse(extractText(result)) as { changedFiles: string[] };
    assert.ok(parsed.changedFiles.length > 0, 'успешное добавление формы должно вернуть непустой changedFiles');
    assertGateFired(spy, parsed.changedFiles, 'add_form success');
    assert.ok(fs.existsSync(path.join(configRoot, 'Catalogs', 'Контрагенты', 'Forms', 'ФормаСписка', 'Ext', 'Form.xml')),
      'реальный Form.xml должен быть создан на диске (Forms/<Имя>/Ext/Form.xml)');

    fs.rmSync(configRoot, { recursive: true, force: true });
  });

  test('домен «формы»: v8vscedit_edit_form — успех запускает гейт (happy-path через реальный FormEditService)', async () => {
    const configRoot = mkTmpDir('v8vscedit-catalog-editform-');
    fs.writeFileSync(path.join(configRoot, 'Configuration.xml'), buildEmptyConfigXml(), 'utf-8');
    const creator = new MetadataXmlCreator();
    assert.strictEqual(creator.addRootObject({ configRoot, kind: 'Catalog', name: 'Контрагенты' }).success, true);
    const catalogXmlPath = path.join(configRoot, 'Catalogs', 'Контрагенты.xml');
    const catalogNode = new MetadataNode({ label: 'Контрагенты', nodeKind: 'Catalog', xmlPath: catalogXmlPath }, vscode.TreeItemCollapsibleState.None);

    const formToolsService = new FormToolsService();
    assert.ok(
      formToolsService.addForm({ objectPath: catalogXmlPath, formName: 'ФормаЭлемента' }).changedFiles.length > 0,
      'подготовительное создание формы должно пройти успешно (непустой changedFiles)',
    );
    const formXmlPath = path.join(configRoot, 'Catalogs', 'Контрагенты', 'Forms', 'ФормаЭлемента', 'Ext', 'Form.xml');
    const formNode = new MetadataNode({
      label: 'ФормаЭлемента',
      nodeKind: 'Form',
      xmlPath: formXmlPath,
      metaContext: { rootMetaKind: 'Catalog', ownerObjectXmlPath: catalogXmlPath },
    }, vscode.TreeItemCollapsibleState.None);

    // FormEditService.edit — известная особенность (не предмет этой задачи):
    // возвращает `changedFiles: [formPath]` безусловно, даже когда definition
    // пуст и XML не изменился ни на байт (нет проверки на реальное изменение,
    // в отличие от modifyObjectType/validateRenameMetadataObject). Поэтому для
    // этого домена показываем именно happy-path: реальная команда добавляет
    // клиентское событие формы — гейт обязан сработать на непустом changedFiles.
    const spy = createSpy();
    const { tools } = registerAllTools(withSpiedGate(spy, {
      treeProvider: createNodeResolvingTreeProvider({
        objectNodes: [catalogNode],
        formsByOwner: [{ ownerNode: catalogNode, formNode }],
      }),
    }));
    const editForm = tools.get('v8vscedit_edit_form');
    assert.ok(editForm, 'v8vscedit_edit_form должен быть зарегистрирован');
    const result = await Promise.resolve(editForm.handler({
      path: 'Справочники.Контрагенты.Форма.ФормаЭлемента',
      definition: { formEvents: [{ name: 'ПередЗакрытием', handler: 'ПередЗакрытием' }] },
    }));
    assert.ok(!isErrorResult(result), `добавление события формы не должно падать: ${extractText(result)}`);
    const parsed = JSON.parse(extractText(result)) as { changedFiles: string[] };
    assert.ok(parsed.changedFiles.length > 0, 'успешное редактирование формы должно вернуть непустой changedFiles');
    assertGateFired(spy, parsed.changedFiles, 'edit_form success');

    fs.rmSync(configRoot, { recursive: true, force: true });
  });

  test('домен «подсистемы»: v8vscedit_edit_subsystem_content — успех запускает гейт, неизвестная ссылка — нет', async () => {
    const configRoot = mkTmpDir('v8vscedit-catalog-subsystem-');
    fs.writeFileSync(path.join(configRoot, 'Configuration.xml'), buildEmptyConfigXml(), 'utf-8');
    const creator = new MetadataXmlCreator();
    assert.strictEqual(creator.addRootObject({ configRoot, kind: 'Catalog', name: 'Товары' }).success, true);
    assert.strictEqual(creator.addRootObject({ configRoot, kind: 'Subsystem', name: 'Продажи' }).success, true);
    const subsystemXmlPath = path.join(configRoot, 'Subsystems', 'Продажи.xml');
    const subsystemNode = new MetadataNode({ label: 'Продажи', nodeKind: 'Subsystem', xmlPath: subsystemXmlPath }, vscode.TreeItemCollapsibleState.None);
    const catalogXmlPath = path.join(configRoot, 'Catalogs', 'Товары.xml');
    const catalogNode = new MetadataNode({ label: 'Товары', nodeKind: 'Catalog', xmlPath: catalogXmlPath }, vscode.TreeItemCollapsibleState.None);

    // Неизвестная ссылка: валидный канонический синтаксис («Справочники.НетТакого»),
    // но такого справочника нет ни в дереве, ни в ChildObjects конфигурации —
    // paths.resolveNode бросает исключение (перехват в wrap), гейт не должен сработать.
    const spyFail = createSpy();
    const { tools: toolsFail } = registerAllTools(withSpiedGate(spyFail, {
      treeProvider: createNodeResolvingTreeProvider({ objectNodes: [subsystemNode, catalogNode] }),
    }));
    const editContentFail = toolsFail.get('v8vscedit_edit_subsystem_content');
    assert.ok(editContentFail, 'v8vscedit_edit_subsystem_content должен быть зарегистрирован');
    const failResult = await Promise.resolve(editContentFail.handler({ path: 'Подсистема.Продажи', add: ['Справочники.НетТакого'] }));
    assert.strictEqual(isErrorResult(failResult), true, 'добавление неизвестной ссылки должно вернуть ошибку tool-а');
    assertGateNotFired(spyFail, 'edit_subsystem_content failure');

    // Успех: добавляем реально существующий в ChildObjects справочник по каноническому пути.
    const spyOk = createSpy();
    const { tools: toolsOk } = registerAllTools(withSpiedGate(spyOk, {
      treeProvider: createNodeResolvingTreeProvider({ objectNodes: [subsystemNode, catalogNode] }),
    }));
    const editContentOk = toolsOk.get('v8vscedit_edit_subsystem_content');
    assert.ok(editContentOk);
    const okResult = await Promise.resolve(editContentOk.handler({ path: 'Подсистема.Продажи', add: ['Справочники.Товары'] }));
    assert.ok(!isErrorResult(okResult), `добавление известной ссылки не должно падать: ${extractText(okResult)}`);
    const okParsed = JSON.parse(extractText(okResult)) as { changedFiles: string[] };
    assert.ok(okParsed.changedFiles.length > 0, 'успешное изменение состава подсистемы должно вернуть непустой changedFiles');
    assertGateFired(spyOk, okParsed.changedFiles, 'edit_subsystem_content success');

    fs.rmSync(configRoot, { recursive: true, force: true });
  });

  test('домен «внешние объекты»: v8vscedit_create_epf — успех запускает гейт (happy-path)', async () => {
    const outputDir = mkTmpDir('v8vscedit-catalog-epf-');
    const spy = createSpy();
    const { tools } = registerAllTools(withSpiedGate(spy));
    const createEpf = tools.get('v8vscedit_create_epf');
    assert.ok(createEpf, 'v8vscedit_create_epf должен быть зарегистрирован');
    const result = await Promise.resolve(createEpf.handler({ name: 'ТестоваяОбработка', outputDir }));
    assert.ok(!isErrorResult(result), `создание EPF не должно падать: ${extractText(result)}`);
    const parsed = JSON.parse(extractText(result)) as { changedFiles: string[] };
    assert.ok(parsed.changedFiles.length > 0, 'успешное создание EPF должно вернуть непустой changedFiles');
    assertGateFired(spy, parsed.changedFiles, 'create_epf success');

    fs.rmSync(outputDir, { recursive: true, force: true });
  });

  test('домен «жизненный цикл»: v8vscedit_create_configuration — успех запускает гейт, конфликт с существующей — нет', async () => {
    const outputDir = mkTmpDir('v8vscedit-catalog-createcfg-');
    const spyOk = createSpy();
    const { tools: toolsOk } = registerAllTools(withSpiedGate(spyOk));
    const createCfgOk = toolsOk.get('v8vscedit_create_configuration');
    assert.ok(createCfgOk, 'v8vscedit_create_configuration должен быть зарегистрирован');
    const okResult = await Promise.resolve(createCfgOk.handler({ name: 'ТестоваяКонфигурация', outputDir }));
    assert.ok(!isErrorResult(okResult), `создание конфигурации не должно падать: ${extractText(okResult)}`);
    const okParsed = JSON.parse(extractText(okResult)) as { changedFiles: string[] };
    assert.ok(okParsed.changedFiles.length > 0, 'успешное создание конфигурации должно вернуть непустой changedFiles');
    assertGateFired(spyOk, okParsed.changedFiles, 'create_configuration success');

    // Повторное создание в уже занятом каталоге — ensureNoConfiguration бросает
    // исключение (перехват в wrap), гейт не должен сработать.
    const spyFail = createSpy();
    const { tools: toolsFail } = registerAllTools(withSpiedGate(spyFail));
    const createCfgFail = toolsFail.get('v8vscedit_create_configuration');
    assert.ok(createCfgFail);
    const failResult = await Promise.resolve(createCfgFail.handler({ name: 'ТестоваяКонфигурация2', outputDir }));
    assert.strictEqual(isErrorResult(failResult), true, 'повторное создание конфигурации в занятом каталоге должно вернуть ошибку');
    assertGateNotFired(spyFail, 'create_configuration failure');

    fs.rmSync(outputDir, { recursive: true, force: true });
  });
});

/**
 * Стаб `MetadataTreeProvider`, воспроизводящий реальную схему обхода
 * `McpMetadataPathService.buildIndex` (см. `collectRoot`/`collectRootChildren`/
 * `collectRootGroup`/`collectObjectChildren` в McpMetadataPathService.ts):
 * канонический путь строится сервисом из `META_TYPES[nodeKind].pathSegment` и
 * `textLabel` узлов, а не из произвольной группировки в дереве — поэтому
 * названия узлов-групп здесь чисто технические и на резолвинг не влияют.
 *
 * `objectNodes` — корневые объекты метаданных (справочники, подсистемы,
 * параметры сеанса и т.п.), добавляются прямо в единственную группу-обёртку.
 * `formsByOwnerCanonical` — формы конкретных объектов: сервис ищет их только
 * через дочернюю группу с `addMetadataTarget.kind==='child'` и
 * `childTag==='Form'` внутри childrenLoader объекта-владельца
 * (`collectObjectChildren`), поэтому форма не долетит до индекса, если
 * её просто добавить как «ещё один корневой объект».
 */
function createNodeResolvingTreeProvider(options: {
  readonly objectNodes?: readonly MetadataNode[];
  readonly formsByOwner?: readonly { readonly ownerNode: MetadataNode; readonly formNode: MetadataNode }[];
  readonly configurationNode?: MetadataNode;
}): MetadataTreeProvider {
  const configRoot = '/tmp/v8vscedit-fixture';
  const objectNodes = options.objectNodes ?? [];
  const formsByOwnerNode = new Map<MetadataNode, MetadataNode[]>();
  for (const { ownerNode, formNode } of options.formsByOwner ?? []) {
    const list = formsByOwnerNode.get(ownerNode) ?? [];
    list.push(formNode);
    formsByOwnerNode.set(ownerNode, list);
  }
  for (const [ownerNode, forms] of formsByOwnerNode) {
    const ownerXmlPath = ownerNode.xmlPath;
    assert.ok(ownerXmlPath, 'у объекта-владельца формы должен быть xmlPath');
    const formGroupWrapper = new MetadataNode(
      {
        label: 'Формы',
        nodeKind: 'group-type',
        addMetadataTarget: { kind: 'child', ownerObjectXmlPath: ownerXmlPath, childTag: 'Form' },
        childrenLoader: () => forms,
      },
      vscode.TreeItemCollapsibleState.Collapsed,
    );
    // childrenLoader объекта переопределяется, чтобы содержать группу форм —
    // безопасно для теста, т.к. в объектах-фикстурах он изначально не задан.
    Object.assign(ownerNode.model, { childrenLoader: () => [formGroupWrapper] });
  }

  const objectsGroup = new MetadataNode(
    { label: 'Объекты', nodeKind: 'group-type', childrenLoader: () => [...objectNodes] },
    vscode.TreeItemCollapsibleState.Collapsed,
  );
  const configurationRoot = options.configurationNode ?? new MetadataNode(
    {
      label: 'Конфигурация',
      nodeKind: 'configuration',
      xmlPath: path.join(configRoot, 'Configuration.xml'),
      childrenLoader: () => [objectsGroup],
    },
    vscode.TreeItemCollapsibleState.Collapsed,
  );
  return {
    getAutomationRoots: () => [configurationRoot],
    getEntries: () => [{ rootPath: configRoot, kind: 'cf' as const }],
    refreshCacheForFiles: () => false,
    refresh: () => undefined,
  } as unknown as MetadataTreeProvider;
}
