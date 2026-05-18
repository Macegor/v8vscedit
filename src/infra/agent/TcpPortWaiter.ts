import * as net from 'net';

export interface TcpPortWaitOptions {
  readonly host: string;
  readonly port: number;
  readonly timeoutMs: number;
  readonly intervalMs?: number;
  readonly isAborted?: () => boolean;
}

export async function waitForTcpPort(options: TcpPortWaitOptions): Promise<boolean> {
  const startedAt = Date.now();
  const intervalMs = options.intervalMs ?? 500;

  while (Date.now() - startedAt < options.timeoutMs) {
    if (options.isAborted?.()) {
      return false;
    }
    if (await canConnect(options.host, options.port)) {
      return true;
    }
    await delay(intervalMs);
  }

  return false;
}

function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let resolved = false;

    const finish = (result: boolean) => {
      if (resolved) {
        return;
      }
      resolved = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(1000);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

function delay(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, timeoutMs));
}
