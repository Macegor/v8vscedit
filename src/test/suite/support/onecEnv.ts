import * as fs from 'fs';
import * as path from 'path';
import { importConfiguration } from '../../../cli/commands/importConfiguration';
import { updateConfiguration } from '../../../cli/commands/updateConfiguration';
import type { CliArgs } from '../../../cli/core/types';
import { normalizeInfoBasePath, resolveV8ExecutablePath } from '../../../infra/process/OnecPlatform';

/**
 * Подключение к базе 1С, снятое из `env.json` конфигурации (формат vanessa-runner).
 * Тесты генератора используют его, чтобы реально прогнать `/LoadConfigFromFiles`
 * + `/UpdateDBCfg` и убедиться, что сгенерированный XML платформа принимает.
 */
export interface OnecEnv {
  readonly projectRoot: string;
  readonly infoBasePath: string;
  readonly userName: string;
  readonly password: string;
  readonly v8Path: string;
}

/** Читает `env.json` (секция `default`) из корня конфигурации. */
export function readOnecEnv(projectRoot: string): OnecEnv | null {
  const envPath = path.join(projectRoot, 'env.json');
  if (!fs.existsSync(envPath)) {
    return null;
  }
  let parsed: { default?: Record<string, unknown> };
  try {
    parsed = JSON.parse(fs.readFileSync(envPath, 'utf-8')) as { default?: Record<string, unknown> };
  } catch {
    return null;
  }
  const defaults = parsed.default ?? {};
  const asString = (key: string): string => {
    const value = defaults[key];
    return typeof value === 'string' ? value : '';
  };
  return {
    projectRoot,
    infoBasePath: fileBasePathFromConnection(asString('--ibconnection')),
    userName: asString('--db-user'),
    password: asString('--db-pwd'),
    v8Path: asString('--path'),
  };
}

/**
 * Извлекает путь файловой базы из значения `--ibconnection` (формат
 * vanessa-runner / 1С). Для файловой базы это designer-флаг `/F` + путь
 * (`/F/Users/.../D2.20`); сам флаг `/F` при запуске добавляет CLI
 * (`appendConnectionArgs`), поэтому здесь префикс снимаем. Серверные базы
 * (`/S server/ref`) интеграцией не поддерживаются — возвращаем пустую строку,
 * и `isOnecAvailable` вернёт false (тест пропустится).
 */
function fileBasePathFromConnection(connection: string): string {
  const value = connection.trim();
  if (value.startsWith('/F')) {
    return value.slice(2).trim();
  }
  if (value.startsWith('/S')) {
    return '';
  }
  return value;
}

/**
 * Доступна ли платформа 1С и файловая база из env.json. Если нет (CI, sandbox
 * без установленной 1С) — интеграционные тесты пропускаются, а не падают.
 */
export function isOnecAvailable(env: OnecEnv | null): boolean {
  if (!env) {
    return false;
  }
  if (!env.infoBasePath || !env.v8Path) {
    return false;
  }
  try {
    resolveV8ExecutablePath(env.v8Path);
  } catch {
    return false;
  }
  const basePath = normalizeInfoBasePath(env.infoBasePath);
  return fs.existsSync(basePath);
}

function connectionArgs(env: OnecEnv): CliArgs {
  return {
    ProjectRoot: env.projectRoot,
    InfoBasePath: env.infoBasePath,
    UserName: env.userName,
    Password: env.password,
    V8Path: env.v8Path,
  };
}

export interface ImportUpdateResult {
  readonly importExit: number;
  readonly updateExit: number;
}

/**
 * Загружает исходники в базу (`/LoadConfigFromFiles`) и применяет к БД
 * (`/UpdateDBCfg`) через существующие CLI-команды расширения. Возвращает коды
 * возврата обоих шагов; 0/0 = платформа приняла сгенерированный XML.
 */
export async function importAndUpdate(env: OnecEnv, target: 'cf' | 'cfe' = 'cf', extension = ''): Promise<ImportUpdateResult> {
  const base = connectionArgs(env);
  const targeted: CliArgs = { ...base, Target: target, Mode: 'Full', Format: 'Hierarchical' };
  if (extension) {
    targeted.Extension = extension;
  }
  const importExit = await importConfiguration(targeted);
  if (importExit !== 0) {
    return { importExit, updateExit: -1 };
  }
  const updateExit = await updateConfiguration({ ...base, ...(extension ? { Extension: extension } : {}) });
  return { importExit, updateExit };
}
