import type { CliArgs } from '../core/types';
import { refreshHashCache } from './refreshHashCache';
import {
  addRepositoryUser,
  bindRepositoryConfiguration,
  commitRepositoryObjects,
  copyRepositoryUsers,
  createRepository,
  dumpRepositoryConfiguration,
  lockRepositoryObjects,
  reportRepository,
  setRepositoryLabel,
  unbindRepositoryConfiguration,
  unlockRepositoryObjects,
  updateRepositoryConfiguration,
} from './repositoryCommands';

type CommandHandler = (args: CliArgs) => number | Promise<number>;

export const CLI_COMMANDS: Partial<Record<string, CommandHandler>> = {
  'refresh-hash-cache': refreshHashCache,
  'repository-create': createRepository,
  'repository-bind': bindRepositoryConfiguration,
  'repository-unbind': unbindRepositoryConfiguration,
  'repository-lock': lockRepositoryObjects,
  'repository-unlock': unlockRepositoryObjects,
  'repository-commit': commitRepositoryObjects,
  'repository-update': updateRepositoryConfiguration,
  'repository-add-user': addRepositoryUser,
  'repository-copy-users': copyRepositoryUsers,
  'repository-dump': dumpRepositoryConfiguration,
  'repository-report': reportRepository,
  'repository-set-label': setRepositoryLabel,
};
