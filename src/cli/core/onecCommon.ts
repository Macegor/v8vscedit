import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { globSync } from 'glob';
import { runProcess } from '../../infra/process';
import { OnecConnection } from './types';

export interface RepositoryConnection {
  repoPath: string;
  repoUser: string;
  repoPassword: string;
}

export function resolveV8Path(v8Path: string): string {
  if (!v8Path) {
    const candidates = globSync('C:/Program Files/1cv8/*/bin/1cv8.exe', { windowsPathsNoEscape: true });
    if (candidates.length === 0) {
      throw new Error('Error: 1cv8.exe not found. Specify -V8Path');
    }
    return [...candidates].sort().at(-1) ?? '';
  }

  if (fs.existsSync(v8Path) && fs.statSync(v8Path).isDirectory()) {
    const candidate = path.join(v8Path, '1cv8.exe');
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  if (!fs.existsSync(v8Path)) {
    throw new Error(`Error: 1cv8.exe not found at ${v8Path}`);
  }
  return v8Path;
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
    const content = stripBom(data).toString('utf-8').trim();
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

function stripBom(data: Buffer): Buffer {
  if (data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) {
    return data.subarray(3);
  }
  return data;
}
