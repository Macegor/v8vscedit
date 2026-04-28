import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { MetadataNode } from '../../tree/TreeNode';
import {
  decodeProcessOutput,
  normalizeInfoBasePath,
  resolveV8PathHintFromVersion,
  runProcess,
} from '../../../infra/process';

type NodeArg = MetadataNode | { xmlPath?: string; nodeKind?: string; label?: string };

interface RunCliOptions {
  cliArgs: string[];
  progressTitle: string;
  progressStartMessage: string;
  successMessage: string;
  errorTitle: string;
  /** Человекочитаемое описание операции для текста причины ошибки */
  failureOperation?: string;
  logPrefix: string;
  showSuccessMessage?: boolean;
  afterSuccess?: () => Promise<void>;
}

interface ConnectionParams {
  infoBasePath?: string;
  infoBaseServer?: string;
  infoBaseRef?: string;
  userName?: string;
  password?: string;
  v8Path?: string;
}

let statusBarItem: vscode.StatusBarItem | undefined;
let clearStatusTimer: NodeJS.Timeout | undefined;

export function extractExtensionTarget(node: NodeArg): { extensionName: string; extensionRoot: string } | null {
  const nodeKind = node?.nodeKind;
  const xmlPath = node?.xmlPath;
  const extensionName = String((node as MetadataNode | undefined)?.label ?? '');
  if (nodeKind !== 'extension' || !xmlPath || !extensionName) {
    return null;
  }
  return {
    extensionName,
    extensionRoot: path.dirname(xmlPath),
  };
}

export async function runDecompileExtension(
  extensionName: string,
  extensionRoot: string,
  workspaceFolder: vscode.WorkspaceFolder,
  outputChannel: vscode.OutputChannel
): Promise<boolean> {
  const settingsPath = resolveSettingsPath(workspaceFolder.uri.fsPath, extensionRoot);
  const connection = resolveConnectionFromSettings(settingsPath);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-import-ext-'));
  const tempConfigDir = path.join(tempRoot, 'cfe', extensionName);
  fs.mkdirSync(tempConfigDir, { recursive: true });
  const cliArgs = [
    'export-configuration',
    '-ProjectRoot',
    workspaceFolder.uri.fsPath,
    '-Target',
    'cfe',
    '-ConfigDir',
    tempConfigDir,
    '-Mode',
    'Full',
    '-Extension',
    extensionName,
    ...buildConnectionCliArgs(connection),
  ];
  try {
    return await runInternalCliCommand(
      {
        cliArgs,
        progressTitle: `Выгрузка расширения ${extensionName} во внутренний XML`,
        progressStartMessage: 'Импорт расширения: выгрузка во временный каталог...',
        successMessage: `Импорт расширения "${extensionName}" успешно завершен.`,
        errorTitle: `Ошибка импорта расширения "${extensionName}".`,
        failureOperation: 'импорте расширения',
        logPrefix: 'export-configuration',
        afterSuccess: async () => {
          syncDirectorySnapshot(tempConfigDir, extensionRoot);
          await refreshConfigurationHashCache('cfe', extensionName, extensionRoot, workspaceFolder, outputChannel);
        },
      },
      workspaceFolder,
      outputChannel
    );
  } finally {
    removeTempDir(tempRoot, outputChannel);
  }
}

export async function runDecompileMainConfiguration(
  configName: string,
  configRoot: string,
  workspaceFolder: vscode.WorkspaceFolder,
  outputChannel: vscode.OutputChannel
): Promise<boolean> {
  const settingsPath = resolveSettingsPath(workspaceFolder.uri.fsPath, configRoot);
  const connection = resolveConnectionFromSettings(settingsPath);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-import-cf-'));
  const tempConfigDir = path.join(tempRoot, 'cf');
  fs.mkdirSync(tempConfigDir, { recursive: true });
  const cliArgs = [
    'export-configuration',
    '-ProjectRoot',
    workspaceFolder.uri.fsPath,
    '-Target',
    'cf',
    '-ConfigDir',
    tempConfigDir,
    '-Mode',
    'Full',
    ...buildConnectionCliArgs(connection),
  ];
  try {
    return await runInternalCliCommand(
      {
        cliArgs,
        progressTitle: `Выгрузка основной конфигурации ${configName} во внутренний XML`,
        progressStartMessage: 'Импорт основной конфигурации: выгрузка во временный каталог...',
        successMessage: `Импорт основной конфигурации "${configName}" успешно завершён.`,
        errorTitle: `Ошибка импорта основной конфигурации "${configName}".`,
        failureOperation: 'импорте основной конфигурации',
        logPrefix: 'export-configuration',
        afterSuccess: async () => {
          syncDirectorySnapshot(tempConfigDir, configRoot);
          await refreshConfigurationHashCache('cf', '', configRoot, workspaceFolder, outputChannel);
        },
      },
      workspaceFolder,
      outputChannel
    );
  } finally {
    removeTempDir(tempRoot, outputChannel);
  }
}

export async function runApplyDatabaseConfiguration(
  target: {
    kind: 'cf' | 'cfe';
    name: string;
    rootPath: string;
    extensionName?: string;
  },
  workspaceFolder: vscode.WorkspaceFolder,
  outputChannel: vscode.OutputChannel,
  showSuccessMessage = false
): Promise<boolean> {
  const settingsPath = resolveSettingsPath(workspaceFolder.uri.fsPath, target.rootPath);
  const connection = resolveConnectionFromSettings(settingsPath);
  const cliArgs = [
    'update-configuration',
    ...(target.kind === 'cfe' && target.extensionName ? ['-Extension', target.extensionName] : []),
    ...buildConnectionCliArgs(connection),
  ];

  const targetLabel = target.kind === 'cfe'
    ? `расширения ${target.name}`
    : `конфигурации ${target.name}`;

  return runInternalCliCommand(
    {
      cliArgs,
      progressTitle: `Обновление ${targetLabel} в БД`,
      progressStartMessage: 'Применение изменений конфигурации в базе...',
      successMessage: `Обновление ${targetLabel} в БД успешно завершено.`,
      errorTitle: `Ошибка обновления ${targetLabel} в БД.`,
      failureOperation: `обновлении ${targetLabel} в базе`,
      logPrefix: 'update-configuration',
      showSuccessMessage,
    },
    workspaceFolder,
    outputChannel
  );
}

export async function runCompileExtension(
  extensionName: string,
  extensionRoot: string,
  workspaceFolder: vscode.WorkspaceFolder,
  outputChannel: vscode.OutputChannel,
  showSuccessMessage = true
): Promise<boolean> {
  const settingsPath = resolveSettingsPath(workspaceFolder.uri.fsPath, extensionRoot);
  const connection = resolveConnectionFromSettings(settingsPath);
  const cliArgs = [
    'sync-configuration-full',
    '-ProjectRoot',
    workspaceFolder.uri.fsPath,
    '-Target',
    'cfe',
    '-ConfigDir',
    extensionRoot,
    '-Extension',
    extensionName,
    ...buildConnectionCliArgs(connection),
  ];
  return runInternalCliCommand(
    {
      cliArgs,
      progressTitle: `Полное обновление расширения ${extensionName} в БД`,
      progressStartMessage: 'Загрузка исходников, применение изменений...',
      successMessage: `Полное обновление расширения "${extensionName}" успешно завершено.`,
      errorTitle: `Ошибка загрузки или применения расширения "${extensionName}" в БД.`,
      failureOperation: 'полном обновлении расширения',
      logPrefix: 'sync-configuration-full',
      showSuccessMessage,
    },
    workspaceFolder,
    outputChannel
  );
}

export async function runUpdateExtension(
  extensionName: string,
  extensionRoot: string,
  workspaceFolder: vscode.WorkspaceFolder,
  outputChannel: vscode.OutputChannel,
  showSuccessMessage = true
): Promise<boolean> {
  const settingsPath = resolveSettingsPath(workspaceFolder.uri.fsPath, extensionRoot);
  const connection = resolveConnectionFromSettings(settingsPath);
  const importChangedFilesArgs = [
    'import-git-changes',
    '-ProjectRoot',
    workspaceFolder.uri.fsPath,
    '-Target',
    'cfe',
    '-ConfigDir',
    extensionRoot,
    '-Extension',
    extensionName,
    ...buildConnectionCliArgs(connection),
  ];
  const imported = await runInternalCliCommand(
    {
      cliArgs: importChangedFilesArgs,
      progressTitle: `Подготовка обновления ${extensionName}`,
      progressStartMessage: 'Поиск и загрузка изменённых файлов XML/BSL по хеш-кэшу...',
      successMessage: `Изменённые файлы расширения "${extensionName}" загружены по хеш-кэшу.`,
      errorTitle: `Ошибка загрузки изменённых файлов расширения "${extensionName}" по хеш-кэшу.`,
      failureOperation: 'быстрой загрузке изменённых файлов',
      logPrefix: 'import-git-changes',
      showSuccessMessage: false,
    },
    workspaceFolder,
    outputChannel
  );
  if (!imported) {
    outputChannel.appendLine(
      `[update-configuration] Частичная загрузка по хеш-кэшу недоступна, выполняю fallback на полную синхронизацию исходников.`
    );
    const fallbackArgs = [
      'sync-configuration-full',
      '-ProjectRoot',
      workspaceFolder.uri.fsPath,
      '-Target',
      'cfe',
      '-ConfigDir',
      extensionRoot,
      '-Extension',
      extensionName,
      ...buildConnectionCliArgs(connection),
    ];
    return runInternalCliCommand(
      {
        cliArgs: fallbackArgs,
        progressTitle: `Обновление расширения ${extensionName} (fallback без git)`,
        progressStartMessage: 'Выполняется полная синхронизация исходников и применение в базе...',
        successMessage: `Обновление расширения "${extensionName}" завершено через fallback без хеш-кэша.`,
        errorTitle: `Ошибка fallback-обновления расширения "${extensionName}".`,
        failureOperation: 'fallback-обновлении без хеш-кэша',
        logPrefix: 'sync-configuration-full',
        showSuccessMessage,
      },
      workspaceFolder,
      outputChannel
    );
  }

  const updateArgs = [
    'update-configuration',
    '-Extension',
    extensionName,
    ...buildConnectionCliArgs(connection),
  ];
  return runInternalCliCommand(
    {
      cliArgs: updateArgs,
      progressTitle: `Обновление расширения ${extensionName} в БД`,
      progressStartMessage: 'Применение загруженных изменений в базе...',
      successMessage: `Обновление расширения "${extensionName}" в БД успешно завершено.`,
      errorTitle: `Ошибка обновления расширения "${extensionName}" в БД.`,
      failureOperation: 'обновлении расширения',
      logPrefix: 'update-configuration',
      showSuccessMessage,
    },
    workspaceFolder,
    outputChannel
  );
}

export async function runUpdateMainConfiguration(
  configName: string,
  configRoot: string,
  workspaceFolder: vscode.WorkspaceFolder,
  outputChannel: vscode.OutputChannel,
  showSuccessMessage = true
): Promise<boolean> {
  const settingsPath = resolveSettingsPath(workspaceFolder.uri.fsPath, configRoot);
  const connection = resolveConnectionFromSettings(settingsPath);
  const importChangedFilesArgs = [
    'import-git-changes',
    '-ProjectRoot',
    workspaceFolder.uri.fsPath,
    '-Target',
    'cf',
    '-ConfigDir',
    configRoot,
    ...buildConnectionCliArgs(connection),
  ];
  const imported = await runInternalCliCommand(
    {
      cliArgs: importChangedFilesArgs,
      progressTitle: `Подготовка обновления ${configName}`,
      progressStartMessage: 'Поиск и загрузка изменённых файлов XML/BSL по хеш-кэшу...',
      successMessage: `Изменённые файлы конфигурации "${configName}" загружены по хеш-кэшу.`,
      errorTitle: `Ошибка загрузки изменённых файлов конфигурации "${configName}" по хеш-кэшу.`,
      failureOperation: 'быстрой загрузке изменённых файлов',
      logPrefix: 'import-git-changes',
      showSuccessMessage: false,
    },
    workspaceFolder,
    outputChannel
  );
  if (!imported) {
    outputChannel.appendLine(
      '[update-configuration] Частичная загрузка основной конфигурации недоступна, выполняю fallback на полную синхронизацию исходников.'
    );
    const fallbackArgs = [
      'sync-configuration-full',
      '-ProjectRoot',
      workspaceFolder.uri.fsPath,
      '-Target',
      'cf',
      '-ConfigDir',
      configRoot,
      ...buildConnectionCliArgs(connection),
    ];
    return runInternalCliCommand(
      {
        cliArgs: fallbackArgs,
        progressTitle: `Обновление конфигурации ${configName} (fallback без git)`,
        progressStartMessage: 'Выполняется полная синхронизация исходников и применение в базе...',
        successMessage: `Обновление конфигурации "${configName}" завершено через fallback без хеш-кэша.`,
        errorTitle: `Ошибка fallback-обновления конфигурации "${configName}".`,
        failureOperation: 'fallback-обновлении без хеш-кэша',
        logPrefix: 'sync-configuration-full',
        showSuccessMessage,
      },
      workspaceFolder,
      outputChannel
    );
  }

  const updateArgs = [
    'update-configuration',
    ...buildConnectionCliArgs(connection),
  ];
  return runInternalCliCommand(
    {
      cliArgs: updateArgs,
      progressTitle: `Обновление конфигурации ${configName} в БД`,
      progressStartMessage: 'Применение загруженных изменений в базе...',
      successMessage: `Обновление конфигурации "${configName}" в БД успешно завершено.`,
      errorTitle: `Ошибка обновления конфигурации "${configName}" в БД.`,
      failureOperation: 'обновлении конфигурации',
      logPrefix: 'update-configuration',
      showSuccessMessage,
    },
    workspaceFolder,
    outputChannel
  );
}

async function runInternalCliCommand(
  options: RunCliOptions,
  workspaceFolder: vscode.WorkspaceFolder,
  outputChannel: vscode.OutputChannel
): Promise<boolean> {
  const cliPath = resolveInternalCliPath(workspaceFolder.uri.fsPath);
  const processArgs = [cliPath, ...options.cliArgs];
  const commandAsText = `node ${processArgs.join(' ')}`;
  outputChannel.appendLine(`[actions] Старт: ${commandAsText}`);
  setOperationStatus(options.progressTitle, options.progressStartMessage, true);

  try {
    let lastStdout = '';
    let lastStderr = '';
    const outputTail: string[] = [];

    const result = await runProcess({
      command: process.execPath,
      args: processArgs,
      cwd: workspaceFolder.uri.fsPath,
      shell: false,
      onStdout: (chunk) => {
        const text = decodeProcessOutput(chunk).trim();
        if (text.length > 0) {
          lastStdout = text;
          appendOutputTail(outputTail, text);
          outputChannel.appendLine(`[${options.logPrefix}] ${text}`);
          setOperationStatus(options.progressTitle, trimStatusMessage(text), true);
        }
      },
      onStderr: (chunk) => {
        const text = decodeProcessOutput(chunk).trim();
        if (text.length > 0) {
          lastStderr = text;
          appendOutputTail(outputTail, text);
          outputChannel.appendLine(`[${options.logPrefix}][stderr] ${text}`);
          setOperationStatus(options.progressTitle, trimStatusMessage(`stderr: ${text}`), true);
        }
      },
    });

    if (result.exitCode !== 0) {
      const details = outputTail.length > 0
        ? outputTail
        : [lastStderr || result.lastStderr, lastStdout || result.lastStdout].filter(Boolean);
      const reason = extractFailureReason(details, result.exitCode);
      const operation = options.failureOperation ?? options.progressTitle.toLowerCase();
      throw new Error(`Ошибка при ${operation} по причине: ${reason}`);
    }

    outputChannel.appendLine(`[actions] Завершено: ${commandAsText}`);
    if (options.afterSuccess) {
      await options.afterSuccess();
    }
    setOperationStatus(options.progressTitle, 'завершено', false);
    if (options.showSuccessMessage !== false) {
      void vscode.window.showInformationMessage(options.successMessage);
    }
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    outputChannel.appendLine(`[actions][error] ${message}`);
    setOperationStatus(options.progressTitle, 'ошибка', false);
    void vscode.window.showErrorMessage(
      `${options.errorTitle}\n${message}`,
      'Открыть журнал'
    ).then((action) => {
      if (action === 'Открыть журнал') {
        outputChannel.show(true);
      }
    });
    return false;
  }
}

export function setConfigurationOperationStatus(title: string, message: string, running: boolean): void {
  setOperationStatus(title, message, running);
}

function setOperationStatus(title: string, message: string, running: boolean): void {
  if (!statusBarItem) {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.name = '1С: операция с конфигурацией';
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

function syncDirectorySnapshot(sourceDir: string, targetDir: string): void {
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Временный каталог выгрузки не найден: ${sourceDir}`);
  }
  fs.mkdirSync(targetDir, { recursive: true });
  deleteMissingEntries(sourceDir, targetDir);
  copyAllEntries(sourceDir, targetDir);
}

function deleteMissingEntries(sourceDir: string, targetDir: string): void {
  for (const entry of fs.readdirSync(targetDir, { withFileTypes: true })) {
    const targetPath = path.join(targetDir, entry.name);
    const sourcePath = path.join(sourceDir, entry.name);
    if (!fs.existsSync(sourcePath)) {
      fs.rmSync(targetPath, { recursive: true, force: true });
      continue;
    }
    if (entry.isDirectory()) {
      deleteMissingEntries(sourcePath, targetPath);
    }
  }
}

function copyAllEntries(sourceDir: string, targetDir: string): void {
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(targetPath, { recursive: true });
      copyAllEntries(sourcePath, targetPath);
      continue;
    }
    fs.copyFileSync(sourcePath, targetPath);
  }
}

function removeTempDir(tempRoot: string, outputChannel: vscode.OutputChannel): void {
  try {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    outputChannel.appendLine(`[actions][warn] Не удалось удалить временный каталог ${tempRoot}: ${message}`);
  }
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

  // Основной путь: CLI из пакета самого расширения (dist/cli/onec-tools.js).
  // В рантайме __dirname указывает на dist/ui/commands/ext.
  addCandidate(result, seen, path.join(__dirname, '..', '..', '..', 'cli', 'onec-tools.js'));
  addCandidate(result, seen, path.join(__dirname, '..', '..', '..', '..', 'cli', 'onec-tools.js'));

  // Резерв: dev-режим/нестандартный запуск из workspace.
  addCandidate(result, seen, path.join(workspaceRoot, 'dist', 'cli', 'onec-tools.js'));
  addCandidate(result, seen, path.join(workspaceRoot, 'out', 'cli', 'onec-tools.js'));

  // Дополнительный fallback: подъём по родительским каталогам workspace.
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

  addCandidate(result, seen, path.join(__dirname, 'cli', 'onec-tools.js'));
  addCandidate(result, seen, path.join(__dirname, '..', 'cli', 'onec-tools.js'));
  addCandidate(result, seen, path.join(__dirname, '..', '..', 'cli', 'onec-tools.js'));

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

function resolveSettingsPath(workspaceRoot: string, extensionRoot: string): string {
  const extensionParent = path.dirname(extensionRoot);
  const extensionGrandParent = path.dirname(extensionParent);
  const candidates = [
    path.join(workspaceRoot, 'env.json'),
    path.join(extensionGrandParent, 'env.json'),
    path.join(extensionParent, 'env.json'),
    path.join(workspaceRoot, 'example', 'env.json'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0];
}

function resolveConnectionFromSettings(settingsPath: string): ConnectionParams {
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

  const connection: ConnectionParams = parseIbConnection(ibConnectionRaw);
  connection.userName = asString(defaults['--db-user']) ?? '';
  connection.password = asString(defaults['--db-pwd']) ?? '';
  connection.v8Path = resolveV8PathFromSettings(defaults);
  return connection;
}

function parseIbConnection(rawValue: string): ConnectionParams {
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

function appendOutputTail(outputTail: string[], text: string): void {
  outputTail.push(text);
  if (outputTail.length > 40) {
    outputTail.splice(0, outputTail.length - 40);
  }
}

function extractFailureReason(details: string[], exitCode: number): string {
  const merged = details
    .map((item) => item.replace(/\r/g, '').trim())
    .filter(Boolean);
  if (merged.length === 0) {
    return `команда завершилась с кодом ${exitCode}`;
  }

  const lines = merged
    .flatMap((block) => block.split('\n'))
    .map((line) => line.trim())
    .filter(Boolean);

  const meaningfulLines = lines.filter((line) =>
    !isDiagnosticNoise(line, exitCode)
  );
  const errorIndex = findLastIndex(meaningfulLines, (line) => isErrorLine(line));
  if (errorIndex >= 0) {
    const start = errorIndex > 0 && shouldIncludePreviousErrorLine(meaningfulLines[errorIndex - 1])
      ? errorIndex - 1
      : errorIndex;
    const end = meaningfulLines[errorIndex].endsWith(':')
      ? Math.min(meaningfulLines.length, errorIndex + 5)
      : errorIndex + 1;
    return meaningfulLines.slice(start, end).join('\n');
  }

  return meaningfulLines.at(-1) ?? lines.at(-1) ?? `команда завершилась с кодом ${exitCode}`;
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index])) {
      return index;
    }
  }
  return -1;
}

function isErrorLine(line: string): boolean {
  return /(ошиб|error|failed|exception|не удалось|not found|denied|отказ|конфликт|заблок|недостаточно)/i.test(line);
}

function shouldIncludePreviousErrorLine(line: string | undefined): boolean {
  return Boolean(line && /(ошиб|error|failed|exception)/i.test(line));
}

function isDiagnosticNoise(line: string, exitCode: number): boolean {
  const normalized = line.trim();
  if (!normalized || normalized === '--- Log ---' || normalized === '--- End ---') {
    return true;
  }
  if (new RegExp(`\\(code:\\s*${exitCode}\\)`, 'i').test(normalized)) {
    return true;
  }
  return /^(\[INFO\]|\[WARN\]|Getting |Git changes detected|Hash changes detected|Files for loading|Executing |Created output directory:|Выгрузка исходников|Загрузка исходников|Применение изменений)$/i.test(normalized);
}

async function refreshConfigurationHashCache(
  target: 'cf' | 'cfe',
  extensionName: string,
  configRoot: string,
  workspaceFolder: vscode.WorkspaceFolder,
  outputChannel: vscode.OutputChannel
): Promise<void> {
  const isExtension = target === 'cfe';
  const name = isExtension ? extensionName : 'основная конфигурация';
  const refreshed = await runInternalCliCommand(
    {
      cliArgs: [
        'refresh-hash-cache',
        '-ProjectRoot',
        workspaceFolder.uri.fsPath,
        '-Target',
        target,
        '-ConfigDir',
        configRoot,
        ...(isExtension ? ['-Extension', extensionName] : []),
      ],
      progressTitle: `Актуализация хеш-кэша ${name}`,
      progressStartMessage: 'Обновляю локальный хеш-кэш...',
      successMessage: `Хеш-кэш "${name}" успешно обновлён.`,
      errorTitle: `Ошибка актуализации хеш-кэша "${name}".`,
      failureOperation: 'актуализации хеш-кэша',
      logPrefix: 'refresh-hash-cache',
      showSuccessMessage: false,
    },
    workspaceFolder,
    outputChannel
  );
  if (!refreshed) {
    outputChannel.appendLine(`[refresh-hash-cache] Не удалось обновить кэш после импорта: ${name}.`);
  }
}
