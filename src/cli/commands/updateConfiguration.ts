import * as path from 'path';
import { CliArgs } from '../core/types';
import { resolveConnection } from '../core/connection';
import { createTempDir, printLogFile, runDesignerAndPrintResult, safeRemoveDir } from '../core/onecCommon';
import { getBool, getString } from '../core/args';

export async function updateConfiguration(args: CliArgs): Promise<number> {
  const connection = resolveConnection(args);
  const extension = getString(args, 'Extension', '');
  const allExtensions = getBool(args, 'AllExtensions');
  const dynamic = getString(args, 'Dynamic', '');
  const server = getBool(args, 'Server');
  const warningsAsErrors = getBool(args, 'WarningsAsErrors');
  const verbose = getBool(args, 'Verbose');
  const tempDir = createTempDir('db_update_');
  const outFile = path.join(tempDir, 'update_log.txt');

  try {
    console.log('Применение изменений');
    const designerArgs: string[] = ['/UpdateDBCfg'];

    if (dynamic) {
      if (dynamic !== '+' && dynamic !== '-') {
        throw new Error('Error: -Dynamic must be "+" or "-"');
      }
      designerArgs.push(`-Dynamic${dynamic}`);
    }
    if (server) {
      designerArgs.push('-Server');
    }
    if (warningsAsErrors) {
      designerArgs.push('-WarningsAsErrors');
    }

    if (extension) {
      designerArgs.push('-Extension', extension);
    } else if (allExtensions) {
      designerArgs.push('-AllExtensions');
    }

    designerArgs.push('/Out', outFile, '/DisableStartupDialogs');
    const exitCode = await runDesignerAndPrintResult(
      connection,
      designerArgs,
      'Применение завершено',
      'Error updating database configuration',
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
