import * as fs from 'fs';
import * as path from 'path';
import type { ConfigEntry } from '../../domain/Configuration';

/**
 * Запись реестра совпадает с {@link ConfigEntry} домена; алиас оставлен,
 * чтобы исторический код, импортирующий `FoundConfig`, продолжал работать.
 */
export type FoundConfig = ConfigEntry;

export type { ConfigEntry } from '../../domain/Configuration';

/**
 * Поиск штатных каталогов с `Configuration.xml`.
 *
 * Отличает расширение (cfe) от основной конфигурации (cf) по наличию тега
 * `ConfigurationExtensionPurpose` — читаются только первые 8 КБ файла, тег
 * всегда расположен в начале блока `Properties`.
 */
export class ConfigLocator {
  /**
   * Ищет конфигурации только в штатной структуре проекта:
   * `src/cf/Configuration.xml` и прямые подкаталоги `src/cfe`.
   * Произвольный рекурсивный обход `src/**` здесь намеренно запрещён,
   * иначе служебные копии и вложенные выгрузки снова появляются дублями.
   */
  find(rootDir: string): FoundConfig[] {
    const results: FoundConfig[] = [];
    const srcDir = path.join(rootDir, 'src');
    if (!isDirectory(srcDir)) {
      return results;
    }

    this.addIfConfigurationRoot(path.join(srcDir, 'cf'), results);
    this.scanDirectCfeChildren(path.join(srcDir, 'cfe'), results);
    return results;
  }

  private scanDirectCfeChildren(cfeDir: string, results: FoundConfig[]): void {
    if (!isDirectory(cfeDir)) {
      return;
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(cfeDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || isIgnoredDirectoryName(entry.name)) {
        continue;
      }
      this.addIfConfigurationRoot(path.join(cfeDir, entry.name), results);
    }
  }

  private addIfConfigurationRoot(dir: string, results: FoundConfig[]): void {
    const configXmlPath = path.join(dir, 'Configuration.xml');
    if (!isFile(configXmlPath)) {
      return;
    }
    results.push({
      rootPath: dir,
      kind: this.detectKind(configXmlPath),
    });
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

function isDirectory(directoryPath: string): boolean {
  try {
    return fs.statSync(directoryPath).isDirectory();
  } catch {
    return false;
  }
}

function isFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isIgnoredDirectoryName(name: string): boolean {
  return name.startsWith('.') || name === 'node_modules' || name === 'dist' || name === 'out';
}

/**
 * Функция-фасад над {@link ConfigLocator} — совместимый API для потребителей,
 * которые исторически вызывали `findConfigurations(root)`.
 */
export function findConfigurations(rootDir: string): ConfigEntry[] {
  return new ConfigLocator().find(rootDir);
}
