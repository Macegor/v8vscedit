import * as path from 'path';
import { getString } from '../core/args';
import { buildHashSnapshot, buildScopeKey, saveHashCache } from '../core/hashCache';
import { resolveConfigDir } from '../core/projectLayout';
import type { CliArgs } from '../core/types';
import { saveMetadataCacheForEntry } from '../../infra/cache/MetadataCache';

/**
 * Полностью пересобирает кэш хешей для указанной области конфигурации.
 */
export function refreshHashCache(args: CliArgs): number {
  const projectRoot = path.resolve(getString(args, 'ProjectRoot', process.cwd()));
  const target = getString(args, 'Target', 'cf');
  const extension = getString(args, 'Extension', '');
  const configDir = getString(args, 'ConfigDir', '') || resolveConfigDir(projectRoot, target === 'cfe' ? 'cfe' : 'cf', extension);
  const normalizedTarget = target === 'cfe' ? 'cfe' : 'cf';
  const scopeKey = buildScopeKey(normalizedTarget, configDir, extension);
  console.log('Формирование хеш-кэша');
  const snapshot = buildHashSnapshot(scopeKey, configDir);
  saveHashCache(projectRoot, snapshot);
  console.log('Формирование кэша метаданных');
  saveMetadataCacheForEntry(projectRoot, scopeKey, { kind: normalizedTarget, rootPath: configDir });
  console.log(`Hash cache rebuilt: ${String(Object.keys(snapshot.files).length)} files`);
  return 0;
}
