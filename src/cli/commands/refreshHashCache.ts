import * as path from 'path';
import { getString } from '../core/args';
import { buildHashSnapshot, buildScopeKey, saveHashCache } from '../core/hashCache';
import { resolveConfigDir } from '../core/projectLayout';
import { CliArgs } from '../core/types';

/**
 * Полностью пересобирает кэш хешей для указанной области конфигурации.
 */
export async function refreshHashCache(args: CliArgs): Promise<number> {
  const projectRoot = path.resolve(getString(args, 'ProjectRoot', process.cwd()));
  const target = getString(args, 'Target', 'cf');
  const extension = getString(args, 'Extension', '');
  const configDir = getString(args, 'ConfigDir', '') || resolveConfigDir(projectRoot, target === 'cfe' ? 'cfe' : 'cf', extension);
  const normalizedTarget = target === 'cfe' ? 'cfe' : 'cf';
  const scopeKey = buildScopeKey(normalizedTarget, configDir, extension);
  const snapshot = buildHashSnapshot(scopeKey, configDir);
  saveHashCache(projectRoot, snapshot);
  console.log(`Hash cache rebuilt: ${Object.keys(snapshot.files).length} files`);
  return 0;
}
