import { CliArgs } from '../core/types';
import { exportConfiguration } from './exportConfiguration';
import { importConfiguration } from './importConfiguration';
import { importGitChanges } from './importGitChanges';
import { refreshHashCache } from './refreshHashCache';
import { updateConfiguration } from './updateConfiguration';
import { syncConfigurationFull, syncConfigurationPartial } from './syncConfiguration';

type CommandHandler = (args: CliArgs) => Promise<number>;

export const CLI_COMMANDS: Record<string, CommandHandler> = {
  'export-configuration': exportConfiguration,
  'import-configuration': importConfiguration,
  'import-git-changes': importGitChanges,
  'refresh-hash-cache': refreshHashCache,
  'update-configuration': updateConfiguration,
  'sync-configuration-partial': syncConfigurationPartial,
  'sync-configuration-full': syncConfigurationFull,

  // Алиасы для обратной совместимости.
  'db-dump-xml': exportConfiguration,
  'db-load-xml': importConfiguration,
  'db-load-git': importGitChanges,
  'db-update': updateConfiguration,
  'update-partial': syncConfigurationPartial,
  'update-full': syncConfigurationFull,
};
