import * as http from 'http';
import * as vscode from 'vscode';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import * as z from 'zod/v4';
import { META_TYPES } from '../../domain/MetaTypes';
import type { ChildTag } from '../../domain/ChildTag';
import { getObjectLocationFromXml } from '../../infra/fs/MetaPathResolver';
import type { ConfigurationXmlEditor } from '../../infra/xml';
import { MetadataMutationService } from '../commands/metadata/MetadataMutationService';
import type { CommandServices } from '../commands/_shared';
import { McpNodeRegistry } from './McpNodeRegistry';
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
  private mcpServer: McpServer | undefined;
  private transport: StreamableHTTPServerTransport | undefined;
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

    const server = new McpServer({
      name: 'v8vscedit',
      version: '0.3.5',
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    this.registerTools(server);
    await server.connect(transport);

    const httpServer = http.createServer((req, res) => {
      void this.handleRequest(transport, req, res);
    });
    const port = await this.listenOnAvailablePort(httpServer, options.host, options.port);

    this.mcpServer = server;
    this.transport = transport;
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
    await this.transport?.close();
    await this.mcpServer?.close();
    this.transport = undefined;
    this.mcpServer = undefined;
  }

  dispose(): void {
    void this.stop();
  }

  private registerTools(server: McpServer): void {
    const nodes = new McpNodeRegistry(this.services.treeProvider);
    const properties = new McpPropertyService(this.xmlEditor);
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
      'v8vscedit_list_metadata_nodes',
      {
        title: 'Список узлов дерева',
        description: 'Ищет узлы основной панели метаданных и возвращает nodeId для последующих MCP-инструментов.',
        inputSchema: z.object({
          query: z.string().optional(),
          rootPath: z.string().optional(),
          limit: z.number().int().min(1).max(1000).optional(),
        }),
      },
      (args) => this.ok(nodes.listNodes(args))
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
        description: 'Создаёт Template.xml табличного документа из JSON DSL: колонки, стили, области, параметры и шаблоны.',
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
        description: 'Создаёт Template.xml схемы компоновки данных из JSON DSL: наборы, поля, параметры, итоги и варианты.',
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
      'v8vscedit_get_property_contract',
      {
        title: 'Контракт свойства',
        description: 'Показывает тип значения, текущее значение и допустимые enum-значения конкретного свойства конкретного узла.',
        inputSchema: z.object({
          nodeId: z.string(),
          propertyKey: z.string(),
        }),
      },
      ({ nodeId, propertyKey }) => this.wrap(() => {
        const node = nodes.resolveNode(nodeId);
        return properties.getPropertyContract(node, propertyKey);
      })
    );

    server.registerTool(
      'v8vscedit_set_property',
      {
        title: 'Изменить свойство',
        description: 'Меняет простое свойство только после проверки контракта: enum, boolean и readonly валидируются до записи XML.',
        inputSchema: z.object({
          nodeId: z.string(),
          propertyKey: z.string(),
          value: z.unknown(),
        }),
        annotations: {
          destructiveHint: true,
        },
      },
      ({ nodeId, propertyKey, value }) => this.wrap(() => {
        const node = nodes.resolveNode(nodeId);
        const result = properties.setProperty(node, propertyKey, value);
        if (result.changedFiles.length > 0) {
          this.services.markChangedConfigurationByFiles([...result.changedFiles]);
          this.services.treeProvider.refresh();
          this.services.refreshActionsView();
        }
        return result;
      })
    );

    server.registerTool(
      'v8vscedit_add_metadata',
      {
        title: 'Добавить метаданные',
        description: 'Добавляет объект или дочерний элемент через тот же сервис, который использует команда UI v8vscedit.addMetadata.',
        inputSchema: z.object({
          targetNodeId: z.string(),
          name: z.string(),
          templateType: z.enum(TEMPLATE_TYPES).optional(),
        }),
        annotations: {
          destructiveHint: true,
        },
      },
      async ({ targetNodeId, name, templateType }) => this.wrapAsync(async () => {
        const node = nodes.resolveNode(targetNodeId);
        if (!node.addMetadataTarget) {
          throw new Error(`Узел "${node.textLabel}" не поддерживает добавление метаданных.`);
        }
        return mutations.addMetadata({
          target: node.addMetadataTarget,
          name,
          templateType,
          sourceNode: node,
        });
      })
    );

    server.registerTool(
      'v8vscedit_remove_metadata',
      {
        title: 'Удалить метаданные',
        description: 'Удаляет объект или дочерний элемент через тот же infra-сервис, который использует команда UI v8vscedit.removeMetadata.',
        inputSchema: z.object({
          nodeId: z.string(),
          keepFiles: z.boolean().optional(),
        }),
        annotations: {
          destructiveHint: true,
        },
      },
      ({ nodeId, keepFiles }) => this.wrap(() => {
        const node = nodes.resolveNode(nodeId);
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

  private async handleRequest(
    transport: StreamableHTTPServerTransport,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
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
      await transport.handleRequest(req, res);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.services.outputChannel.appendLine(`[mcp][error] ${message}`);
      if (!res.headersSent) {
        res.writeHead(500).end('MCP server error');
      }
    }
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
