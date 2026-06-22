import { spawn } from 'child_process';
import { decodeProcessOutput } from './OutputDecoder';

export interface ProcessRunOptions {
  command: string;
  args: string[];
  cwd?: string;
  shell?: boolean;
  onStdout?: (chunk: Buffer) => void;
  onStderr?: (chunk: Buffer) => void;
}

export interface ProcessRunResult {
  exitCode: number;
  lastStdout: string;
  lastStderr: string;
}

/**
 * Запускает внешний процесс и возвращает код завершения и последние строки потоков.
 * Используется как единая точка запуска CLI-инструментов.
 */
export async function runProcess(options: ProcessRunOptions): Promise<ProcessRunResult> {
  return new Promise<ProcessRunResult>((resolve, reject) => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      shell: options.shell ?? false,
    });

    // Аккумулируем потоки целиком: чанки могут разрывать многобайтовые
    // символы и теряться при перезаписи, поэтому декодируем итоговый буфер.
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      options.onStdout?.(chunk);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
      options.onStderr?.(chunk);
    });

    child.on('error', (err) => {
      reject(err);
    });

    child.on('close', (code) => {
      resolve({
        exitCode: code ?? 1,
        lastStdout: decodeProcessOutput(Buffer.concat(stdoutChunks)).trim(),
        lastStderr: decodeProcessOutput(Buffer.concat(stderrChunks)).trim(),
      });
    });
  });
}
