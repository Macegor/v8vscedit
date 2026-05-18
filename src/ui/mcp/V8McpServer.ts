import * as http from 'http';
import * as vscode from 'vscode';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import * as z from 'zod/v4';
import { META_TYPES } from '../../domain/MetaTypes';
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
    this.endpoint = `http://${options.host}:${String(port)}/mcp`;
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
}
