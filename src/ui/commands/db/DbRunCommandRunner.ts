import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { globSync } from 'glob';
import { spawn } from 'child_process';

interface DbRunConnectionParams {
  infoBasePath?: string;
  infoBaseServer?: string;
  infoBaseRef?: string;
  userName?: string;
  password?: string;
  v8Path?: string;
}

interface DbRunOptions {
  mode: 'ENTERPRISE' | 'DESIGNER';
  execute?: string;
  cParam?: string;
  url?: string;
}

/**
 * Запускает клиент 1С в выбранном режиме из параметров env.json.
 */
export async function runDbClientFromWorkspace(
  workspaceFolder: vscode.WorkspaceFolder,
  outputChannel: vscode.OutputChannel,
  options: DbRunOptions
): Promise<void> {
  try {
    const settingsPath = resolveSettingsPath(workspaceFolder.uri.fsPath);
    const connection = resolveConnectionFromSettings(settingsPath);
    const v8Path = resolveV8Path(connection.v8Path ?? '');
    const args = buildLaunchArguments(options, connection);

    outputChannel.appendLine(`[db-run] Запуск: ${v8Path} ${args.join(' ')}`);
    spawnDetached(v8Path, args, workspaceFolder.uri.fsPath);

    const modeLabel = options.mode === 'DESIGNER' ? 'конфигуратор' : 'тонкий клиент';
    await vscode.window.showInformationMessage(`Запущен ${modeLabel} 1С.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    outputChannel.appendLine(`[db-run][error] ${message}`);
    await vscode.window.showErrorMessage(`Не удалось запустить 1С.\n${message}`, { modal: true });
  }
}

function resolveV8Path(v8Path: string): string {
  if (!v8Path) {
    const candidates = globSync('C:/Program Files/1cv8/*/bin/1cv8.exe', { windowsPathsNoEscape: true });
    if (candidates.length === 0) {
      throw new Error('Error: 1cv8.exe not found. Specify -V8Path');
    }
    return [...candidates].sort().at(-1) ?? '';
  }

  if (fs.existsSync(v8Path) && fs.statSync(v8Path).isDirectory()) {
    v8Path = path.join(v8Path, '1cv8.exe');
  }

  if (!fs.existsSync(v8Path)) {
    throw new Error(`Error: 1cv8.exe not found at ${v8Path}`);
  }
  return v8Path;
}

function buildLaunchArguments(options: DbRunOptions, params: DbRunConnectionParams): string[] {
  const args: string[] = [options.mode];

  if (params.infoBaseServer && params.infoBaseRef) {
    args.push('/S', `${params.infoBaseServer}/${params.infoBaseRef}`);
  } else if (params.infoBasePath) {
    args.push('/F', params.infoBasePath);
  } else {
    throw new Error('Error: specify -InfoBasePath or -InfoBaseServer + -InfoBaseRef');
  }

  if (params.userName) {
    args.push(`/N${params.userName}`);
  }
  if (params.password) {
    args.push(`/P${params.password}`);
  }

  let execute = options.execute ?? '';
  if (execute) {
    const ext = path.extname(execute).toLowerCase();
    if (ext === '.erf') {
      execute = '';
    }
  }

  if (execute) {
    args.push('/Execute', execute);
  }
  if (options.cParam) {
    args.push('/C', options.cParam);
  }
  if (options.url) {
    args.push('/URL', options.url);
  }

  return args;
}

function spawnDetached(command: string, args: string[], cwd: string): void {
  const child = spawn(command, args, {
    cwd,
    shell: false,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

function resolveSettingsPath(workspaceRoot: string): string {
  const candidates = [
    path.join(workspaceRoot, 'env.json'),
    path.join(workspaceRoot, 'example', 'env.json'),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(`Не найден env.json для подключения к базе: ${candidates[0]}`);
  }
  return found;
}

function resolveConnectionFromSettings(settingsPath: string): DbRunConnectionParams {
  const raw = fs.readFileSync(settingsPath, 'utf-8');
  const parsed = JSON.parse(raw) as {
    default?: Record<string, unknown>;
  };
  const defaults = parsed.default ?? {};

  const ibConnectionRaw = asString(defaults['--ibconnection']);
  if (!ibConnectionRaw) {
    throw new Error(`В env.json отсутствует "--ibconnection": ${settingsPath}`);
  }

  const connection = parseIbConnection(ibConnectionRaw);
  connection.userName = asString(defaults['--db-user']) ?? '';
  connection.password = asString(defaults['--db-pwd']) ?? '';
  connection.v8Path = asString(defaults['--path']);
  return connection;
}

function parseIbConnection(rawValue: string): DbRunConnectionParams {
  const normalized = rawValue.replace(/^"+|"+$/g, '');
  if (/^\/F/i.test(normalized)) {
    const infoBasePath = normalizeInfoBasePath(normalized.slice(2).trim());
    return { infoBasePath };
  }

  if (/^\/S/i.test(normalized)) {
    const serverRef = normalized.slice(2).trim();
    const slashIndex = serverRef.indexOf('/');
    if (slashIndex > 0) {
      return {
        infoBaseServer: serverRef.slice(0, slashIndex),
        infoBaseRef: serverRef.slice(slashIndex + 1),
      };
    }
  }

  throw new Error(`Не удалось разобрать "--ibconnection": ${rawValue}`);
}

function normalizeInfoBasePath(rawPath: string): string {
  let value = rawPath.replace(/^"+|"+$/g, '').trim();
  value = value.replace(/\//g, '\\');
  value = value.replace(/^([A-Za-z]):\\+/, '$1:\\');
  if (!value.startsWith('\\\\')) {
    value = value.replace(/\\{2,}/g, '\\');
  }
  return value;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
