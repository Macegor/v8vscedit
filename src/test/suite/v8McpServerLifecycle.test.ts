/**
 * Интеграционные тесты доработанного жизненного цикла `V8McpServer`:
 * publish identity (`GET /identity`), graceful shutdown (`POST /shutdown`),
 * решение reuse/conflict-foreign/conflict-unknown при занятом порте,
 * `forceRestart` и корректное завершение `stop()` при открытом SSE-потоке
 * (`closeAllConnections`).
 *
 * Все сценарии — на РЕАЛЬНЫХ `V8McpServer` и реальном сетевом стеке
 * (127.0.0.1, эфемерные порты), без единого мока сервера или транспорта.
 * Для установления настоящей MCP-сессии используется тот же
 * `@modelcontextprotocol/sdk`, которым пользуется production-код —
 * `Client` + `StreamableHTTPClientTransport` (тот самый пакет, что уже
 * зависимость расширения, а не подстава внешней системы).
 *
 * `CommandServices` собраны минимальным стабом: тесты этого файла не
 * вызывают ни один зарегистрированный MCP-инструмент (только
 * start/stop/forceRestart/identity/shutdown), поэтому реальные
 * бизнес-сервисы конфигурации не нужны — по аналогии с тем, что
 * `registerTools` лишь регистрирует схемы инструментов и не обращается
 * к сервисам до вызова конкретного handler'а (см. `mcpToolsCatalog.test.ts`).
 */
import * as assert from 'assert';
import * as http from 'http';
import * as net from 'net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { V8McpServer } from '../../ui/mcp/V8McpServer';
import { ConfigurationXmlEditor } from '../../infra/xml';
import type { CommandServices } from '../../ui/commands/_shared';
import { parseIdentity, PRODUCT_ID, IDENTITY_PROTOCOL } from '../../infra/mcp/McpServerIdentity';
import { probeIdentity } from '../../infra/mcp/McpPortProbe';

const HOST = '127.0.0.1';

function reserveFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, HOST, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : undefined;
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        if (port === undefined) {
          reject(new Error('не удалось определить свободный порт'));
          return;
        }
        resolve(port);
      });
    });
  });
}

function canBindPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, HOST, () => probe.close(() => resolve(true)));
  });
}

function waitUntilTrue(check: () => boolean | Promise<boolean>, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      Promise.resolve(check()).then((value) => {
        if (value) {
          resolve(true);
          return;
        }
        if (Date.now() > deadline) {
          resolve(false);
          return;
        }
        setTimeout(tick, 50);
      }).catch(() => {
        if (Date.now() > deadline) {
          resolve(false);
          return;
        }
        setTimeout(tick, 50);
      });
    };
    tick();
  });
}

/**
 * Минимальный набор `CommandServices`: тело `registerTools` вызывается
 * только при установлении реальной MCP-сессии (см. `createSession` в
 * `V8McpServer`) и лишь РЕГИСТРИРУЕТ схемы инструментов — ни один handler
 * здесь не вызывается, поэтому реальные бизнес-сервисы избыточны.
 */
function createMinimalServices(): CommandServices {
  const treeProvider = { getAutomationRoots: () => [], getEntries: () => [] };
  return {
    treeProvider,
    outputChannel: { appendLine: () => undefined },
  } as unknown as CommandServices;
}

function createServer(projectRoot: string, version = '0.4.1-test'): V8McpServer {
  return new V8McpServer(createMinimalServices(), new ConfigurationXmlEditor(), projectRoot, version);
}

function httpGet(port: number, urlPath: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: HOST, port, path: urlPath, method: 'GET', headers: { host: `${HOST}:${String(port)}`, ...headers } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf-8') }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function httpPost(port: number, urlPath: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: HOST, port, path: urlPath, method: 'POST', headers: { host: `${HOST}:${String(port)}`, ...headers } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf-8') }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/**
 * Перехватывает СЕРВЕРНЫЙ `http.ServerResponse` первого GET `/mcp`-запроса,
 * пришедшего на данный порт, — это и есть standalone SSE-поток, который
 * `StreamableHTTPClientTransport` открывает сам после `notifications/initialized`
 * (см. комментарий в тесте ниже). Временно оборачивает `http.Server.prototype.emit`
 * вместо доступа к приватному `httpServer` внутри `V8McpServer` и снимает
 * обёртку сразу после первого совпадения, чтобы не задевать другие тесты.
 */
function captureStandaloneSseResponse(port: number, timeoutMs = 3000): Promise<http.ServerResponse> {
  // Ссылка сохраняется намеренно для monkey-patch'а прототипа на время теста;
  // `this` ниже контролируется явно через `.apply(this, ...)`, а не теряется.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalEmit: typeof http.Server.prototype.emit = http.Server.prototype.emit;
  let settled = false;
  return new Promise((resolve, reject) => {
    const restore = () => {
      http.Server.prototype.emit = originalEmit;
    };
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      restore();
      reject(new Error('SDK-клиент не открыл собственный standalone SSE-поток за отведённое время'));
    }, timeoutMs);
    const patchedEmit: typeof originalEmit = function (this: http.Server, event: string | symbol, ...args: unknown[]) {
      if (!settled && event === 'request') {
        const req = args[0] as http.IncomingMessage;
        const res = args[1] as http.ServerResponse;
        if (req.method === 'GET' && req.url === '/mcp' && req.socket.localPort === port) {
          settled = true;
          clearTimeout(timer);
          restore();
          void waitForResponseHeaders(res, timeoutMs).then(
            () => resolve(res),
            (error: unknown) => reject(error instanceof Error ? error : new Error(String(error))),
          );
        }
      }
      return originalEmit.apply(this, [event, ...args] as Parameters<typeof originalEmit>);
    };
    http.Server.prototype.emit = patchedEmit;
  });
}

/**
 * То же самое, что `reserveFreePort`, но для произвольного host — нужен для
 * IPv6-набора ниже, где `HOST` (127.0.0.1) не подходит.
 */
function reserveFreePortOnHost(host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : undefined;
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        if (port === undefined) {
          reject(new Error('не удалось определить свободный порт'));
          return;
        }
        resolve(port);
      });
    });
  });
}

/**
 * Проверяет реальную доступность IPv6-loopback в текущей среде: пытается
 * забиндиться на `::1`. В CI/контейнерах без IPv6-стека bind упадёт с ошибкой —
 * набор ниже обязан честно скипаться (`this.skip()`), а не падать по
 * инфраструктурной причине, не связанной с проверяемым багом.
 */
function canBindIPv6Loopback(): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(0, '::1', () => {
      probe.close(() => resolve(true));
    });
  });
}

/** Дожидается, пока сервер реально отправит заголовки ответа (writeHead выполнен). */
function waitForResponseHeaders(res: http.ServerResponse, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (res.headersSent) {
        resolve();
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error('сервер не отправил заголовки standalone SSE-потока за отведённое время'));
        return;
      }
      setTimeout(tick, 5);
    };
    tick();
  });
}

suite('V8McpServer — жизненный цикл (identity, reuse/conflict, forceRestart, shutdown)', () => {
  const spawnedServers: V8McpServer[] = [];

  teardown(async function () {
    this.timeout(10000);
    const servers = spawnedServers.splice(0);
    await Promise.all(servers.map((server) => server.stop().catch(() => undefined)));
  });

  test('start на свободном порту → started; повторный start на уже запущенном сервере идемпотентен', async () => {
    const port = await reserveFreePort();
    const server = createServer('/tmp/v8vscedit-fixture/project-idempotent');
    spawnedServers.push(server);

    const first = await server.start({ host: HOST, port });
    assert.deepStrictEqual(first, { kind: 'started', endpoint: `http://${HOST}:${String(port)}/mcp` });

    const second = await server.start({ host: HOST, port });
    assert.deepStrictEqual(
      second, { kind: 'started', endpoint: `http://${HOST}:${String(port)}/mcp` },
      'повторный start уже запущенного сервера не должен пытаться забиндиться заново — должен просто вернуть тот же started',
    );
  });

  test('два инстанса на одном порту с ОДИНАКОВЫМ projectRoot: второй получает reuse', async () => {
    const port = await reserveFreePort();
    const projectRoot = '/tmp/v8vscedit-fixture/project-reuse';
    const serverA = createServer(projectRoot);
    const serverB = createServer(projectRoot);
    spawnedServers.push(serverA, serverB);

    const resultA = await serverA.start({ host: HOST, port });
    assert.strictEqual(resultA.kind, 'started');

    const resultB = await serverB.start({ host: HOST, port });
    assert.deepStrictEqual(resultB, { kind: 'reuse', endpoint: `http://${HOST}:${String(port)}/mcp` });
  });

  test('два инстанса на одном порту с РАЗНЫМ projectRoot: второй получает conflict-foreign с occupant', async () => {
    const port = await reserveFreePort();
    const serverA = createServer('/tmp/v8vscedit-fixture/project-a', '0.4.1-a');
    const serverB = createServer('/tmp/v8vscedit-fixture/project-b', '0.4.1-b');
    spawnedServers.push(serverA, serverB);

    await serverA.start({ host: HOST, port });
    const resultB = await serverB.start({ host: HOST, port });

    assert.strictEqual(resultB.kind, 'conflict-foreign');
    // resultB сужен assert.strictEqual выше до члена conflict-foreign — occupant доступен напрямую.
    assert.strictEqual(resultB.occupant.product, PRODUCT_ID);
    assert.strictEqual(resultB.occupant.projectRoot, '/tmp/v8vscedit-fixture/project-a');
    assert.strictEqual(resultB.occupant.pid, process.pid, 'занявший порт процесс — тот же тестовый процесс Node');
    assert.strictEqual(resultB.occupant.version, '0.4.1-a');
  });

  test('порт занят сторонним http-сервером без /identity → conflict-unknown', async () => {
    const foreign = http.createServer((_req, res) => {
      res.writeHead(404).end();
    });
    const port = await new Promise<number>((resolve, reject) => {
      foreign.once('error', reject);
      foreign.listen(0, HOST, () => {
        const address = foreign.address();
        resolve(typeof address === 'object' && address ? address.port : 0);
      });
    });
    try {
      const server = createServer('/tmp/v8vscedit-fixture/project-unknown');
      spawnedServers.push(server);
      const result = await server.start({ host: HOST, port });
      assert.deepStrictEqual(result, { kind: 'conflict-unknown' });
    } finally {
      await new Promise<void>((resolve) => foreign.close(() => resolve()));
    }
  });

  test('GET /identity отдаёт корректный JSON и отвергает запрос с чужим Host (403)', async () => {
    const port = await reserveFreePort();
    const projectRoot = '/tmp/v8vscedit-fixture/project-identity';
    const server = createServer(projectRoot, '0.9.9-identity-test');
    spawnedServers.push(server);
    await server.start({ host: HOST, port });

    const ok = await httpGet(port, '/identity');
    assert.strictEqual(ok.status, 200);
    const identity = parseIdentity(JSON.parse(ok.body) as unknown);
    assert.ok(identity, 'ответ /identity должен парситься как валидная identity');
    assert.strictEqual(identity.projectRoot, projectRoot);
    assert.strictEqual(identity.version, '0.9.9-identity-test');
    assert.strictEqual(identity.protocol, IDENTITY_PROTOCOL);
    assert.strictEqual(identity.pid, process.pid);

    const forbidden = await httpGet(port, '/identity', { host: 'evil.example.com' });
    assert.strictEqual(
      forbidden.status, 403,
      '/identity обязан проходить ту же защиту от DNS-rebinding, что остальные loopback-эндпоинты',
    );
  });

  test('POST /shutdown отвечает 200 и гасит свой сервер: порт реально освобождается', async function () {
    this.timeout(5000);
    const port = await reserveFreePort();
    const server = createServer('/tmp/v8vscedit-fixture/project-shutdown');
    spawnedServers.push(server);
    await server.start({ host: HOST, port });

    const response = await httpPost(port, '/shutdown');
    assert.strictEqual(response.status, 200);

    const released = await waitUntilTrue(() => canBindPort(port), 3000);
    assert.ok(released, 'после POST /shutdown порт должен реально освободиться');
  });

  test('closeAllConnections: stop() резолвится быстро и освобождает порт при открытом SSE-потоке', async function () {
    this.timeout(10000);
    const port = await reserveFreePort();
    const server = createServer('/tmp/v8vscedit-fixture/project-sse');
    spawnedServers.push(server);
    await server.start({ host: HOST, port });

    // Настоящая MCP-сессия через SDK-клиент — так же, как её устанавливает
    // любой реальный MCP-клиент (initialize + notifications/initialized).
    //
    // `StreamableHTTPClientTransport` САМ, без await, открывает собственный
    // долгоживущий standalone GET /mcp SSE-поток сразу после того, как сервер
    // ответит 202 на `notifications/initialized` (см. node_modules
    // @modelcontextprotocol/sdk client/streamableHttp.js: `if
    // (isInitializedNotification(message)) { this._startOrAuthSse(...) }`,
    // вызов fire-and-forget — только `.catch`, без `await`). Поэтому тест
    // НЕ открывает свой второй GET-поток на ту же сессию: сервер, как и
    // требует спецификация Streamable HTTP, допускает лишь один standalone
    // SSE-поток на сессию и отверг бы второй конфликтом 409 — открытие
    // второго потока гонялось бы с уже открываемым клиентом и было
    // источником нестабильности теста. Вместо этого тест перехватывает
    // именно тот поток, что уже открыл сам SDK-клиент.
    const standaloneStream = captureStandaloneSseResponse(port);
    const client = new Client({ name: 'v8vscedit-test-client', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(`http://${HOST}:${String(port)}/mcp`));
    await client.connect(transport);
    const sessionId = transport.sessionId;
    assert.ok(sessionId, 'после initialize клиент обязан получить mcp-session-id — иначе сессия не установлена по-настоящему');

    const res = await standaloneStream;
    // 200 однозначно подтверждает успешное открытие standalone SSE-потока:
    // `handleGetRequest` (SDK) возвращает 200 ТОЛЬКО в этом случае, во всех
    // остальных ветках (406/400/404/409) поток не создаётся. Content-Type
    // из ответа здесь не проверяется: `@hono/node-server`, которым пользуется
    // `StreamableHTTPServerTransport` для конвертации web-Response в Node
    // `http.ServerResponse`, пишет заголовки в обход стандартного механизма
    // `setHeader`/`writeHead(status, headers)` — `res.getHeaders()` после
    // такой записи пуст, хотя `headersSent` уже true и реальные байты на
    // сокете корректны (сам `StreamableHTTPClientTransport`, разбирающий эти
    // байты как настоящий SSE-поток, — независимое тому доказательство).
    assert.strictEqual(res.statusCode, 200, 'клиентский SDK обязан успешно открыть собственный standalone SSE-поток');

    let socketClosed = false;
    res.socket?.on('close', () => {
      socketClosed = true;
    });
    res.on('data', () => undefined);

    const stopStartedAt = Date.now();
    await server.stop();
    const stopElapsedMs = Date.now() - stopStartedAt;
    assert.ok(
      stopElapsedMs < 3000,
      `stop() обязан резолвиться быстро даже при открытом SSE-потоке (заняло ${String(stopElapsedMs)} мс) — ` +
      'без принудительного закрытия долгоживущих соединений httpServer.close() ждёт естественного завершения потока',
    );

    const socketReallyClosed = await waitUntilTrue(() => socketClosed, 2000);
    assert.ok(socketReallyClosed, 'stop() обязан принудительно закрыть сокет открытого SSE-потока (closeAllConnections)');

    const released = await waitUntilTrue(() => canBindPort(port), 3000);
    assert.ok(released, 'после stop() порт должен реально освободиться, несмотря на ранее открытый SSE-поток');
  });

  test('forceRestart: A запущен, B.forceRestart на тот же host/port гасит A и стартует B', async function () {
    this.timeout(10000);
    const port = await reserveFreePort();
    const serverA = createServer('/tmp/v8vscedit-fixture/project-force-a', '0.4.1-a');
    const serverB = createServer('/tmp/v8vscedit-fixture/project-force-b', '0.4.1-b');
    spawnedServers.push(serverA, serverB);

    const startA = await serverA.start({ host: HOST, port });
    assert.strictEqual(startA.kind, 'started');

    const restartResult = await serverB.forceRestart({ host: HOST, port });
    assert.deepStrictEqual(restartResult, { kind: 'started', endpoint: `http://${HOST}:${String(port)}/mcp` });

    const identityAfter = await httpGet(port, '/identity');
    const parsed = parseIdentity(JSON.parse(identityAfter.body) as unknown);
    assert.strictEqual(
      parsed?.projectRoot, '/tmp/v8vscedit-fixture/project-force-b',
      'после forceRestart на порту обязан отвечать B, а не прежний владелец A',
    );
  });

  test('повторный start() на adopted-инстансе идемпотентен: возвращает reuse без нового зонда, владелец жив', async () => {
    const port = await reserveFreePort();
    const projectRoot = '/tmp/v8vscedit-fixture/project-adopted-idempotent';
    const owner = createServer(projectRoot, '0.4.1-owner-idem');
    const adopter = createServer(projectRoot, '0.4.1-adopter-idem');
    spawnedServers.push(owner, adopter);

    await owner.start({ host: HOST, port });
    const firstAdopt = await adopter.start({ host: HOST, port });
    assert.strictEqual(firstAdopt.kind, 'reuse');

    // Второй start() того же adopted-инстанса обязан пройти через ветку
    // `this.adopted ? { kind: 'reuse', ... }` в самом начале start() (endpoint
    // уже выставлен из первого reuse) — без повторного probeIdentity/decideMcpStart.
    const secondAdopt = await adopter.start({ host: HOST, port });
    assert.deepStrictEqual(
      secondAdopt, { kind: 'reuse', endpoint: `http://${HOST}:${String(port)}/mcp` },
      'повторный start() adopted-инстанса обязан идемпотентно вернуть reuse через adopted-ветку раннего выхода',
    );

    const ownerStillAlive = await httpGet(port, '/identity');
    assert.strictEqual(ownerStillAlive.status, 200, 'владелец обязан остаться живым после повторного start() адаптера');
    const parsed = parseIdentity(JSON.parse(ownerStillAlive.body) as unknown);
    assert.strictEqual(parsed?.version, '0.4.1-owner-idem');
  });

  test('forceRestart на СВОЁМ уже запущенном endpoint: сервер сначала гасит себя, затем стартует заново', async function () {
    this.timeout(10000);
    const port = await reserveFreePort();
    const projectRoot = '/tmp/v8vscedit-fixture/project-self-restart';
    const server = createServer(projectRoot, '0.4.1-self-restart-v1');
    spawnedServers.push(server);

    const started = await server.start({ host: HOST, port });
    assert.strictEqual(started.kind, 'started');

    // this.endpoint у server truthy (сам себе владелец, не adopted) — это и есть
    // ветка `if (this.endpoint) { await this.stop(); }` внутри forceRestart:
    // сервер сначала останавливает СЕБЯ, затем reclaimPort (порт уже свободен
    // после собственного stop()) и стартует заново на том же host/port.
    const restarted = await server.forceRestart({ host: HOST, port });
    assert.deepStrictEqual(restarted, { kind: 'started', endpoint: `http://${HOST}:${String(port)}/mcp` });

    const identityAfter = await httpGet(port, '/identity');
    assert.strictEqual(identityAfter.status, 200, 'после самостоятельного forceRestart /identity обязан снова отвечать');
    const parsed = parseIdentity(JSON.parse(identityAfter.body) as unknown);
    assert.strictEqual(
      parsed?.version, '0.4.1-self-restart-v1',
      'после forceRestart на своём же endpoint сервер обязан снова подняться тем же экземпляром',
    );
  });

  test('adopted-сервер (после reuse) не гасит владельца своим stop(): владелец продолжает отвечать', async () => {
    const port = await reserveFreePort();
    const projectRoot = '/tmp/v8vscedit-fixture/project-adopted';
    const owner = createServer(projectRoot, '0.4.1-owner');
    const adopter = createServer(projectRoot, '0.4.1-adopter');
    spawnedServers.push(owner);

    await owner.start({ host: HOST, port });
    const adoptResult = await adopter.start({ host: HOST, port });
    assert.strictEqual(adoptResult.kind, 'reuse');

    // adopter лишь переиспользовал чужой endpoint — он не владеет реальным
    // http.Server на этом порту, поэтому его stop() не должен трогать owner.
    await adopter.stop();

    const stillAlive = await httpGet(port, '/identity');
    assert.strictEqual(
      stillAlive.status, 200,
      'владелец (owner) обязан продолжать отвечать после stop() адаптера, который лишь переиспользовал endpoint',
    );
    const parsed = parseIdentity(JSON.parse(stillAlive.body) as unknown);
    assert.strictEqual(parsed?.version, '0.4.1-owner');
  });
});

/**
 * IPv6-loopback (`::1`): `V8McpServer.buildAllowedHosts` хранит каноничную
 * скобочную форму `[::1]:<port>` (RFC 3986 — IPv6-адрес в `Host`/URL всегда
 * в квадратных скобках), но `McpPortProbe.probeIdentity`/`requestShutdown`
 * формируют заголовок `Host` для зонда/shutdown как `${host}:${port}`, что
 * для `host === '::1'` даёт мусорную форму `"::1:<port>"` вместо `"[::1]:<port>"`.
 * Из-за этого `isAllowedHostAndOrigin` не находит присланный Host в
 * `allowedHosts` и сервер отвечает 403 на СОБСТВЕННЫЙ `/identity` — т.е.
 * сервер той же 1С-конфигурации не может ни зазондировать сам себя, ни
 * (в проде) корректно определить reuse/forceRestart при `mcp.host: "::1"`.
 *
 * Набор — env-независимый: если в текущей среде нет IPv6-loopback-стека
 * (частый случай в контейнерах CI), `canBindIPv6Loopback()` вернёт false и
 * оба теста честно скипаются через `this.skip()`, не роняя прогон.
 */
suite('V8McpServer — IPv6-loopback (::1): форма Host-заголовка в probeIdentity', () => {
  const spawnedServers: V8McpServer[] = [];
  let ipv6Available = false;

  suiteSetup(async function () {
    this.timeout(5000);
    ipv6Available = await canBindIPv6Loopback();
    if (!ipv6Available) {
      // Явный лог причины скипа — чтобы в среде без IPv6 было видно, что
      // набор не упал, а осознанно пропущен по недоступности стека.
      console.log('[v8McpServerLifecycle] IPv6-loopback (::1) недоступен в этой среде — набор IPv6 пропущен');
    }
  });

  teardown(async function () {
    this.timeout(10000);
    const servers = spawnedServers.splice(0);
    await Promise.all(servers.map((server) => server.stop().catch(() => undefined)));
  });

  test('GET /identity на ::1 реально отвечает 200, и probeIdentity(\'::1\', port) возвращает валидную identity', async function () {
    if (!ipv6Available) {
      this.skip();
      return;
    }
    const port = await reserveFreePortOnHost('::1');
    const projectRoot = '/tmp/v8vscedit-fixture/project-ipv6-identity';
    const server = createServer(projectRoot, '0.9.9-ipv6-identity');
    spawnedServers.push(server);
    const started = await server.start({ host: '::1', port });
    assert.strictEqual(started.kind, 'started');
    assert.strictEqual(started.endpoint, `http://[::1]:${String(port)}/mcp`);

    // Сам HTTP жив и отвечает (сравнение с прямым http-запросом ниже) —
    // расхождение с probeIdentity ниже однозначно укажет на баг именно в
    // форме Host-заголовка, который строит сам McpPortProbe, а не в сервере.
    const identity = await probeIdentity('::1', port);
    assert.ok(
      identity,
      'probeIdentity(\'::1\', port) обязан вернуть identity собственного сервера, а не undefined — ' +
      'сейчас McpPortProbe шлёт заголовок Host как "::1:<port>" вместо каноничного "[::1]:<port>", ' +
      'который ждёт V8McpServer.isAllowedHostAndOrigin, из-за чего /identity отвечает 403',
    );
    assert.strictEqual(identity.projectRoot, projectRoot);
    assert.strictEqual(identity.version, '0.9.9-ipv6-identity');
  });

  test('два инстанса на ::1 с одинаковым projectRoot: второй обязан получить reuse, а не conflict-unknown', async function () {
    if (!ipv6Available) {
      this.skip();
      return;
    }
    const port = await reserveFreePortOnHost('::1');
    const projectRoot = '/tmp/v8vscedit-fixture/project-ipv6-reuse';
    const serverA = createServer(projectRoot, '0.9.9-ipv6-a');
    const serverB = createServer(projectRoot, '0.9.9-ipv6-b');
    spawnedServers.push(serverA, serverB);

    const resultA = await serverA.start({ host: '::1', port });
    assert.strictEqual(resultA.kind, 'started');

    const resultB = await serverB.start({ host: '::1', port });
    // При актуальном баге собственный зонд serverB получает 403 на /identity
    // владельца (serverA) → probeIdentity возвращает undefined →
    // decideMcpStart(undefined, projectRoot) резолвится в conflict-unknown
    // вместо reuse, хотя projectRoot у обоих инстансов идентичен.
    assert.deepStrictEqual(
      resultB,
      { kind: 'reuse', endpoint: `http://[::1]:${String(port)}/mcp` },
      'второй инстанс на ::1 с тем же projectRoot обязан переиспользовать endpoint первого (reuse), ' +
      'а не получать conflict-unknown из-за рассинхрона формы Host-заголовка в probeIdentity',
    );
  });
});
