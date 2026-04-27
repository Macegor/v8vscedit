import * as fs from 'fs';
import * as path from 'path';
import { getBool, getString } from '../core/args';
import { resolveConnection } from '../core/connection';
import { runDesignerAndPrintResult, createTempDir, printLogFile, safeRemoveDir, writeUtf8BomLines } from '../core/onecCommon';
import { CliArgs } from '../core/types';
import { resolveConfigDir } from '../core/projectLayout';

export async function exportConfiguration(args: CliArgs): Promise<number> {
  const projectRoot = getProjectRoot(args);
  const mode = getString(args, 'Mode', 'Changes');
  const format = getString(args, 'Format', 'Hierarchical');
  const target = getString(args, 'Target', 'cf');
  const extension = getString(args, 'Extension', '');
  const objects = getString(args, 'Objects', '');
  const configDir = getString(args, 'ConfigDir', '') || resolveConfigDir(projectRoot, target === 'cfe' ? 'cfe' : 'cf', extension);
  const allExtensions = getBool(args, 'AllExtensions');
  const connection = resolveConnection(args);
  const verbose = getBool(args, 'Verbose');

  if (!['Full', 'Changes', 'Partial', 'UpdateInfo'].includes(mode)) {
    throw new Error('Error: -Mode must be Full, Changes, Partial or UpdateInfo');
  }
  if (!['Hierarchical', 'Plain'].includes(format)) {
    throw new Error('Error: -Format must be Hierarchical or Plain');
  }
  if (mode === 'Partial' && !objects.trim()) {
    throw new Error('Error: -Objects required for Partial mode');
  }

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
    console.log(`Created output directory: ${configDir}`);
  }

  const tempDir = createTempDir('db_dump_xml_');
  try {
    console.log('Выгрузка исходников');
    const designerArgs: string[] = ['/DumpConfigToFiles', configDir, '-Format', format];
    if (mode === 'Changes') {
      designerArgs.push('-update', '-force');
    } else if (mode === 'Partial') {
      const objectList = objects.split(',').map((item) => item.trim()).filter(Boolean);
      const listFile = path.join(tempDir, 'dump_list.txt');
      writeUtf8BomLines(listFile, objectList);
      designerArgs.push('-listFile', listFile);
      if (verbose) {
        console.log(`Objects to dump: ${objectList.length}`);
      }
    } else if (mode === 'UpdateInfo') {
      designerArgs.push('-configDumpInfoOnly');
    }

    if (target === 'cfe' || extension) {
      designerArgs.push('-Extension', extension);
    } else if (allExtensions) {
      designerArgs.push('-AllExtensions');
    }

    const outFile = path.join(tempDir, 'dump_log.txt');
    designerArgs.push('/Out', outFile, '/DisableStartupDialogs');

    const exitCode = await runDesignerAndPrintResult(
      connection,
      designerArgs,
      'Выгрузка завершена',
      'Error dumping configuration',
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

function getProjectRoot(args: CliArgs): string {
  return path.resolve(getString(args, 'ProjectRoot', process.cwd()));
}
