/**
 * Сетевой зонд MCP-порта: реальные TCP/HTTP-запросы к loopback для проверки,
 * кто занял preferred-порт, и для его освобождения (`/shutdown` + ожидание
 * реального release). Единственная «внешняя система» — сам порт ОС.
 *
 * Модуль относится к `infra/**`: `http`/`net` разрешены, `vscode` — нет.
 */
import * as http from 'http';
import * as net from 'net';
import { parseIdentity, type McpServerIdentity } from './McpServerIdentity';
import { formatHostForUrl } from './McpHost';

const DEFAULT_PROBE_TIMEOUT_MS = 1000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 1000;
const DEFAULT_RELEASE_INTERVAL_MS = 50;
const DEFAULT_RELEASE_TIMEOUT_MS = 3000;

export interface WaitForPortReleaseOptions {
  readonly intervalMs?: number;
  readonly timeoutMs?: number;
}

/**
 * Запрашивает `GET /identity` у занявшего порт процесса и строго валидирует
 * ответ. Возвращает identity только для нашего сервера; при ECONNREFUSED,
 * мусорном/чужом теле или таймауте — `undefined`.
 */
export function probeIdentity(
  host: string,
  port: number,
  timeoutMs: number = DEFAULT_PROBE_TIMEOUT_MS
): Promise<McpServerIdentity | undefined> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: McpServerIdentity | undefined) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };

    const req = http.request(
      { host, port, path: '/identity', method: 'GET', headers: { host: `${formatHostForUrl(host)}:${String(port)}` } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as unknown;
            finish(parseIdentity(parsed));
          } catch {
            finish(undefined);
          }
        });
        res.on('error', () => finish(undefined));
      }
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      finish(undefined);
    });
    req.on('error', () => finish(undefined));
    req.end();
  });
}

/**
 * Просит занявший порт процесс завершиться через `POST /shutdown`.
 * Возвращает `true` при ответе 200, `false` — если никто не слушает/ошибка.
 */
export function requestShutdown(
  host: string,
  port: number,
  timeoutMs: number = DEFAULT_SHUTDOWN_TIMEOUT_MS
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };

    const req = http.request(
      { host, port, path: '/shutdown', method: 'POST', headers: { host: `${formatHostForUrl(host)}:${String(port)}` } },
      (res) => {
        res.on('data', () => undefined);
        res.on('end', () => finish(res.statusCode === 200));
        res.on('error', () => finish(false));
      }
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      finish(false);
    });
    req.on('error', () => finish(false));
    req.end();
  });
}

/** Проверяет, можно ли сейчас забиндиться на порт (порт реально свободен). */
function canBind(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, host, () => {
      probe.close(() => resolve(true));
    });
  });
}

/**
 * Поллит порт до реального освобождения (успешного bind) или до таймаута.
 * Возвращает `true`, если порт освободился за отведённое время.
 */
export function waitForPortRelease(
  host: string,
  port: number,
  opts: WaitForPortReleaseOptions = {}
): Promise<boolean> {
  const intervalMs = opts.intervalMs ?? DEFAULT_RELEASE_INTERVAL_MS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_RELEASE_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const tick = () => {
      void canBind(host, port).then((free) => {
        if (free) {
          resolve(true);
          return;
        }
        if (Date.now() >= deadline) {
          resolve(false);
          return;
        }
        setTimeout(tick, intervalMs);
      });
    };
    tick();
  });
}

/**
 * Гасит занявший порт наш сервер через `/shutdown` и дожидается реального
 * освобождения порта для последующего bind. Возвращает `true` при успехе.
 */
export async function reclaimPort(host: string, port: number): Promise<boolean> {
  const requested = await requestShutdown(host, port);
  if (!requested) {
    return false;
  }
  return waitForPortRelease(host, port);
}
