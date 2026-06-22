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
const TEMPLATE_CONTENT_RE = /\/Ext\/(?:Template\.(?:txt|bin)|Template\/[^/]+\.html)$/i;
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
 * Полностью пересобирает снапшот по релевантным файлам выгрузки.
 */
export function buildHashSnapshot(scopeKey: string, configDir: string): HashCacheSnapshot {
  const files: Record<string, string> = {};
  walkSupportedFiles(configDir, (fullPath, relativePath) => {
    files[relativePath] = computeFileHash(fullPath);
  });
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
  // Пишем во временный файл рядом и атомарно подменяем целевой через rename,
  // чтобы прерывание записи не оставило битый JSON в кэше.
  const tempPath = `${filePath}.${String(process.pid)}.${String(Date.now())}.tmp`;
  try {
    fs.writeFileSync(tempPath, JSON.stringify(snapshot), 'utf-8');
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    fs.rmSync(tempPath, { force: true });
    throw error;
  }
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
  const deleted = new Set(deletedFiles);
  const files = Object.fromEntries(
    Object.entries(mergedFiles).filter(([file]) => !deleted.has(file))
  );
  return {
    schemaVersion: CACHE_SCHEMA_VERSION,
    scopeKey: previous.scopeKey,
    generatedAt: new Date().toISOString(),
    files,
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
  const normalized = relativePath.replace(/\\/g, '/');
  if (normalized === 'ConfigDumpInfo.xml') {
    return false;
  }

  return SUPPORTED_FILE_RE.test(normalized) || isTemplateContentConfigFile(normalized);
}

export function isTemplateContentConfigFile(relativePath: string): boolean {
  return TEMPLATE_CONTENT_RE.test(relativePath.replace(/\\/g, '/'));
}

function getCacheFilePath(projectRoot: string, scopeKey: string): string {
  const hash = crypto.createHash('sha1').update(scopeKey).digest('hex');
  return path.join(projectRoot, HASH_CACHE_DIR, `${hash}.json`);
}

function computeFileHash(filePath: string): string {
  const content = fs.readFileSync(filePath);
  const oneShotHash = Reflect.get(crypto, 'hash');
  if (typeof oneShotHash === 'function') {
    return oneShotHash('sha1', content, 'hex');
  }
  return crypto.createHash('sha1').update(content).digest('hex');
}

function walkSupportedFiles(
  rootDir: string,
  visitor: (fullPath: string, relativePath: string) => void
): void {
  if (!fs.existsSync(rootDir)) {
    return;
  }

  const pending = [rootDir];
  while (pending.length > 0) {
    const currentDir = pending.pop();
    if (!currentDir) {
      continue;
    }

    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        pending.push(fullPath);
        continue;
      }

      const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, '/');
      if (isSupportedConfigFile(relativePath)) {
        visitor(fullPath, relativePath);
      }
    }
  }
}

function sortUnique(items: string[]): string[] {
  return Array.from(new Set(items)).sort((a, b) => a.localeCompare(b));
}
