import * as fs from 'fs';
import * as path from 'path';
import { ConfigEntry } from '../../domain/Configuration';

/**
 * Запись реестра совпадает с {@link ConfigEntry} домена; алиас оставлен,
 * чтобы исторический код, импортирующий `FoundConfig`, продолжал работать.
 */
export type FoundConfig = ConfigEntry;

export type { ConfigEntry } from '../../domain/Configuration';

/**
 * Рекурсивный поиск каталогов с `Configuration.xml`.
 *
 * Отличает расширение (cfe) от основной конфигурации (cf) по наличию тега
 * `ConfigurationExtensionPurpose` — читаются только первые 8 КБ файла, тег
 * всегда расположен в начале блока `Properties`.
 */
export class ConfigLocator {
  private static readonly MAX_DEPTH = 10;
  private static readonly SKIP_DIRS = new Set(['node_modules', '.git', '.cursor', 'dist', 'out']);

  async find(rootDir: string): Promise<FoundConfig[]> {
    const results: FoundConfig[] = [];
    await this.scanDir(rootDir, 0, results);
    return results;
  }

  private async scanDir(dir: string, depth: number, results: FoundConfig[]): Promise<void> {
    if (depth > ConfigLocator.MAX_DEPTH) {
      return;
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    const hasConfig = entries.some((e) => e.isFile() && e.name === 'Configuration.xml');
    if (hasConfig) {
      results.push({
        rootPath: dir,
        kind: this.detectKind(path.join(dir, 'Configuration.xml')),
      });
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || ConfigLocator.SKIP_DIRS.has(entry.name)) {
        continue;
      }
      await this.scanDir(path.join(dir, entry.name), depth + 1, results);
    }
  }

  private detectKind(configXmlPath: string): 'cf' | 'cfe' {
    try {
      const fd = fs.openSync(configXmlPath, 'r');
      const buf = Buffer.alloc(8192);
      const bytesRead = fs.readSync(fd, buf, 0, 8192, 0);
      fs.closeSync(fd);
      const chunk = buf.toString('utf-8', 0, bytesRead);
      if (chunk.includes('<ConfigurationExtensionPurpose>')) {
        return 'cfe';
      }
    } catch {
      // На ошибках чтения считаем обычной конфигурацией
    }
    return 'cf';
  }
}

/**
 * Функция-фасад над {@link ConfigLocator} — совместимый API для потребителей,
 * которые исторически вызывали `findConfigurations(root)`.
 */
export async function findConfigurations(rootDir: string): Promise<ConfigEntry[]> {
  return new ConfigLocator().find(rootDir);
}
