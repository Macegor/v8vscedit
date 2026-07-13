/**
 * Юнит-тесты сетевого зонда MCP-порта (`src/infra/mcp/McpPortProbe.ts`).
 * Модуль делает реальные TCP/HTTP-запросы к localhost — единственная
 * "внешняя система" тут сам порт ОС, поэтому тестируем на настоящих
 * http/net-серверах на эфемерных портах, без моков сети.
 *
 * `startIdentityServer` ниже — НЕ мок production-кода: это минимальный
 * реальный http-сервер, реализующий тот же контракт `/identity`+`/shutdown`,
 * который появится у `V8McpServer`. Он нужен, чтобы протестировать
 * `McpPortProbe` изолированно, до и независимо от изменений в `V8McpServer`
 * (интеграционные сценарии на самом `V8McpServer` — в `v8McpServerLifecycle.test.ts`).
 */
import * as assert from 'assert';
import * as http from 'http';
import * as net from 'net';
import { probeIdentity, requestShutdown, waitForPortRelease, reclaimPort } from '../../infra/mcp/McpPortProbe';
import { PRODUCT_ID, IDENTITY_PROTOCOL, serializeIdentity, type McpServerIdentity } from '../../infra/mcp/McpServerIdentity';

const HOST = '127.0.0.1';

function buildIdentity(overrides: Partial<McpServerIdentity> = {}): McpServerIdentity {
  return {
    product: PRODUCT_ID,
    protocol: IDENTITY_PROTOCOL,
    pid: process.pid,
    projectRoot: '/tmp/v8vscedit-probe-fixture',
    version: '0.4.1-test',
    endpoint: `http://${HOST}:0/mcp`,
    ...overrides,
  };
}

function listen(server: http.Server | net.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, HOST, () => {
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : 0);
    });
  });
}

function closeServer(server: http.Server | net.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

/** Открывает и сразу закрывает сервер на свободном порту — гарантированно закрытый порт для проверки ECONNREFUSED. */
function reserveClosedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, HOST, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : undefined;
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        if (port === undefined) {
          reject(new Error('не удалось определить порт'));
          return;
        }
        resolve(port);
      });
    });
  });
}

/** Реальный http-сервер с эндпоинтами /identity и /shutdown — образец будущего контракта V8McpServer. */
function startIdentityServer(
  identity: McpServerIdentity,
  opts: { shutdownDelayMs?: number; identityDelayMs?: number } = {},
): http.Server {
  const server = http.createServer((req, res) => {
    if (req.url === '/identity' && req.method === 'GET') {
      const respond = () => {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(serializeIdentity(identity));
      };
      if (opts.identityDelayMs) {
        setTimeout(respond, opts.identityDelayMs);
      } else {
        respond();
      }
      return;
    }
    if (req.url === '/shutdown' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
      const closeNow = () => server.close();
      if (opts.shutdownDelayMs) {
        setTimeout(closeNow, opts.shutdownDelayMs);
      } else {
        closeNow();
      }
      return;
    }
    res.writeHead(404).end();
  });
  return server;
}

function startGarbageServer(body: string): http.Server {
  return http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end(body);
  });
}

function canBind(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, HOST, () => probe.close(() => resolve(true)));
  });
}

suite('infra/mcp/McpPortProbe — probeIdentity', () => {
  test('распознаёт валидный identity реального http-сервера', async () => {
    const identity = buildIdentity({ projectRoot: '/tmp/v8vscedit-probe-a', pid: 4242 });
    const server = startIdentityServer(identity);
    const port = await listen(server);
    try {
      const probed = await probeIdentity(HOST, port);
      assert.deepStrictEqual(probed, identity);
    } finally {
      await closeServer(server);
    }
  });

  test('возвращает undefined, если тело ответа — не JSON (мусор)', async () => {
    const server = startGarbageServer('это не JSON, а мусор <html>...');
    const port = await listen(server);
    try {
      const probed = await probeIdentity(HOST, port);
      assert.strictEqual(probed, undefined);
    } finally {
      await closeServer(server);
    }
  });

  test('возвращает undefined, если тело — валидный JSON, но чужой формы (не наш product)', async () => {
    const server = startIdentityServer(buildIdentity({ product: 'chужой-сервер' }));
    const port = await listen(server);
    try {
      const probed = await probeIdentity(HOST, port);
      assert.strictEqual(probed, undefined);
    } finally {
      await closeServer(server);
    }
  });

  test('возвращает undefined для закрытого порта (ECONNREFUSED)', async () => {
    const port = await reserveClosedPort();
    const probed = await probeIdentity(HOST, port);
    assert.strictEqual(probed, undefined);
  });

  test('возвращает undefined по таймауту, если сервер отвечает дольше отведённого времени', async function () {
    this.timeout(5000);
    const identity = buildIdentity();
    const server = startIdentityServer(identity, { identityDelayMs: 2000 });
    const port = await listen(server);
    try {
      const startedAt = Date.now();
      const probed = await probeIdentity(HOST, port, 200);
      assert.strictEqual(probed, undefined);
      assert.ok(
        Date.now() - startedAt < 1900,
        'probeIdentity обязан прерваться по собственному таймауту, а не ждать медленный ответ сервера',
      );
    } finally {
      await closeServer(server);
    }
  });
});

suite('infra/mcp/McpPortProbe — requestShutdown', () => {
  test('возвращает true при ответе 200 от реального сервера', async () => {
    const server = startIdentityServer(buildIdentity());
    const port = await listen(server);
    try {
      const result = await requestShutdown(HOST, port);
      assert.strictEqual(result, true);
    } finally {
      await closeServer(server).catch(() => undefined);
    }
  });

  test('возвращает false, если на порту никто не слушает', async () => {
    const port = await reserveClosedPort();
    const result = await requestShutdown(HOST, port);
    assert.strictEqual(result, false);
  });

  test('возвращает false по таймауту, если сервер принимает /shutdown, но никогда не отвечает', async function () {
    this.timeout(5000);
    // Реальный "зависший" процесс: соединение принято, но res.end() не вызывается
    // никогда — это и есть сценарий строк 95-96 requestShutdown (req.destroy() +
    // finish(false) из колбэка req.setTimeout), а не ECONNREFUSED/сетевая ошибка.
    const server = http.createServer(() => {
      // намеренно не отвечаем — имитация зависшего владельца порта
    });
    const port = await listen(server);
    try {
      const startedAt = Date.now();
      const result = await requestShutdown(HOST, port, 200);
      assert.strictEqual(result, false);
      assert.ok(
        Date.now() - startedAt < 1900,
        'requestShutdown обязан прерваться по собственному таймауту, а не ждать зависший сервер бесконечно',
      );
    } finally {
      await closeServer(server).catch(() => undefined);
    }
  });

  test('гонка timeout/ответ: повторный finish() из-за прерванного ответа не портит результат (защитный guard)', async function () {
    this.timeout(5000);
    // Сервер шлёт заголовки и часть тела сразу (клиент успевает получить событие
    // 'response' до таймаута), но дозавершает тело позже отведённого timeoutMs.
    // requestShutdown резолвится по СВОЕМУ таймауту первым (finish(false) из
    // колбэка req.setTimeout), а когда клиентский req.destroy() рвёт сокет,
    // на res прилетает 'aborted'/'error' и требуется ВТОРОЙ finish(false) —
    // именно его блокирует guard `if (settled) return;` (строки 80-81).
    // Тайминги подобраны так, что таймаут (300мс) гарантированно срабатывает
    // раньше завершения тела сервером (600мс) — детерминированно, без гонки.
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Length': '100' });
      res.write('start-');
      setTimeout(() => {
        try {
          res.end('x'.repeat(94));
        } catch {
          // сокет к этому моменту уже разрушен клиентом — ожидаемо
        }
      }, 600);
    });
    const port = await listen(server);
    try {
      const startedAt = Date.now();
      const result = await requestShutdown(HOST, port, 300);
      assert.strictEqual(result, false, 'таймаут обязан вернуть false несмотря на частично полученный ответ');
      assert.ok(
        Date.now() - startedAt < 550,
        'requestShutdown обязан резолвиться по собственному таймауту (~300мс), а не ждать 600мс до завершения тела сервером',
      );
    } finally {
      await closeServer(server).catch(() => undefined);
    }
  });
});

suite('infra/mcp/McpPortProbe — waitForPortRelease', () => {
  test('дожидается освобождения порта, занятого на ограниченное время', async function () {
    this.timeout(5000);
    const server = net.createServer();
    const port = await listen(server);
    setTimeout(() => {
      void closeServer(server);
    }, 300);

    const released = await waitForPortRelease(HOST, port, { intervalMs: 50, timeoutMs: 3000 });
    assert.strictEqual(released, true);
  });

  test('возвращает false, если порт остаётся занятым дольше отведённого таймаута', async function () {
    this.timeout(5000);
    const server = net.createServer();
    const port = await listen(server);
    try {
      const released = await waitForPortRelease(HOST, port, { intervalMs: 50, timeoutMs: 300 });
      assert.strictEqual(released, false);
    } finally {
      await closeServer(server);
    }
  });
});

suite('infra/mcp/McpPortProbe — reclaimPort', () => {
  test('гасит контрольный сервер через /shutdown и дожидается реального освобождения порта', async function () {
    this.timeout(5000);
    const server = startIdentityServer(buildIdentity(), { shutdownDelayMs: 50 });
    const port = await listen(server);

    const reclaimed = await reclaimPort(HOST, port);
    assert.strictEqual(reclaimed, true);
    assert.ok(await canBind(port), 'после reclaimPort порт обязан быть по-настоящему свободен для нового bind');
  });

  test('возвращает false без ожидания release, если requestShutdown не достучался (порт закрыт)', async function () {
    this.timeout(5000);
    // Никто не слушает на порту — requestShutdown быстро получает ECONNREFUSED
    // и возвращает false. Проверяем именно ветку `if (!requested) return false;`
    // (строки 151-152): reclaimPort обязан вернуть false СРАЗУ, не вызывая
    // waitForPortRelease с его дефолтным таймаутом (3000мс) — иначе тест занял
    // бы секунды вместо миллисекунд.
    const port = await reserveClosedPort();
    const startedAt = Date.now();
    const reclaimed = await reclaimPort(HOST, port);
    assert.strictEqual(reclaimed, false);
    assert.ok(
      Date.now() - startedAt < 900,
      'reclaimPort обязан выйти сразу после неудачного requestShutdown, не дожидаясь waitForPortRelease',
    );
  });
});
