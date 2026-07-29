import * as path from 'path';
import { getString } from '../core/args';
import { resolveConnection } from '../core/connection';
import { createTempDir, runDesignerAndPrintResult, safeRemoveDir, writeUtf8BomLines } from '../core/onecCommon';
import type { CliArgs } from '../core/types';
import { readExtensionListFromDumpFile } from '../../infra/environment/ExtensionListParser';

/**
 * Получает список расширений, подключённых к базе, через Конфигуратор
 * (`/DumpDBCfgList -AllExtensions`) и сохраняет имена в файл-результат
 * (UTF-8 BOM, по одному имени в строке) для последующего чтения UI.
 */
/* c8 ignore start -- тонкий оркестратор спавна реального Конфигуратора 1С (runDesignerAndPrintResult); не исполним в CI без установленной платформы. Тестируемая логика (разбор вывода) вынесена в infra/environment/ExtensionListParser.ts и покрыта на 100%. Тот же паттерн, что и ExtensionCommandRunner.listConnectedDatabaseExtensions. guard -ResultFile входит в ignore осознанно — чистая оркестрация. */
export async function listDbExtensions(args: CliArgs): Promise<number> {
  const connection = resolveConnection(args);
  const resultFile = getString(args, 'ResultFile', '');
  if (!resultFile) {
    throw new Error('Error: -ResultFile required');
  }

  const tempDir = createTempDir('db_ext_list_');
  try {
    const designerOut = path.join(tempDir, 'ext_list.txt');
    const designerArgs: string[] = ['/DumpDBCfgList', '-AllExtensions', '/Out', designerOut, '/DisableStartupDialogs'];

    const exitCode = await runDesignerAndPrintResult(
      connection,
      designerArgs,
      'Список расширений получен',
      'Error listing extensions',
      designerOut
    );

    if (exitCode === 0) {
      writeUtf8BomLines(resultFile, readExtensionListFromDumpFile(designerOut));
    }
    return exitCode;
  } finally {
    safeRemoveDir(tempDir);
  }
}
/* c8 ignore stop */
