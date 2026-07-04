import { spawn, type ChildProcess } from 'child_process';
import { decodeProcessOutput, LineBufferedDecoder } from './OutputDecoder';

/**
 * Структурный аналог vscode.CancellationToken без импорта vscode
 * (infra не зависит от vscode). Позволяет прокидывать токен отмены из UI.
 */
export interface CancellationLike {
  readonly isCancellationRequested: boolean;
  onCancellationRequested(listener: () => void): { dispose(): void };
}

export interface ProcessRunOptions {
  command: string;
  args: string[];
  cwd?: string;
  shell?: boolean;
  /** Готовая строка stdout (собрана по границе '\n', декодирована с учётом кодировки). */
  onStdout?: (line: string) => void;
  /** Готовая строка stderr. */
  onStderr?: (line: string) => void;
  /** Таймаут принудительного завершения; 0/undefined — без таймаута. */
  timeoutMs?: number;
  /** Пауза между SIGTERM и SIGKILL, мс (по умолчанию 5000). */
  killGraceMs?: number;
  /** Внешняя отмена (структурно совместима с vscode.CancellationToken). */
  cancellationToken?: CancellationLike;
}

export interface ProcessRunResult {
  exitCode: number;
  lastStdout: string;
  lastStderr: string;
  /** Процесс завершён принудительно по таймауту. */
  timedOut?: boolean;
  /** Процесс завершён принудительно по внешней отмене. */
  canceled?: boolean;
}

const DEFAULT_KILL_GRACE_MS = 5_000;

/**
 * Запускает внешний процесс и возвращает код завершения и последние строки потоков.
 * Умеет принудительно завершать зависший процесс по таймауту и по внешней отмене:
 * сначала SIGTERM, затем — если процесс не закрылся за killGraceMs — SIGKILL.
 * В обоих случаях промис РЕЗОЛВИТСЯ с флагом (timedOut/canceled), а не reject,
 * чтобы вызывающий код не трактовал штатную отмену как исключение.
 */
export async function runProcess(options: ProcessRunOptions): Promise<ProcessRunResult> {
  return new Promise<ProcessRunResult>((resolve, reject) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const stdoutDecoder = new LineBufferedDecoder();
    const stderrDecoder = new LineBufferedDecoder();

    let settled = false;
    let timedOut = false;
    let canceled = false;
    let timeoutTimer: NodeJS.Timeout | undefined;
    let killTimer: NodeJS.Timeout | undefined;
    let tokenSubscription: { dispose(): void } | undefined;

    // Если токен уже отменён на входе — не запускаем процесс вовсе.
    if (options.cancellationToken?.isCancellationRequested) {
      resolve({ exitCode: 1, lastStdout: '', lastStderr: '', canceled: true });
      return;
    }

    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      shell: options.shell ?? false,
    });

    const cleanupTimers = (): void => {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = undefined;
      }
      if (killTimer) {
        clearTimeout(killTimer);
        killTimer = undefined;
      }
      tokenSubscription?.dispose();
      tokenSubscription = undefined;
    };

    // Принудительное завершение: SIGTERM, затем SIGKILL по истечении killGraceMs.
    const forceKill = (): void => {
      if (killTimer) {
        return;
      }
      safeKill(child, 'SIGTERM');
      const graceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
      killTimer = setTimeout(() => safeKill(child, 'SIGKILL'), graceMs);
    };

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      for (const line of stdoutDecoder.push(chunk)) {
        options.onStdout?.(line);
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
      for (const line of stderrDecoder.push(chunk)) {
        options.onStderr?.(line);
      }
    });

    child.on('error', (err) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanupTimers();
      reject(err);
    });

    child.on('close', (code) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanupTimers();

      const stdoutTail = stdoutDecoder.flush();
      if (stdoutTail !== undefined) {
        options.onStdout?.(stdoutTail);
      }
      const stderrTail = stderrDecoder.flush();
      if (stderrTail !== undefined) {
        options.onStderr?.(stderrTail);
      }

      resolve({
        exitCode: code ?? 1,
        lastStdout: decodeProcessOutput(Buffer.concat(stdoutChunks)).trim(),
        lastStderr: decodeProcessOutput(Buffer.concat(stderrChunks)).trim(),
        ...(timedOut ? { timedOut: true } : {}),
        ...(canceled ? { canceled: true } : {}),
      });
    });

    if (options.timeoutMs && options.timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        forceKill();
      }, options.timeoutMs);
    }

    if (options.cancellationToken) {
      tokenSubscription = options.cancellationToken.onCancellationRequested(() => {
        canceled = true;
        forceKill();
      });
    }
  });
}

function safeKill(child: ChildProcess, signal: NodeJS.Signals): void {
  try {
    child.kill(signal);
  } catch {
    // процесс уже завершился — игнорируем
  }
}

/**
 * Нейтральное сообщение для штатного прерывания процесса (отмена/таймаут).
 * Возвращает undefined, если прерывания не было — вызывающий трактует это как
 * обычный сбой/успех и не показывает нейтральную нотификацию.
 */
export function describeProcessInterruption(result: ProcessRunResult): string | undefined {
  if (result.canceled) {
    return 'Операция отменена пользователем.';
  }
  if (result.timedOut) {
    return 'Операция прервана по таймауту.';
  }
  return undefined;
}
