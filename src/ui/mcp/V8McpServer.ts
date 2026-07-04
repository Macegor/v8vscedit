import * as http from 'http';
import { randomUUID } from 'crypto';
import type * as vscode from 'vscode';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { ConfigurationXmlEditor } from '../../infra/xml';
import { MetadataMutationService } from '../commands/metadata/MetadataMutationService';
import type { CommandServices } from '../commands/_shared';
import { registerAllAddTools } from './McpAddToolsRegistration';
import { McpMutationGate } from './registration/McpMutationGate';
import type { McpRegistrationDeps } from './registration/McpRegistrationDeps';
import { registerNavigationTools } from './registration/McpNavigationTools';
import { registerConfigInfoTools } from './registration/McpConfigInfoTools';
import { registerTemplateTools } from './registration/McpTemplateTools';
import { registerExternalObjectTools } from './registration/McpExternalObjectTools';
import { registerFormTools } from './registration/McpFormTools';
import { registerSubsystemTools } from './registration/McpSubsystemTools';
import { registerRoleTools } from './registration/McpRoleTools';
import { registerConfigLifecycleTools } from './registration/McpConfigLifecycleTools';
import { registerPropertyTools } from './registration/McpPropertyTools';
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
    const gate = new McpMutationGate(this.services);
    const deps: McpRegistrationDeps = {
      services: this.services,
      xmlEditor: this.xmlEditor,
      paths,
      properties,
      mutations,
      gate,
    };

    registerNavigationTools(server, deps);

    registerConfigInfoTools(server, deps);
    registerTemplateTools(server, deps);
    registerExternalObjectTools(server, deps);
    registerFormTools(server, deps);
    registerSubsystemTools(server, deps);
    registerRoleTools(server, deps);
    registerConfigLifecycleTools(server, deps);
    registerPropertyTools(server, deps);

    // Декомпозированные tools добавления (E8): отдельный tool на каждый корневой
    // MetaKind и каждый дочерний ChildTag. Бывший общий `v8vscedit_add_metadata_by_path`
    // удалён — он заставлял агента угадывать childTag/templateType/canonical.
    registerAllAddTools(server, {
      paths,
      mutations,
      // registerAllAddTools вызывает этот колбэк только при result.success (см.
      // if(result.success) в McpAddToolsRegistration) — success уже проверен на
      // стороне вызывающего, поэтому шлюз гейтит лишь по непустому списку файлов.
      afterMutation: (changedFiles) => gate.afterMutationIfSucceeded(changedFiles),
      wrapAsync: (fn) => gate.wrapAsync(fn),
    });
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

