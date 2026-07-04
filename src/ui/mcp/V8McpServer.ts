import * as http from 'http';
import { randomUUID } from 'crypto';
import * as vscode from 'vscode';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import * as z from 'zod/v4';
import * as path from 'path';
import { META_TYPES } from '../../domain/MetaTypes';
import type { ChildTag } from '../../domain/ChildTag';
import { getObjectLocationFromXml } from '../../infra/fs/MetaPathResolver';
import { SupportMode } from '../../infra/support/SupportInfoService';
import type { ConfigurationXmlEditor } from '../../infra/xml';
import { getPlatformTypeRegistry, type TypeContext } from '../../infra/xml/PlatformTypeRegistry';
import { MetadataMutationService } from '../commands/metadata/MetadataMutationService';
import type { CommandServices } from '../commands/_shared';
import type { MetadataNode } from '../tree/TreeNode';
import { parseCanonicalPath } from '../../domain/CanonicalNames';
import { registerAllAddTools } from './McpAddToolsRegistration';
import { McpMetadataPathService } from './McpMetadataPathService';
import {
  canonicalToLegacyModulePath,
  resolveCommandInterfaceXmlByCanonical,
  resolveConfigurationRootDirByCanonical,
  resolveConfigurationXmlByCanonical,
  resolveFormXmlByCanonical,
  resolveObjectXmlByCanonical,
  resolveOwnerObjectXmlByCanonical,
  resolveRoleXmlByCanonical,
  resolveSubsystemXmlByCanonical,
  resolveTemplateXmlByCanonical,
} from './McpPathResolvers';
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

const ROLE_OBJECT_SCHEMA = z.union([
  z.string(),
  z.object({
    name: z.string().optional(),
    preset: z.string().optional(),
    rights: z.union([z.array(z.string()), z.record(z.string(), z.boolean())]).optional(),
    rls: z.record(z.string(), z.string()).optional(),
  }),
]);

const ROLE_EDIT_OPERATION_SCHEMA = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('grant'),
    object: z.string(),
    preset: z.string().optional(),
    rights: z.union([z.array(z.string()), z.record(z.string(), z.boolean())]).optional(),
    rls: z.record(z.string(), z.string()).optional(),
  }),
  z.object({
    op: z.literal('revoke'),
    object: z.string(),
    rights: z.array(z.string()).optional(),
  }),
  z.object({
    op: z.literal('setRls'),
    object: z.string(),
    right: z.string(),
    condition: z.string().optional(),
  }),
  z.object({
    op: z.literal('setFlags'),
    flags: z.object({
      setForNewObjects: z.boolean().optional(),
      setForAttributesByDefault: z.boolean().optional(),
      independentRightsOfChildObjects: z.boolean().optional(),
    }),
  }),
  z.object({
    op: z.literal('addTemplate'),
    name: z.string(),
    condition: z.string(),
  }),
  z.object({
    op: z.literal('removeTemplate'),
    name: z.string(),
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
  // Набор разрешённых значений Host/Origin для защиты от DNS-rebinding.
  // Заполняется реальным портом при старте; пустой набор = сервер ещё не слушает.
  private allowedHosts = new Set<string>();

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
    this.allowedHosts = buildAllowedHosts(port);
    this.services.outputChannel.appendLine(`[mcp] Сервер запущен: ${this.endpoint}`);
  }

  async stop(): Promise<void> {
    const httpServer = this.httpServer;
    this.httpServer = undefined;
    this.endpoint = undefined;
    this.allowedHosts = new Set();
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
      'v8vscedit_tree',
      {
        title: 'Плоское дерево канонических путей',
        description: [
          'Возвращает плоский список канонических путей метаданных. Используй для',
          'быстрой ориентации в конфигурации без пагинации. Канон путей: множественное',
          'число корня, прямые реквизиты/ТЧ, без английских алиасов',
          '(Справочники.Контрагенты.ИНН, не Catalog.Counterparties.Attribute.TIN).',
        ].join(' '),
        inputSchema: z.object({
          configuration: z.string().optional(),
          scope: z.enum(['all', 'objects', 'common', 'subsystems']).optional(),
          depth: z.enum(['roots', 'objects', 'children']).optional(),
          include: z.array(z.string()).optional(),
          limit: z.number().int().min(1).max(50_000).optional(),
        }),
      },
      (args) => this.wrap(() => paths.listTreePaths(args))
    );

    server.registerTool(
      'v8vscedit_resolve_path',
      {
        title: 'Резолв канонического пути',
        description: [
          'Нормализует канонический путь и проверяет наличие узла в дереве.',
          'Возвращает каноническую форму входа и exists. На вход принимает только',
          'канонические русские пути; английские/legacy формы (Catalog.X) отбиваются',
          'с подсказкой канона. exists=false без ошибки означает «узла нет».',
        ].join(' '),
        inputSchema: z.object({
          path: z.string(),
          configuration: z.string().optional(),
        }),
      },
      (args) => this.wrap(() => {
        const result = paths.resolveNodeSafe(args.path, args.configuration);
        if (!result.exists || !result.node) {
          return { canonical: result.canonical, exists: false };
        }
        return {
          canonical: result.canonical,
          exists: true,
          nodeKind: result.node.nodeKind,
          xmlPath: result.node.xmlPath,
        };
      })
    );

    server.registerTool(
      'v8vscedit_list_supported_types',
      {
        title: 'Реестр платформенных типов',
        description: [
          'Возвращает доступные типы для свойства по контексту: реквизит метаданных,',
          'реквизит формы, параметр команды, источник подписки. Для metadataAttribute /',
          'formAttribute базовая группа выдаётся даже без configuration; ссылочные',
          'группы (Справочник/Документ/…) появляются только при указанной configuration.',
        ].join(' '),
        inputSchema: z.object({
          context: z.enum(['metadataAttribute', 'formAttribute', 'commandParameter', 'eventSource']),
          configuration: z.string().optional(),
        }),
      },
      (args) => this.wrap(() => listSupportedTypes(this.services.treeProvider, args.context, args.configuration))
    );

    server.registerTool(
      'v8vscedit_configuration_info',
      {
        title: 'Информация о конфигурации',
        description: [
          'Свойства конфигурации/расширения и счётчики ChildObjects.',
          'Принимает канонический путь корня: Конфигурация или Расширение.',
        ].join(' '),
        inputSchema: z.object({
          path: z.string(),
          configuration: z.string().optional(),
          mode: z.enum(['overview', 'brief', 'full']).optional(),
          limit: z.number().int().min(1).max(1000).optional(),
          offset: z.number().int().min(0).optional(),
        }),
      },
      ({ path: canonical, configuration, ...rest }) => this.wrap(() => {
        const configPath = resolveConfigurationXmlByCanonical(paths, canonical, configuration);
        return this.services.configurationInfoService.read({ ...rest, configPath });
      })
    );

    server.registerTool(
      'v8vscedit_validate_configuration',
      {
        title: 'Валидировать конфигурацию',
        description: [
          'Проверяет Configuration.xml, ChildObjects, DefaultLanguage и базовые enum-значения.',
          'Принимает канонический путь корня: Конфигурация или Расширение.',
        ].join(' '),
        inputSchema: z.object({
          path: z.string(),
          configuration: z.string().optional(),
          detailed: z.boolean().optional(),
          maxErrors: z.number().int().min(1).max(500).optional(),
        }),
      },
      ({ path: canonical, configuration, ...rest }) => this.wrap(() => {
        const configPath = resolveConfigurationXmlByCanonical(paths, canonical, configuration);
        return this.services.configurationValidationService.validate({ ...rest, configPath });
      })
    );

    server.registerTool(
      'v8vscedit_metadata_info',
      {
        title: 'Информация об объекте метаданных',
        description: [
          'Возвращает структуру объекта: реквизиты, табличные части, формы, команды, макеты.',
          'Принимает канонический путь объекта: Справочники.Контрагенты, Документы.РасходТовара,',
          'РегистрыСведений.КурсыВалют, Перечисления.СтатусыЗаказа и т.п.',
        ].join(' '),
        inputSchema: z.object({
          path: z.string(),
          configuration: z.string().optional(),
          mode: z.enum(['overview', 'brief', 'full']).optional(),
          name: z.string().optional(),
          limit: z.number().int().min(1).max(1000).optional(),
          offset: z.number().int().min(0).optional(),
        }),
      },
      ({ path: canonical, configuration, ...rest }) => this.wrap(() => {
        const objectPath = resolveObjectXmlByCanonical(paths, canonical, configuration);
        return this.services.metadataInfoService.read({ ...rest, objectPath });
      })
    );

    server.registerTool(
      'v8vscedit_validate_metadata',
      {
        title: 'Валидировать объект метаданных',
        description: [
          'Проверяет XML объекта, тип, имя, UUID, дочерние элементы и связанные файлы.',
          'Принимает канонический путь объекта (Справочники.Контрагенты) либо массив',
          'таких путей через `paths` для пакетной проверки.',
        ].join(' '),
        inputSchema: z.object({
          path: z.string().optional(),
          paths: z.array(z.string()).optional(),
          configuration: z.string().optional(),
          detailed: z.boolean().optional(),
          maxErrors: z.number().int().min(1).max(500).optional(),
        }),
      },
      ({ path: canonical, paths: canonicals, configuration, ...rest }) => this.wrap(() => {
        const items = (canonicals && canonicals.length > 0
          ? canonicals
          : canonical
            ? [canonical]
            : [])
          .map((item) => item.trim())
          .filter(Boolean);
        if (items.length === 0) {
          throw new Error('Укажите path или paths с каноническим путём объекта.');
        }
        const resolvedJoined = items
          .map((item) => resolveObjectXmlByCanonical(paths, item, configuration))
          .join('|');
        return this.services.metadataValidationService.validate({ ...rest, objectPath: resolvedJoined });
      })
    );

    server.registerTool(
      'v8vscedit_subsystem_info',
      {
        title: 'Информация о подсистеме',
        description: [
          'Возвращает свойства подсистемы, состав, дерево дочерних подсистем и CommandInterface.xml.',
          'Принимает канонический путь подсистемы: Подсистема.Продажи.Розница.',
        ].join(' '),
        inputSchema: z.object({
          path: z.string(),
          configuration: z.string().optional(),
          mode: z.enum(['overview', 'content', 'ci', 'tree', 'full']).optional(),
          name: z.string().optional(),
          limit: z.number().int().min(1).max(1000).optional(),
          offset: z.number().int().min(0).optional(),
        }),
      },
      ({ path: canonical, configuration, ...rest }) => this.wrap(() => {
        const subsystemPath = resolveSubsystemXmlByCanonical(paths, canonical, configuration);
        return this.services.subsystemToolsService.info({ ...rest, subsystemPath });
      })
    );

    server.registerTool(
      'v8vscedit_validate_subsystem',
      {
        title: 'Валидировать подсистему',
        description: [
          'Проверяет XML подсистемы: свойства, Content, ChildObjects, файлы и CommandInterface.xml.',
          'Принимает канонический путь подсистемы: Подсистема.Продажи.Розница.',
        ].join(' '),
        inputSchema: z.object({
          path: z.string(),
          configuration: z.string().optional(),
          detailed: z.boolean().optional(),
          maxErrors: z.number().int().min(1).max(500).optional(),
        }),
      },
      ({ path: canonical, configuration, ...rest }) => this.wrap(() => {
        const subsystemPath = resolveSubsystemXmlByCanonical(paths, canonical, configuration);
        return this.services.subsystemToolsService.validate({ ...rest, subsystemPath });
      })
    );

    server.registerTool(
      'v8vscedit_mxl_info',
      {
        title: 'Информация о MXL-макете',
        description: [
          'Возвращает области, параметры, текст и статистику табличного документа.',
          'Принимает канонический путь макета: Справочники.X.Макет.СчетФактура или ОбщиеМакеты.X.',
        ].join(' '),
        inputSchema: z.object({
          path: z.string(),
          configuration: z.string().optional(),
          withText: z.boolean().optional(),
          maxParams: z.number().int().min(1).max(100).optional(),
          limit: z.number().int().min(1).max(1000).optional(),
          offset: z.number().int().min(0).optional(),
        }),
      },
      ({ path: canonical, configuration, ...rest }) => this.wrap(() => {
        const templatePath = resolveTemplateXmlByCanonical(paths, canonical, configuration);
        return this.services.mxlTemplateService.info({ ...rest, templatePath });
      })
    );

    server.registerTool(
      'v8vscedit_validate_mxl',
      {
        title: 'Валидировать MXL-макет',
        description: [
          'Проверяет Template.xml табличного документа: строки, колонки, палитры, области.',
          'Принимает канонический путь макета: Справочники.X.Макет.СчетФактура или ОбщиеМакеты.X.',
        ].join(' '),
        inputSchema: z.object({
          path: z.string(),
          configuration: z.string().optional(),
          detailed: z.boolean().optional(),
          maxErrors: z.number().int().min(1).max(500).optional(),
        }),
      },
      ({ path: canonical, configuration, ...rest }) => this.wrap(() => {
        const templatePath = resolveTemplateXmlByCanonical(paths, canonical, configuration);
        return this.services.mxlTemplateService.validate({ ...rest, templatePath });
      })
    );

    server.registerTool(
      'v8vscedit_compile_mxl',
      {
        title: 'Скомпилировать MXL-макет',
        description: [
          'Перезаписывает содержимое существующего MXL Template.xml из JSON DSL.',
          'Для нового макета сначала используй v8vscedit_add_template с templateType="Табличный документ".',
          'Принимает канонический путь существующего макета: Справочники.X.Макет.Y.',
        ].join(' '),
        inputSchema: z.object({
          path: z.string(),
          configuration: z.string().optional(),
          definition: z.any(),
        }),
        annotations: {
          destructiveHint: true,
        },
      },
      (args) => this.wrap(() => {
        this.assertNodeEditable(paths.resolveNode(args.path, args.configuration));
        const outputPath = resolveTemplateXmlByCanonical(paths, args.path, args.configuration);
        // args.definition имеет тип any (z.any()); сервис нормализует данные внутри.
        const result = this.services.mxlTemplateService.compile({ ...args, outputPath });
        // Сервис бросает исключение при провале (перехват в wrap); дошли сюда — успех.
        this.afterMutationIfSucceeded(result.changedFiles);
        return result;
      })
    );

    server.registerTool(
      'v8vscedit_decompile_mxl',
      {
        title: 'Декомпилировать MXL-макет',
        description: [
          'Возвращает редактируемый JSON DSL по существующему Template.xml табличного документа.',
          'Принимает канонический путь макета: Справочники.X.Макет.СчетФактура или ОбщиеМакеты.X.',
        ].join(' '),
        inputSchema: z.object({
          path: z.string(),
          configuration: z.string().optional(),
        }),
      },
      ({ path: canonical, configuration }) => this.wrap(() => {
        const templatePath = resolveTemplateXmlByCanonical(paths, canonical, configuration);
        return this.services.mxlTemplateService.decompile({ templatePath });
      })
    );

    server.registerTool(
      'v8vscedit_skd_info',
      {
        title: 'Информация о СКД',
        description: [
          'Возвращает наборы, запросы, поля, итоги, параметры и варианты СКД.',
          'Принимает канонический путь макета: Отчеты.X.Макет.ОсновнаяСхема.',
        ].join(' '),
        inputSchema: z.object({
          path: z.string(),
          configuration: z.string().optional(),
          mode: z.enum(['overview', 'query', 'fields', 'calculated', 'resources', 'params', 'variant', 'full']).optional(),
          name: z.string().optional(),
          limit: z.number().int().min(1).max(1000).optional(),
          offset: z.number().int().min(0).optional(),
        }),
      },
      ({ path: canonical, configuration, ...rest }) => this.wrap(() => {
        const templatePath = resolveTemplateXmlByCanonical(paths, canonical, configuration);
        return this.services.dataCompositionSchemaService.info({ ...rest, templatePath });
      })
    );

    server.registerTool(
      'v8vscedit_validate_skd',
      {
        title: 'Валидировать СКД',
        description: [
          'Проверяет Template.xml схемы компоновки данных: XML, дубли наборов, полей и параметров.',
          'Принимает канонический путь макета: Отчеты.X.Макет.ОсновнаяСхема.',
        ].join(' '),
        inputSchema: z.object({
          path: z.string(),
          configuration: z.string().optional(),
          detailed: z.boolean().optional(),
          maxErrors: z.number().int().min(1).max(500).optional(),
        }),
      },
      ({ path: canonical, configuration, ...rest }) => this.wrap(() => {
        const templatePath = resolveTemplateXmlByCanonical(paths, canonical, configuration);
        return this.services.dataCompositionSchemaService.validate({ ...rest, templatePath });
      })
    );

    server.registerTool(
      'v8vscedit_compile_skd',
      {
        title: 'Скомпилировать СКД',
        description: [
          'Перезаписывает содержимое существующей СКД Template.xml из JSON DSL.',
          'Для новой СКД сначала используй v8vscedit_add_template с templateType="Схема компоновки данных".',
          'Принимает канонический путь существующего макета СКД.',
        ].join(' '),
        inputSchema: z.object({
          path: z.string(),
          configuration: z.string().optional(),
          definition: z.any(),
        }),
        annotations: {
          destructiveHint: true,
        },
      },
      (args) => this.wrap(() => {
        this.assertNodeEditable(paths.resolveNode(args.path, args.configuration));
        const outputPath = resolveTemplateXmlByCanonical(paths, args.path, args.configuration);
        const result = this.services.dataCompositionSchemaService.compile({ ...args, outputPath });
        // Сервис бросает исключение при провале (перехват в wrap); дошли сюда — успех.
        this.afterMutationIfSucceeded(result.changedFiles);
        return result;
      })
    );

    server.registerTool(
      'v8vscedit_edit_skd',
      {
        title: 'Изменить СКД',
        description: [
          'Точечно редактирует Template.xml СКД: поля, итоги, параметры, запрос, выборку, фильтры.',
          'Принимает канонический путь макета: Отчеты.X.Макет.ОсновнаяСхема.',
        ].join(' '),
        inputSchema: z.object({
          path: z.string(),
          configuration: z.string().optional(),
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
      ({ path: canonical, configuration, ...rest }) => this.wrap(() => {
        this.assertNodeEditable(paths.resolveNode(canonical, configuration));
        const templatePath = resolveTemplateXmlByCanonical(paths, canonical, configuration);
        const result = this.services.dataCompositionSchemaService.edit({ ...rest, templatePath });
        // Сервис бросает исключение при провале (перехват в wrap); дошли сюда — успех.
        this.afterMutationIfSucceeded(result.changedFiles);
        return result;
      })
    );

    server.registerTool(
      'v8vscedit_add_help',
      {
        title: 'Добавить встроенную справку',
        description: [
          'Создаёт Ext/Help.xml и Ext/Help/<lang>.html для объекта и проставляет',
          'IncludeHelpInContents у форм при отсутствии.',
          'Принимает канонический путь объекта: Справочники.Контрагенты.',
        ].join(' '),
        inputSchema: z.object({
          path: z.string(),
          configuration: z.string().optional(),
          lang: z.string().optional(),
          title: z.string().optional(),
        }),
        annotations: {
          destructiveHint: true,
        },
      },
      ({ path: canonical, configuration, ...rest }) => this.wrap(() => {
        this.assertNodeEditable(paths.resolveNode(canonical, configuration));
        const objectPath = resolveObjectXmlByCanonical(paths, canonical, configuration);
        const result = this.services.externalObjectService.addHelp({ ...rest, objectPath });
        // Сервис бросает исключение при провале (перехват в wrap); дошли сюда — успех.
        this.afterMutationIfSucceeded(result.changedFiles);
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
        // Сервис бросает исключение при провале (перехват в wrap); дошли сюда — успех.
        this.afterMutationIfSucceeded(result.changedFiles);
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
        // Сервис бросает исключение при провале (перехват в wrap); дошли сюда — успех.
        this.afterMutationIfSucceeded(result.changedFiles);
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
        // Сервис бросает исключение при провале (перехват в wrap); дошли сюда — успех.
        this.afterMutationIfSucceeded(result.changedFiles);
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
        // Сервис бросает исключение при провале (перехват в wrap); дошли сюда — успех.
        this.afterMutationIfSucceeded(result.changedFiles);
        return result;
      })
    );

    server.registerTool(
      'v8vscedit_form_info',
      {
        title: 'Информация о форме',
        description: [
          'Возвращает структуру управляемой формы: иерархию элементов, реквизиты,',
          'команды и события. Принимает канонический путь формы:',
          'Справочники.Контрагенты.Форма.ФормаСписка или общую форму ОбщиеФормы.X.',
        ].join(' '),
        inputSchema: z.object({
          path: z.string(),
          configuration: z.string().optional(),
          expand: z.string().optional(),
          limit: z.number().int().min(1).max(1000).optional(),
          offset: z.number().int().min(0).optional(),
        }),
      },
      ({ path: canonical, configuration, ...rest }) => this.wrap(() => {
        const formPath = resolveFormXmlByCanonical(paths, canonical, configuration);
        return this.services.formToolsService.info({ ...rest, formPath });
      })
    );

    server.registerTool(
      'v8vscedit_validate_form',
      {
        title: 'Валидировать форму',
        description: [
          'Проверяет Form.xml: версию, уникальность ID, DataPath, CommandName,',
          'события, callType, типы. Принимает канонический путь формы:',
          'Справочники.Контрагенты.Форма.ФормаСписка или ОбщиеФормы.X.',
        ].join(' '),
        inputSchema: z.object({
          path: z.string(),
          configuration: z.string().optional(),
          detailed: z.boolean().optional(),
          maxErrors: z.number().int().min(1).max(500).optional(),
        }),
      },
      ({ path: canonical, configuration, ...rest }) => this.wrap(() => {
        const formPath = resolveFormXmlByCanonical(paths, canonical, configuration);
        return this.services.formToolsService.validate({ ...rest, formPath });
      })
    );

    server.registerTool(
      'v8vscedit_add_form',
      {
        title: 'Добавить форму',
        description: [
          'Создаёт управляемую форму у объекта: Forms/<Имя>.xml, Form.xml, Module.bsl,',
          'регистрирует <Form>Имя</Form> в ChildObjects.',
          'parentPath — канонический путь объекта-владельца (Справочники.Контрагенты);',
          'name — идентификатор формы 1С (ФормаЭлемента/ФормаСписка/…).',
        ].join(' '),
        inputSchema: z.object({
          parentPath: z.string(),
          name: z.string(),
          configuration: z.string().optional(),
          purpose: z.string().optional(),
          synonym: z.string().optional(),
          setDefault: z.boolean().optional(),
          autoFill: z.boolean().optional(),
        }),
        annotations: {
          destructiveHint: true,
        },
      },
      ({ parentPath, name, configuration, ...rest }) => this.wrap(() => {
        const owner = resolveOwnerObjectXmlByCanonical(paths, parentPath, configuration);
        const objectPath = owner.xmlPath;
        if (!objectPath) {
          throw new Error(`У узла "${parentPath}" нет XML-файла.`);
        }
        this.assertNodeEditable(owner);
        const result = this.services.formToolsService.addForm({ ...rest, objectPath, formName: name });
        // Сервис бросает исключение при провале (перехват в wrap); дошли сюда — успех.
        this.afterMutationIfSucceeded(result.changedFiles);
        return result;
      })
    );

    server.registerTool(
      'v8vscedit_remove_form',
      {
        title: 'Удалить форму',
        description: [
          'Удаляет форму у объекта: каталог формы, дескриптор Forms/<Имя>.xml,',
          'снимает регистрацию из ChildObjects и очищает DefaultForm/DefaultObjectForm/…',
          'Принимает канонический путь формы: Справочники.Контрагенты.Форма.ФормаСписка.',
        ].join(' '),
        inputSchema: z.object({
          path: z.string(),
          configuration: z.string().optional(),
        }),
        annotations: {
          destructiveHint: true,
        },
      },
      ({ path: canonical, configuration }) => this.wrap(() => {
        const node = paths.resolveNode(canonical, configuration);
        if (node.nodeKind !== 'Form' || !node.metaContext?.ownerObjectXmlPath) {
          throw new Error(`Путь "${canonical}" должен указывать на форму объекта (Справочники.X.Форма.Y).`);
        }
        this.assertNodeEditable(node);
        const result = this.services.formToolsService.removeForm({
          objectPath: node.metaContext.ownerObjectXmlPath,
          formName: node.textLabel,
        });
        // Сервис бросает исключение при провале (перехват в wrap); дошли сюда — успех.
        this.afterMutationIfSucceeded(result.changedFiles);
        return result;
      })
    );

    server.registerTool(
      'v8vscedit_compile_form',
      {
        title: 'Скомпилировать форму',
        description: [
          'Перезаписывает Form.xml из JSON DSL (целиком).',
          'Для создания новой формы с регистрацией в объекте и Module.bsl используй v8vscedit_add_form.',
          'Принимает канонический путь существующей формы: Справочники.X.Форма.Y или ОбщиеФормы.X.',
        ].join(' '),
        inputSchema: z.object({
          path: z.string(),
          configuration: z.string().optional(),
          definition: z.any().optional(),
          fromObject: z.boolean().optional(),
        }),
        annotations: {
          destructiveHint: true,
        },
      },
      ({ path: canonical, configuration, ...rest }) => this.wrap(() => {
        this.assertNodeEditable(paths.resolveNode(canonical, configuration));
        const outputPath = resolveFormXmlByCanonical(paths, canonical, configuration);
        const result = this.services.formToolsService.compile({ ...rest, outputPath });
        // Сервис бросает исключение при провале (перехват в wrap); дошли сюда — успех.
        this.afterMutationIfSucceeded(result.changedFiles);
        return result;
      })
    );

    server.registerTool(
      'v8vscedit_edit_form',
      {
        title: 'Изменить форму',
        description: [
          'Точечно добавляет элементы, реквизиты, команды и события в существующий Form.xml.',
          'Не перезаписывает форму целиком (в отличие от compile).',
          'Принимает канонический путь формы: Справочники.X.Форма.Y или ОбщиеФормы.X.',
        ].join(' '),
        inputSchema: z.object({
          path: z.string(),
          configuration: z.string().optional(),
          definition: z.any(),
        }),
        annotations: {
          destructiveHint: true,
        },
      },
      (args) => this.wrap(() => {
        this.assertNodeEditable(paths.resolveNode(args.path, args.configuration));
        const formPath = resolveFormXmlByCanonical(paths, args.path, args.configuration);
        const result = this.services.formToolsService.edit({ ...args, formPath });
        // Сервис бросает исключение при провале (перехват в wrap); дошли сюда — успех.
        this.afterMutationIfSucceeded(result.changedFiles);
        return result;
      })
    );

    server.registerTool(
      'v8vscedit_compile_subsystem',
      {
        title: 'Создать подсистему',
        description: [
          'Создаёт XML подсистемы из JSON DSL и регистрирует её в Configuration.xml',
          'или родительской подсистеме. parentPath — канонический путь:',
          'Конфигурация / Расширение (по умолчанию) или Подсистема.X.Y.',
        ].join(' '),
        inputSchema: z.object({
          parentPath: z.string().optional(),
          configuration: z.string().optional(),
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
      ({ parentPath, configuration, definition }) => this.wrap(() => {
        const canonicalParent = parentPath ?? 'Конфигурация';
        const parsed = parseCanonicalPath(canonicalParent);
        let outputDir: string;
        let subsystemParentPath: string | undefined;
        if (parsed.kind === 'subsystem') {
          subsystemParentPath = resolveSubsystemXmlByCanonical(paths, canonicalParent, configuration);
          outputDir = path.dirname(subsystemParentPath);
        } else {
          outputDir = resolveConfigurationRootDirByCanonical(paths, canonicalParent, configuration);
        }
        const result = this.services.subsystemToolsService.compile({
          outputDir,
          parentPath: subsystemParentPath,
          definition,
        });
        // Сервис бросает исключение при провале (перехват в wrap); дошли сюда — успех.
        this.afterMutationIfSucceeded(result.changedFiles);
        return result;
      })
    );

    server.registerTool(
      'v8vscedit_edit_subsystem_content',
      {
        title: 'Изменить состав подсистемы',
        description: [
          'Добавляет и убирает объекты из Content подсистемы по каноническим путям',
          'или ссылкам вида Catalog.Товары. Свойства подсистемы — через',
          'v8vscedit_get_properties и v8vscedit_set_property_by_path.',
          'Принимает канонический путь подсистемы: Подсистема.Продажи.Розница.',
        ].join(' '),
        inputSchema: z.object({
          path: z.string(),
          configuration: z.string().optional(),
          add: z.array(z.string()).optional(),
          remove: z.array(z.string()).optional(),
        }),
        annotations: {
          destructiveHint: true,
        },
      },
      ({ path: canonical, configuration, add, remove }) => this.wrap(() => {
        this.assertNodeEditable(paths.resolveNode(canonical, configuration));
        const subsystemPath = resolveSubsystemXmlByCanonical(paths, canonical, configuration);
        const result = this.services.subsystemXmlService.editContentRefs(subsystemPath, {
          add: resolveSubsystemContentRefs(paths, add ?? [], configuration),
          remove: resolveSubsystemContentRefs(paths, remove ?? [], configuration),
        });
        // Сервис бросает исключение при провале (перехват в wrap); дошли сюда — успех.
        this.afterMutationIfSucceeded(result.changedFiles);
        return result;
      })
    );

    server.registerTool(
      'v8vscedit_edit_command_interface',
      {
        title: 'Изменить командный интерфейс',
        description: [
          'Редактирует CommandInterface.xml подсистемы: hide/show/place/order/subsystem-order/group-order.',
          'Принимает канонический путь подсистемы: Подсистема.Продажи.Розница.',
          'CommandInterface.xml ищется рядом с её XML; createIfMissing создаёт его, если отсутствует.',
        ].join(' '),
        inputSchema: z.object({
          path: z.string(),
          configuration: z.string().optional(),
          createIfMissing: z.boolean().optional(),
          operations: z.array(COMMAND_INTERFACE_OPERATION_SCHEMA).min(1),
        }),
        annotations: {
          destructiveHint: true,
        },
      },
      ({ path: canonical, configuration, ...rest }) => this.wrap(() => {
        this.assertNodeEditable(paths.resolveNode(canonical, configuration));
        const ciPath = resolveCommandInterfaceXmlByCanonical(paths, canonical, configuration);
        const result = this.services.commandInterfaceService.edit({ ...rest, ciPath });
        // Сервис бросает исключение при провале (перехват в wrap); дошли сюда — успех.
        this.afterMutationIfSucceeded(result.changedFiles);
        return result;
      })
    );

    server.registerTool(
      'v8vscedit_validate_command_interface',
      {
        title: 'Валидировать командный интерфейс',
        description: [
          'Проверяет CommandInterface.xml: разделы, порядок, ссылки команд, дубли и форматы списков.',
          'Принимает канонический путь подсистемы: Подсистема.Продажи.Розница.',
        ].join(' '),
        inputSchema: z.object({
          path: z.string(),
          configuration: z.string().optional(),
          detailed: z.boolean().optional(),
          maxErrors: z.number().int().min(1).max(500).optional(),
        }),
      },
      ({ path: canonical, configuration, ...rest }) => this.wrap(() => {
        const ciPath = resolveCommandInterfaceXmlByCanonical(paths, canonical, configuration);
        return this.services.commandInterfaceService.validate({ ...rest, ciPath });
      })
    );

    server.registerTool(
      'v8vscedit_role_info',
      {
        title: 'Информация о правах роли',
        description: [
          'Возвращает разрешённые/запрещённые права, RLS и шаблоны ограничений из Rights.xml.',
          'Принимает канонический путь роли: Роли.БазовыеПрава.',
        ].join(' '),
        inputSchema: z.object({
          path: z.string(),
          configuration: z.string().optional(),
          showDenied: z.boolean().optional(),
          limit: z.number().int().min(0).max(5000).optional(),
          offset: z.number().int().min(0).optional(),
        }),
      },
      ({ path: canonical, configuration, ...rest }) => this.wrap(() => {
        const rightsPath = resolveRoleXmlByCanonical(paths, canonical, configuration);
        return this.services.roleRightsService.info({ ...rest, rightsPath });
      })
    );

    server.registerTool(
      'v8vscedit_validate_role',
      {
        title: 'Валидировать роль',
        description: [
          'Проверяет Rights.xml роли: XML, глобальные флаги, права объектов, RLS, шаблоны',
          'и регистрацию в Configuration.xml. Принимает канонический путь роли: Роли.БазовыеПрава.',
        ].join(' '),
        inputSchema: z.object({
          path: z.string(),
          configuration: z.string().optional(),
          detailed: z.boolean().optional(),
          maxErrors: z.number().int().min(1).max(500).optional(),
        }),
      },
      ({ path: canonical, configuration, ...rest }) => this.wrap(() => {
        const rightsPath = resolveRoleXmlByCanonical(paths, canonical, configuration);
        return this.services.roleRightsService.validate({ ...rest, rightsPath });
      })
    );

    server.registerTool(
      'v8vscedit_compile_role',
      {
        title: 'Создать роль из DSL',
        description: [
          'Создаёт Roles/<Имя>.xml и Roles/<Имя>/Ext/Rights.xml из JSON DSL и регистрирует',
          'роль в Configuration.xml через ChildObjects. DefaultRoles не затрагивается.',
          'parentPath — канонический путь корня: Конфигурация (по умолчанию) или Расширение.',
        ].join(' '),
        inputSchema: z.object({
          parentPath: z.string().optional(),
          configuration: z.string().optional(),
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
      ({ parentPath, configuration, definition }) => this.wrap(() => {
        const canonicalParent = parentPath ?? 'Конфигурация';
        const outputDir = resolveConfigurationRootDirByCanonical(paths, canonicalParent, configuration);
        const result = this.services.roleRightsService.compile({ outputDir, definition });
        // RoleCompileResult без булева success — сервис бросает исключение при провале
        // (перехват в wrap); дошли сюда — успех.
        this.afterMutationIfSucceeded(result.changedFiles);
        return result;
      })
    );

    server.registerTool(
      'v8vscedit_edit_role',
      {
        title: 'Точечное редактирование прав роли',
        description: [
          'Применяет операции к Rights.xml роли. Объекты задаются именами 1С с типами',
          '(Catalog.Контрагенты или Справочник.Контрагенты). Поддерживаются операции:',
          'grant/revoke/setRls/setFlags/addTemplate/removeTemplate.',
          'Принимает канонический путь роли: Роли.БазовыеПрава.',
        ].join(' '),
        inputSchema: z.object({
          path: z.string(),
          configuration: z.string().optional(),
          operations: z.array(ROLE_EDIT_OPERATION_SCHEMA).min(1),
        }),
        annotations: {
          destructiveHint: true,
        },
      },
      ({ path: canonical, configuration, operations }) => this.wrap(() => {
        this.assertNodeEditable(paths.resolveNode(canonical, configuration));
        const rightsPath = resolveRoleXmlByCanonical(paths, canonical, configuration);
        const result = this.services.roleRightsService.edit({ rightsPath, operations });
        this.afterMutationIfSucceeded(result.changedFiles, result.success);
        return result;
      })
    );

    server.registerTool(
      'v8vscedit_list_default_roles',
      {
        title: 'Список ролей по умолчанию',
        description: [
          'Возвращает текущий список <DefaultRoles> из Configuration.xml.',
          'Принимает канонический путь корня: Конфигурация или Расширение.',
        ].join(' '),
        inputSchema: z.object({
          path: z.string(),
          configuration: z.string().optional(),
        }),
      },
      ({ path: canonical, configuration }) => this.wrap(() => {
        const configPath = resolveConfigurationXmlByCanonical(paths, canonical, configuration);
        return this.services.roleRightsService.listDefaultRoles({ configPath });
      })
    );

    server.registerTool(
      'v8vscedit_add_default_role',
      {
        title: 'Добавить роль в DefaultRoles',
        description: [
          'Добавляет роль в <DefaultRoles> Configuration.xml.',
          'role — имя роли (БазовыеПрава) или полная ссылка (Role.БазовыеПрава).',
          'Принимает канонический путь корня: Конфигурация или Расширение.',
        ].join(' '),
        inputSchema: z.object({
          path: z.string(),
          configuration: z.string().optional(),
          role: z.string(),
        }),
        annotations: {
          destructiveHint: true,
        },
      },
      ({ path: canonical, configuration, role }) => this.wrap(() => {
        const configPath = resolveConfigurationXmlByCanonical(paths, canonical, configuration);
        const result = this.services.roleRightsService.addDefaultRole({ configPath, role });
        this.afterMutationIfSucceeded(result.changedFiles, result.success);
        return result;
      })
    );

    server.registerTool(
      'v8vscedit_remove_default_role',
      {
        title: 'Удалить роль из DefaultRoles',
        description: [
          'Убирает роль из <DefaultRoles> Configuration.xml.',
          'role — имя роли (БазовыеПрава) или полная ссылка (Role.БазовыеПрава).',
          'Принимает канонический путь корня: Конфигурация или Расширение.',
        ].join(' '),
        inputSchema: z.object({
          path: z.string(),
          configuration: z.string().optional(),
          role: z.string(),
        }),
        annotations: {
          destructiveHint: true,
        },
      },
      ({ path: canonical, configuration, role }) => this.wrap(() => {
        const configPath = resolveConfigurationXmlByCanonical(paths, canonical, configuration);
        const result = this.services.roleRightsService.removeDefaultRole({ configPath, role });
        this.afterMutationIfSucceeded(result.changedFiles, result.success);
        return result;
      })
    );

    server.registerTool(
      'v8vscedit_set_default_roles',
      {
        title: 'Задать список DefaultRoles',
        description: [
          'Полностью заменяет список <DefaultRoles> в Configuration.xml.',
          'Каждое имя нормализуется в форму Role.<Имя>.',
          'Принимает канонический путь корня: Конфигурация или Расширение.',
        ].join(' '),
        inputSchema: z.object({
          path: z.string(),
          configuration: z.string().optional(),
          roles: z.array(z.string()),
        }),
        annotations: {
          destructiveHint: true,
        },
      },
      ({ path: canonical, configuration, roles }) => this.wrap(() => {
        const configPath = resolveConfigurationXmlByCanonical(paths, canonical, configuration);
        const result = this.services.roleRightsService.setDefaultRoles({ configPath, roles });
        this.afterMutationIfSucceeded(result.changedFiles, result.success);
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
        // Сервис бросает исключение при провале (перехват в wrap); дошли сюда — успех.
        this.afterMutationIfSucceeded(result.changedFiles);
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
        // Сервис бросает исключение при провале (перехват в wrap); дошли сюда — успех.
        this.afterMutationIfSucceeded(result.changedFiles);
        return result;
      })
    );

    server.registerTool(
      'v8vscedit_get_properties',
      {
        title: 'Свойства объекта по пути',
        description: [
          'Возвращает ВСЕ свойства узла, включая readonly, со всеми допустимыми',
          'enum/multiEnum-значениями. Каждый контракт содержит propertyKey, title,',
          'kind, currentValue, supportedBySetProperty и notes. Свойства с kind=',
          '"metadataType" (Type/Source/CommandParameterType) сами список значений',
          'не несут — в notes указано, какой tool вызывать для смены и получения',
          'списка доступных типов.',
        ].join(' '),
        inputSchema: z.object({
          path: z.string(),
          configuration: z.string().optional(),
        }),
      },
      ({ path: canonical, configuration }) => this.wrap(() => {
        const node = paths.resolveNode(canonical, configuration);
        return properties.getPropertyContracts(node);
      })
    );

    server.registerTool(
      'v8vscedit_set_property_by_path',
      {
        title: 'Изменить свойство по пути',
        description: [
          'Меняет простое свойство объекта по каноническому пути с проверками enum/boolean/readonly.',
          'Корневые свойства доступны по path="Конфигурация" или "Расширение".',
          'Для DefaultRoles удобнее v8vscedit_add_default_role / set_default_roles.',
        ].join(' '),
        inputSchema: z.object({
          path: z.string(),
          configuration: z.string().optional(),
          propertyKey: z.string(),
          value: z.unknown(),
        }),
        annotations: {
          destructiveHint: true,
        },
      },
      ({ path: canonical, configuration, propertyKey, value }) => this.wrap(() => {
        const node = paths.resolveNode(canonical, configuration);
        this.assertNodeEditable(node);
        const result = properties.setProperty(node, propertyKey, value);
        this.afterMutationIfSucceeded(result.changedFiles, result.success);
        return result;
      })
    );

    server.registerTool(
      'v8vscedit_set_properties',
      {
        title: 'Пакетная смена свойств по пути',
        description: [
          'Меняет несколько простых свойств объекта за один вызов. properties —',
          'объект вида { propertyKey: value, ... }, ключи — английские имена свойств',
          'из v8vscedit_get_properties. Применяет последовательно, в отчёте',
          'показывает результат каждой пары. Для типов (Type/Source/CommandParameterType)',
          'используй v8vscedit_set_type — set_properties их пропустит.',
        ].join(' '),
        inputSchema: z.object({
          path: z.string(),
          configuration: z.string().optional(),
          properties: z.record(z.string(), z.unknown()),
        }),
        annotations: {
          destructiveHint: true,
        },
      },
      ({ path: canonical, configuration, properties: propertiesInput }) => this.wrap(() => {
        const resolved = paths.resolveNodeSafe(canonical, configuration);
        if (!resolved.exists || !resolved.node) {
          throw new Error(`Метаданные по пути "${canonical}" не найдены.`);
        }
        const node = resolved.node;
        this.assertNodeEditable(node);
        const totalRequested = Object.keys(propertiesInput).length;
        const result = properties.setProperties(node, propertiesInput);
        // McpSetPropertiesResult не несёт булева success: успех выражается наличием
        // реально применённых правок — сервис кладёт в changedFiles только их.
        this.afterMutationIfSucceeded(result.changedFiles);
        return {
          path: resolved.canonical,
          totalRequested,
          applied: result.applied,
          failed: result.failed,
          changedFiles: result.changedFiles,
        };
      })
    );

    server.registerTool(
      'v8vscedit_list_available_types',
      {
        title: 'Доступные типы 1С',
        description: [
          'Возвращает стандартные и конфигурационные типы для свойства Тип / Источник /',
          'Тип параметра команды. Для CFE показывает только собственные и заимствованные',
          'объекты текущего расширения. Используй русское поле value при вызове set_type.',
        ].join(' '),
        inputSchema: z.object({
          path: z.string().optional(),
          configuration: z.string().optional(),
          propertyKey: z.string().optional(),
        }),
      },
      ({ path: canonical, configuration, propertyKey }) => this.wrap(() => {
        const node = canonical ? paths.resolveNode(canonical, configuration) : undefined;
        return properties.getAvailableTypes(node, propertyKey ?? 'Type');
      })
    );

    server.registerTool(
      'v8vscedit_set_type',
      {
        title: 'Изменить тип объекта',
        description: [
          'Меняет свойство Тип / Источник / Тип параметра команды по каноническому пути.',
          'Перед ссылочным типом вызови v8vscedit_list_available_types для того же path.',
          'Принимает русские имена типов и квалификаторы (длина/точность).',
        ].join(' '),
        inputSchema: z.object({
          path: z.string(),
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
      ({ path: canonical, configuration, propertyKey, ...typeInput }) => this.wrap(() => {
        const node = paths.resolveNode(canonical, configuration);
        this.assertNodeEditable(node);
        const result = properties.setType(node, propertyKey ?? 'Type', normalizeSetTypeToolInput(typeInput));
        this.afterMutationIfSucceeded(result.changedFiles, result.success);
        return result;
      })
    );

    server.registerTool(
      'v8vscedit_rename_metadata',
      {
        title: 'Переименовать метаданные',
        description: [
          'Переименовывает объект или дочерний элемент по каноническому пути.',
          'Для корневого объекта обновляет файл, каталог, ChildObjects и ссылки.',
          'Принимает канонический путь: Справочники.Контрагенты.',
        ].join(' '),
        inputSchema: z.object({
          path: z.string(),
          configuration: z.string().optional(),
          newName: z.string(),
        }),
        annotations: {
          destructiveHint: true,
        },
      },
      ({ path: canonical, configuration, newName }) => this.wrap(() => {
        const node = paths.resolveNode(canonical, configuration);
        this.assertNodeEditable(node);
        const result = properties.rename(node, newName);
        this.afterMutationIfSucceeded(result.changedFiles, result.success);
        return result;
      })
    );

    // Декомпозированные tools добавления (E8): отдельный tool на каждый корневой
    // MetaKind и каждый дочерний ChildTag. Бывший общий `v8vscedit_add_metadata_by_path`
    // удалён — он заставлял агента угадывать childTag/templateType/canonical.
    registerAllAddTools(server, {
      paths,
      mutations,
      // registerAllAddTools вызывает этот колбэк только при result.success (см.
      // if(result.success) в McpAddToolsRegistration) — success уже проверен на
      // стороне вызывающего, поэтому шлюз гейтит лишь по непустому списку файлов.
      afterMutation: (changedFiles) => this.afterMutationIfSucceeded(changedFiles),
      wrapAsync: (fn) => this.wrapAsync(fn),
    });

    server.registerTool(
      'v8vscedit_remove_metadata',
      {
        title: 'Удалить метаданные',
        description: [
          'Удаляет объект или дочерний элемент по каноническому пути через общий сервис',
          'удаления (используется и UI). Не удаляй XML/каталоги вручную.',
          'Принимает канонический путь: Справочники.Контрагенты или Справочники.X.ИНН.',
        ].join(' '),
        inputSchema: z.object({
          path: z.string(),
          configuration: z.string().optional(),
          keepFiles: z.boolean().optional(),
        }),
        annotations: {
          destructiveHint: true,
        },
      },
      ({ path: canonical, configuration, keepFiles }) => this.wrap(() => {
        const node = paths.resolveNode(canonical, configuration);
        if (!node.xmlPath || !node.canRemoveMetadata) {
          throw new Error(`Узел "${node.textLabel}" не поддерживает удаление метаданных.`);
        }
        this.assertNodeEditable(node);
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
          this.afterMutationIfSucceeded(result.changedFiles, result.success);
          this.services.dynamicPanelController.handleMetadataRemoved(node);
          this.services.subsystemEditorViewProvider.handleMetadataRemoved();
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
        // CfeBorrowService сигналит провал исключением (перехват в wrap), а при
        // alreadyBorrowed возвращает пустой files — гейт по списку изменённых файлов.
        this.afterMutationIfSucceeded(result.files);
        return result;
      })
    );

    server.registerTool(
      'v8vscedit_cfe_patch_method',
      {
        title: 'Добавить перехватчик метода CFE',
        description: [
          'Создаёт или дописывает BSL-модуль расширения перехватчиком &Перед/&После/&ИзменениеИКонтроль.',
          'path — канонический путь модуля расширения: Справочники.X.МодульОбъекта,',
          'Справочники.X.Форма.Y.МодульФормы, ОбщиеМодули.X. Модуль может пока отсутствовать.',
        ].join(' '),
        inputSchema: z.object({
          extensionPath: z.string(),
          path: z.string(),
          methodName: z.string(),
          interceptorType: z.enum(['Before', 'After', 'ModificationAndControl']),
          context: z.string().optional(),
          isFunction: z.boolean().optional(),
        }),
        annotations: {
          destructiveHint: true,
        },
      },
      ({ path: canonical, ...rest }) => this.wrap(() => {
        const modulePath = canonicalToLegacyModulePath(canonical);
        const result = this.services.cfePatchMethodService.addMethodInterceptor({ ...rest, modulePath });
        // Сервис бросает исключение при провале (перехват в wrap); дошли сюда — успех.
        this.afterMutationIfSucceeded(result.changedFiles);
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
      // Защита от DNS-rebinding: даже при loopback-соединении сторонняя
      // веб-страница в браузере может слать запросы на 127.0.0.1 с произвольным
      // Host/Origin. Принимаем только обращения к ожидаемому loopback-endpoint.
      if (!this.isAllowedHostAndOrigin(req)) {
        res.writeHead(403).end('MCP server rejects request: unexpected Host/Origin.');
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

  /**
   * Проверяет заголовки `Host` и `Origin` против ожидаемого loopback-endpoint.
   * `Host` обязателен и должен входить в `allowedHosts`. `Origin` присутствует
   * в кросс-сайтовых запросах из браузера — если задан, его хост:порт тоже
   * обязан совпасть с разрешённым; легитимные MCP-клиенты Origin не шлют.
   */
  private isAllowedHostAndOrigin(req: http.IncomingMessage): boolean {
    const host = getHeaderString(req, 'host');
    if (!host || !this.allowedHosts.has(host.toLowerCase())) {
      return false;
    }
    const origin = getHeaderString(req, 'origin');
    if (origin !== undefined) {
      const originHost = parseOriginHost(origin);
      if (!originHost || !this.allowedHosts.has(originHost)) {
        return false;
      }
    }
    return true;
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

  /**
   * Перед мутацией существующего объекта повторяет проверки UI: объект на
   * поддержке без права редактирования (`SupportMode.Locked`) или не захвачен
   * в подключённом хранилище конфигурации блокируется. Защищает .cf-объекты;
   * для объектов вне поддержки/хранилища обе проверки возвращают «разрешено».
   *
   * `objectXmlPath` — XML-файл объекта-владельца (для дочерних элементов это
   * `metaContext.ownerObjectXmlPath`), как и в `RemoveMetadataCommand` /
   * `PropertiesViewController`.
   */
  private assertMetadataEditable(objectXmlPath: string | undefined): void {
    if (!objectXmlPath) {
      throw new Error('Не удалось определить XML-файл объекта для проверки блокировки изменения.');
    }
    if (this.services.supportService?.getSupportMode(objectXmlPath) === SupportMode.Locked) {
      throw new Error('Объект защищён от изменения: находится на поддержке с запретом редактирования.');
    }
    if (this.services.repositoryService.isEditRestricted(objectXmlPath)) {
      throw new Error('Объект защищён от изменения: не захвачен в хранилище конфигурации.');
    }
  }

  /**
   * Резолвит путь объекта-владельца у узла дерева так же, как UI
   * (`metaContext.ownerObjectXmlPath ?? xmlPath`) и проверяет блокировку.
   */
  private assertNodeEditable(node: MetadataNode): void {
    this.assertMetadataEditable(node.metaContext?.ownerObjectXmlPath ?? node.xmlPath);
  }

  private afterMutation(filePaths: readonly string[]): void {
    if (filePaths.length === 0) {
      return;
    }
    this.services.suppressConfigurationReloadForFiles([...filePaths]);
    this.services.markChangedConfigurationByFiles([...filePaths]);
    // refreshCacheForFiles сам эмитит onDidChangeTreeData (точечно для изменённых
    // узлов или полным refresh внутри). Дополнительный refresh() дублировал бы
    // работу — десятки тысяч new MetadataNode на больших конфигурациях. Делаем
    // его только если refreshCacheForFiles ничего не обновил (нет совпавших
    // конфигураций — например, файлы вне дерева).
    const refreshed = this.services.treeProvider.refreshCacheForFiles([...filePaths]);
    if (!refreshed) {
      this.services.treeProvider.refresh();
    }
    this.services.refreshActionsView();
  }

  /**
   * Единый guarded-шлюз post-mutation (Волна 5b, M8). Гейт по факту успеха
   * мутации: если результат помечен неуспешным (`succeeded === false`),
   * конфигурация НЕ помечается изменённой и дерево НЕ рефрешится — иначе при
   * частичном провале UI зря считал бы конфигурацию грязной. Формы результата,
   * не несущие явного `success` (сервис сигналит провал исключением внутри
   * `wrap`/`wrapAsync`), проходят с `succeeded=true`, а фактический гейт для них
   * даёт пустой список изменённых файлов (см. `afterMutation`).
   */
  private afterMutationIfSucceeded(changedFiles: readonly string[] | undefined, succeeded = true): void {
    if (!succeeded) {
      return;
    }
    const files = changedFiles ?? [];
    if (files.length === 0) {
      return;
    }
    this.afterMutation([...files]);
  }
}

function formatHostForUrl(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

/**
 * Набор допустимых значений `Host`/`Origin`-host для реального порта сервера.
 * Сервер всегда слушает loopback, поэтому ожидаем именно loopback-имена:
 * `127.0.0.1:<port>`, `[::1]:<port>`, `localhost:<port>`. Значения в нижнем
 * регистре — сравнение в `isAllowedHostAndOrigin` тоже регистронезависимое.
 */
function buildAllowedHosts(port: number): Set<string> {
  const suffix = `:${String(port)}`;
  return new Set([
    `127.0.0.1${suffix}`,
    `[::1]${suffix}`,
    `localhost${suffix}`,
  ]);
}

/**
 * Извлекает `host:port` из значения заголовка `Origin` в нижнем регистре.
 * Возвращает undefined для `null`/невалидного Origin (такой запрос отклоняется).
 */
function parseOriginHost(origin: string): string | undefined {
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * Возвращает реестр платформенных типов для указанного контекста.
 *
 * `configuration` нужна только для генерации ссылочных групп (`Справочник.X`,
 * `Документ.X`, …). Если конфигураций больше одной и `configuration` не задан,
 * возвращается только базовая группа без ссылочных типов.
 */
function listSupportedTypes(
  treeProvider: McpCommandServices['treeProvider'],
  context: TypeContext,
  configuration: string | undefined,
): {
  readonly context: TypeContext;
  readonly groups: ReturnType<typeof getPlatformTypeRegistry>;
} {
  const entries = treeProvider.getEntries();
  let configXmlPath: string | undefined;
  if (entries.length === 1) {
    configXmlPath = path.join(entries[0].rootPath, 'Configuration.xml');
  } else if (configuration && configuration.trim().length > 0) {
    const normalized = configuration.trim().toLocaleLowerCase('ru-RU');
    const match = entries.find((entry) => {
      const baseName = path.basename(entry.rootPath).toLocaleLowerCase('ru-RU');
      return baseName === normalized || entry.rootPath.toLocaleLowerCase('ru-RU') === normalized;
    });
    if (match) {
      configXmlPath = path.join(match.rootPath, 'Configuration.xml');
    }
  }
  // Без configXmlPath реестр вернёт только базовую группу — это ровно требуемое поведение
  // при отсутствии однозначного выбора конфигурации.
  const groups = getPlatformTypeRegistry(configXmlPath, context);
  return { context, groups };
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
  if (!def.folder || def.group === 'service' || def.group === 'root' || def.group === 'child' || node.nodeKind === 'Subsystem') {
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
