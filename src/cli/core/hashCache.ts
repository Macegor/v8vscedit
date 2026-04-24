import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface HashCacheSnapshot {
  schemaVersion: 1;
  scopeKey: string;
  generatedAt: string;
  files: Record<string, string>;
}

export interface HashDiffResult {
  added: string[];
  modified: string[];
  deleted: string[];
}

const HASH_CACHE_DIR = path.join('.v8vscedit', 'cache');
const SUPPORTED_FILE_RE = /\.(xml|bsl)$/i;
const CACHE_SCHEMA_VERSION = 1;

/**
 * Формирует ключ области кэша для основной конфигурации или расширения.
 */
export function buildScopeKey(target: 'cf' | 'cfe', configDir: string, extensionName = ''): string {
  const normalizedConfigDir = path.resolve(configDir).replace(/\\/g, '/').toLowerCase();
  if (target === 'cf') {
    return `cf::${normalizedConfigDir}`;
  }
  return `cfe::${extensionName}::${normalizedConfigDir}`;
}

/**
 * Загружает кэш хешей области; если кэша нет, возвращает пустой снапшот.
 */
export function loadHashCache(projectRoot: string, scopeKey: string): HashCacheSnapshot {
  const filePath = getCacheFilePath(projectRoot, scopeKey);
  if (!fs.existsSync(filePath)) {
    return { schemaVersion: CACHE_SCHEMA_VERSION, scopeKey, generatedAt: '', files: {} };
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<HashCacheSnapshot>;
    if (parsed.schemaVersion !== CACHE_SCHEMA_VERSION || parsed.scopeKey !== scopeKey || !parsed.files) {
      return { schemaVersion: CACHE_SCHEMA_VERSION, scopeKey, generatedAt: '', files: {} };
    }
    return {
      schemaVersion: CACHE_SCHEMA_VERSION,
      scopeKey,
      generatedAt: typeof parsed.generatedAt === 'string' ? parsed.generatedAt : '',
      files: parsed.files,
    };
  } catch {
    return { schemaVersion: CACHE_SCHEMA_VERSION, scopeKey, generatedAt: '', files: {} };
  }
}

/**
 * Полностью пересобирает снапшот по релевантным XML/BSL файлам.
 */
export function buildHashSnapshot(scopeKey: string, configDir: string): HashCacheSnapshot {
  const files: Record<string, string> = {};
  for (const fullPath of walkFiles(configDir)) {
    const relativePath = path.relative(configDir, fullPath).replace(/\\/g, '/');
    if (!isSupportedConfigFile(relativePath)) {
      continue;
    }
    files[relativePath] = computeFileHash(fullPath);
  }
  return {
    schemaVersion: CACHE_SCHEMA_VERSION,
    scopeKey,
    generatedAt: new Date().toISOString(),
    files,
  };
}

/**
 * Сохраняет снапшот на диск в служебный каталог проекта.
 */
export function saveHashCache(projectRoot: string, snapshot: HashCacheSnapshot): void {
  const filePath = getCacheFilePath(projectRoot, snapshot.scopeKey);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), 'utf-8');
}

/**
 * Сравнивает снапшоты и возвращает набор добавленных/изменённых/удалённых файлов.
 */
export function diffHashSnapshots(previous: HashCacheSnapshot, current: HashCacheSnapshot): HashDiffResult {
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];

  for (const [file, hash] of Object.entries(current.files)) {
    const prevHash = previous.files[file];
    if (!prevHash) {
      added.push(file);
      continue;
    }
    if (prevHash !== hash) {
      modified.push(file);
    }
  }

  for (const file of Object.keys(previous.files)) {
    if (!current.files[file]) {
      deleted.push(file);
    }
  }

  return {
    added: sortUnique(added),
    modified: sortUnique(modified),
    deleted: sortUnique(deleted),
  };
}

/**
 * Применяет частичные изменения к кэшу после успешного частичного импорта.
 */
export function patchHashSnapshot(
  previous: HashCacheSnapshot,
  changedHashes: Record<string, string>,
  deletedFiles: string[]
): HashCacheSnapshot {
  const mergedFiles: Record<string, string> = { ...previous.files };
  for (const [file, hash] of Object.entries(changedHashes)) {
    mergedFiles[file] = hash;
  }
  for (const file of deletedFiles) {
    delete mergedFiles[file];
  }
  return {
    schemaVersion: CACHE_SCHEMA_VERSION,
    scopeKey: previous.scopeKey,
    generatedAt: new Date().toISOString(),
    files: mergedFiles,
  };
}

export function collectCurrentHashes(configDir: string, relativePaths: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const relativePath of relativePaths) {
    const fullPath = path.join(configDir, relativePath);
    if (!fs.existsSync(fullPath)) {
      continue;
    }
    result[relativePath] = computeFileHash(fullPath);
  }
  return result;
}

export function isSupportedConfigFile(relativePath: string): boolean {
  if (!SUPPORTED_FILE_RE.test(relativePath)) {
    return false;
  }
  return relativePath.replace(/\\/g, '/') !== 'ConfigDumpInfo.xml';
}

function getCacheFilePath(projectRoot: string, scopeKey: string): string {
  const hash = crypto.createHash('sha1').update(scopeKey).digest('hex');
  return path.join(projectRoot, HASH_CACHE_DIR, `${hash}.json`);
}

function computeFileHash(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha1').update(content).digest('hex');
}

function walkFiles(rootDir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(rootDir)) {
    return out;
  }
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(fullPath));
      continue;
    }
    out.push(fullPath);
  }
  return out;
}

function sortUnique(items: string[]): string[] {
  return Array.from(new Set(items)).sort((a, b) => a.localeCompare(b));
}
