import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { MetadataNode } from '../../tree/TreeNode';
import type { AgentMessage } from '../../../domain/agent';
import {
  AgentCommandError,
  AgentOperationService,
  DesignerAgentProcess,
  DesignerAgentSessionManager,
  ProcessDesignerAgentTransportFactory,
  buildDesignerAgentModeArgs,
  waitForTcpPort,
  type DesignerAgentInfoBaseConnection,
  type DesignerAgentConnectionOptions,
} from '../../../infra/agent';
import {
  describeProcessInterruption,
  getOrCreate,
  normalizeInfoBasePath,
  resolveV8PathHintFromVersion,
  runProcess,
} from '../../../infra/process';
import { resolveDbPassword, type ProjectSecretStorage } from '../../../infra/environment';

type NodeArg = MetadataNode | { xmlPath?: string; nodeKind?: string; label?: string };

/**
 * Хранилище секретов проекта, внедряемое из композиционного корня (`Container`).
 * Модуль запускает процессы 1С из множества экспортируемых функций с разными
 * сигнатурами; вместо каскадного проброса `ProjectSecretStorage` через каждую из
 * них корень один раз регистрирует единственный экземпляр. Пароль БД читается
 * только через него (SecretStorage), в env.json пароль больше не хранится.
 */
let injectedProjectSecretStorage: ProjectSecretStorage | undefined;

/** Регистрирует хранилище секретов проекта. Вызывается один раз из `Container`. */
export function setProjectSecretStorage(secrets: ProjectSecretStorage): void {
  injectedProjectSecretStorage = secrets;
}

export interface ConfigurationProgressHooks {
  readonly onProgressMessage?: (message: string) => void;
}

export interface ConfigurationImportHooks extends ConfigurationProgressHooks {
  readonly beforeProjectFilesChanged?: (filePaths: string[]) => void;
}

interface ConnectionParams {
  infoBasePath?: string;
  infoBaseServer?: string;
  infoBaseRef?: string;
  userName?: string;
  password?: string;
  v8Path?: string;
}

interface AgentCommandSettings {
  readonly host: string;
  readonly listenAddress: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly privateKeyPath: string;
  readonly visible: boolean;
  readonly autoStart: boolean;
  readonly agentModeArgs: readonly string[];
  readonly progressInterval: number;
  readonly startupTimeoutMs: number;
}

interface RunAgentOptions {
  readonly progressTitle: string;
  readonly progressStartMessage: string;
  readonly successMessage: string;
  readonly errorTitle: string;
  readonly showSuccessMessage?: boolean;
  readonly workspaceFolder: vscode.WorkspaceFolder;
  readonly outputChannel: vscode.OutputChannel;
  readonly rootPath: string;
  readonly hooks?: ConfigurationImportHooks | ConfigurationProgressHooks;
  readonly onProgressMessage?: (message: string) => void;
}

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
  /** Если false — popup с ошибкой не показывается, ответственность за UX-обработку у вызывающей стороны. */
  showErrorMessage?: boolean;
  /** Колбэк получает извлечённую причину при сбое. Вызывается до показа popup'а (если он включён). */
  onFailureReason?: (reason: string) => void;
  afterSuccess?: () => Promise<void>;
  onProgressMessage?: (message: string) => void;
}

interface CachedAgentService {
  readonly service: AgentOperationService;
  readonly sessions: DesignerAgentSessionManager;
  readonly process?: DesignerAgentProcess;
}

export interface InteractiveDesignerAgentService {
  readonly service: AgentOperationService;
  readonly forceDisconnect: boolean;
}

// Кэшируем именно промис сервиса (а не готовый сервис), чтобы параллельные
// запросы с одним ключом не запускали конфигуратор/подключение дважды (TOCTOU).
const agentServices = new Map<string, Promise<CachedAgentService>>();

let statusBarItem: vscode.StatusBarItem | undefined;
let clearStatusTimer: NodeJS.Timeout | undefined;
// Счётчик активных операций: параллельные операции делят один статус-бар-синглтон,
// поэтому скрывать его по таймеру можно только когда завершилась ПОСЛЕДНЯЯ (count → 0).
let activeOperationCount = 0;

export function isAgentConfigurationOperationMode(): boolean {
  const mode = vscode.workspace
    .getConfiguration('v8vscedit.configuration')
    .get<string>('operationMode', 'batch');
  return mode === 'agent';
}

/**
 * Единая точка создания/переиспользования кэшированного сервиса агента.
 * getOrCreate кладёт промис в map до await (TOCTOU-защита), а при ошибке старта
 * удаляет ключ, чтобы неудачная попытка не «отравляла» кэш навсегда.
 */
function ensureAgentService(
  workspaceRoot: string,
  factory: () => Promise<CachedAgentService>
): Promise<CachedAgentService> {
  const key = path.resolve(workspaceRoot).toLowerCase();
  const entry = getOrCreate(agentServices, key, factory);
  // Помечаем промис его значением для синхронного геттера getCachedAgentOperationService.
  void entry.then((value) => resolvedServices.set(entry, value.service), () => undefined);
  return entry;
}

export function getAgentServiceCacheKey(workspaceRoot: string): string {
  return path.resolve(workspaceRoot).toLowerCase();
}

export function getCachedAgentOperationService(workspaceFolder: vscode.WorkspaceFolder): AgentOperationService | undefined {
  const key = getAgentServiceCacheKey(workspaceFolder.uri.fsPath);
  const cached = agentServices.get(key);
  if (!cached) {
    return undefined;
  }
  // Синхронный геттер отдаёт сервис, только если промис старта уже успешно
  // разрешён (значение попало в resolvedServices при создании через ensureAgentService).
  return resolvedServices.get(cached);
}

// Слабое сопоставление «промис старта → готовый сервис» для синхронного геттера:
// как только промис разрешается успешно, кладём сюда его значение.
const resolvedServices = new WeakMap<Promise<CachedAgentService>, AgentOperationService>();

export async function disposeCachedAgentOperationServices(): Promise<void> {
  // Статус-бар создаётся лениво при begin/update/end и не попадает в context.subscriptions,
  // поэтому освобождаем его здесь — на общем пути остановки расширения.
  if (clearStatusTimer) {
    clearTimeout(clearStatusTimer);
    clearStatusTimer = undefined;
  }
  statusBarItem?.dispose();
  statusBarItem = undefined;
  activeOperationCount = 0;

  const entries = [...agentServices.values()];
  agentServices.clear();
  await Promise.all(entries.map(async (entryPromise) => {
    // Зафейленный промис старта не должен ронять остановку расширения.
    const entry = await entryPromise.catch(() => undefined);
    if (!entry) {
      return;
    }
    try {
      await entry.sessions.disposeAll();
    } finally {
      await entry.process?.stop();
    }
  }));
}

export async function getAgentOperationServiceForInteractiveDesigner(
  workspaceFolder: vscode.WorkspaceFolder,
  outputChannel: vscode.OutputChannel
): Promise<InteractiveDesignerAgentService | undefined> {
  const cached = getCachedAgentOperationService(workspaceFolder);
  if (cached) {
    return { service: cached, forceDisconnect: false };
  }

  const workspaceRoot = workspaceFolder.uri.fsPath;
  try {
    // Сигнальным исключением помечаем случай «агент не найден» — тогда ключ
    // не должен осесть в кэше отравленным, и getOrCreate его удалит.
    const entry = await ensureAgentService(workspaceRoot, async () => {
      const settingsPath = resolveSettingsPath(workspaceRoot, workspaceRoot);
      const connection = await resolveConnectionFromSettings(settingsPath);
      const agentSettings = readAgentCommandSettings(connection);
      const portOpened = await waitForTcpPort({
        host: agentSettings.host,
        port: agentSettings.port,
        timeoutMs: 500,
      });
      if (!portOpened) {
        throw new AgentPortNotOpenError();
      }
      outputChannel.appendLine(
        `[agent] Найден запущенный агент конфигуратора: ${agentSettings.host}:${String(agentSettings.port)}.`
      );
      return createAgentOperationServiceEntry(workspaceRoot, agentSettings);
    });
    return { service: entry.service, forceDisconnect: true };
  } catch (error) {
    if (error instanceof AgentPortNotOpenError) {
      return undefined;
    }
    const message = error instanceof Error ? error.message : String(error);
    outputChannel.appendLine(`[agent][warn] Не удалось проверить запущенный агент конфигуратора: ${message}`);
    return undefined;
  }
}

/** Внутренний сигнал: агент не слушает порт — не ошибка старта, а «нет агента». */
class AgentPortNotOpenError extends Error {
  constructor() {
    super('агент конфигуратора не обнаружен на порту');
    this.name = 'AgentPortNotOpenError';
  }
}

export function extractExtensionTarget(node: NodeArg): { extensionName: string; extensionRoot: string } | null {
  const nodeKind = node.nodeKind;
  const xmlPath = node.xmlPath;
  const rawLabel = (node as MetadataNode).label;
  const extensionName = typeof rawLabel === 'string' ? rawLabel : rawLabel?.label ?? '';
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
  outputChannel: vscode.OutputChannel,
  hooks?: ConfigurationImportHooks
): Promise<boolean> {
  if (!isAgentConfigurationOperationMode()) {
    return runBatchDecompileExtension(extensionName, extensionRoot, workspaceFolder, outputChannel, hooks);
  }

  return runAgentConfigurationOperation(
    {
      progressTitle: `Выгрузка расширения ${extensionName} во внутренний XML`,
      progressStartMessage: 'Импорт расширения через агент...',
      successMessage: `Импорт расширения "${extensionName}" успешно завершен.`,
      errorTitle: `Ошибка импорта расширения "${extensionName}".`,
      showSuccessMessage: false,
      workspaceFolder,
      outputChannel,
      hooks,
      rootPath: extensionRoot,
    },
    async (service, operationHooks) => {
      await service.importFromDatabase(
        { kind: 'cfe', name: extensionName, rootPath: extensionRoot, extensionName },
        operationHooks
      );
    }
  );
}

export async function runDecompileMainConfiguration(
  configName: string,
  configRoot: string,
  workspaceFolder: vscode.WorkspaceFolder,
  outputChannel: vscode.OutputChannel,
  hooks?: ConfigurationImportHooks
): Promise<boolean> {
  if (!isAgentConfigurationOperationMode()) {
    return runBatchDecompileMainConfiguration(configName, configRoot, workspaceFolder, outputChannel, hooks);
  }

  return runAgentConfigurationOperation(
    {
      progressTitle: `Выгрузка основной конфигурации ${configName} во внутренний XML`,
      progressStartMessage: 'Импорт основной конфигурации через агент...',
      successMessage: `Импорт основной конфигурации "${configName}" успешно завершён.`,
      errorTitle: `Ошибка импорта основной конфигурации "${configName}".`,
      showSuccessMessage: false,
      workspaceFolder,
      outputChannel,
      hooks,
      rootPath: configRoot,
    },
    async (service, operationHooks) => {
      await service.importFromDatabase(
        { kind: 'cf', name: configName, rootPath: configRoot },
        operationHooks
      );
    }
  );
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
  if (!isAgentConfigurationOperationMode()) {
    return runBatchApplyDatabaseConfiguration(target, workspaceFolder, outputChannel, showSuccessMessage);
  }

  const targetLabel = target.kind === 'cfe'
    ? `расширения ${target.name}`
    : `конфигурации ${target.name}`;

  return runAgentConfigurationOperation(
    {
      progressTitle: `Обновление ${targetLabel} в БД`,
      progressStartMessage: 'Применение изменений конфигурации через агент...',
      successMessage: `Обновление ${targetLabel} в БД успешно завершено.`,
      errorTitle: `Ошибка обновления ${targetLabel} в БД.`,
      showSuccessMessage,
      workspaceFolder,
      outputChannel,
      rootPath: target.rootPath,
    },
    async (service, operationHooks) => {
      await service.updateDatabaseConfiguration(target, operationHooks);
    }
  );
}

export async function runCompileExtension(
  extensionName: string,
  extensionRoot: string,
  workspaceFolder: vscode.WorkspaceFolder,
  outputChannel: vscode.OutputChannel,
  showSuccessMessage = true
): Promise<boolean> {
  if (!isAgentConfigurationOperationMode()) {
    return runBatchCompileExtension(extensionName, extensionRoot, workspaceFolder, outputChannel, showSuccessMessage);
  }

  return runAgentConfigurationOperation(
    {
      progressTitle: `Полное обновление расширения ${extensionName} в БД`,
      progressStartMessage: 'Загрузка исходников через агент, применение изменений...',
      successMessage: `Полное обновление расширения "${extensionName}" успешно завершено.`,
      errorTitle: `Ошибка загрузки или применения расширения "${extensionName}" в БД.`,
      showSuccessMessage,
      workspaceFolder,
      outputChannel,
      rootPath: extensionRoot,
    },
    async (service, operationHooks) => {
      await service.loadFullAndUpdate(
        { kind: 'cfe', name: extensionName, rootPath: extensionRoot, extensionName },
        operationHooks
      );
    }
  );
}

export async function runUpdateExtension(
  extensionName: string,
  extensionRoot: string,
  workspaceFolder: vscode.WorkspaceFolder,
  outputChannel: vscode.OutputChannel,
  showSuccessMessage = true,
  hooks?: ConfigurationProgressHooks
): Promise<boolean> {
  if (!isAgentConfigurationOperationMode()) {
    return runBatchUpdateExtension(extensionName, extensionRoot, workspaceFolder, outputChannel, showSuccessMessage, hooks);
  }

  return runAgentConfigurationOperation(
    {
      progressTitle: `Обновление расширения ${extensionName} в БД`,
      progressStartMessage: 'Поиск и загрузка изменённых файлов через агент...',
      successMessage: `Обновление расширения "${extensionName}" в БД успешно завершено.`,
      errorTitle: `Ошибка обновления расширения "${extensionName}" в БД.`,
      showSuccessMessage,
      onProgressMessage: hooks?.onProgressMessage,
      workspaceFolder,
      outputChannel,
      rootPath: extensionRoot,
    },
    async (service, operationHooks) => {
      await service.loadChangedAndUpdate(
        { kind: 'cfe', name: extensionName, rootPath: extensionRoot, extensionName },
        operationHooks
      );
    }
  );
}

export async function runUpdateMainConfiguration(
  configName: string,
  configRoot: string,
  workspaceFolder: vscode.WorkspaceFolder,
  outputChannel: vscode.OutputChannel,
  showSuccessMessage = true,
  hooks?: ConfigurationProgressHooks
): Promise<boolean> {
  if (!isAgentConfigurationOperationMode()) {
    return runBatchUpdateMainConfiguration(configName, configRoot, workspaceFolder, outputChannel, showSuccessMessage, hooks);
  }

  return runAgentConfigurationOperation(
    {
      progressTitle: `Обновление конфигурации ${configName} в БД`,
      progressStartMessage: 'Поиск и загрузка изменённых файлов через агент...',
      successMessage: `Обновление конфигурации "${configName}" в БД успешно завершено.`,
      errorTitle: `Ошибка обновления конфигурации "${configName}" в БД.`,
      showSuccessMessage,
      onProgressMessage: hooks?.onProgressMessage,
      workspaceFolder,
      outputChannel,
      rootPath: configRoot,
    },
    async (service, operationHooks) => {
      await service.loadChangedAndUpdate(
        { kind: 'cf', name: configName, rootPath: configRoot },
        operationHooks
      );
    }
  );
}

async function runBatchDecompileExtension(
  extensionName: string,
  extensionRoot: string,
  workspaceFolder: vscode.WorkspaceFolder,
  outputChannel: vscode.OutputChannel,
  hooks?: ConfigurationImportHooks
): Promise<boolean> {
  const settingsPath = resolveSettingsPath(workspaceFolder.uri.fsPath, extensionRoot);
  const connection = await resolveConnectionFromSettings(settingsPath);
  const tempRoot = createWorkspaceTempDir(workspaceFolder.uri.fsPath, 'import-ext-');
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
        onProgressMessage: hooks?.onProgressMessage,
        afterSuccess: async () => {
          const changedProjectFiles = collectSnapshotProjectFiles(tempConfigDir, extensionRoot);
          hooks?.onProgressMessage?.(`замена файлов выгрузки: ${String(changedProjectFiles.length)}`);
          hooks?.beforeProjectFilesChanged?.(changedProjectFiles);
          await yieldToUi();
          syncDirectorySnapshot(tempConfigDir, extensionRoot);
          hooks?.beforeProjectFilesChanged?.(changedProjectFiles);
          hooks?.onProgressMessage?.('обновление кэша метаданных');
          await refreshConfigurationHashCache('cfe', extensionName, extensionRoot, workspaceFolder, outputChannel, hooks?.onProgressMessage);
        },
      },
      workspaceFolder,
      outputChannel
    );
  } finally {
    removeTempDir(tempRoot, outputChannel);
  }
}

async function runBatchDecompileMainConfiguration(
  configName: string,
  configRoot: string,
  workspaceFolder: vscode.WorkspaceFolder,
  outputChannel: vscode.OutputChannel,
  hooks?: ConfigurationImportHooks
): Promise<boolean> {
  const settingsPath = resolveSettingsPath(workspaceFolder.uri.fsPath, configRoot);
  const connection = await resolveConnectionFromSettings(settingsPath);
  const tempRoot = createWorkspaceTempDir(workspaceFolder.uri.fsPath, 'import-cf-');
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
        onProgressMessage: hooks?.onProgressMessage,
        afterSuccess: async () => {
          const changedProjectFiles = collectSnapshotProjectFiles(tempConfigDir, configRoot);
          hooks?.onProgressMessage?.(`замена файлов выгрузки: ${String(changedProjectFiles.length)}`);
          hooks?.beforeProjectFilesChanged?.(changedProjectFiles);
          await yieldToUi();
          syncDirectorySnapshot(tempConfigDir, configRoot);
          hooks?.beforeProjectFilesChanged?.(changedProjectFiles);
          hooks?.onProgressMessage?.('обновление кэша метаданных');
          await refreshConfigurationHashCache('cf', '', configRoot, workspaceFolder, outputChannel, hooks?.onProgressMessage);
        },
      },
      workspaceFolder,
      outputChannel
    );
  } finally {
    removeTempDir(tempRoot, outputChannel);
  }
}

async function runBatchApplyDatabaseConfiguration(
  target: {
    kind: 'cf' | 'cfe';
    name: string;
    rootPath: string;
    extensionName?: string;
  },
  workspaceFolder: vscode.WorkspaceFolder,
  outputChannel: vscode.OutputChannel,
  showSuccessMessage: boolean
): Promise<boolean> {
  const settingsPath = resolveSettingsPath(workspaceFolder.uri.fsPath, target.rootPath);
  const connection = await resolveConnectionFromSettings(settingsPath);
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

function createWorkspaceTempDir(workspaceRoot: string, prefix: string): string {
  const tempParent = path.join(workspaceRoot, '.v8vscedit', 'import-temp');
  fs.mkdirSync(tempParent, { recursive: true });
  return fs.mkdtempSync(path.join(tempParent, prefix));
}

const FULL_SYNC_CONFIRM_BUTTON = 'Выполнить полную загрузку';

function isConfigurationIdMismatchReason(reason: string): boolean {
  return /идентификатор[\s\S]*загружаемой конфигурации[\s\S]*отличается[\s\S]*сохраненной/i.test(reason)
    || /ошибка частичной загрузки/i.test(reason);
}

async function confirmFullSyncFallback(
  targetLabel: string,
  failureReason: string,
  outputChannel: vscode.OutputChannel
): Promise<boolean> {
  const isMismatch = isConfigurationIdMismatchReason(failureReason);
  const detail = isMismatch
    ? `Идентификатор конфигурации в файлах не совпадает с идентификатором базы — частичная загрузка платформой запрещена. Это типично для первой синхронизации с базой или после её пересоздания.\n\nПолная загрузка перезапишет конфигурацию базы исходниками из ${targetLabel}.`
    : `Причина:\n${failureReason}\n\nПолная загрузка перезапишет конфигурацию базы исходниками из ${targetLabel}.`;

  const choice = await vscode.window.showWarningMessage(
    `Не удалось выполнить быструю загрузку изменений ${targetLabel}. Выполнить полную загрузку?`,
    {
      modal: true,
      detail,
    },
    FULL_SYNC_CONFIRM_BUTTON,
    'Открыть журнал'
  );

  if (choice === 'Открыть журнал') {
    outputChannel.show(true);
    return false;
  }
  return choice === FULL_SYNC_CONFIRM_BUTTON;
}

async function runBatchCompileExtension(
  extensionName: string,
  extensionRoot: string,
  workspaceFolder: vscode.WorkspaceFolder,
  outputChannel: vscode.OutputChannel,
  showSuccessMessage: boolean
): Promise<boolean> {
  const settingsPath = resolveSettingsPath(workspaceFolder.uri.fsPath, extensionRoot);
  const connection = await resolveConnectionFromSettings(settingsPath);
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

async function runBatchUpdateExtension(
  extensionName: string,
  extensionRoot: string,
  workspaceFolder: vscode.WorkspaceFolder,
  outputChannel: vscode.OutputChannel,
  showSuccessMessage: boolean,
  hooks?: ConfigurationProgressHooks
): Promise<boolean> {
  const settingsPath = resolveSettingsPath(workspaceFolder.uri.fsPath, extensionRoot);
  const connection = await resolveConnectionFromSettings(settingsPath);
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
  let importFailureReason = '';
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
      showErrorMessage: false,
      onFailureReason: (reason) => { importFailureReason = reason; },
      onProgressMessage: hooks?.onProgressMessage,
    },
    workspaceFolder,
    outputChannel
  );
  if (!imported) {
    outputChannel.appendLine(
      '[update-configuration] Частичная загрузка по хеш-кэшу недоступна, запрашиваю подтверждение полной загрузки.'
    );
    const confirmed = await confirmFullSyncFallback(
      `расширения "${extensionName}"`,
      importFailureReason,
      outputChannel
    );
    if (!confirmed) {
      outputChannel.appendLine('[update-configuration] Полная загрузка отклонена пользователем.');
      return false;
    }
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
        progressTitle: `Обновление расширения ${extensionName} (полная загрузка)`,
        progressStartMessage: 'Выполняется полная синхронизация исходников и применение в базе...',
        successMessage: `Обновление расширения "${extensionName}" завершено через полную загрузку.`,
        errorTitle: `Ошибка полной загрузки расширения "${extensionName}".`,
        failureOperation: 'полной загрузке расширения',
        logPrefix: 'sync-configuration-full',
        showSuccessMessage,
        onProgressMessage: hooks?.onProgressMessage,
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
      onProgressMessage: hooks?.onProgressMessage,
    },
    workspaceFolder,
    outputChannel
  );
}

async function runBatchUpdateMainConfiguration(
  configName: string,
  configRoot: string,
  workspaceFolder: vscode.WorkspaceFolder,
  outputChannel: vscode.OutputChannel,
  showSuccessMessage: boolean,
  hooks?: ConfigurationProgressHooks
): Promise<boolean> {
  const settingsPath = resolveSettingsPath(workspaceFolder.uri.fsPath, configRoot);
  const connection = await resolveConnectionFromSettings(settingsPath);
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
  let importFailureReason = '';
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
      showErrorMessage: false,
      onFailureReason: (reason) => { importFailureReason = reason; },
      onProgressMessage: hooks?.onProgressMessage,
    },
    workspaceFolder,
    outputChannel
  );
  if (!imported) {
    outputChannel.appendLine(
      '[update-configuration] Частичная загрузка основной конфигурации недоступна, запрашиваю подтверждение полной загрузки.'
    );
    const confirmed = await confirmFullSyncFallback(
      `конфигурации "${configName}"`,
      importFailureReason,
      outputChannel
    );
    if (!confirmed) {
      outputChannel.appendLine('[update-configuration] Полная загрузка отклонена пользователем.');
      return false;
    }
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
        progressTitle: `Обновление конфигурации ${configName} (полная загрузка)`,
        progressStartMessage: 'Выполняется полная синхронизация исходников и применение в базе...',
        successMessage: `Обновление конфигурации "${configName}" завершено через полную загрузку.`,
        errorTitle: `Ошибка полной загрузки конфигурации "${configName}".`,
        failureOperation: 'полной загрузке конфигурации',
        logPrefix: 'sync-configuration-full',
        showSuccessMessage,
        onProgressMessage: hooks?.onProgressMessage,
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
      onProgressMessage: hooks?.onProgressMessage,
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
  beginConfigurationOperationStatus(options.progressTitle, options.progressStartMessage);
  options.onProgressMessage?.(options.progressStartMessage);

  try {
    let lastStdout = '';
    let lastStderr = '';
    const outputTail: string[] = [];

    // Оборачиваем операцию в прогресс-нотификацию с кнопкой отмены, чтобы
    // пользователь мог прервать зависший CLI/конфигуратор. Статус-бар не трогаем.
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: options.progressTitle,
        cancellable: true,
      },
      (_progress, token) => runProcess({
        command: process.execPath,
        args: processArgs,
        cwd: workspaceFolder.uri.fsPath,
        shell: false,
        cancellationToken: token,
        onStdout: (text) => {
          const line = text.trim();
          if (line.length > 0) {
            lastStdout = line;
            appendOutputTail(outputTail, line);
            outputChannel.appendLine(`[${options.logPrefix}] ${line}`);
            const statusMessage = trimStatusMessage(line);
            updateConfigurationOperationStatus(options.progressTitle, statusMessage);
            options.onProgressMessage?.(statusMessage);
          }
        },
        onStderr: (text) => {
          const line = text.trim();
          if (line.length > 0) {
            lastStderr = line;
            appendOutputTail(outputTail, line);
            outputChannel.appendLine(`[${options.logPrefix}][stderr] ${line}`);
            const statusMessage = trimStatusMessage(`stderr: ${line}`);
            updateConfigurationOperationStatus(options.progressTitle, statusMessage);
            options.onProgressMessage?.(statusMessage);
          }
        },
      })
    );

    // Штатная отмена/таймаут — не ошибка: показываем нейтральное сообщение.
    const interruption = describeProcessInterruption(result);
    if (interruption) {
      outputChannel.appendLine(`[actions] ${interruption}`);
      endConfigurationOperationStatus(options.progressTitle, 'прервано');
      options.onProgressMessage?.(interruption);
      void vscode.window.showInformationMessage(`${options.progressTitle}: ${interruption}`);
      return false;
    }

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
    endConfigurationOperationStatus(options.progressTitle, 'завершено');
    if (options.showSuccessMessage !== false) {
      void vscode.window.showInformationMessage(options.successMessage);
    }
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    outputChannel.appendLine(`[actions][error] ${message}`);
    endConfigurationOperationStatus(options.progressTitle, 'ошибка');
    options.onFailureReason?.(message);
    if (options.showErrorMessage !== false) {
      void vscode.window.showErrorMessage(
        `${options.errorTitle}\n${message}`,
        'Открыть журнал'
      ).then((action) => {
        if (action === 'Открыть журнал') {
          outputChannel.show(true);
        }
      });
    }
    return false;
  }
}

async function runAgentConfigurationOperation(
  options: RunAgentOptions,
  operation: (
    service: AgentOperationService,
    hooks: {
      onMessage: (message: string) => void;
      onProjectFilesWillChange?: (filePaths: string[]) => void;
      onQuestion: (message: AgentMessage) => Promise<string | undefined>;
    }
  ) => Promise<void>
): Promise<boolean> {
  options.outputChannel.appendLine(`[agent] Старт: ${options.progressTitle}`);
  beginConfigurationOperationStatus(options.progressTitle, options.progressStartMessage);
  options.hooks?.onProgressMessage?.(options.progressStartMessage);
  options.onProgressMessage?.(options.progressStartMessage);

  const importHooks = isImportHooks(options.hooks) ? options.hooks : undefined;
  const buildOperationHooks = () => ({
    onMessage: (message: string) => {
      options.outputChannel.appendLine(`[agent] ${message}`);
      const statusMessage = getAgentStatusMessage(message);
      if (statusMessage) {
        updateConfigurationOperationStatus(options.progressTitle, statusMessage);
        options.hooks?.onProgressMessage?.(statusMessage);
        options.onProgressMessage?.(statusMessage);
      }
    },
    onProjectFilesWillChange: importHooks
      ? (filePaths: string[]) => importHooks.beforeProjectFilesChanged?.(filePaths)
      : undefined,
    onQuestion: showAgentQuestion,
  });

  try {
    const service = await getAgentOperationService(options.workspaceFolder, options.rootPath, options.outputChannel);
    await operation(service, buildOperationHooks());

    endConfigurationOperationStatus(options.progressTitle, 'завершено');
    options.outputChannel.appendLine(`[agent] Завершено: ${options.progressTitle}`);
    if (options.showSuccessMessage !== false) {
      void vscode.window.showInformationMessage(options.successMessage);
    }
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    options.outputChannel.appendLine(`[agent][error] ${message}`);
    if (error instanceof AgentCommandError) {
      options.outputChannel.appendLine(`[agent][error] Команда: ${error.command}`);
    }
    logAgentDiagnostics(options.workspaceFolder, options.outputChannel);
    endConfigurationOperationStatus(options.progressTitle, 'ошибка');
    void vscode.window.showErrorMessage(
      `${options.errorTitle}\n${message}`,
      'Открыть журнал'
    ).then((action) => {
      if (action === 'Открыть журнал') {
        options.outputChannel.show(true);
      }
    });
    return false;
  }
}

function logAgentDiagnostics(workspaceFolder: vscode.WorkspaceFolder, outputChannel: vscode.OutputChannel): void {
  const workspaceRoot = workspaceFolder.uri.fsPath;
  const agentBaseDir = path.join(workspaceRoot, '.v8vscedit', 'agent');
  outputChannel.appendLine(`[agent][diag] Каталог агента: ${agentBaseDir}`);
  // Сам конфигуратор пишет дамп в `~/.1cv8/1C/1cv8/dumps` либо в каталог временных файлов платформы.
  // Здесь сообщаем только то, что мы заведомо знаем — служебный каталог расширения.
}

async function getAgentOperationService(
  workspaceFolder: vscode.WorkspaceFolder,
  rootPath: string,
  outputChannel: vscode.OutputChannel
): Promise<AgentOperationService> {
  const workspaceRoot = workspaceFolder.uri.fsPath;
  // ensureAgentService закрывает TOCTOU: параллельные операции не запустят
  // конфигуратор дважды, а неудачный старт удалит ключ (getOrCreate).
  const entry = await ensureAgentService(
    workspaceRoot,
    () => startAgentOperationService(workspaceRoot, rootPath, outputChannel)
  );
  return entry.service;
}

async function startAgentOperationService(
  workspaceRoot: string,
  rootPath: string,
  outputChannel: vscode.OutputChannel
): Promise<CachedAgentService> {
  const settingsPath = resolveSettingsPath(workspaceRoot, rootPath);
  const connection = await resolveConnectionFromSettings(settingsPath);
  const agentSettings = readAgentCommandSettings(connection);
  let agentProcess: DesignerAgentProcess | undefined;
  if (agentSettings.autoStart) {
    agentProcess = new DesignerAgentProcess();
    const agentBaseDir = path.join(workspaceRoot, '.v8vscedit', 'agent');
    fs.mkdirSync(agentBaseDir, { recursive: true });
    const args = buildAgentStartLogArgs(toDesignerAgentConnection(connection), agentSettings, agentBaseDir);
    outputChannel.appendLine(`[agent] Запуск конфигуратора: ${args.join(' ')}`);
    agentProcess.start({
      connection: toDesignerAgentConnection(connection),
      visible: agentSettings.visible,
      agentPort: agentSettings.port,
      agentListenAddress: agentSettings.listenAddress,
      agentBaseDir,
      agentModeArgs: agentSettings.agentModeArgs,
      // 1С создаёт 1cv8u.pfl в рабочем каталоге процесса, поэтому держим его в служебной папке агента.
      cwd: agentBaseDir,
      onStdout: (text) => appendAgentProcessOutput(outputChannel, 'stdout', text),
      onStderr: (text) => appendAgentProcessOutput(outputChannel, 'stderr', text),
      onExit: (code, signal) => {
        outputChannel.appendLine(`[agent][process] Конфигуратор в режиме агента завершился: код=${String(code ?? '-')}, сигнал=${signal ?? '-'}`);
      },
    });
    outputChannel.appendLine('[agent] Конфигуратор запущен в режиме агента.');
    outputChannel.appendLine(`[agent] Ожидание SSH-порта ${agentSettings.host}:${String(agentSettings.port)} до ${String(agentSettings.startupTimeoutMs)} мс.`);
    const portOpened = await waitForTcpPort({
      host: agentSettings.host,
      port: agentSettings.port,
      timeoutMs: agentSettings.startupTimeoutMs,
      isAborted: () => agentProcess?.hasExited() ?? false,
    });
    if (!portOpened) {
      throw new Error(
        `Конфигуратор в режиме агента не открыл SSH-порт ${agentSettings.host}:${String(agentSettings.port)}. ` +
        `Состояние процесса: ${agentProcess.getExitDescription()}. Подробности выше в журнале 1С Редактора.`
      );
    }
    outputChannel.appendLine(`[agent] SSH-порт ${agentSettings.host}:${String(agentSettings.port)} открыт.`);
  }

  return createAgentOperationServiceEntry(workspaceRoot, agentSettings, agentProcess);
}

function createAgentOperationServiceEntry(
  workspaceRoot: string,
  agentSettings: AgentCommandSettings,
  agentProcess?: DesignerAgentProcess
): CachedAgentService {
  const transportOptions: DesignerAgentConnectionOptions = {
    host: agentSettings.host,
    port: agentSettings.port,
    user: agentSettings.user,
    password: agentSettings.password,
    privateKeyPath: nonEmptyString(agentSettings.privateKeyPath),
    connectAttempts: 8,
    connectRetryDelayMs: 1000,
  };
  const sessions = new DesignerAgentSessionManager(
    new ProcessDesignerAgentTransportFactory(transportOptions),
    { notifyProgressInterval: agentSettings.progressInterval }
  );
  return {
    service: new AgentOperationService(workspaceRoot, sessions),
    sessions,
    process: agentProcess,
  };
}

function readAgentCommandSettings(connection: ConnectionParams): AgentCommandSettings {
  const config = vscode.workspace.getConfiguration('v8vscedit.agent');
  const rawModeArgs = config.get<string>('agentModeArgs', '');
  const configuredUser = config.get<string>('user', '').trim();
  return {
    host: nonEmptyString(config.get<string>('host', 'localhost')) ?? 'localhost',
    listenAddress: nonEmptyString(config.get<string>('listenAddress', '127.0.0.1')) ?? '127.0.0.1',
    port: config.get<number>('port', 1543),
    user: configuredUser ? configuredUser : (nonEmptyString(connection.userName) ?? 'admin'),
    password: connection.password ?? '',
    privateKeyPath: config.get<string>('privateKeyPath', '').trim(),
    visible: config.get<boolean>('visible', false),
    autoStart: config.get<boolean>('autoStart', true),
    agentModeArgs: splitAgentModeArgs(rawModeArgs),
    progressInterval: config.get<number>('progressInterval', 0.5),
    startupTimeoutMs: config.get<number>('startupTimeoutMs', 15000),
  };
}

export function splitAgentModeArgs(rawValue: string): string[] {
  const result: string[] = [];
  let current = '';
  let quote: '"' | '\'' | undefined;
  let escaped = false;

  for (let index = 0; index < rawValue.length; index += 1) {
    const char = rawValue[index] ?? '';
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\' && quote) {
      const next = rawValue[index + 1];
      if (next === quote || next === '\\') {
        escaped = true;
      } else {
        current += char;
      }
      continue;
    }
    if ((char === '"' || char === "'") && (!quote || quote === char)) {
      quote = quote ? undefined : char;
      continue;
    }
    if (!quote && /\s/.test(char)) {
      if (current) {
        result.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }

  if (escaped) {
    current += '\\';
  }
  if (quote) {
    throw new Error('Некорректные дополнительные параметры /AgentMode: не закрыта кавычка.');
  }
  if (current) {
    result.push(current);
  }
  return result;
}

function toDesignerAgentConnection(connection: ConnectionParams): DesignerAgentInfoBaseConnection {
  const v8Path = connection.v8Path ?? '';
  if (connection.infoBaseServer && connection.infoBaseRef) {
    return {
      infoBasePath: '',
      infoBaseServer: connection.infoBaseServer,
      infoBaseRef: connection.infoBaseRef,
      v8Path,
    };
  }
  if (connection.infoBasePath) {
    return {
      infoBasePath: connection.infoBasePath,
      v8Path,
    };
  }
  throw new Error('Недостаточно параметров подключения к базе из env.json.');
}

function buildAgentStartLogArgs(
  connection: DesignerAgentInfoBaseConnection,
  settings: AgentCommandSettings,
  agentBaseDir: string
): string[] {
  const args = ['1cv8', 'DESIGNER'];
  if (connection.infoBaseServer && connection.infoBaseRef) {
    args.push('/S', `${connection.infoBaseServer}/${connection.infoBaseRef}`);
  } else {
    args.push('/F', connection.infoBasePath);
  }
  args.push('/AgentMode', ...buildDesignerAgentModeArgs({
    connection,
    agentPort: settings.port,
    agentListenAddress: settings.listenAddress,
    agentBaseDir,
    agentModeArgs: settings.agentModeArgs,
  }));
  if (settings.visible) {
    args.push('/Visible');
  }
  return args;
}

function appendAgentProcessOutput(outputChannel: vscode.OutputChannel, stream: 'stdout' | 'stderr', text: string): void {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    outputChannel.appendLine(`[agent][process][${stream}] ${line}`);
  }
}

async function showAgentQuestion(message: AgentMessage): Promise<string | undefined> {
  const text = typeof message.message === 'string' && message.message.trim()
    ? message.message.trim()
    : typeof message.body === 'string'
      ? message.body
      : JSON.stringify(message.body ?? message);
  if (/(парол|password)/i.test(text)) {
    return vscode.window.showInputBox({
      title: 'Пароль информационной базы',
      prompt: text,
      password: true,
      ignoreFocusOut: true,
    });
  }
  if (/(пользователь|логин|user|login)/i.test(text)) {
    return vscode.window.showInputBox({
      title: 'Пользователь информационной базы',
      prompt: text,
      ignoreFocusOut: true,
    });
  }
  const action = await vscode.window.showWarningMessage(
    text,
    { modal: true },
    'Да',
    'Нет',
    'Отмена'
  );
  if (action === 'Да') {
    return 'yes';
  }
  if (action === 'Нет') {
    return 'no';
  }
  return 'cancel';
}

function isImportHooks(hooks: ConfigurationImportHooks | ConfigurationProgressHooks | undefined): hooks is ConfigurationImportHooks {
  return Boolean(hooks && 'beforeProjectFilesChanged' in hooks);
}

/**
 * Компат-обёртка: `running=true` трактуется как ГРАНИЦА старта операции (begin),
 * `running=false` — как терминал (end). Промежуточные обновления текста прогресса
 * должны идти через {@link updateConfigurationOperationStatus}, а НЕ сюда, иначе
 * счётчик активных операций растёт на каждом прогресс-сообщении и статус-бар
 * перестаёт скрываться (регресс M9). Тесты используют только begin/end.
 */
export function setConfigurationOperationStatus(title: string, message: string, running: boolean): void {
  if (running) {
    beginConfigurationOperationStatus(title, message);
  } else {
    endConfigurationOperationStatus(title, message);
  }
}

/** Начало операции: инкремент счётчика активных операций + спиннер-текст. */
export function beginConfigurationOperationStatus(title: string, message: string): void {
  ensureConfigurationStatusItem();
  cancelConfigurationHideTimer();
  activeOperationCount++;
  showSpinnerStatus(title, message);
}

/** Обновление текста прогресса без изменения счётчика активных операций. */
export function updateConfigurationOperationStatus(title: string, message: string): void {
  ensureConfigurationStatusItem();
  cancelConfigurationHideTimer();
  showSpinnerStatus(title, message);
}

/**
 * Терминал операции: декремент счётчика; при достижении нуля — таймер скрытия.
 * Если `title`/`message` заданы — показывает финальный check-текст; без них
 * оставляет уже отображённый текст (используется финализирующим
 * `clearConfigurationProgress`, где сообщение уже выставлено предыдущим шагом).
 */
export function endConfigurationOperationStatus(title?: string, message?: string): void {
  ensureConfigurationStatusItem();
  cancelConfigurationHideTimer();
  activeOperationCount = Math.max(0, activeOperationCount - 1);

  if (statusBarItem && title !== undefined && message !== undefined) {
    const text = `${title}: ${message}`;
    statusBarItem.text = `$(check) ${trimStatusMessage(text)}`;
    statusBarItem.tooltip = text;
    statusBarItem.show();
  }

  // Скрываем статус только когда завершилась последняя активная операция —
  // завершение одной из параллельных операций не должно гасить статус остальных.
  if (activeOperationCount === 0) {
    clearStatusTimer = setTimeout(() => {
      statusBarItem?.hide();
      clearStatusTimer = undefined;
    }, 5_000);
  }
}

function ensureConfigurationStatusItem(): void {
  if (!statusBarItem) {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.name = '1С: операция с конфигурацией';
  }
}

function cancelConfigurationHideTimer(): void {
  if (clearStatusTimer) {
    clearTimeout(clearStatusTimer);
    clearStatusTimer = undefined;
  }
}

function showSpinnerStatus(title: string, message: string): void {
  const text = `${title}: ${message}`;
  if (statusBarItem) {
    statusBarItem.text = `$(sync~spin) ${trimStatusMessage(text)}`;
    statusBarItem.tooltip = text;
    statusBarItem.show();
  }
}

function syncDirectorySnapshot(sourceDir: string, targetDir: string): void {
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Временный каталог выгрузки не найден: ${sourceDir}`);
  }

  if (replaceDirectorySnapshot(sourceDir, targetDir)) {
    return;
  }

  fs.mkdirSync(targetDir, { recursive: true });
  deleteMissingEntries(sourceDir, targetDir);
  copyAllEntries(sourceDir, targetDir);
}

function replaceDirectorySnapshot(sourceDir: string, targetDir: string): boolean {
  const targetParent = path.dirname(targetDir);
  fs.mkdirSync(targetParent, { recursive: true });

  const backupDir = path.join(
    targetParent,
    `.${path.basename(targetDir)}.v8vscedit-backup-${String(process.pid)}-${String(Date.now())}`
  );
  let targetMoved = false;

  try {
    if (fs.existsSync(targetDir)) {
      fs.renameSync(targetDir, backupDir);
      targetMoved = true;
    }

    fs.renameSync(sourceDir, targetDir);
    if (targetMoved) {
      removeDirectoryInBackground(backupDir);
    }
    return true;
  } catch (error) {
    if (targetMoved && !fs.existsSync(targetDir) && fs.existsSync(backupDir)) {
      try {
        fs.renameSync(backupDir, targetDir);
      } catch {
        // если откат не удался — это редкий случай Windows-блокировок,
        // оставим резервную копию и пробросим исходную ошибку
      }
    }

    if (isRenameFallbackError(error)) {
      return false;
    }

    throw error;
  }
}

function removeDirectoryInBackground(directoryPath: string): void {
  fs.rm(directoryPath, { recursive: true, force: true }, () => undefined);
}

function isRenameFallbackError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }
  // EXDEV — rename между томами; EPERM/EACCES/EBUSY — типичная ошибка Windows,
  // когда внутри каталога удерживается дескриптор (file watcher, антивирус).
  const code = (error as { code?: unknown }).code;
  return code === 'EXDEV' || code === 'EPERM' || code === 'EACCES' || code === 'EBUSY';
}

function collectSnapshotProjectFiles(sourceDir: string, targetDir: string): string[] {
  const result = new Set<string>();
  collectSourceProjectFiles(sourceDir, targetDir, result);
  collectDeletedProjectFiles(sourceDir, targetDir, result);
  return [...result];
}

function collectSourceProjectFiles(sourceDir: string, targetDir: string, result: Set<string>): void {
  if (!fs.existsSync(sourceDir)) {
    return;
  }

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      collectSourceProjectFiles(sourcePath, targetPath, result);
      continue;
    }

    addSuppressedProjectFile(targetPath, result);
  }
}

function collectDeletedProjectFiles(sourceDir: string, targetDir: string, result: Set<string>): void {
  if (!fs.existsSync(targetDir)) {
    return;
  }

  for (const entry of fs.readdirSync(targetDir, { withFileTypes: true })) {
    const targetPath = path.join(targetDir, entry.name);
    const sourcePath = path.join(sourceDir, entry.name);
    if (!fs.existsSync(sourcePath)) {
      collectExistingFilePaths(targetPath, result);
      continue;
    }

    if (entry.isDirectory()) {
      collectDeletedProjectFiles(sourcePath, targetPath, result);
    }
  }
}

function collectExistingFilePaths(filePath: string, result: Set<string>): void {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const stat = fs.statSync(filePath);
  if (!stat.isDirectory()) {
    addSuppressedProjectFile(filePath, result);
    return;
  }

  for (const entry of fs.readdirSync(filePath, { withFileTypes: true })) {
    collectExistingFilePaths(path.join(filePath, entry.name), result);
  }
}

function addSuppressedProjectFile(filePath: string, result: Set<string>): void {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  if (
    normalized.endsWith('.xml') ||
    normalized.endsWith('.bsl') ||
    normalized.endsWith('/ext/template.txt') ||
    normalized.endsWith('/ext/template.bin') ||
    /\/ext\/template\/.+\.html$/.test(normalized)
  ) {
    result.add(filePath);
  }
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

async function resolveConnectionFromSettings(settingsPath: string): Promise<ConnectionParams> {
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
  connection.password = await resolveConnectionPassword(asString(defaults['--db-pwd']) ?? '');
  connection.v8Path = resolveV8PathFromSettings(defaults);
  return connection;
}

/**
 * Резолвит пароль подключения: приоритет — `ProjectSecretStorage`, fallback —
 * legacy-значение из env.json (для конфигураций, ещё не пересохранённых новым
 * `ProjectEnvironmentService.save`). Без внедрённого хранилища деградирует до
 * legacy-значения, не роняя запуск.
 */
async function resolveConnectionPassword(legacyEnvJsonPassword: string): Promise<string> {
  if (!injectedProjectSecretStorage) {
    return legacyEnvJsonPassword;
  }
  return resolveDbPassword(injectedProjectSecretStorage, legacyEnvJsonPassword);
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

function nonEmptyString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (trimmed) {
    return trimmed;
  }
  return undefined;
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
    return `команда завершилась с кодом ${String(exitCode)}`;
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

  return meaningfulLines.at(-1) ?? lines.at(-1) ?? `команда завершилась с кодом ${String(exitCode)}`;
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
  if (new RegExp(`\\(code:\\s*${String(exitCode)}\\)`, 'i').test(normalized)) {
    return true;
  }
  return /^(\[INFO\]|\[WARN\]|Getting |Git changes detected|Hash changes detected|Files for loading|Executing |Created output directory:|Выгрузка исходников|Загрузка исходников|Применение изменений)$/i.test(normalized);
}

async function refreshConfigurationHashCache(
  target: 'cf' | 'cfe',
  extensionName: string,
  configRoot: string,
  workspaceFolder: vscode.WorkspaceFolder,
  outputChannel: vscode.OutputChannel,
  onProgressMessage?: (message: string) => void
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
      onProgressMessage,
    },
    workspaceFolder,
    outputChannel
  );
  if (!refreshed) {
    outputChannel.appendLine(`[refresh-hash-cache] Не удалось обновить кэш после импорта: ${name}.`);
  }
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function getAgentStatusMessage(message: string): string | undefined {
  const text = trimStatusMessage(message);
  if (isRawAgentCommandMessage(text)) {
    return undefined;
  }
  return text;
}

function isRawAgentCommandMessage(message: string): boolean {
  const normalized = message.replace(/\s+/g, ' ').trim().toLowerCase();
  return /^(common|config|options|infobase-tools)\s+/.test(normalized) ||
    /^выполнено:\s*(common|config|options|infobase-tools)\s+/.test(normalized) ||
    /^the operation is completed:\s*(common|config|options|infobase-tools)\s+/.test(normalized);
}
