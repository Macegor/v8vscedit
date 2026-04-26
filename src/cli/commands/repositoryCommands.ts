import * as path from 'path';
import { CliArgs } from '../core/types';
import { resolveConnection } from '../core/connection';
import {
  appendRepositoryArgs,
  createTempDir,
  printLogFile,
  RepositoryConnection,
  runDesignerAndPrintResult,
  safeRemoveDir,
} from '../core/onecCommon';
import { getBool, getRequiredString, getString } from '../core/args';

function resolveRepositoryConnection(args: CliArgs): RepositoryConnection {
  const repoPath = getRequiredString(args, 'RepoPath');
  const repoUser = getRequiredString(args, 'RepoUser');
  return {
    repoPath,
    repoUser,
    repoPassword: getString(args, 'RepoPassword', ''),
  };
}

function appendRepositoryCommandArgs(args: string[], repository: RepositoryConnection): void {
  appendRepositoryArgs(args, repository);
}

async function executeRepositoryCommand(
  args: CliArgs,
  commandArgs: string[],
  successMessage: string,
  errorMessage: string,
  logFileName: string
): Promise<number> {
  const connection = resolveConnection(args);
  const repository = resolveRepositoryConnection(args);
  const extension = getString(args, 'Extension', '');
  const verbose = getBool(args, 'Verbose');
  const tempDir = createTempDir('repo_');
  const outFile = path.join(tempDir, logFileName);

  try {
    const designerArgs: string[] = [];
    appendRepositoryCommandArgs(designerArgs, repository);
    designerArgs.push(...commandArgs);
    if (extension) {
      designerArgs.push('-Extension', extension);
    }
    designerArgs.push('/Out', outFile, '/DisableStartupDialogs');

    const exitCode = await runDesignerAndPrintResult(
      connection,
      designerArgs,
      successMessage,
      errorMessage,
      verbose ? undefined : outFile
    );
    if (verbose) {
      printLogFile(outFile);
    }
    return exitCode;
  } finally {
    safeRemoveDir(tempDir);
  }
}

export async function createRepository(args: CliArgs): Promise<number> {
  const commandArgs = ['/ConfigurationRepositoryCreate'];
  if (getBool(args, 'AllowConfigurationChanges')) {
    commandArgs.push('-AllowConfigurationChanges');
  }

  const changesAllowedRule = getString(args, 'ChangesAllowedRule', '');
  if (changesAllowedRule) {
    commandArgs.push('-ChangesAllowedRule', changesAllowedRule);
  }

  const changesNotRecommendedRule = getString(args, 'ChangesNotRecommendedRule', '');
  if (changesNotRecommendedRule) {
    commandArgs.push('-ChangesNotRecommendedRule', changesNotRecommendedRule);
  }

  if (getBool(args, 'NoBind')) {
    commandArgs.push('-NoBind');
  }

  return executeRepositoryCommand(
    args,
    commandArgs,
    'Создание хранилища завершено',
    'Error creating configuration repository',
    'repository-create.log'
  );
}

export async function bindRepositoryConfiguration(args: CliArgs): Promise<number> {
  const commandArgs = ['/ConfigurationRepositoryBindCfg'];
  if (getBool(args, 'ForceBindAlreadyBindedUser')) {
    commandArgs.push('-forceBindAlreadyBindedUser');
  }
  if (getBool(args, 'ForceReplaceCfg')) {
    commandArgs.push('-forceReplaceCfg');
  }

  return executeRepositoryCommand(
    args,
    commandArgs,
    'Подключение к хранилищу завершено',
    'Error binding configuration repository',
    'repository-bind.log'
  );
}

export async function unbindRepositoryConfiguration(args: CliArgs): Promise<number> {
  const commandArgs = ['/ConfigurationRepositoryUnbindCfg'];
  if (getBool(args, 'Force')) {
    commandArgs.push('-force');
  }

  return executeRepositoryCommand(
    args,
    commandArgs,
    'Отключение от хранилища завершено',
    'Error unbinding configuration repository',
    'repository-unbind.log'
  );
}

export async function lockRepositoryObjects(args: CliArgs): Promise<number> {
  const commandArgs = ['/ConfigurationRepositoryLock'];
  const objectsFile = getString(args, 'ObjectsFile', '');
  if (objectsFile) {
    commandArgs.push('-Objects', objectsFile);
  }
  if (getBool(args, 'Revised')) {
    commandArgs.push('-revised');
  }

  return executeRepositoryCommand(
    args,
    commandArgs,
    'Захват объектов завершен',
    'Error locking repository objects',
    'repository-lock.log'
  );
}

export async function unlockRepositoryObjects(args: CliArgs): Promise<number> {
  const commandArgs = ['/ConfigurationRepositoryUnLock'];
  const objectsFile = getString(args, 'ObjectsFile', '');
  if (objectsFile) {
    commandArgs.push('-Objects', objectsFile);
  }
  if (getBool(args, 'Force')) {
    commandArgs.push('-force');
  }

  return executeRepositoryCommand(
    args,
    commandArgs,
    'Освобождение объектов завершено',
    'Error unlocking repository objects',
    'repository-unlock.log'
  );
}

export async function commitRepositoryObjects(args: CliArgs): Promise<number> {
  const commandArgs = ['/ConfigurationRepositoryCommit'];
  const objectsFile = getString(args, 'ObjectsFile', '');
  if (objectsFile) {
    commandArgs.push('-Objects', objectsFile);
  }

  const comment = getString(args, 'Comment', '');
  if (comment) {
    commandArgs.push('-comment', comment);
  }

  if (getBool(args, 'KeepLocked')) {
    commandArgs.push('-keepLocked');
  }
  if (getBool(args, 'Force')) {
    commandArgs.push('-force');
  }

  return executeRepositoryCommand(
    args,
    commandArgs,
    'Помещение изменений завершено',
    'Error committing repository objects',
    'repository-commit.log'
  );
}

export async function updateRepositoryConfiguration(args: CliArgs): Promise<number> {
  const commandArgs = ['/ConfigurationRepositoryUpdateCfg'];
  const objectsFile = getString(args, 'ObjectsFile', '');
  if (objectsFile) {
    commandArgs.push('-Objects', objectsFile);
  }

  const version = getString(args, 'Version', '');
  if (version) {
    commandArgs.push('-v', version);
  }
  if (getBool(args, 'Force')) {
    commandArgs.push('-force');
  }

  return executeRepositoryCommand(
    args,
    commandArgs,
    'Получение объектов из хранилища завершено',
    'Error updating configuration from repository',
    'repository-update.log'
  );
}

export async function addRepositoryUser(args: CliArgs): Promise<number> {
  const userName = getRequiredString(args, 'User');
  const password = getRequiredString(args, 'Pwd');
  const rights = getRequiredString(args, 'Rights');
  const commandArgs = [
    '/ConfigurationRepositoryAddUser',
    '-User',
    userName,
    '-Pwd',
    password,
    '-Rights',
    rights,
  ];
  if (getBool(args, 'RestoreDeletedUser')) {
    commandArgs.push('-RestoreDeletedUser');
  }

  return executeRepositoryCommand(
    args,
    commandArgs,
    'Добавление пользователя завершено',
    'Error adding repository user',
    'repository-add-user.log'
  );
}

export async function copyRepositoryUsers(args: CliArgs): Promise<number> {
  const sourcePath = getRequiredString(args, 'Path');
  const userName = getRequiredString(args, 'User');
  const password = getRequiredString(args, 'Pwd');
  const commandArgs = [
    '/ConfigurationRepositoryCopyUsers',
    '-Path',
    sourcePath,
    '-User',
    userName,
    '-Pwd',
    password,
  ];
  if (getBool(args, 'RestoreDeletedUser')) {
    commandArgs.push('-RestoreDeletedUser');
  }

  return executeRepositoryCommand(
    args,
    commandArgs,
    'Копирование пользователей завершено',
    'Error copying repository users',
    'repository-copy-users.log'
  );
}

export async function dumpRepositoryConfiguration(args: CliArgs): Promise<number> {
  const filePath = getRequiredString(args, 'File');
  const commandArgs = ['/ConfigurationRepositoryDumpCfg', filePath];
  const version = getString(args, 'Version', '');
  if (version) {
    commandArgs.push('-v', version);
  }

  return executeRepositoryCommand(
    args,
    commandArgs,
    'Выгрузка версии хранилища завершена',
    'Error dumping configuration repository',
    'repository-dump.log'
  );
}

export async function reportRepository(args: CliArgs): Promise<number> {
  const filePath = getRequiredString(args, 'File');
  const commandArgs = ['/ConfigurationRepositoryReport', filePath];
  appendOptionalValue(commandArgs, '-NBegin', getString(args, 'NBegin', ''));
  appendOptionalValue(commandArgs, '-NEnd', getString(args, 'NEnd', ''));
  appendOptionalValue(commandArgs, '-DateBegin', getString(args, 'DateBegin', ''));
  appendOptionalValue(commandArgs, '-DateEnd', getString(args, 'DateEnd', ''));
  appendOptionalValue(commandArgs, '-ConfigurationVersion', getString(args, 'ConfigurationVersion', ''));
  appendOptionalValue(commandArgs, '-ReportFormat', getString(args, 'ReportFormat', ''));
  if (getBool(args, 'GroupByObject')) {
    commandArgs.push('-GroupByObject');
  }
  if (getBool(args, 'GroupByComment')) {
    commandArgs.push('-GroupByComment');
  }
  if (getBool(args, 'DoNotIncludeVersionsWithLabels')) {
    commandArgs.push('-DoNotIncludeVersionsWithLabels');
  }
  if (getBool(args, 'IncludeOnlyVersionsWithLabels')) {
    commandArgs.push('-IncludeOnlyVersionsWithLabels');
  }
  if (getBool(args, 'IncludeCommentLinesWithDoubleSlash')) {
    commandArgs.push('-IncludeCommentLinesWithDoubleSlash');
  }

  return executeRepositoryCommand(
    args,
    commandArgs,
    'Построение отчета по хранилищу завершено',
    'Error building repository report',
    'repository-report.log'
  );
}

export async function setRepositoryLabel(args: CliArgs): Promise<number> {
  const labelName = getRequiredString(args, 'LabelName');
  const commandArgs = ['/ConfigurationRepositorySetLabel', '-name', labelName];
  const version = getString(args, 'Version', '');
  if (version) {
    commandArgs.push('-v', version);
  }
  const comment = getString(args, 'Comment', '');
  if (comment) {
    commandArgs.push('-comment', comment);
  }

  return executeRepositoryCommand(
    args,
    commandArgs,
    'Установка метки завершена',
    'Error setting repository label',
    'repository-set-label.log'
  );
}

function appendOptionalValue(target: string[], name: string, value: string): void {
  if (!value) {
    return;
  }
  target.push(name, value);
}
