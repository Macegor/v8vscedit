import * as http from 'http';
import { randomUUID } from 'crypto';
import * as vscode from 'vscode';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import * as z from 'zod/v4';
import { META_TYPES } from '../../domain/MetaTypes';
import { CHILD_TAG_CONFIG, type ChildTag } from '../../domain/ChildTag';
import { getObjectLocationFromXml } from '../../infra/fs/MetaPathResolver';
import type { ConfigurationXmlEditor } from '../../infra/xml';
import { MetadataMutationService } from '../commands/metadata/MetadataMutationService';
import type { CommandServices } from '../commands/_shared';
import type { MetadataNode } from '../tree/TreeNode';
import { McpMetadataPathService } from './McpMetadataPathService';
import { McpPropertyService } from './McpPropertyService';

export interface V8McpServerOptions {
  readonly host: string;
  readonly port: number;
}

export interface V8McpServerStatus {
  readonly running: boolean;
  readonly endpoint?: string;
}

type McpCommandServices = Omit<CommandServices, 'aiMcpViewProvider'>;

interface McpSession {
  readonly server: McpServer;
  readonly transport: StreamableHTTPServerTransport;
}

const TEMPLATE_TYPES = [
  'SpreadsheetDocument',
  'DataCompositionSchema',
  'TextDocument',
  'HTMLDocument',
  'BinaryData',
  'DataCompositionAppearanceTemplate',
  'GraphicalSchema',
  'AddIn',
] as const;

type TemplateTypeInput = typeof TEMPLATE_TYPES[number];

const ROLE_OBJECT_SCHEMA = z.union([
  z.string(),
  z.object({
    name: z.string().optional(),
    preset: z.string().optional(),
    rights: z.union([z.array(z.string()), z.record(z.string(), z.boolean())]).optional(),
    rls: z.record(z.string(), z.string()).optional(),
  }),
]);

const COMMAND_INTERFACE_OPERATION_SCHEMA = z.discriminatedUnion('operation', [
  z.object({
    operation: z.enum(['hide', 'show']),
    value: z.union([z.string(), z.array(z.string())]),
  }),
  z.object({
    operation: z.literal('place'),
    value: z.object({ command: z.string(), group: z.string() }),
  }),
  z.object({
    operation: z.literal('order'),
    value: z.object({ group: z.string(), commands: z.array(z.string()) }),
  }),
  z.object({
    operation: z.literal('subsystem-order'),
    value: z.array(z.string()),
  }),
  z.object({
    operation: z.literal('group-order'),
    value: z.array(z.string()),
  }),
]);

const ALLOWED_COMMANDS = new Set([
  'v8vscedit.refresh',
  'v8vscedit.importConfigurations',
  'v8vscedit.updateChangedConfigurations',
]);

/**
 * MCP-сервер расширения. Снаружи виден только localhost HTTP endpoint,
 * а все операции проходят через общий реестр инструментов и существующие
 * сервисы расширения.
 */
export class V8McpServer implements vscode.Disposable {
  private readonly sessions = new Map<string, McpSession>();
  private httpServer: http.Server | undefined;
  private endpoint: string | undefined;

  constructor(
    private readonly services: McpCommandServices,
    private readonly xmlEditor: ConfigurationXmlEditor
  ) {}

  getStatus(): V8McpServerStatus {
    return this.endpoint
      ? { running: true, endpoint: this.endpoint }
      : { running: false };
  }

  async start(options: V8McpServerOptions): Promise<void> {
    if (this.endpoint) {
      return;
    }

    const httpServer = http.createServer((req, res) => {
      void this.handleRequest(req, res);
    });
    const port = await this.listenOnAvailablePort(httpServer, options.host, options.port);

    this.httpServer = httpServer;
    this.endpoint = `http://${formatHostForUrl(options.host)}:${String(port)}/mcp`;
    this.services.outputChannel.appendLine(`[mcp] Сервер запущен: ${this.endpoint}`);
  }

  async stop(): Promise<void> {
    const httpServer = this.httpServer;
    this.httpServer = undefined;
    this.endpoint = undefined;
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(sessions.map(async (session) => {
      await session.transport.close();
      await session.server.close();
    }));
  }

  dispose(): void {
    void this.stop();
  }

  private registerTools(server: McpServer): void {
    const paths = new McpMetadataPathService(this.services.treeProvider);
    const properties = new McpPropertyService(this.xmlEditor, this.services.subsystemXmlService);
    const mutations = new MetadataMutationService(this.services);

    server.registerTool(
      'v8vscedit_list_configurations',
      {
        title: 'Список конфигураций 1С',
        description: 'Возвращает найденные корни CF/CFE после полной загрузки дерева метаданных.',
        inputSchema: z.object({}),
      },
      () => this.ok(this.services.treeProvider.getEntries())
    );

    server.registerTool(
      'v8vscedit_list_metadata_types',
      {
        title: 'Список типов метаданных',
        description: 'Возвращает декларативный реестр META_TYPES: типы, папки, дочерние элементы и слоты модулей.',
        inputSchema: z.object({}),
      },
      () => this.ok(META_TYPES)
    );

    server.registerTool(
      'v8vscedit_workspace_overview',
      {
        title: 'Обзор конфигураций и расширений',
        description: 'Возвращает основную конфигурацию, расширения, корневые пути и счётчики объектов без обхода дерева по nodeId.',
        inputSchema: z.object({}),
      },
      () => this.ok(paths.getWorkspaceOverview())
    );

    server.registerTool(
      'v8vscedit_search_metadata',
      {
        title: 'Поиск метаданных по пути',
        description: 'Ищет по части строки в предметных путях метаданных выбранной конфигурации: например "Польз" найдёт Справочники.Пользователи.',
        inputSchema: z.object({
          query: z.string(),
          configuration: z.string(),
          kind: z.string().optional(),
          limit: z.number().int().min(1).max(1000).optional(),
        }),
      },
      (args) => this.ok(paths.search(args))
    );

    server.registerTool(
      'v8vscedit_list_metadata',
      {
        title: 'Список метаданных по группе или объекту',
        description: 'Возвращает объекты группы или дочерние элементы по предметному пути без nodeId: список справочников, форм, реквизитов, измерений, ресурсов и т.п.',
        inputSchema: z.object({
          configuration: z.string().optional(),
          parentPath: z.string().optional(),
          kind: z.string().optional(),
          group: z.string().optional(),
          query: z.string().optional(),
          limit: z.number().int().min(1).max(1000).optional(),
        }),
      },
      (args) => this.ok(paths.list(args))
    );

    server.registerTool(
      'v8vscedit_configuration_info',
      {
        title: 'Информация о конфигурации',
        description: 'Структурированный аналог cf-info/cfe-info: свойства, счётчики ChildObjects и текстовый отчёт.',
        inputSchema: z.object({
          configPath: z.string(),
          mode: z.enum(['overview', 'brief', 'full']).optional(),
          limit: z.number().int().min(1).max(1000).optional(),
          offset: z.number().int().min(0).optional(),
        }),
      },
      (args) => this.wrap(() => this.services.configurationInfoService.read(args))
    );

    server.registerTool(
      'v8vscedit_validate_configuration',
      {
        title: 'Валидировать конфигурацию',
        description: 'Проверяет Configuration.xml, ChildObjects, DefaultLanguage и базовые enum-значения без запуска Python.',
        inputSchema: z.object({
          configPath: z.string(),
          detailed: z.boolean().optional(),
          maxErrors: z.number().int().min(1).max(500).optional(),
        }),
      },
      (args) => this.wrap(() => this.services.configurationValidationService.validate(args))
    );

    server.registerTool(
      'v8vscedit_metadata_info',
      {
        title: 'Информация об объекте метаданных',
        description: 'Структурированный аналог meta-info: реквизиты, табличные части, формы, команды, макеты и текстовый отчёт.',
        inputSchema: z.object({
          objectPath: z.string(),
          mode: z.enum(['overview', 'brief', 'full']).optional(),
          name: z.string().optional(),
          limit: z.number().int().min(1).max(1000).optional(),
          offset: z.number().int().min(0).optional(),
        }),
      },
      (args) => this.wrap(() => this.services.metadataInfoService.read(args))
    );

    server.registerTool(
      'v8vscedit_validate_metadata',
      {
        title: 'Валидировать объект метаданных',
        description: 'Проверяет XML объекта, тип в META_TYPES, имя, UUID, допустимые дочерние элементы и связанные файлы.',
        inputSchema: z.object({
          objectPath: z.string(),
          detailed: z.boolean().optional(),
          maxErrors: z.number().int().min(1).max(500).optional(),
        }),
      },
      (args) => this.wrap(() => this.services.metadataValidationService.validate(args))
    );

    server.registerTool(
      'v8vscedit_subsystem_info',
      {
        title: 'Информация о подсистеме',
        description: 'Структурированный аналог subsystem-info: свойства, состав, дерево дочерних подсистем и CommandInterface.xml.',
        inputSchema: z.object({
          subsystemPath: z.string(),
          mode: z.enum(['overview', 'content', 'ci', 'tree', 'full']).optional(),
          name: z.string().optional(),
          limit: z.number().int().min(1).max(1000).optional(),
          offset: z.number().int().min(0).optional(),
        }),
      },
      (args) => this.wrap(() => this.services.subsystemToolsService.info(args))
    );

    server.registerTool(
      'v8vscedit_validate_subsystem',
      {
        title: 'Валидировать подсистему',
        description: 'Проверяет XML подсистемы, свойства, Content, ChildObjects, дочерние файлы и CommandInterface.xml.',
        inputSchema: z.object({
          subsystemPath: z.string(),
          detailed: z.boolean().optional(),
          maxErrors: z.number().int().min(1).max(500).optional(),
        }),
      },
      (args) => this.wrap(() => this.services.subsystemToolsService.validate(args))
    );

    server.registerTool(
      'v8vscedit_mxl_info',
      {
        title: 'Информация о MXL-макете',
        description: 'Структурированный аналог mxl-info: области, параметры, текст, объединения и статистика табличного документа.',
        inputSchema: z.object({
          templatePath: z.string(),
          withText: z.boolean().optional(),
          maxParams: z.number().int().min(1).max(100).optional(),
          limit: z.number().int().min(1).max(1000).optional(),
          offset: z.number().int().min(0).optional(),
        }),
      },
      (args) => this.wrap(() => this.services.mxlTemplateService.info(args))
    );

    server.registerTool(
      'v8vscedit_validate_mxl',
      {
        title: 'Валидировать MXL-макет',
        description: 'Проверяет Template.xml табличного документа: строки, колонки, палитры, области и объединения.',
        inputSchema: z.object({
          templatePath: z.string(),
          detailed: z.boolean().optional(),
          maxErrors: z.number().int().min(1).max(500).optional(),
        }),
      },
      (args) => this.wrap(() => this.services.mxlTemplateService.validate(args))
    );

    server.registerTool(
      'v8vscedit_compile_mxl',
      {
        title: 'Скомпилировать MXL-макет',
        description: 'Создаёт или перезаписывает содержимое существующего MXL-макета Template.xml из JSON DSL. Не регистрирует новый макет в объекте; для нового макета сначала используй v8vscedit_add_metadata_by_path.',
        inputSchema: z.object({
          outputPath: z.string(),
          definition: z.any(),
        }),
        annotations: {
          destructiveHint: true,
        },
      },
      (args) => this.wrap(() => {
        const result = this.services.mxlTemplateService.compile(args);
        this.afterMutation([...result.changedFiles]);
        return result;
      })
    );

    server.registerTool(
      'v8vscedit_decompile_mxl',
      {
        title: 'Декомпилировать MXL-макет',
        description: 'Возвращает редактируемый JSON DSL по существующему Template.xml табличного документа.',
        inputSchema: z.object({
          templatePath: z.string(),
        }),
      },
      (args) => this.wrap(() => this.services.mxlTemplateService.decompile(args))
    );

    server.registerTool(
      'v8vscedit_skd_info',
      {
        title: 'Информация о СКД',
        description: 'Структурированный аналог skd-info: наборы, запросы, поля, итоги, параметры и варианты.',
        inputSchema: z.object({
          templatePath: z.string(),
          mode: z.enum(['overview', 'query', 'fields', 'calculated', 'resources', 'params', 'variant', 'full']).optional(),
          name: z.string().optional(),
          limit: z.number().int().min(1).max(1000).optional(),
          offset: z.number().int().min(0).optional(),
        }),
      },
      (args) => this.wrap(() => this.services.dataCompositionSchemaService.info(args))
    );

    server.registerTool(
      'v8vscedit_validate_skd',
      {
        title: 'Валидировать СКД',
        description: 'Проверяет Template.xml схемы компоновки данных: XML, корень, дубли наборов, полей, параметров и вариантов.',
        inputSchema: z.object({
          templatePath: z.string(),
          detailed: z.boolean().optional(),
          maxErrors: z.number().int().min(1).max(500).optional(),
        }),
      },
      (args) => this.wrap(() => this.services.dataCompositionSchemaService.validate(args))
    );

    server.registerTool(
      'v8vscedit_compile_skd',
      {
        title: 'Скомпилировать СКД',
        description: 'Создаёт или перезаписывает содержимое существующей СКД Template.xml из JSON DSL. Не регистрирует новый макет в объекте; для новой СКД сначала используй v8vscedit_add_metadata_by_path с templateType=Схема компоновки данных.',
        inputSchema: z.object({
          outputPath: z.string(),
          definition: z.any(),
        }),
        annotations: {
          destructiveHint: true,
        },
      },
      (args) => this.wrap(() => {
        const result = this.services.dataCompositionSchemaService.compile(args);
        this.afterMutation([...result.changedFiles]);
        return result;
      })
    );

    server.registerTool(
      'v8vscedit_edit_skd',
      {
        title: 'Изменить СКД',
        description: 'Точечно редактирует Template.xml СКД: поля, итоги, вычисляемые поля, параметры, запрос, выборку, фильтры и варианты.',
        inputSchema: z.object({
          templatePath: z.string(),
          operation: z.enum([
            'add-field',
            'add-total',
            'add-calculated-field',
            'add-parameter',
            'add-filter',
            'add-dataParameter',
            'add-order',
            'add-selection',
            'add-dataSetLink',
            'add-dataSet',
            'add-variant',
            'add-conditionalAppearance',
            'add-drilldown',
            'set-query',
            'patch-query',
            'set-outputParameter',
            'set-structure',
            'modify-field',
            'modify-filter',
            'modify-dataParameter',
            'modify-parameter',
            'rename-parameter',
            'reorder-parameters',
            'clear-selection',
            'clear-order',
            'clear-filter',
            'remove-field',
            'remove-total',
            'remove-calculated-field',
            'remove-parameter',
            'remove-filter',
          ]),
          value: z.string(),
          dataSet: z.string().optional(),
          variant: z.string().optional(),
          noSelection: z.boolean().optional(),
        }),
        annotations: {
          destructiveHint: true,
        },
      },
      (args) => this.wrap(() => {
        const result = this.services.dataCompositionSchemaService.edit(args);
        this.afterMutation([...result.changedFiles]);
        return result;
      })
    );

    server.registerTool(
      'v8vscedit_add_help',
      {
        title: 'Добавить встроенную справку',
        description: 'Создаёт Ext/Help.xml и Ext/Help/<lang>.html для объекта, а в формах добавляет IncludeHelpInContents при отсутствии.',
        inputSchema: z.object({
          objectPath: z.string(),
          lang: z.string().optional(),
          title: z.string().optional(),
        }),
        annotations: {
          destructiveHint: true,
        },
      },
      (args) => this.wrap(() => {
        const result = this.services.externalObjectService.addHelp(args);
        this.afterMutation([...result.changedFiles]);
        return result;
      })
    );

    server.registerTool(
      'v8vscedit_create_epf',
      {
        title: 'Создать внешнюю обработку EPF',
        description: 'Создаёт минимальные XML-исходники внешней обработки: корневой XML, каталог Ext и ObjectModule.bsl.',
        inputSchema: z.object({
          name: z.string(),
          synonym: z.string().optional(),
          outputDir: z.string(),
        }),
        annotations: {
          destructiveHint: true,
        },
      },
      (args) => this.wrap(() => {
        const result = this.services.externalObjectService.createExternalDataProcessor(args);
        this.afterMutation([...result.changedFiles]);
        return result;
      })
    );

    server.registerTool(
      'v8vscedit_create_erf',
      {
        title: 'Создать внешний отчёт ERF',
        description: 'Создаёт минимальные XML-исходники внешнего отчёта; опционально добавляет основную СКД и привязку MainDataCompositionSchema.',
        inputSchema: z.object({
          name: z.string(),
          synonym: z.string().optional(),
          outputDir: z.string(),
          withSkd: z.boolean().optional(),
        }),
        annotations: {
          destructiveHint: true,
        },
      },
      (args) => this.wrap(() => {
        const result = this.services.externalObjectService.createExternalReport(args);
        this.afterMutation([...result.changedFiles]);
        return result;
      })
    );

    server.registerTool(
      'v8vscedit_validate_external_object',
      {
        title: 'Валидировать EPF/ERF XML',
        description: 'Проверяет структуру XML-исходников внешней обработки или отчёта: InternalInfo, Properties, ChildObjects, ссылки и файлы.',
        inputSchema: z.object({
          objectPath: z.string(),
          detailed: z.boolean().optional(),
          maxErrors: z.number().int().min(1).max(500).optional(),
        }),
      },
      (args) => this.wrap(() => this.services.externalObjectService.validate(args))
    );

    server.registerTool(
      'v8vscedit_epf_bsp_init',
      {
        title: 'Добавить регистрацию БСП',
        description: 'Добавляет функцию СведенияОВнешнейОбработке в ObjectModule.bsl внешней обработки/отчёта и базовый обработчик команды.',
        inputSchema: z.object({
          objectPath: z.string(),
          kind: z.string(),
          targets: z.array(z.string()).optional(),
        }),
        annotations: {
          destructiveHint: true,
        },
      },
      (args) => this.wrap(() => {
        const result = this.services.externalObjectService.initBspRegistration(args);
        this.afterMutation([...result.changedFiles]);
        return result;
      })
    );

    server.registerTool(
      'v8vscedit_epf_bsp_add_command',
      {
        title: 'Добавить команду БСП',
        description: 'Добавляет команду в СведенияОВнешнейОбработке и создаёт/дополняет серверный, клиентский или печатный обработчик.',
        inputSchema: z.object({
          objectPath: z.string(),
          identifier: z.string(),
          commandType: z.string().optional(),
          presentation: z.string().optional(),
          formModulePath: z.string().optional(),
        }),
        annotations: {
          destructiveHint: true,
        },
      },
      (args) => this.wrap(() => {
        const result = this.services.externalObjectService.addBspCommand(args);
        this.afterMutation([...result.changedFiles]);
        return result;
      })
    );

    server.registerTool(
      'v8vscedit_form_info',
      {
        title: 'Информация о форме',
        description: 'Структурированный аналог form-info: элементы, реквизиты, команды, события и BaseForm.',
        inputSchema: z.object({
          formPath: z.string(),
          expand: z.string().optional(),
          limit: z.number().int().min(1).max(1000).optional(),
          offset: z.number().int().min(0).optional(),
        }),
      },
      (args) => this.wrap(() => this.services.formToolsService.info(args))
    );

    server.registerTool(
      'v8vscedit_validate_form',
      {
        title: 'Валидировать форму',
        description: 'Проверяет Form.xml: AutoCommandBar, ID, DataPath, команды, события, callType и типы реквизитов.',
        inputSchema: z.object({
          formPath: z.string(),
          detailed: z.boolean().optional(),
          maxErrors: z.number().int().min(1).max(500).optional(),
        }),
      },
      (args) => this.wrap(() => this.services.formToolsService.validate(args))
    );

    server.registerTool(
      'v8vscedit_add_form',
      {
        title: 'Добавить форму',
        description: 'Создаёт метаданные формы, Form.xml, Module.bsl и регистрирует форму в ChildObjects объекта.',
        inputSchema: z.object({
          objectPath: z.string(),
          formName: z.string(),
          purpose: z.string().optional(),
          synonym: z.string().optional(),
          setDefault: z.boolean().optional(),
        }),
        annotations: {
          destructiveHint: true,
        },
      },
      (args) => this.wrap(() => {
        const result = this.services.formToolsService.addForm(args);
        this.afterMutation([...result.changedFiles]);
        return result;
      })
    );

    server.registerTool(
      'v8vscedit_remove_form',
      {
        title: 'Удалить форму',
        description: 'Удаляет форму, каталог формы, регистрацию в ChildObjects и очищает DefaultForm-ссылку.',
        inputSchema: z.object({
          objectPath: z.string(),
          formName: z.string(),
        }),
        annotations: {
          destructiveHint: true,
        },
      },
      (args) => this.wrap(() => {
        const result = this.services.formToolsService.removeForm(args);
        this.afterMutation([...result.changedFiles]);
        return result;
      })
    );

    server.registerTool(
      'v8vscedit_compile_form',
      {
        title: 'Скомпилировать форму',
        description: 'Создаёт Form.xml из JSON DSL или из метаданных объекта по outputPath.',
        inputSchema: z.object({
          outputPath: z.string(),
          definition: z.any().optional(),
          fromObject: z.boolean().optional(),
        }),
        annotations: {
          destructiveHint: true,
        },
      },
      (args) => this.wrap(() => {
        const result = this.services.formToolsService.compile(args);
        this.afterMutation([...result.changedFiles]);
        return result;
      })
    );

    server.registerTool(
      'v8vscedit_edit_form',
      {
        title: 'Изменить форму',
        description: 'Добавляет элементы, реквизиты, команды и события в существующий Form.xml.',
        inputSchema: z.object({
          formPath: z.string(),
          definition: z.any(),
        }),
        annotations: {
          destructiveHint: true,
        },
      },
      (args) => this.wrap(() => {
        const result = this.services.formToolsService.edit(args);
        this.afterMutation([...result.changedFiles]);
        return result;
      })
    );

    server.registerTool(
      'v8vscedit_compile_subsystem',
      {
        title: 'Создать подсистему',
        description: 'Создаёт XML подсистемы из JSON DSL и регистрирует её в Configuration.xml или родительской подсистеме.',
        inputSchema: z.object({
          outputDir: z.string(),
          parentPath: z.string().optional(),
          definition: z.object({
            name: z.string(),
            synonym: z.string().optional(),
            comment: z.string().optional(),
            includeHelpInContents: z.boolean().optional(),
            includeInCommandInterface: z.boolean().optional(),
            useOneCommand: z.boolean().optional(),
            explanation: z.string().optional(),
            picture: z.string().optional(),
            content: z.array(z.string()).optional(),
            children: z.array(z.string()).optional(),
          }),
        }),
        annotations: {
          destructiveHint: true,
        },
      },
      (args) => this.wrap(() => {
        const result = this.services.subsystemToolsService.compile(args);
        this.afterMutation([...result.changedFiles]);
        return result;
      })
    );

    server.registerTool(
      'v8vscedit_edit_subsystem_content',
      {
        title: 'Изменить состав подсистемы',
        description: 'Добавляет или убирает объекты из Content подсистемы по предметным путям или ссылкам вида Catalog.Товары. Для свойств подсистемы используй v8vscedit_get_properties и v8vscedit_set_property_by_path.',
        inputSchema: z.object({
          metadataPath: z.string(),
          configuration: z.string().optional(),
          add: z.array(z.string()).optional(),
          remove: z.array(z.string()).optional(),
        }),
        annotations: {
          destructiveHint: true,
        },
      },
      ({ metadataPath, configuration, add, remove }) => this.wrap(() => {
        const subsystemNode = paths.resolveNode(metadataPath, configuration);
        if (subsystemNode.nodeKind !== 'Subsystem' || !subsystemNode.xmlPath) {
          throw new Error(`Путь "${metadataPath}" должен указывать на подсистему.`);
        }
        const result = this.services.subsystemXmlService.editContentRefs(subsystemNode.xmlPath, {
          add: resolveSubsystemContentRefs(paths, add ?? [], configuration),
          remove: resolveSubsystemContentRefs(paths, remove ?? [], configuration),
        });
        this.afterMutation(result.changedFiles);
        return result;
      })
    );

    server.registerTool(
      'v8vscedit_edit_command_interface',
      {
        title: 'Изменить командный интерфейс',
        description: 'Редактирует CommandInterface.xml подсистемы: hide/show/place/order/subsystem-order/group-order.',
        inputSchema: z.object({
          ciPath: z.string(),
          createIfMissing: z.boolean().optional(),
          operations: z.array(COMMAND_INTERFACE_OPERATION_SCHEMA).min(1),
        }),
        annotations: {
          destructiveHint: true,
        },
      },
      (args) => this.wrap(() => {
        const result = this.services.commandInterfaceService.edit(args);
        this.afterMutation([...result.changedFiles]);
        return result;
      })
    );

    server.registerTool(
      'v8vscedit_validate_command_interface',
      {
        title: 'Валидировать командный интерфейс',
        description: 'Проверяет CommandInterface.xml: разделы, порядок, ссылки команд, дубли и форматы списков.',
        inputSchema: z.object({
          ciPath: z.string(),
          detailed: z.boolean().optional(),
          maxErrors: z.number().int().min(1).max(500).optional(),
        }),
      },
      (args) => this.wrap(() => this.services.commandInterfaceService.validate(args))
    );

    server.registerTool(
      'v8vscedit_role_info',
      {
        title: 'Информация о правах роли',
        description: 'Структурированный аналог role-info: разрешённые/запрещённые права, RLS и шаблоны ограничений из Rights.xml.',
        inputSchema: z.object({
          rightsPath: z.string(),
          showDenied: z.boolean().optional(),
          limit: z.number().int().min(0).max(5000).optional(),
          offset: z.number().int().min(0).optional(),
        }),
      },
      (args) => this.wrap(() => this.services.roleRightsService.info(args))
    );

    server.registerTool(
      'v8vscedit_validate_role',
      {
        title: 'Валидировать роль',
        description: 'Проверяет Rights.xml роли: XML, глобальные флаги, права объектов, RLS, шаблоны и регистрацию в Configuration.xml.',
        inputSchema: z.object({
          rightsPath: z.string(),
          detailed: z.boolean().optional(),
          maxErrors: z.number().int().min(1).max(500).optional(),
        }),
      },
      (args) => this.wrap(() => this.services.roleRightsService.validate(args))
    );

    server.registerTool(
      'v8vscedit_compile_role',
      {
        title: 'Создать роль из DSL',
        description: 'Создаёт Roles/<Имя>.xml и Roles/<Имя>/Ext/Rights.xml из JSON DSL, затем регистрирует роль в Configuration.xml.',
        inputSchema: z.object({
          outputDir: z.string(),
          definition: z.object({
            name: z.string(),
            synonym: z.string().optional(),
            comment: z.string().optional(),
            setForNewObjects: z.boolean().optional(),
            setForAttributesByDefault: z.boolean().optional(),
            independentRightsOfChildObjects: z.boolean().optional(),
            objects: z.array(ROLE_OBJECT_SCHEMA).optional(),
            rights: z.array(ROLE_OBJECT_SCHEMA).optional(),
            templates: z.array(z.object({ name: z.string(), condition: z.string() })).optional(),
          }),
        }),
        annotations: {
          destructiveHint: true,
        },
      },
      (args) => this.wrap(() => {
        const result = this.services.roleRightsService.compile(args);
        this.afterMutation([...result.changedFiles]);
        return result;
      })
    );

    server.registerTool(
      'v8vscedit_create_configuration',
      {
        title: 'Создать пустую конфигурацию',
        description: 'Создаёт scaffold CF: Configuration.xml и Languages/Русский.xml.',
        inputSchema: z.object({
          name: z.string(),
          synonym: z.string().optional(),
          outputDir: z.string(),
          version: z.string().optional(),
          vendor: z.string().optional(),
          compatibilityMode: z.string().optional(),
        }),
        annotations: {
          destructiveHint: true,
        },
      },
      (args) => this.wrap(() => {
        const result = this.services.configurationScaffoldService.createConfiguration(args);
        this.afterMutation([...result.changedFiles]);
        return result;
      })
    );

    server.registerTool(
      'v8vscedit_create_extension',
      {
        title: 'Создать расширение',
        description: 'Создаёт scaffold CFE: Configuration.xml, язык и опциональную основную роль.',
        inputSchema: z.object({
          name: z.string(),
          synonym: z.string().optional(),
          namePrefix: z.string().optional(),
          outputDir: z.string(),
          purpose: z.enum(['Patch', 'Customization', 'AddOn']).optional(),
          version: z.string().optional(),
          vendor: z.string().optional(),
          compatibilityMode: z.string().optional(),
          configPath: z.string().optional(),
          noRole: z.boolean().optional(),
        }),
        annotations: {
          destructiveHint: true,
        },
      },
      (args) => this.wrap(() => {
        const result = this.services.configurationScaffoldService.createExtension(args);
        this.afterMutation([...result.changedFiles]);
        return result;
      })
    );

    server.registerTool(
      'v8vscedit_get_properties',
      {
        title: 'Свойства объекта по пути',
        description: 'Возвращает все свойства метаданных по предметному пути: текущее значение, readonly, тип контрола и допустимые enum/multiEnum-значения.',
        inputSchema: z.object({
          metadataPath: z.string(),
          configuration: z.string().optional(),
        }),
      },
      ({ metadataPath, configuration }) => this.wrap(() => {
        const node = paths.resolveNode(metadataPath, configuration);
        return properties.getPropertyContracts(node);
      })
    );

    server.registerTool(
      'v8vscedit_set_property_by_path',
      {
        title: 'Изменить свойство по пути',
        description: 'Меняет простое свойство объекта по предметному пути без nodeId. Для enum/boolean/readonly использует те же проверки, что панель свойств.',
        inputSchema: z.object({
          metadataPath: z.string(),
          configuration: z.string().optional(),
          propertyKey: z.string(),
          value: z.unknown(),
        }),
        annotations: {
          destructiveHint: true,
        },
      },
      ({ metadataPath, configuration, propertyKey, value }) => this.wrap(() => {
        const node = paths.resolveNode(metadataPath, configuration);
        const result = properties.setProperty(node, propertyKey, value);
        this.afterMutation(result.changedFiles);
        return result;
      })
    );

    server.registerTool(
      'v8vscedit_list_available_types',
      {
        title: 'Доступные типы 1С',
        description: 'Возвращает стандартные и конфигурационные типы для свойства "Тип", "Источник" или "Тип параметра команды". Для CFE показывает только типы текущего расширения: собственные и уже заимствованные объекты. Используй русское поле value при вызове v8vscedit_set_type.',
        inputSchema: z.object({
          metadataPath: z.string().optional(),
          configuration: z.string().optional(),
          propertyKey: z.string().optional(),
        }),
      },
      ({ metadataPath, configuration, propertyKey }) => this.wrap(() => {
        const node = metadataPath ? paths.resolveNode(metadataPath, configuration) : undefined;
        return properties.getAvailableTypes(node, propertyKey ?? 'Type');
      })
    );

    server.registerTool(
      'v8vscedit_set_type',
      {
        title: 'Изменить тип объекта',
        description: 'Меняет свойство "Тип", "Источник" или "Тип параметра команды" по предметному пути. Перед ссылочным типом сначала вызови v8vscedit_list_available_types для того же metadataPath: set_type принимает только доступные типы, а в CFE не позволит сослаться на незаимствованный объект. Принимает русские имена типов и квалификаторы: длина строки, длина числа и точность.',
        inputSchema: z.object({
          metadataPath: z.string(),
          configuration: z.string().optional(),
          propertyKey: z.string().optional(),
          value: z.unknown().optional(),
          type: z.string().optional(),
          items: z.array(z.string()).optional(),
          length: z.number().int().min(0).optional(),
          allowedLength: z.string().optional(),
          digits: z.number().int().min(1).optional(),
          fractionDigits: z.number().int().min(0).optional(),
          precision: z.number().int().min(0).optional(),
          allowedSign: z.string().optional(),
          dateFractions: z.string().optional(),
        }),
        annotations: {
          destructiveHint: true,
        },
      },
      ({ metadataPath, configuration, propertyKey, ...typeInput }) => this.wrap(() => {
        const node = paths.resolveNode(metadataPath, configuration);
        const result = properties.setType(node, propertyKey ?? 'Type', normalizeSetTypeToolInput(typeInput));
        this.afterMutation(result.changedFiles);
        return result;
      })
    );

    server.registerTool(
      'v8vscedit_rename_metadata',
      {
        title: 'Переименовать метаданные',
        description: 'Переименовывает объект или дочерний элемент по предметному пути. Для корневого объекта обновляет файл, каталог, ChildObjects и ссылки через общий XML-сервис.',
        inputSchema: z.object({
          metadataPath: z.string(),
          configuration: z.string().optional(),
          newName: z.string(),
        }),
        annotations: {
          destructiveHint: true,
        },
      },
      ({ metadataPath, configuration, newName }) => this.wrap(() => {
        const node = paths.resolveNode(metadataPath, configuration);
        const result = properties.rename(node, newName);
        this.afterMutation(result.changedFiles);
        return result;
      })
    );

    server.registerTool(
      'v8vscedit_add_metadata_by_path',
      {
        title: 'Добавить метаданные по пути',
        description: 'Добавляет объект, реквизит, табличную часть, колонку, форму, команду или макет по предметному пути без nodeId. Примеры: Справочники.Пользователи.Фамилия, Справочники.Пользователи.ТабличныеЧасти.Состав, Справочники.Пользователи.ТабличныеЧасти.Состав.Реквизиты.Номенклатура, Справочники.Пользователи.Формы.ФормаСписка.',
        inputSchema: z.object({
          path: z.string(),
          configuration: z.string().optional(),
          childTag: z.string().optional(),
          templateType: z.string().optional(),
        }),
        annotations: {
          destructiveHint: true,
        },
      },
      async ({ path: metadataPath, configuration, childTag, templateType }) => this.wrapAsync(async () => {
        const resolved = paths.resolveAddTarget({ path: metadataPath, configuration, childTag: normalizeChildTag(childTag) });
        return mutations.addMetadata({
          target: resolved.target,
          name: resolved.name,
          templateType: normalizeTemplateType(templateType),
          sourceNode: resolved.sourceNode,
        });
      })
    );

    server.registerTool(
      'v8vscedit_remove_metadata',
      {
        title: 'Удалить метаданные',
        description: 'Удаляет объект или дочерний элемент по предметному пути через тот же infra-сервис, который использует UI; не удаляй XML/каталоги вручную.',
        inputSchema: z.object({
          metadataPath: z.string(),
          configuration: z.string().optional(),
          keepFiles: z.boolean().optional(),
        }),
        annotations: {
          destructiveHint: true,
        },
      },
      ({ metadataPath, configuration, keepFiles }) => this.wrap(() => {
        const node = paths.resolveNode(metadataPath, configuration);
        if (!node.xmlPath || !node.canRemoveMetadata) {
          throw new Error(`Узел "${node.textLabel}" не поддерживает удаление метаданных.`);
        }
        const result = node.metaContext
          ? this.services.metadataXmlRemover.removeChildElement({
              ownerObjectXmlPath: node.metaContext.ownerObjectXmlPath ?? node.xmlPath,
              childTag: toRemoveChildTag(node.nodeKind),
              name: node.textLabel,
              tabularSectionName: node.metaContext.tabularSectionName,
              keepFiles,
            })
          : this.services.metadataXmlRemover.removeRootObject({
              configRoot: getObjectLocationFromXml(node.xmlPath).configRoot,
              kind: node.nodeKind,
              name: node.textLabel,
              keepFiles,
            });
        if (result.success) {
          this.afterMutation(result.changedFiles);
        }
        return result;
      })
    );

    server.registerTool(
      'v8vscedit_cfe_borrow',
      {
        title: 'Заимствовать объект в расширение',
        description: 'Заимствует объект, форму или дочерний элемент из CF в CFE через CfeBorrowService.',
        inputSchema: z.object({
          configRoot: z.string(),
          extensionRoot: z.string(),
          typeName: z.string(),
          objectName: z.string(),
          formName: z.string().optional(),
          childTag: z.string().optional(),
          childName: z.string().optional(),
        }),
        annotations: {
          destructiveHint: true,
        },
      },
      ({ configRoot, extensionRoot, typeName, objectName, formName, childTag, childName }) => this.wrap(() => {
        const result = formName
          ? this.services.cfeBorrowService.borrowForm(configRoot, extensionRoot, typeName, objectName, formName)
          : childTag && childName
            ? this.services.cfeBorrowService.borrowChild(configRoot, extensionRoot, typeName, objectName, childTag, childName)
            : this.services.cfeBorrowService.borrowObject(configRoot, extensionRoot, typeName, objectName);
        this.afterMutation(result.files);
        return result;
      })
    );

    server.registerTool(
      'v8vscedit_cfe_patch_method',
      {
        title: 'Добавить перехватчик метода CFE',
        description: 'Создаёт или дописывает BSL-модуль расширения перехватчиком &Перед, &После или &ИзменениеИКонтроль.',
        inputSchema: z.object({
          extensionPath: z.string(),
          modulePath: z.string(),
          methodName: z.string(),
          interceptorType: z.enum(['Before', 'After', 'ModificationAndControl']),
          context: z.string().optional(),
          isFunction: z.boolean().optional(),
        }),
        annotations: {
          destructiveHint: true,
        },
      },
      (args) => this.wrap(() => {
        const result = this.services.cfePatchMethodService.addMethodInterceptor(args);
        this.afterMutation([...result.changedFiles]);
        return result;
      })
    );

    server.registerTool(
      'v8vscedit_cfe_diff',
      {
        title: 'Анализ расширения CFE',
        description: 'Возвращает состав расширения, заимствованные объекты, BSL-перехватчики и опционально проверку переноса #Вставка.',
        inputSchema: z.object({
          extensionPath: z.string(),
          configPath: z.string().optional(),
          mode: z.enum(['overview', 'transfer']).optional(),
        }),
      },
      (args) => this.wrap(() => this.services.cfeDiffService.analyze(args))
    );

    server.registerTool(
      'v8vscedit_execute_command',
      {
        title: 'Выполнить команду расширения',
        description: 'Безопасный мост только для явно разрешённых команд расширения: refresh, importConfigurations, updateChangedConfigurations.',
        inputSchema: z.object({
          command: z.enum([...ALLOWED_COMMANDS] as [string, ...string[]]),
        }),
        annotations: {
          destructiveHint: true,
        },
      },
      async ({ command }) => this.wrapAsync(async () => {
        const result = await vscode.commands.executeCommand(command);
        return { command, result: result ?? null };
      })
    );
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      if (!this.isLoopbackRequest(req)) {
        res.writeHead(403).end('MCP server accepts loopback requests only.');
        return;
      }
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
      if (url.pathname !== '/mcp') {
        res.writeHead(404).end('Not found');
        return;
      }
      if (req.method !== 'GET' && req.method !== 'POST' && req.method !== 'DELETE') {
        res.writeHead(405).end('Method not allowed');
        return;
      }
      if (req.method === 'GET' && !acceptsEventStream(req)) {
        this.writeBrowserProbeResponse(res);
        return;
      }
      const sessionId = getHeaderString(req, 'mcp-session-id');
      const existingSession = sessionId ? this.sessions.get(sessionId) : undefined;
      if (existingSession) {
        await existingSession.transport.handleRequest(req, res);
        return;
      }
      if (sessionId) {
        this.writeJsonRpcError(res, 404, -32001, 'Session not found');
        return;
      }
      if (req.method !== 'POST') {
        this.writeJsonRpcError(res, 400, -32000, 'Bad Request: Mcp-Session-Id header is required');
        return;
      }

      const parsedBody = await readJsonBody(req);
      if (!isInitializeRequest(parsedBody)) {
        this.writeJsonRpcError(res, 400, -32000, 'Bad Request: No valid session ID provided');
        return;
      }

      const session = await this.createSession();
      await session.transport.handleRequest(req, res, parsedBody);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.services.outputChannel.appendLine(`[mcp][error] ${message}`);
      if (!res.headersSent) {
        res.writeHead(500).end('MCP server error');
      }
    }
  }

  private async createSession(): Promise<McpSession> {
    let initializedSessionId: string | undefined;
    const server = new McpServer({
      name: 'v8vscedit',
      version: '0.3.5',
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        initializedSessionId = sessionId;
        this.sessions.set(sessionId, { server, transport });
        this.services.outputChannel.appendLine(`[mcp] Сессия подключена: ${sessionId}`);
      },
    });
    transport.onclose = () => {
      const sessionId = transport.sessionId ?? initializedSessionId;
      if (sessionId) {
        this.sessions.delete(sessionId);
        this.services.outputChannel.appendLine(`[mcp] Сессия закрыта: ${sessionId}`);
      }
    };
    this.registerTools(server);
    await server.connect(transport);
    return { server, transport };
  }

  private async listenOnAvailablePort(server: http.Server, host: string, preferredPort: number): Promise<number> {
    const startPort = Math.max(0, preferredPort);
    const maxAttempts = startPort === 0 ? 1 : 20;
    for (let offset = 0; offset < maxAttempts; offset += 1) {
      const port = startPort === 0 ? 0 : startPort + offset;
      const listened = await this.tryListen(server, host, port);
      if (listened !== null) {
        return listened;
      }
    }
    throw new Error(`Не удалось запустить MCP-сервер на ${host}:${String(preferredPort)}.`);
  }

  private tryListen(server: http.Server, host: string, port: number): Promise<number | null> {
    return new Promise((resolve, reject) => {
      const onError = (error: NodeJS.ErrnoException) => {
        server.off('listening', onListening);
        if (error.code === 'EADDRINUSE') {
          resolve(null);
          return;
        }
        reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        const address = server.address();
        resolve(typeof address === 'object' && address ? address.port : port);
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, host);
    });
  }

  private isLoopbackRequest(req: http.IncomingMessage): boolean {
    const address = req.socket.remoteAddress ?? '';
    return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
  }

  private writeBrowserProbeResponse(res: http.ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    }).end([
      'MCP-сервер v8vscedit запущен.',
      '',
      'Этот endpoint не открывается как обычная веб-страница.',
      'Подключайте MCP-клиент к этому URL; для GET-потока клиент должен отправлять Accept: text/event-stream.',
      'Для JSON-RPC POST клиент должен отправлять Accept: application/json, text/event-stream.',
    ].join('\n'));
  }

  private writeJsonRpcError(res: http.ServerResponse, status: number, code: number, message: string): void {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    }).end(JSON.stringify({
      jsonrpc: '2.0',
      error: { code, message },
      id: null,
    }));
  }

  private ok(data: unknown): CallToolResult {
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    };
  }

  private wrap(fn: () => unknown): CallToolResult {
    try {
      return this.ok(fn());
    } catch (error) {
      return this.toolError(error);
    }
  }

  private async wrapAsync(fn: () => Promise<unknown>): Promise<CallToolResult> {
    try {
      return this.ok(await fn());
    } catch (error) {
      return this.toolError(error);
    }
  }

  private toolError(error: unknown): CallToolResult {
    const message = error instanceof Error ? error.message : String(error);
    return {
      isError: true,
      content: [{ type: 'text', text: message }],
    };
  }

  private afterMutation(filePaths: readonly string[]): void {
    if (filePaths.length === 0) {
      return;
    }
    this.services.suppressConfigurationReloadForFiles([...filePaths]);
    this.services.markChangedConfigurationByFiles([...filePaths]);
    this.services.treeProvider.refresh();
    this.services.refreshActionsView();
  }
}

function formatHostForUrl(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

function resolveSubsystemContentRefs(
  paths: McpMetadataPathService,
  values: readonly string[],
  configuration?: string
): string[] {
  return uniqueStrings(values.map((value) => resolveSubsystemContentRef(paths, value, configuration)));
}

function resolveSubsystemContentRef(paths: McpMetadataPathService, value: string, configuration?: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('Пустая ссылка на объект состава подсистемы.');
  }
  const node = paths.resolveNode(trimmed, configuration);
  return metadataNodeToObjectRef(node, trimmed);
}

function metadataNodeToObjectRef(node: MetadataNode, source: string): string {
  if (node.metaContext || !node.xmlPath) {
    throw new Error(`В Content подсистемы можно добавлять только корневые объекты метаданных: ${source}.`);
  }
  const def = META_TYPES[node.nodeKind];
  if (!def?.folder || def.group === 'service' || def.group === 'root' || def.group === 'child' || node.nodeKind === 'Subsystem') {
    throw new Error(`Тип узла не поддерживается в Content подсистемы: ${node.nodeKind}.`);
  }
  return `${node.nodeKind}.${node.textLabel}`;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function acceptsEventStream(req: http.IncomingMessage): boolean {
  const accept = req.headers.accept;
  if (Array.isArray(accept)) {
    return accept.some((value: unknown) => typeof value === 'string' && value.includes('text/event-stream'));
  }
  return typeof accept === 'string' && accept.includes('text/event-stream');
}

function getHeaderString(req: http.IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value.find((item) => item.trim().length > 0);
  }
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer | string>) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf-8') : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf-8').trim();
  if (!raw) {
    throw new Error('Parse error: empty JSON body');
  }
  return JSON.parse(raw) as unknown;
}

function toRemoveChildTag(kind: string): ChildTag | 'Column' {
  if (
    kind === 'Attribute' ||
    kind === 'AddressingAttribute' ||
    kind === 'TabularSection' ||
    kind === 'Form' ||
    kind === 'Command' ||
    kind === 'Template' ||
    kind === 'Dimension' ||
    kind === 'Resource' ||
    kind === 'EnumValue' ||
    kind === 'Column'
  ) {
    return kind;
  }
  throw new Error(`Неподдерживаемый дочерний тип для удаления: ${kind}`);
}

function normalizeChildTag(value: string | undefined): ChildTag | 'Column' | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = normalizeInputText(value);
  if (normalized === normalizeInputText('Колонка') || normalized === normalizeInputText('Реквизит табличной части')) {
    return 'Column';
  }
  for (const [tag, config] of Object.entries(CHILD_TAG_CONFIG)) {
    const aliases = [
      tag,
      config.label,
      META_TYPES[tag as keyof typeof META_TYPES].label,
      META_TYPES[tag as keyof typeof META_TYPES].pluralLabel,
    ];
    if (aliases.some((alias) => normalizeInputText(alias) === normalized)) {
      return tag as ChildTag;
    }
  }
  throw new Error(`Неподдерживаемый дочерний тип "${value}". Используйте русское имя группы, например "Реквизиты", "Формы", "Макеты".`);
}

function normalizeTemplateType(value: string | undefined): TemplateTypeInput | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = normalizeInputText(value);
  const aliases: Record<TemplateTypeInput, readonly string[]> = {
    SpreadsheetDocument: ['Табличный документ', 'MXL', 'SpreadsheetDocument'],
    DataCompositionSchema: ['Схема компоновки данных', 'СКД', 'DataCompositionSchema'],
    TextDocument: ['Текстовый документ', 'Текст', 'TextDocument'],
    HTMLDocument: ['HTML документ', 'HTMLDocument'],
    BinaryData: ['Двоичные данные', 'BinaryData'],
    DataCompositionAppearanceTemplate: ['Макет оформления компоновки данных', 'DataCompositionAppearanceTemplate'],
    GraphicalSchema: ['Графическая схема', 'GraphicalSchema'],
    AddIn: ['Внешняя компонента', 'AddIn'],
  };
  for (const [templateType, names] of Object.entries(aliases) as [TemplateTypeInput, readonly string[]][]) {
    if (names.some((name) => normalizeInputText(name) === normalized)) {
      return templateType;
    }
  }
  throw new Error(`Неподдерживаемый тип макета "${value}". Используйте русское имя, например "Текстовый документ", "Табличный документ", "СКД".`);
}

function normalizeSetTypeToolInput(input: Record<string, unknown>): unknown {
  const rawValue = input.value;
  const items = Array.isArray(input.items)
    ? input.items.filter((item): item is string => typeof item === 'string')
    : undefined;
  const type = typeof input.type === 'string' ? input.type : undefined;
  const value = rawValue ?? (items ? { items } : type);

  if (value === undefined) {
    throw new Error('Укажите тип в value, type или items.');
  }

  const normalized: Record<string, unknown> = isPlainObject(value)
    ? { ...value }
    : { items: typeof value === 'string' ? [value] : value };

  if (items && !Array.isArray(normalized.items)) {
    normalized.items = items;
  }
  if (type && !Array.isArray(normalized.items)) {
    normalized.items = [type];
  }

  const stringQualifiers = mergeQualifierObject(normalized.stringQualifiers, {
    length: input.length,
    allowedLength: input.allowedLength,
  });
  const numberQualifiers = mergeQualifierObject(normalized.numberQualifiers, {
    digits: input.digits ?? input.length,
    fractionDigits: input.fractionDigits ?? input.precision,
    allowedSign: input.allowedSign,
  });
  const dateQualifiers = mergeQualifierObject(normalized.dateQualifiers, {
    dateFractions: input.dateFractions,
  });

  if (stringQualifiers) {
    normalized.stringQualifiers = stringQualifiers;
  }
  if (numberQualifiers) {
    normalized.numberQualifiers = numberQualifiers;
  }
  if (dateQualifiers) {
    normalized.dateQualifiers = dateQualifiers;
  }

  return normalized;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function mergeQualifierObject(current: unknown, additions: Record<string, unknown>): Record<string, unknown> | undefined {
  const result = isPlainObject(current) ? { ...current } : {};
  for (const [key, value] of Object.entries(additions)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function normalizeInputText(value: string): string {
  return value.trim().toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/\s+/g, '');
}
