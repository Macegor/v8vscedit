import * as path from 'path';
import { ConfigEntry } from '../../domain/Configuration';
import { parseConfigXml } from '../xml';
import {
  buildHashSnapshot,
  diffHashSnapshots,
  loadHashCache,
  saveHashCache,
} from '../../cli/core/hashCache';
import { buildMetadataCacheScopeKey, loadMetadataCache, saveMetadataCacheForEntry } from '../cache/MetadataCache';

export interface ChangedConfiguration {
  kind: 'cf' | 'cfe';
  rootPath: string;
  name: string;
  changedFilesCount: number;
}

/**
 * Определяет, в каких XML-исходниках есть изменения относительно локального хеш-кэша.
 */
export class ConfigurationChangeDetector {
  constructor(private readonly projectRoot: string) {}

  describe(entry: ConfigEntry, changedFilesCount: number): ChangedConfiguration {
    const scope = this.resolveScope(entry);
    return {
      kind: entry.kind,
      rootPath: entry.rootPath,
      name: scope.name,
      changedFilesCount,
    };
  }

  /**
   * Создаёт первичный хеш-кэш для конфигураций, у которых его ещё нет.
   */
  ensureCaches(entries: ConfigEntry[], reportStatus?: (message: string) => void): number {
    let created = 0;
    for (const entry of entries) {
      const scope = this.resolveScope(entry);
      const previous = loadHashCache(this.projectRoot, scope.scopeKey);
      const metadata = loadMetadataCache(this.projectRoot, scope.scopeKey);
      const hasHashCache = Boolean(previous.generatedAt || Object.keys(previous.files).length > 0);
      if (hasHashCache && metadata) {
        continue;
      }

      let entryCreated = false;
      if (!hasHashCache) {
        reportStatus?.(`Инициализация хеш-кэша: ${scope.name}`);
        saveHashCache(this.projectRoot, buildHashSnapshot(scope.scopeKey, entry.rootPath));
        entryCreated = true;
      }
      if (!metadata) {
        reportStatus?.(`Инициализация дерева метаданных: ${scope.name}`);
        saveMetadataCacheForEntry(this.projectRoot, scope.scopeKey, entry);
        entryCreated = true;
      }
      if (entryCreated) {
        created += 1;
      }
    }
    return created;
  }

  detect(entries: ConfigEntry[]): ChangedConfiguration[] {
    const result: ChangedConfiguration[] = [];

    for (const entry of entries) {
      const scope = this.resolveScope(entry);
      const previous = loadHashCache(this.projectRoot, scope.scopeKey);
      const current = buildHashSnapshot(scope.scopeKey, entry.rootPath);
      const diff = diffHashSnapshots(previous, current);
      const changedFilesCount = diff.added.length + diff.modified.length + diff.deleted.length;

      if (changedFilesCount === 0) {
        continue;
      }

      result.push({
        kind: entry.kind,
        rootPath: entry.rootPath,
        name: scope.name,
        changedFilesCount,
      });
    }

    return result.sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === 'cf' ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });
  }

  private resolveScope(entry: ConfigEntry): { name: string; scopeKey: string } {
    const configXmlPath = path.join(entry.rootPath, 'Configuration.xml');
    const info = parseConfigXml(configXmlPath);
    return {
      name: info.name,
      scopeKey: buildMetadataCacheScopeKey(entry, info),
    };
  }
}
