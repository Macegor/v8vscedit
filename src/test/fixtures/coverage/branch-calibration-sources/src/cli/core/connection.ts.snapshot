import { getString } from './args';
import type { CliArgs, OnecConnection } from './types';
import { resolveV8Path } from './onecCommon';

/**
 * Формирует параметры подключения к базе из аргументов CLI.
 */
export function resolveConnection(args: CliArgs): OnecConnection {
  const infoBasePath = getString(args, 'InfoBasePath', '');
  const infoBaseServer = getString(args, 'InfoBaseServer', '');
  const infoBaseRef = getString(args, 'InfoBaseRef', '');

  if (!infoBasePath && (!infoBaseServer || !infoBaseRef)) {
    throw new Error('Error: specify -InfoBasePath or -InfoBaseServer + -InfoBaseRef');
  }

  return {
    infoBasePath,
    infoBaseServer,
    infoBaseRef,
    userName: getString(args, 'UserName', ''),
    password: getString(args, 'Password', ''),
    v8Path: resolveV8Path(getString(args, 'V8Path', '')),
  };
}
