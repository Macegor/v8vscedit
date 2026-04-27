import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { decode } from 'iconv-lite';
import { resolveV8ExecutablePath, runProcess } from '../../infra/process';
import { OnecConnection } from './types';

export interface RepositoryConnection {
  repoPath: string;
  repoUser: string;
  repoPassword: string;
}

export function resolveV8Path(v8Path: string): string {
  return resolveV8ExecutablePath(v8Path);
}

export function appendConnectionArgs(args: string[], connection: OnecConnection): void {
  if (connection.infoBaseServer && connection.infoBaseRef) {
    args.push('/S', `${connection.infoBaseServer}/${connection.infoBaseRef}`);
  } else {
    args.push('/F', connection.infoBasePath);
  }
  if (connection.userName) {
    args.push(`/N${connection.userName}`);
  }
  if (connection.password) {
    args.push(`/P${connection.password}`);
  }
}

export function appendRepositoryArgs(args: string[], repository: RepositoryConnection): void {
  args.push('/ConfigurationRepositoryF', repository.repoPath);
  args.push('/ConfigurationRepositoryN', repository.repoUser);
  if (repository.repoPassword) {
    args.push('/ConfigurationRepositoryP', repository.repoPassword);
  }
}

export function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function safeRemoveDir(dirPath: string): void {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch {
    // Ошибка удаления временного каталога не должна ломать выполнение.
  }
}

export function writeUtf8BomLines(filePath: string, lines: string[]): void {
  fs.writeFileSync(filePath, `\uFEFF${lines.join('\n')}`, 'utf-8');
}

export async function runDesignerAndPrintResult(
  connection: OnecConnection,
  designerArgs: string[],
  successMessage: string,
  errorMessage: string,
  outFilePath?: string
): Promise<number> {
  const args: string[] = ['DESIGNER'];
  appendConnectionArgs(args, connection);
  args.push(...designerArgs);

  const result = await runProcess({ command: connection.v8Path, args });
  if (result.exitCode === 0) {
    console.log(successMessage);
  } else {
    if (outFilePath) {
      printLogFile(outFilePath);
    }
    const processDetails = [result.lastStderr, result.lastStdout]
      .map((item) => item.trim())
      .filter(Boolean);
    for (const detail of processDetails) {
      console.error(detail);
    }
    console.error(`${errorMessage} (code: ${result.exitCode})`);
  }
  return result.exitCode;
}

export function printLogFile(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    return;
  }
  try {
    const data = fs.readFileSync(filePath);
    const content = decodeLogFile(data).trim();
    if (!content) {
      return;
    }
    console.log('--- Log ---');
    console.log(content);
    console.log('--- End ---');
  } catch {
    // Ошибка чтения лога не критична.
  }
}

function decodeLogFile(data: Buffer): string {
  if (data.length >= 2 && data[0] === 0xff && data[1] === 0xfe) {
    return data.subarray(2).toString('utf16le');
  }
  if (data.length >= 2 && data[0] === 0xfe && data[1] === 0xff) {
    return decode(data.subarray(2), 'utf16-be');
  }
  if (data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) {
    return data.subarray(3).toString('utf-8');
  }

  const utf8Text = data.toString('utf-8');
  if (!utf8Text.includes('�')) {
    return utf8Text;
  }

  const cp866Text = decode(data, 'cp866');
  const cp1251Text = decode(data, 'win1251');
  return pickMostReadableText([cp866Text, cp1251Text, utf8Text]);
}

function pickMostReadableText(candidates: string[]): string {
  let best = candidates[0] ?? '';
  let bestScore = -1;

  for (const candidate of candidates) {
    const cyr = (candidate.match(/[А-Яа-яЁё]/g) ?? []).length;
    const replacement = (candidate.match(/�/g) ?? []).length;
    const score = cyr * 2 - replacement * 3;
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}
