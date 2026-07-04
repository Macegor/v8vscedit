import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { decode } from 'iconv-lite';
import type { RepositoryBinding, RepositoryNodeRef, RepositoryService, RepositoryTarget } from '../../../infra/repository/RepositoryService';
import { resolveDbPassword, type ProjectSecretStorage } from '../../../infra/environment';
import {
  describeProcessInterruption,
  normalizeInfoBasePath,
  pickMostReadableText,
  resolveV8ExecutablePath,
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
  afterSuccess?: () => void | Promise<void>;
}

let statusBarItem: vscode.StatusBarItem | undefined;
let clearStatusTimer: NodeJS.Timeout | undefined;
// Счётчик активных операций хранилища: параллельные операции делят один статус-бар,
// поэтому скрывать его по таймеру можно только когда завершилась последняя (count → 0).
let activeOperationCount = 0;

export interface RepositoryCliServices {
  workspaceFolder: vscode.WorkspaceFolder;
  outputChannel: vscode.OutputChannel;
  repositoryService: RepositoryService;
  projectSecretStorage: ProjectSecretStorage;
}

export async function runRepositoryCliCommand(
  options: RepositoryCliRunOptions,
  services: RepositoryCliServices
): Promise<boolean> {
  const connection = await resolveDatabaseConnection(
    services.repositoryService.getEnvJsonPath(),
    services.projectSecretStorage
  );
  const binding = options.bindingOverride
    ?? await services.repositoryService.resolveBindingForCommand(options.target);
  if (!binding) {
    throw new Error(`Для "${options.target.displayName}" не настроено подключение к хранилищу в env.json.`);
  }

  const v8Path = resolveV8ExecutablePath(connection.v8Path ?? '');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v8repo_'));
  const outFile = path.join(tempDir, `${options.command}.log`);

  beginRepositoryOperationStatus(options.progressTitle, options.progressStartMessage);

  try {
    const designerArgs: string[] = ['DESIGNER'];
    appendConnectionDesignerArgs(designerArgs, connection);
    appendRepositoryDesignerArgs(designerArgs, binding);
    designerArgs.push(...buildCommandDesignerArgs(options.command, options.extraArgs ?? []));
    if (options.target.extensionName) {
      designerArgs.push('-Extension', options.target.extensionName);
    }
    designerArgs.push('/Out', outFile, '/DisableStartupDialogs');

    const commandAsText = `${v8Path} ${designerArgs.join(' ')}`;
    services.outputChannel.appendLine(`[repository] Старт: ${commandAsText}`);

    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    // Прогресс-нотификация с кнопкой отмены для прерывания зависшего конфигуратора.
    // Статус-бар не переписываем — withProgress добавлен только ради отмены.
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: options.progressTitle,
        cancellable: true,
      },
      (_progress, token) => runProcess({
        command: v8Path,
        args: designerArgs,
        cwd: services.workspaceFolder.uri.fsPath,
        shell: false,
        cancellationToken: token,
        onStdout: (text) => {
          const line = text.trim();
          if (!line) {
            return;
          }
          stdoutChunks.push(line);
          services.outputChannel.appendLine(`[repository][stdout] ${line}`);
          updateRepositoryOperationStatus(options.progressTitle, trimStatusMessage(line));
        },
        onStderr: (text) => {
          const line = text.trim();
          if (!line) {
            return;
          }
          stderrChunks.push(line);
          services.outputChannel.appendLine(`[repository][stderr] ${line}`);
          updateRepositoryOperationStatus(options.progressTitle, trimStatusMessage(`stderr: ${line}`));
        },
      })
    );

    const interruption = describeProcessInterruption(result);
    if (interruption) {
      services.outputChannel.appendLine(`[repository] ${interruption}`);
      endRepositoryOperationStatus(options.progressTitle, 'прервано');
      void vscode.window.showInformationMessage(`${options.progressTitle}: ${interruption}`);
      return false;
    }

    const logContent = readLogFileContent(outFile);
    if (result.exitCode !== 0) {
      if (logContent) {
        services.outputChannel.appendLine(`[repository][log]\n${logContent}`);
      }
      const details = [
        ...stderrChunks,
        ...stdoutChunks,
        result.lastStderr,
        result.lastStdout,
        logContent,
      ].filter(Boolean);
      const reason = extractFailureReason(details, result.exitCode);
      const operation = options.failureOperation ?? options.progressTitle.toLowerCase();
      throw new Error(`Ошибка при ${operation}: ${reason}`);
    }

    if (logContent) {
      services.outputChannel.appendLine(`[repository][log]\n${logContent}`);
    }

    if (options.afterSuccess) {
      await options.afterSuccess();
    }

    services.outputChannel.appendLine(`[repository] Завершено: ${commandAsText}`);
    endRepositoryOperationStatus(options.progressTitle, 'завершено');
    if (options.showSuccessMessage !== false) {
      void vscode.window.showInformationMessage(options.successMessage);
    }
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    services.outputChannel.appendLine(`[repository][error] ${message}`);
    endRepositoryOperationStatus(options.progressTitle, 'ошибка');
    await vscode.window.showErrorMessage(`${options.errorTitle}\n${message}`);
    return false;
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // временный каталог уже мог быть удалён — игнорируем
    }
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
    afterSuccess: () => {
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
    afterSuccess: () => {
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
    afterSuccess: () => {
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

function appendConnectionDesignerArgs(args: string[], connection: ConnectionParams): void {
  if (connection.infoBaseServer && connection.infoBaseRef) {
    args.push('/S', `${connection.infoBaseServer}/${connection.infoBaseRef}`);
  } else if (connection.infoBasePath) {
    args.push('/F', connection.infoBasePath);
  } else {
    throw new Error('Недостаточно параметров подключения к базе из env.json');
  }
  if (connection.userName) {
    args.push(`/N${connection.userName}`);
  }
  if (connection.password) {
    args.push(`/P${connection.password}`);
  }
}

function appendRepositoryDesignerArgs(args: string[], binding: RepositoryBinding): void {
  args.push('/ConfigurationRepositoryF', binding.repoPath);
  args.push('/ConfigurationRepositoryN', binding.repoUser);
  if (binding.repoPassword) {
    args.push('/ConfigurationRepositoryP', binding.repoPassword);
  }
}

const BOOLEAN_EXTRA_FLAGS = new Set([
  'AllowConfigurationChanges',
  'NoBind',
  'ForceBindAlreadyBindedUser',
  'ForceReplaceCfg',
  'Force',
  'Revised',
  'KeepLocked',
  'RestoreDeletedUser',
  'GroupByObject',
  'GroupByComment',
  'DoNotIncludeVersionsWithLabels',
  'IncludeOnlyVersionsWithLabels',
  'IncludeCommentLinesWithDoubleSlash',
  'Verbose',
]);

interface ParsedExtraArgs {
  bool(name: string): boolean;
  value(name: string): string | undefined;
}

function parseExtraArgs(extraArgs: string[]): ParsedExtraArgs {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  let i = 0;
  while (i < extraArgs.length) {
    const arg = extraArgs[i];
    if (!arg.startsWith('-')) {
      i += 1;
      continue;
    }
    const name = arg.slice(1);
    if (BOOLEAN_EXTRA_FLAGS.has(name)) {
      flags.add(name);
      i += 1;
      continue;
    }
    if (i + 1 < extraArgs.length && !extraArgs[i + 1].startsWith('-')) {
      values.set(name, extraArgs[i + 1]);
      i += 2;
    } else {
      flags.add(name);
      i += 1;
    }
  }
  return {
    bool: (name) => flags.has(name),
    value: (name) => values.get(name),
  };
}

function pushIfValue(target: string[], name: string, value: string | undefined): void {
  if (value !== undefined && value !== '') {
    target.push(name, value);
  }
}

function buildCommandDesignerArgs(command: string, extraArgs: string[]): string[] {
  const opts = parseExtraArgs(extraArgs);
  switch (command) {
    case 'repository-create': {
      const args = ['/ConfigurationRepositoryCreate'];
      if (opts.bool('AllowConfigurationChanges')) {
        args.push('-AllowConfigurationChanges');
      }
      pushIfValue(args, '-ChangesAllowedRule', opts.value('ChangesAllowedRule'));
      pushIfValue(args, '-ChangesNotRecommendedRule', opts.value('ChangesNotRecommendedRule'));
      if (opts.bool('NoBind')) {
        args.push('-NoBind');
      }
      return args;
    }
    case 'repository-bind': {
      const args = ['/ConfigurationRepositoryBindCfg'];
      if (opts.bool('ForceBindAlreadyBindedUser')) {
        args.push('-forceBindAlreadyBindedUser');
      }
      if (opts.bool('ForceReplaceCfg')) {
        args.push('-forceReplaceCfg');
      }
      return args;
    }
    case 'repository-unbind': {
      const args = ['/ConfigurationRepositoryUnbindCfg'];
      if (opts.bool('Force')) {
        args.push('-force');
      }
      return args;
    }
    case 'repository-lock': {
      const args = ['/ConfigurationRepositoryLock'];
      pushIfValue(args, '-Objects', opts.value('ObjectsFile'));
      if (opts.bool('Revised')) {
        args.push('-revised');
      }
      return args;
    }
    case 'repository-unlock': {
      const args = ['/ConfigurationRepositoryUnLock'];
      pushIfValue(args, '-Objects', opts.value('ObjectsFile'));
      if (opts.bool('Force')) {
        args.push('-force');
      }
      return args;
    }
    case 'repository-commit': {
      const args = ['/ConfigurationRepositoryCommit'];
      pushIfValue(args, '-Objects', opts.value('ObjectsFile'));
      pushIfValue(args, '-comment', opts.value('Comment'));
      if (opts.bool('KeepLocked')) {
        args.push('-keepLocked');
      }
      if (opts.bool('Force')) {
        args.push('-force');
      }
      return args;
    }
    case 'repository-update': {
      const args = ['/ConfigurationRepositoryUpdateCfg'];
      pushIfValue(args, '-Objects', opts.value('ObjectsFile'));
      pushIfValue(args, '-v', opts.value('Version'));
      if (opts.bool('Force')) {
        args.push('-force');
      }
      return args;
    }
    case 'repository-add-user': {
      const args = ['/ConfigurationRepositoryAddUser'];
      pushIfValue(args, '-User', opts.value('User'));
      pushIfValue(args, '-Pwd', opts.value('Pwd'));
      pushIfValue(args, '-Rights', opts.value('Rights'));
      if (opts.bool('RestoreDeletedUser')) {
        args.push('-RestoreDeletedUser');
      }
      return args;
    }
    case 'repository-copy-users': {
      const args = ['/ConfigurationRepositoryCopyUsers'];
      pushIfValue(args, '-Path', opts.value('Path'));
      pushIfValue(args, '-User', opts.value('User'));
      pushIfValue(args, '-Pwd', opts.value('Pwd'));
      if (opts.bool('RestoreDeletedUser')) {
        args.push('-RestoreDeletedUser');
      }
      return args;
    }
    case 'repository-dump': {
      const file = opts.value('File');
      if (!file) {
        throw new Error('Для выгрузки требуется параметр -File');
      }
      const args = ['/ConfigurationRepositoryDumpCfg', file];
      pushIfValue(args, '-v', opts.value('Version'));
      return args;
    }
    case 'repository-report': {
      const file = opts.value('File');
      if (!file) {
        throw new Error('Для отчёта требуется параметр -File');
      }
      const args = ['/ConfigurationRepositoryReport', file];
      pushIfValue(args, '-NBegin', opts.value('NBegin'));
      pushIfValue(args, '-NEnd', opts.value('NEnd'));
      pushIfValue(args, '-DateBegin', opts.value('DateBegin'));
      pushIfValue(args, '-DateEnd', opts.value('DateEnd'));
      pushIfValue(args, '-ConfigurationVersion', opts.value('ConfigurationVersion'));
      pushIfValue(args, '-ReportFormat', opts.value('ReportFormat'));
      if (opts.bool('GroupByObject')) {
        args.push('-GroupByObject');
      }
      if (opts.bool('GroupByComment')) {
        args.push('-GroupByComment');
      }
      if (opts.bool('DoNotIncludeVersionsWithLabels')) {
        args.push('-DoNotIncludeVersionsWithLabels');
      }
      if (opts.bool('IncludeOnlyVersionsWithLabels')) {
        args.push('-IncludeOnlyVersionsWithLabels');
      }
      if (opts.bool('IncludeCommentLinesWithDoubleSlash')) {
        args.push('-IncludeCommentLinesWithDoubleSlash');
      }
      return args;
    }
    case 'repository-set-label': {
      const args = ['/ConfigurationRepositorySetLabel'];
      pushIfValue(args, '-name', opts.value('LabelName'));
      pushIfValue(args, '-v', opts.value('Version'));
      pushIfValue(args, '-comment', opts.value('Comment'));
      return args;
    }
    default:
      throw new Error(`Неизвестная команда хранилища: ${command}`);
  }
}

function readLogFileContent(outFile: string): string {
  if (!fs.existsSync(outFile)) {
    return '';
  }
  try {
    const data = fs.readFileSync(outFile);
    return decodeLogFile(data).trim();
  } catch {
    return '';
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

async function resolveDatabaseConnection(
  settingsPath: string,
  secrets: ProjectSecretStorage
): Promise<ConnectionParams> {
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
  connection.password = await resolveDbPassword(secrets, asString(defaults['--db-pwd']) ?? '');
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

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function resolveV8PathFromSettings(defaults: Record<string, unknown>): string {
  return asString(defaults['--path']) ?? resolveV8PathHintFromVersion(asString(defaults['--v8version']) ?? '');
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
    return `команда завершилась с кодом ${String(exitCode)}`;
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
  return filtered.at(-1) ?? lines.at(-1) ?? `команда завершилась с кодом ${String(exitCode)}`;
}

/**
 * Компат-обёртка: `running=true` — граница старта операции (begin), `running=false` —
 * терминал (end). Промежуточные обновления текста прогресса должны идти через
 * {@link updateRepositoryOperationStatus}, иначе счётчик активных операций растёт на
 * каждом прогресс-сообщении и статус-бар перестаёт скрываться (регресс M9).
 */
export function setRepositoryOperationStatus(title: string, message: string, running: boolean): void {
  if (running) {
    beginRepositoryOperationStatus(title, message);
  } else {
    endRepositoryOperationStatus(title, message);
  }
}

/** Начало операции хранилища: инкремент счётчика + спиннер-текст. */
export function beginRepositoryOperationStatus(title: string, message: string): void {
  ensureRepositoryStatusItem();
  cancelRepositoryHideTimer();
  activeOperationCount++;
  showRepositorySpinnerStatus(title, message);
}

/** Обновление текста прогресса без изменения счётчика активных операций. */
export function updateRepositoryOperationStatus(title: string, message: string): void {
  ensureRepositoryStatusItem();
  cancelRepositoryHideTimer();
  showRepositorySpinnerStatus(title, message);
}

/** Терминал операции хранилища: декремент счётчика; при нуле — таймер скрытия. */
export function endRepositoryOperationStatus(title: string, message: string): void {
  ensureRepositoryStatusItem();
  cancelRepositoryHideTimer();
  activeOperationCount = Math.max(0, activeOperationCount - 1);

  const text = `${title}: ${message}`;
  if (statusBarItem) {
    statusBarItem.text = `$(check) ${trimStatusMessage(text)}`;
    statusBarItem.tooltip = text;
    statusBarItem.show();
  }

  // Скрываем статус только когда завершилась последняя активная операция хранилища.
  if (activeOperationCount === 0) {
    clearStatusTimer = setTimeout(() => {
      statusBarItem?.hide();
      clearStatusTimer = undefined;
    }, 5_000);
  }
}

function ensureRepositoryStatusItem(): void {
  if (!statusBarItem) {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 95);
    statusBarItem.name = '1С: хранилище конфигурации';
  }
}

function cancelRepositoryHideTimer(): void {
  if (clearStatusTimer) {
    clearTimeout(clearStatusTimer);
    clearStatusTimer = undefined;
  }
}

function showRepositorySpinnerStatus(title: string, message: string): void {
  const text = `${title}: ${message}`;
  if (statusBarItem) {
    statusBarItem.text = `$(sync~spin) ${trimStatusMessage(text)}`;
    statusBarItem.tooltip = text;
    statusBarItem.show();
  }
}

/**
 * Освобождает лениво созданный статус-бар хранилища на остановке расширения.
 * Статус-бар не попадает в context.subscriptions, поэтому его нужно диспозить явно
 * (симметрично disposeCachedAgentOperationServices для ExtensionCommandRunner).
 */
export function disposeRepositoryCommandStatusBar(): void {
  if (clearStatusTimer) {
    clearTimeout(clearStatusTimer);
    clearStatusTimer = undefined;
  }
  statusBarItem?.dispose();
  statusBarItem = undefined;
  activeOperationCount = 0;
}
