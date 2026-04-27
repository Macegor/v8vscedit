import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { RepositoryBinding, RepositoryNodeRef, RepositoryService, RepositoryTarget } from '../../../infra/repository/RepositoryService';
import {
  decodeProcessOutput,
  normalizeInfoBasePath,
  resolveV8PathHintFromVersion,
  runProcess,
} from '../../../infra/process';

interface ConnectionParams {
  infoBasePath?: string;
  infoBaseServer?: string;
  infoBaseRef?: string;
  userName?: string;
  password?: string;
  v8Path?: string;
}

interface RepositoryCliRunOptions {
  command: string;
  target: RepositoryTarget;
  bindingOverride?: RepositoryBinding;
  extraArgs?: string[];
  progressTitle: string;
  progressStartMessage: string;
  successMessage: string;
  errorTitle: string;
  failureOperation?: string;
  showSuccessMessage?: boolean;
  afterSuccess?: () => Promise<void>;
}

let statusBarItem: vscode.StatusBarItem | undefined;
let clearStatusTimer: NodeJS.Timeout | undefined;

export interface RepositoryCliServices {
  workspaceFolder: vscode.WorkspaceFolder;
  outputChannel: vscode.OutputChannel;
  repositoryService: RepositoryService;
}

export async function runRepositoryCliCommand(
  options: RepositoryCliRunOptions,
  services: RepositoryCliServices
): Promise<boolean> {
  const connection = resolveDatabaseConnection(services.repositoryService.getEnvJsonPath());
  const binding = options.bindingOverride ?? services.repositoryService.loadBinding(options.target);
  if (!binding) {
    throw new Error(`Для "${options.target.displayName}" не настроено подключение к хранилищу в env.json.`);
  }

  const processArgs = [
    resolveInternalCliPath(services.workspaceFolder.uri.fsPath),
    options.command,
    ...buildConnectionCliArgs(connection),
    ...buildRepositoryCliArgs(binding),
    ...(options.target.extensionName ? ['-Extension', options.target.extensionName] : []),
    ...(options.extraArgs ?? []),
    '-Verbose',
  ];

  const commandAsText = `node ${processArgs.join(' ')}`;
  services.outputChannel.appendLine(`[repository] Старт: ${commandAsText}`);
  setOperationStatus(options.progressTitle, options.progressStartMessage, true);

  try {
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    const result = await runProcess({
      command: process.execPath,
      args: processArgs,
      cwd: services.workspaceFolder.uri.fsPath,
      shell: false,
      onStdout: (chunk) => {
        const text = decodeProcessOutput(chunk).trim();
        if (!text) {
          return;
        }
        stdoutChunks.push(text);
        services.outputChannel.appendLine(`[repository][stdout] ${text}`);
        setOperationStatus(options.progressTitle, trimStatusMessage(text), true);
      },
      onStderr: (chunk) => {
        const text = decodeProcessOutput(chunk).trim();
        if (!text) {
          return;
        }
        stderrChunks.push(text);
        services.outputChannel.appendLine(`[repository][stderr] ${text}`);
        setOperationStatus(options.progressTitle, trimStatusMessage(`stderr: ${text}`), true);
      },
    });

    if (result.exitCode !== 0) {
      const details = [
        ...stderrChunks,
        ...stdoutChunks,
        result.lastStderr,
        result.lastStdout,
      ]
        .filter(Boolean);
      const reason = extractFailureReason(details, result.exitCode);
      const operation = options.failureOperation ?? options.progressTitle.toLowerCase();
      throw new Error(`Ошибка при ${operation}: ${reason}`);
    }

    if (options.afterSuccess) {
      await options.afterSuccess();
    }

    services.outputChannel.appendLine(`[repository] Завершено: ${commandAsText}`);
    setOperationStatus(options.progressTitle, 'завершено', false);
    if (options.showSuccessMessage !== false) {
      void vscode.window.showInformationMessage(options.successMessage);
    }
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    services.outputChannel.appendLine(`[repository][error] ${message}`);
    setOperationStatus(options.progressTitle, 'ошибка', false);
    await vscode.window.showErrorMessage(`${options.errorTitle}\n${message}`);
    return false;
  }
}

export function resolveRepositoryTarget(
  repositoryService: RepositoryService,
  node: RepositoryNodeRef
): RepositoryTarget | null {
  if (!node.xmlPath) {
    return null;
  }
  return repositoryService.resolveTargetByXmlPath(node.xmlPath);
}

export async function runRepositoryLockAction(
  services: RepositoryCliServices,
  node: RepositoryNodeRef,
  recursive: boolean
): Promise<boolean> {
  const target = requireTarget(services.repositoryService, node);
  const objects = services.repositoryService.createObjectsFileForNode(node, recursive);
  return runRepositoryCliCommand({
    command: 'repository-lock',
    target,
    extraArgs: [
      '-ObjectsFile',
      objects.filePath,
    ],
    progressTitle: `Захват: ${node.label ?? target.displayName}`,
    progressStartMessage: 'Получаю объекты из хранилища для редактирования...',
    successMessage: `Объекты "${node.label ?? target.displayName}" захвачены.`,
    errorTitle: `Ошибка захвата объектов "${node.label ?? target.displayName}".`,
    failureOperation: 'захвате объектов хранилища',
    afterSuccess: async () => {
      services.repositoryService.setLocked(target, objects.fullNames, true);
    },
  }, services);
}

export async function runRepositoryUnlockAction(
  services: RepositoryCliServices,
  node: RepositoryNodeRef,
  recursive: boolean,
  force: boolean
): Promise<boolean> {
  const target = requireTarget(services.repositoryService, node);
  const objects = services.repositoryService.createObjectsFileForNode(node, recursive);
  return runRepositoryCliCommand({
    command: 'repository-unlock',
    target,
    extraArgs: [
      '-ObjectsFile',
      objects.filePath,
      ...(force ? ['-Force'] : []),
    ],
    progressTitle: `Освобождение: ${node.label ?? target.displayName}`,
    progressStartMessage: 'Отменяю захват объектов...',
    successMessage: `Объекты "${node.label ?? target.displayName}" освобождены.`,
    errorTitle: `Ошибка освобождения объектов "${node.label ?? target.displayName}".`,
    failureOperation: 'освобождении объектов хранилища',
    afterSuccess: async () => {
      services.repositoryService.setLocked(target, objects.fullNames, false);
    },
  }, services);
}

export async function runRepositoryCommitAction(
  services: RepositoryCliServices,
  node: RepositoryNodeRef,
  options: {
    recursive: boolean;
    comment: string;
    keepLocked: boolean;
    force: boolean;
  }
): Promise<boolean> {
  const target = requireTarget(services.repositoryService, node);
  const objects = services.repositoryService.createObjectsFileForNode(node, options.recursive);
  return runRepositoryCliCommand({
    command: 'repository-commit',
    target,
    extraArgs: [
      '-ObjectsFile',
      objects.filePath,
      ...(options.comment ? ['-Comment', options.comment] : []),
      ...(options.keepLocked ? ['-KeepLocked'] : []),
      ...(options.force ? ['-Force'] : []),
    ],
    progressTitle: `Помещение: ${node.label ?? target.displayName}`,
    progressStartMessage: 'Помещаю изменения в хранилище...',
    successMessage: `Изменения "${node.label ?? target.displayName}" помещены в хранилище.`,
    errorTitle: `Ошибка помещения "${node.label ?? target.displayName}" в хранилище.`,
    failureOperation: 'помещении изменений в хранилище',
    afterSuccess: async () => {
      if (!options.keepLocked) {
        services.repositoryService.setLocked(target, objects.fullNames, false);
      }
    },
  }, services);
}

export async function runRepositoryUpdateAction(
  services: RepositoryCliServices,
  node: RepositoryNodeRef,
  options: {
    recursive: boolean;
    force: boolean;
    version?: string;
  }
): Promise<boolean> {
  const target = requireTarget(services.repositoryService, node);
  const objects = services.repositoryService.createObjectsFileForNode(node, options.recursive);
  return runRepositoryCliCommand({
    command: 'repository-update',
    target,
    extraArgs: [
      '-ObjectsFile',
      objects.filePath,
      ...(options.version ? ['-Version', options.version] : []),
      ...(options.force ? ['-Force'] : []),
    ],
    progressTitle: `Получение: ${node.label ?? target.displayName}`,
    progressStartMessage: 'Получаю изменения из хранилища...',
    successMessage: `Объекты "${node.label ?? target.displayName}" обновлены из хранилища.`,
    errorTitle: `Ошибка получения "${node.label ?? target.displayName}" из хранилища.`,
    failureOperation: 'получении изменений из хранилища',
  }, services);
}

function requireTarget(repositoryService: RepositoryService, node: RepositoryNodeRef): RepositoryTarget {
  const target = resolveRepositoryTarget(repositoryService, node);
  if (!target) {
    throw new Error('Не удалось определить конфигурацию для выбранного узла.');
  }
  return target;
}

function resolveInternalCliPath(workspaceRoot: string): string {
  const candidates = collectCliCandidates(workspaceRoot);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Не найден внутренний CLI раннер. Ожидался один из путей: ${candidates.join(', ')}`
  );
}

function collectCliCandidates(workspaceRoot: string): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  addCandidate(result, seen, path.join(__dirname, '..', '..', '..', 'cli', 'onec-tools.js'));
  addCandidate(result, seen, path.join(__dirname, '..', '..', '..', '..', 'cli', 'onec-tools.js'));
  addCandidate(result, seen, path.join(workspaceRoot, 'dist', 'cli', 'onec-tools.js'));
  addCandidate(result, seen, path.join(workspaceRoot, 'out', 'cli', 'onec-tools.js'));

  let current = path.resolve(workspaceRoot);
  for (let depth = 0; depth < 8; depth += 1) {
    addCandidate(result, seen, path.join(current, 'dist', 'cli', 'onec-tools.js'));
    addCandidate(result, seen, path.join(current, 'out', 'cli', 'onec-tools.js'));
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return result;
}

function addCandidate(target: string[], seen: Set<string>, candidatePath: string): void {
  const normalized = path.resolve(candidatePath);
  if (seen.has(normalized)) {
    return;
  }
  seen.add(normalized);
  target.push(normalized);
}

function resolveDatabaseConnection(settingsPath: string): ConnectionParams {
  if (!fs.existsSync(settingsPath)) {
    throw new Error(`Не найден env.json для подключения к базе: ${settingsPath}`);
  }

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
  connection.v8Path = resolveV8PathFromSettings(defaults);
  return connection;
}

function parseIbConnection(rawValue: string): ConnectionParams {
  const normalized = rawValue.replace(/^"+|"+$/g, '');
  if (/^\/F/i.test(normalized)) {
    return {
      infoBasePath: normalizeInfoBasePath(normalized.slice(2).trim()),
    };
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

function buildConnectionCliArgs(params: ConnectionParams): string[] {
  const args: string[] = [];
  if (params.infoBasePath) {
    args.push('-InfoBasePath', params.infoBasePath);
  } else if (params.infoBaseServer && params.infoBaseRef) {
    args.push('-InfoBaseServer', params.infoBaseServer, '-InfoBaseRef', params.infoBaseRef);
  } else {
    throw new Error('Недостаточно параметров подключения к базе из env.json');
  }

  if (params.userName) {
    args.push('-UserName', params.userName);
  }
  if (params.password) {
    args.push('-Password', params.password);
  }
  if (params.v8Path) {
    args.push('-V8Path', params.v8Path);
  }
  return args;
}

function buildRepositoryCliArgs(binding: RepositoryBinding): string[] {
  const args = ['-RepoPath', binding.repoPath, '-RepoUser', binding.repoUser];
  if (binding.repoPassword) {
    args.push('-RepoPassword', binding.repoPassword);
  }
  return args;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function resolveV8PathFromSettings(defaults: Record<string, unknown>): string {
  return asString(defaults['--path']) || resolveV8PathHintFromVersion(asString(defaults['--v8version']) ?? '');
}

function trimStatusMessage(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= 80) {
    return oneLine;
  }
  return `${oneLine.slice(0, 77)}...`;
}

function extractFailureReason(details: string[], exitCode: number): string {
  const lines = details
    .map((item) => item.replace(/\r/g, '').trim())
    .filter(Boolean)
    .flatMap((block) => block.split('\n'))
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line !== '--- Log ---' && line !== '--- End ---');

  if (lines.length === 0) {
    return `команда завершилась с кодом ${exitCode}`;
  }

  const filtered = lines.filter((line) => {
    if (/^Error [^(]+\(code:\s*\d+\)$/i.test(line)) {
      return false;
    }
    if (/завершил(?:ось|ся) с ошибкой$/i.test(line)) {
      return false;
    }
    return true;
  });
  return filtered.at(-1) ?? lines.at(-1) ?? `команда завершилась с кодом ${exitCode}`;
}

function setOperationStatus(title: string, message: string, running: boolean): void {
  if (!statusBarItem) {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 95);
    statusBarItem.name = '1С: хранилище конфигурации';
  }
  if (clearStatusTimer) {
    clearTimeout(clearStatusTimer);
    clearStatusTimer = undefined;
  }

  const text = `${title}: ${message}`;
  statusBarItem.text = running
    ? `$(sync~spin) ${trimStatusMessage(text)}`
    : `$(check) ${trimStatusMessage(text)}`;
  statusBarItem.tooltip = text;
  statusBarItem.show();

  if (!running) {
    clearStatusTimer = setTimeout(() => {
      statusBarItem?.hide();
      clearStatusTimer = undefined;
    }, 5_000);
  }
}
