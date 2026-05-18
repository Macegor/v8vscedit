import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { MetadataNode } from '../../tree/TreeNode';
import type { AgentMessage } from '../../../domain/agent';
import {
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
  normalizeInfoBasePath,
  resolveV8PathHintFromVersion,
} from '../../../infra/process';

type NodeArg = MetadataNode | { xmlPath?: string; nodeKind?: string; label?: string };

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

interface CachedAgentService {
  readonly service: AgentOperationService;
  readonly sessions: DesignerAgentSessionManager;
  readonly process?: DesignerAgentProcess;
}

export interface InteractiveDesignerAgentService {
  readonly service: AgentOperationService;
  readonly forceDisconnect: boolean;
}

const agentServices = new Map<string, CachedAgentService>();

let statusBarItem: vscode.StatusBarItem | undefined;
let clearStatusTimer: NodeJS.Timeout | undefined;

export function getCachedAgentOperationService(workspaceFolder: vscode.WorkspaceFolder): AgentOperationService | undefined {
  const workspaceRoot = workspaceFolder.uri.fsPath;
  const key = path.resolve(workspaceRoot).toLowerCase();
  return agentServices.get(key)?.service;
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
    const settingsPath = resolveSettingsPath(workspaceRoot, workspaceRoot);
    const connection = resolveConnectionFromSettings(settingsPath);
    const agentSettings = readAgentCommandSettings(connection);
    const portOpened = await waitForTcpPort({
      host: agentSettings.host,
      port: agentSettings.port,
      timeoutMs: 500,
    });
    if (!portOpened) {
      return undefined;
    }

    outputChannel.appendLine(
      `[agent] Найден запущенный агент конфигуратора: ${agentSettings.host}:${String(agentSettings.port)}.`
    );
    const serviceEntry = createAgentOperationServiceEntry(workspaceRoot, agentSettings);
    const key = path.resolve(workspaceRoot).toLowerCase();
    agentServices.set(key, serviceEntry);
    return { service: serviceEntry.service, forceDisconnect: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    outputChannel.appendLine(`[agent][warn] Не удалось проверить запущенный агент конфигуратора: ${message}`);
    return undefined;
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
  setOperationStatus(options.progressTitle, options.progressStartMessage, true);
  options.hooks?.onProgressMessage?.(options.progressStartMessage);
  options.onProgressMessage?.(options.progressStartMessage);

  try {
    const service = await getAgentOperationService(options.workspaceFolder, options.rootPath, options.outputChannel);
    const importHooks = isImportHooks(options.hooks) ? options.hooks : undefined;
    await operation(service, {
      onMessage: (message) => {
        const statusMessage = trimStatusMessage(message);
        options.outputChannel.appendLine(`[agent] ${message}`);
        setOperationStatus(options.progressTitle, statusMessage, true);
        options.hooks?.onProgressMessage?.(statusMessage);
        options.onProgressMessage?.(statusMessage);
      },
      onProjectFilesWillChange: importHooks
        ? (filePaths) => importHooks.beforeProjectFilesChanged?.(filePaths)
        : undefined,
      onQuestion: showAgentQuestion,
    });

    setOperationStatus(options.progressTitle, 'завершено', false);
    options.outputChannel.appendLine(`[agent] Завершено: ${options.progressTitle}`);
    if (options.showSuccessMessage !== false) {
      void vscode.window.showInformationMessage(options.successMessage);
    }
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    options.outputChannel.appendLine(`[agent][error] ${message}`);
    setOperationStatus(options.progressTitle, 'ошибка', false);
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

async function getAgentOperationService(
  workspaceFolder: vscode.WorkspaceFolder,
  rootPath: string,
  outputChannel: vscode.OutputChannel
): Promise<AgentOperationService> {
  const workspaceRoot = workspaceFolder.uri.fsPath;
  const key = path.resolve(workspaceRoot).toLowerCase();
  const cached = agentServices.get(key);
  if (cached) {
    return cached.service;
  }

  const settingsPath = resolveSettingsPath(workspaceRoot, rootPath);
  const connection = resolveConnectionFromSettings(settingsPath);
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
        outputChannel.appendLine(`[agent][process] Конфигуратор в режиме агента завершился: код=${String(code ?? '-')}, сигнал=${String(signal ?? '-')}`);
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

  const serviceEntry = createAgentOperationServiceEntry(workspaceRoot, agentSettings, agentProcess);
  agentServices.set(key, serviceEntry);
  return serviceEntry.service;
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
    privateKeyPath: agentSettings.privateKeyPath || undefined,
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
    host: config.get<string>('host', 'localhost').trim() || 'localhost',
    listenAddress: config.get<string>('listenAddress', '127.0.0.1').trim() || '127.0.0.1',
    port: config.get<number>('port', 1543),
    user: configuredUser || connection.userName || 'admin',
    password: connection.password ?? '',
    privateKeyPath: config.get<string>('privateKeyPath', '').trim(),
    visible: config.get<boolean>('visible', false),
    autoStart: config.get<boolean>('autoStart', true),
    agentModeArgs: splitAgentModeArgs(rawModeArgs),
    progressInterval: config.get<number>('progressInterval', 0.5),
    startupTimeoutMs: config.get<number>('startupTimeoutMs', 15000),
  };
}

function splitAgentModeArgs(rawValue: string): string[] {
  return rawValue
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
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
