import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import {
  findExecutableInPath,
  type InstalledOnecPlatform,
  normalizeInfoBasePath,
  resolveV8ExecutablePath,
  resolveV8PathHintFromVersion,
  scanInstalledOnecPlatforms,
} from '../process';
import type { Logger } from '../support/Logger';

export type StandaloneServerState = 'unconfigured' | 'running' | 'unresponsive' | 'stopped' | 'stale' | 'busy';

export interface StandaloneServerSettings {
  readonly ibsrvPath: string;
  readonly platformPath: string;
  readonly dataPath: string;
  readonly databasePath: string;
  readonly httpAddress: string;
  readonly httpPort: number;
  readonly httpBase: string;
  readonly name: string;
  readonly distributeLicenses: 'allow' | 'deny';
  readonly scheduleJobs: 'allow' | 'deny';
}

export interface StandaloneServerStatus {
  readonly configured: boolean;
  readonly state: StandaloneServerState;
  readonly message: string;
  readonly pid: number | null;
  readonly url: string | null;
  readonly settings: StandaloneServerSettings;
  readonly logPath: string;
}

export interface StandaloneServerSettingsSnapshot {
  readonly configured: boolean;
  readonly settings: StandaloneServerSettings;
  readonly platforms: InstalledOnecPlatform[];
  readonly configPath: string;
  readonly logPath: string;
  readonly warnings: string[];
}

export interface SaveStandaloneServerSettingsInput {
  readonly ibsrvPath: string;
  readonly platformPath: string;
  readonly databasePath: string;
  readonly httpAddress: string;
  readonly httpPort: number;
  readonly httpBase: string;
  readonly name: string;
  readonly distributeLicenses: 'allow' | 'deny';
  readonly scheduleJobs: 'allow' | 'deny';
}

interface StoredStandaloneServerSettings extends SaveStandaloneServerSettingsInput {
  readonly dataPath?: string;
}

const SETTINGS_FILE = 'settings.json';
const PID_FILE = 'server.pid';
const LOG_FILE = 'server.log';
const LOCK_FILE = 'lock.pid';
const LAST_EXIT_FILE = 'last-exit.json';

interface StandaloneServerHealth {
  readonly pid: number;
  readonly httpReady: boolean;
  readonly checkedAt: number;
}

interface LastExitInfo {
  readonly at: string;
  readonly pid: number;
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

/**
 * Управляет автономным сервером 1С для файловой базы проекта.
 *
 * Сервис хранит конфигурацию и данные сервера внутри `.v8vscedit/standalone-server`,
 * чтобы запуск был воспроизводимым и не зависел от пользовательского каталога 1С.
 */
export class StandaloneServerService {
  private busy = false;
  private health: StandaloneServerHealth | undefined;

  constructor(
    private readonly workspaceRoot: string,
    private readonly logger: Logger
  ) {}

  getStatus(): StandaloneServerStatus {
    const configured = this.isConfigured();
    const settings = this.readSettings();
    const pid = this.readPid();
    const alive = pid !== null && isProcessAlive(pid);

    if (!configured) {
      return {
        configured,
        state: 'unconfigured',
        message: 'Автономный сервер не настроен.',
        pid: null,
        url: null,
        settings,
        logPath: this.getLogPath(),
      };
    }

    if (this.busy) {
      return {
        configured,
        state: 'busy',
        message: 'Выполняется операция с автономным сервером.',
        pid: alive ? pid : null,
        url: alive ? buildServerUrl(settings) : null,
        settings,
        logPath: this.getLogPath(),
      };
    }

    if (alive && this.health?.pid === pid && !this.health.httpReady) {
      return {
        configured,
        state: 'unresponsive',
        message: `Процесс есть, но HTTP не отвечает: ${buildServerUrl(settings)}`,
        pid,
        url: buildServerUrl(settings),
        settings,
        logPath: this.getLogPath(),
      };
    }

    if (alive) {
      return {
        configured,
        state: 'running',
        message: `Запущен: ${buildServerUrl(settings)}`,
        pid,
        url: buildServerUrl(settings),
        settings,
        logPath: this.getLogPath(),
      };
    }

    if (pid !== null) {
      const lastExit = this.readLastExitInfo(pid);
      return {
        configured,
        state: 'stale',
        message: lastExit
          ? `Сервер завершился: код ${String(lastExit.code ?? '-')}, сигнал ${lastExit.signal ?? '-'}`
          : 'Сервер остановлен, сохранённый pid устарел.',
        pid,
        url: null,
        settings,
        logPath: this.getLogPath(),
      };
    }

    const lastExit = this.readLastExitInfo();
    return {
      configured,
      state: 'stopped',
      message: lastExit
        ? `Сервер остановлен. Последнее завершение: код ${String(lastExit.code ?? '-')}, сигнал ${lastExit.signal ?? '-'}`
        : 'Сервер остановлен.',
      pid: null,
      url: null,
      settings,
      logPath: this.getLogPath(),
    };
  }

  getSettingsSnapshot(forceRefresh = false): StandaloneServerSettingsSnapshot {
    const platforms = forceRefresh ? scanInstalledOnecPlatforms() : scanInstalledOnecPlatforms();
    const settings = this.readSettings();
    const warnings: string[] = [];

    if (!settings.platformPath && !settings.ibsrvPath) {
      warnings.push('Путь к платформе будет взят из env.json или найден автоматически.');
    }
    if (!fs.existsSync(settings.databasePath)) {
      warnings.push('Каталог файловой базы будет создан при первом запуске.');
    } else if (!fs.existsSync(path.join(settings.databasePath, '1Cv8.1CD'))) {
      warnings.push('Каталог файловой базы не содержит 1Cv8.1CD. Проверьте, что выбран путь к существующей файловой базе.');
    }

    return {
      configured: this.isConfigured(),
      settings,
      platforms: ensureCurrentPlatformInList(platforms, settings.platformPath),
      configPath: this.getSettingsPath(),
      logPath: this.getLogPath(),
      warnings,
    };
  }

  save(input: SaveStandaloneServerSettingsInput): StandaloneServerSettingsSnapshot {
    const normalized = normalizeSettingsInput(input, this.getServerRoot());
    fs.mkdirSync(this.getServerRoot(), { recursive: true });
    fs.mkdirSync(normalized.dataPath, { recursive: true });
    fs.mkdirSync(normalized.databasePath, { recursive: true });
    fs.writeFileSync(this.getSettingsPath(), `${JSON.stringify(normalized, null, 2)}\n`, 'utf-8');
    this.logger.appendLine(`[standalone] Настройки сохранены: ${this.getSettingsPath()}`);
    return this.getSettingsSnapshot(true);
  }

  async start(): Promise<StandaloneServerStatus> {
    if (!this.isConfigured()) {
      throw new Error('Автономный сервер ещё не настроен.');
    }

    const status = this.getStatus();
    if (status.state === 'running') {
      return status;
    }
    if (status.state === 'unresponsive') {
      await this.stop();
    }

    await this.withBusy(async () => {
      const settings = this.readSettings();
      const ibsrvPath = this.resolveIbsrvPath(settings);
      fs.mkdirSync(settings.dataPath, { recursive: true });
      fs.mkdirSync(settings.databasePath, { recursive: true });
      fs.mkdirSync(path.dirname(this.getLogPath()), { recursive: true });
      this.clearStalePid();

      const args = buildServerArgs(settings, this.getLockPath());
      const logHandle = fs.openSync(this.getLogPath(), 'a');
      try {
        this.logger.appendLine(`[standalone] Запуск: ${ibsrvPath} ${args.join(' ')}`);
        fs.appendFileSync(this.getLogPath(), `\n[${new Date().toISOString()}] ${ibsrvPath} ${args.join(' ')}\n`, 'utf-8');
        const child = spawn(ibsrvPath, args, {
          cwd: settings.dataPath,
          detached: true,
          shell: false,
          stdio: ['ignore', logHandle, logHandle],
        });
        if (typeof child.pid !== 'number') {
          throw new Error('Не удалось получить pid процесса ibsrv.');
        }
        this.watchStartedProcess(child, settings);
        child.unref();
        fs.writeFileSync(this.getPidPath(), `${String(child.pid)}\n`, 'utf-8');
        this.logger.appendLine(`[standalone] Сервер запущен, pid=${String(child.pid)}, url=${buildServerUrl(settings)}`);
      } finally {
        fs.closeSync(logHandle);
      }

      const started = await waitUntilPortAccepts(settings, 5_000);
      this.setHealthFromPid(this.readPid(), started);
      if (!started) {
        this.logger.appendLine(`[standalone] HTTP-порт не ответил после запуска: ${buildServerUrl(settings)}`);
      }
    });

    return this.getStatus();
  }

  async stop(): Promise<StandaloneServerStatus> {
    await this.withBusy(async () => {
      const pid = this.readPid();
      if (pid === null) {
        this.clearStalePid();
        return;
      }

      if (!isProcessAlive(pid)) {
        this.clearStalePid();
        return;
      }

      this.logger.appendLine(`[standalone] Остановка сервера, pid=${String(pid)}`);
      try {
        process.kill(-pid, 'SIGTERM');
      } catch {
        process.kill(pid, 'SIGTERM');
      }

      const stopped = await waitUntilStopped(pid, 5_000);
      if (!stopped) {
        this.logger.appendLine(`[standalone] Сервер не остановился по SIGTERM, отправляю SIGKILL, pid=${String(pid)}`);
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {
          process.kill(pid, 'SIGKILL');
        }
        await waitUntilStopped(pid, 2_000);
      }

      this.clearStalePid();
    });

    return this.getStatus();
  }

  async restart(): Promise<StandaloneServerStatus> {
    await this.stop();
    return this.start();
  }

  async refreshHealth(timeoutMs = 700): Promise<StandaloneServerStatus> {
    const status = this.getStatus();
    if (!status.configured || status.pid === null || status.state === 'stale' || status.state === 'stopped') {
      return status;
    }

    const ready = await waitUntilPortAccepts(status.settings, timeoutMs);
    this.setHealthFromPid(status.pid, ready);
    return this.getStatus();
  }

  async waitForHttpReady(timeoutMs = 15_000): Promise<boolean> {
    const status = this.getStatus();
    if (!status.configured || status.pid === null || status.state === 'stale' || status.state === 'stopped') {
      return false;
    }

    const ready = await waitUntilPortAccepts(status.settings, timeoutMs);
    this.setHealthFromPid(status.pid, ready);
    return ready;
  }

  getLogPath(): string {
    return path.join(this.getServerRoot(), LOG_FILE);
  }

  private async withBusy<T>(action: () => Promise<T>): Promise<T> {
    if (this.busy) {
      throw new Error('Операция с автономным сервером уже выполняется.');
    }

    this.busy = true;
    try {
      return await action();
    } finally {
      this.busy = false;
    }
  }

  private isConfigured(): boolean {
    return fs.existsSync(this.getSettingsPath());
  }

  private readSettings(): StandaloneServerSettings {
    const defaults = this.createDefaultSettings();
    if (!this.isConfigured()) {
      return defaults;
    }

    const raw = fs.readFileSync(this.getSettingsPath(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<StoredStandaloneServerSettings>;
    return normalizeStoredSettings(parsed, defaults);
  }

  private createDefaultSettings(): StandaloneServerSettings {
    const env = this.readEnvDefaults();
    const platformPath = asString(env['--path']);
    const v8Version = asString(env['--v8version']);
    const fileDatabasePath = resolveFileDatabasePathFromEnv(env);
    const dataPath = this.getServerRoot();
    return {
      ibsrvPath: '',
      platformPath: platformPath || resolveV8PathHintFromVersion(v8Version),
      dataPath,
      databasePath: fileDatabasePath ?? path.join(dataPath, 'db-data'),
      httpAddress: 'localhost',
      httpPort: 8314,
      httpBase: '/',
      name: 'v8vscedit',
      distributeLicenses: 'allow',
      scheduleJobs: 'allow',
    };
  }

  private resolveIbsrvPath(settings: StandaloneServerSettings): string {
    const explicitIbsrvPath = settings.ibsrvPath.trim();
    if (explicitIbsrvPath) {
      if (!hasPathSeparator(explicitIbsrvPath)) {
        const commandPath = findExecutableInPath(explicitIbsrvPath);
        if (commandPath) {
          return commandPath;
        }
        throw new Error(`Команда ibsrv не найдена в PATH: ${explicitIbsrvPath}`);
      }
      if (fs.existsSync(explicitIbsrvPath)) {
        return explicitIbsrvPath;
      }
      throw new Error(`Не найден ibsrv: ${explicitIbsrvPath}`);
    }

    const v8Executable = resolveV8ExecutablePath(settings.platformPath);
    const executableName = process.platform === 'win32' ? 'ibsrv.exe' : 'ibsrv';
    const candidates = [
      path.join(path.dirname(v8Executable), executableName),
      path.join(path.dirname(path.dirname(v8Executable)), executableName),
      path.join(path.dirname(v8Executable), 'bin', executableName),
    ];
    const found = candidates.find((candidate) => fs.existsSync(candidate));
    if (found) {
      return found;
    }

    throw new Error(`Не найден ibsrv рядом с платформой: ${v8Executable}`);
  }

  private readEnvDefaults(): Record<string, unknown> {
    const envPath = path.join(this.workspaceRoot, 'env.json');
    if (!fs.existsSync(envPath)) {
      return {};
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(envPath, 'utf-8')) as { default?: unknown };
      return isRecord(parsed.default) ? parsed.default : {};
    } catch {
      return {};
    }
  }

  private clearStalePid(): void {
    for (const filePath of [this.getPidPath(), this.getLockPath()]) {
      if (fs.existsSync(filePath)) {
        fs.rmSync(filePath, { force: true });
      }
    }
    this.health = undefined;
  }

  private readPid(): number | null {
    const candidates = [this.getPidPath(), this.getLockPath()];
    for (const filePath of candidates) {
      if (!fs.existsSync(filePath)) {
        continue;
      }
      const value = Number.parseInt(fs.readFileSync(filePath, 'utf-8').trim(), 10);
      if (Number.isInteger(value) && value > 0) {
        return value;
      }
    }
    return null;
  }

  private getServerRoot(): string {
    return path.join(this.workspaceRoot, '.v8vscedit', 'standalone-server');
  }

  private getSettingsPath(): string {
    return path.join(this.getServerRoot(), SETTINGS_FILE);
  }

  private getPidPath(): string {
    return path.join(this.getServerRoot(), PID_FILE);
  }

  private getLockPath(): string {
    return path.join(this.getServerRoot(), LOCK_FILE);
  }

  private getLastExitPath(): string {
    return path.join(this.getServerRoot(), LAST_EXIT_FILE);
  }

  private setHealthFromPid(pid: number | null, httpReady: boolean): void {
    if (pid === null) {
      this.health = undefined;
      return;
    }

    this.health = {
      pid,
      httpReady,
      checkedAt: Date.now(),
    };
  }

  private watchStartedProcess(
    child: ReturnType<typeof spawn>,
    settings: StandaloneServerSettings
  ): void {
    child.once('error', (error) => {
      const pid = typeof child.pid === 'number' ? child.pid : this.readPid();
      const message = `[standalone] Процесс ibsrv не запущен: ${error.message}`;
      this.logger.appendLine(message);
      appendStandaloneLog(this.getLogPath(), message);
      if (pid !== null) {
        this.writeLastExitInfo({ at: new Date().toISOString(), pid, code: null, signal: null });
      }
      this.clearPidIfCurrent(pid);
    });

    child.once('exit', (code, signal) => {
      const pid = typeof child.pid === 'number' ? child.pid : this.readPid();
      const message = `[standalone] Процесс ibsrv завершён, pid=${String(pid ?? '-')}, code=${String(code ?? '-')}, signal=${signal ?? '-'}`;
      this.logger.appendLine(message);
      appendStandaloneLog(this.getLogPath(), message);
      if (pid !== null) {
        this.writeLastExitInfo({ at: new Date().toISOString(), pid, code, signal });
      }
      this.clearPidIfCurrent(pid);
      this.health = undefined;
      appendStandaloneLog(this.getLogPath(), `[standalone] Последний URL: ${buildServerUrl(settings)}`);
    });
  }

  private clearPidIfCurrent(pid: number | null): void {
    if (pid === null) {
      return;
    }
    const currentPid = this.readPid();
    if (currentPid !== pid) {
      return;
    }

    for (const filePath of [this.getPidPath(), this.getLockPath()]) {
      if (fs.existsSync(filePath)) {
        fs.rmSync(filePath, { force: true });
      }
    }
  }

  private writeLastExitInfo(info: LastExitInfo): void {
    fs.mkdirSync(this.getServerRoot(), { recursive: true });
    fs.writeFileSync(this.getLastExitPath(), `${JSON.stringify(info, null, 2)}\n`, 'utf-8');
  }

  private readLastExitInfo(pid?: number): LastExitInfo | null {
    if (!fs.existsSync(this.getLastExitPath())) {
      return null;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.getLastExitPath(), 'utf-8')) as Partial<LastExitInfo>;
      if ((pid === undefined || parsed.pid === pid) && typeof parsed.pid === 'number' && typeof parsed.at === 'string') {
        return {
          at: parsed.at,
          pid: parsed.pid,
          code: typeof parsed.code === 'number' ? parsed.code : null,
          signal: typeof parsed.signal === 'string' ? parsed.signal : null,
        };
      }
    } catch {
      return null;
    }
    return null;
  }
}

function buildServerArgs(settings: StandaloneServerSettings, lockPath: string): string[] {
  return [
    `--data=${settings.dataPath}`,
    `--lock=${lockPath}`,
    `--database-path=${settings.databasePath}`,
    `--http-address=${settings.httpAddress}`,
    `--http-port=${String(settings.httpPort)}`,
    `--http-base=${settings.httpBase}`,
    `--name=${settings.name}`,
    `--distribute-licenses=${settings.distributeLicenses}`,
    `--schedule-jobs=${settings.scheduleJobs}`,
    '--enable-http-gate',
    '--disable-ssh-gate',
    '--disable-direct-gate',
  ];
}

function normalizeSettingsInput(
  input: SaveStandaloneServerSettingsInput,
  serverRoot: string
): StandaloneServerSettings {
  return {
    ibsrvPath: input.ibsrvPath.trim(),
    platformPath: input.platformPath.trim(),
    dataPath: serverRoot,
    databasePath: normalizeProjectPath(input.databasePath, path.join(serverRoot, 'db-data')),
    httpAddress: input.httpAddress.trim() || 'localhost',
    httpPort: normalizePort(input.httpPort),
    httpBase: normalizeHttpBase(input.httpBase),
    name: input.name.trim() || 'v8vscedit',
    distributeLicenses: input.distributeLicenses,
    scheduleJobs: input.scheduleJobs,
  };
}

function normalizeStoredSettings(
  stored: Partial<StoredStandaloneServerSettings>,
  defaults: StandaloneServerSettings
): StandaloneServerSettings {
  const storedDatabasePath = asString(stored.databasePath);
  const oldGeneratedDatabasePath = path.join(defaults.dataPath, 'db-data');
  const databasePath = storedDatabasePath === oldGeneratedDatabasePath
    && defaults.databasePath !== oldGeneratedDatabasePath
    ? defaults.databasePath
    : storedDatabasePath || defaults.databasePath;

  return {
    ibsrvPath: asString(stored.ibsrvPath) || defaults.ibsrvPath,
    platformPath: asString(stored.platformPath) || defaults.platformPath,
    dataPath: asString(stored.dataPath) || defaults.dataPath,
    databasePath,
    httpAddress: asString(stored.httpAddress) || defaults.httpAddress,
    httpPort: normalizePort(stored.httpPort ?? defaults.httpPort),
    httpBase: normalizeHttpBase(asString(stored.httpBase) || defaults.httpBase),
    name: asString(stored.name) || defaults.name,
    distributeLicenses: stored.distributeLicenses === 'deny' ? 'deny' : 'allow',
    scheduleJobs: stored.scheduleJobs === 'deny' ? 'deny' : 'allow',
  };
}

function resolveFileDatabasePathFromEnv(env: Record<string, unknown>): string | null {
  const ibConnection = asString(env['--ibconnection']).replace(/^"+|"+$/g, '').trim();
  if (!/^\/F/i.test(ibConnection)) {
    return null;
  }

  const rawPath = ibConnection.slice(2).trim();
  if (!rawPath) {
    return null;
  }
  return normalizeInfoBasePath(rawPath);
}

function normalizeProjectPath(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }
  if (trimmed === '~') {
    return os.homedir();
  }
  if (trimmed.startsWith('~/')) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return path.resolve(trimmed);
}

function normalizePort(value: unknown): number {
  const port = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return 8314;
  }
  return port;
}

function normalizeHttpBase(value: string): string {
  const trimmed = value.trim() || '/';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function buildServerUrl(settings: StandaloneServerSettings): string {
  const host = settings.httpAddress === 'any' ? 'localhost' : settings.httpAddress;
  const base = settings.httpBase === '/' ? '/' : settings.httpBase.replace(/\/+$/, '');
  return `http://${host}:${String(settings.httpPort)}${base}`;
}

function appendStandaloneLog(logPath: string, message: string): void {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, `${message}\n`, 'utf-8');
}

async function waitUntilPortAccepts(
  settings: StandaloneServerSettings,
  timeoutMs: number
): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await canConnect(settings)) {
      return true;
    }
    await sleep(300);
  }
  return canConnect(settings);
}

function canConnect(settings: StandaloneServerSettings): Promise<boolean> {
  const host = settings.httpAddress === 'any' ? '127.0.0.1' : settings.httpAddress;
  return new Promise((resolve) => {
    const socket = net.connect({
      host,
      port: settings.httpPort,
      timeout: 800,
    });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function waitUntilStopped(pid: number, timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!isProcessAlive(pid)) {
      return true;
    }
    await sleep(200);
  }
  return !isProcessAlive(pid);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isNodeError(error) && error.code === 'EPERM';
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function ensureCurrentPlatformInList(
  platforms: InstalledOnecPlatform[],
  platformPath: string
): InstalledOnecPlatform[] {
  if (!platformPath || platforms.some((platform) => platform.executablePath === platformPath)) {
    return platforms;
  }

  return [
    {
      executablePath: platformPath,
      version: '',
      label: `Из настроек: ${platformPath}`,
    },
    ...platforms,
  ];
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasPathSeparator(value: string): boolean {
  return value.includes('/') || value.includes('\\');
}

export type { InstalledOnecPlatform };
