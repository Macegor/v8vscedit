import * as path from 'path';
import { getString } from '../core/args';
import { resolveConnection } from '../core/connection';
import { createTempDir, runDesignerAndPrintResult, safeRemoveDir, writeUtf8BomLines } from '../core/onecCommon';
import type { CliArgs, OnecConnection } from '../core/types';
import { readExtensionListFromDumpFile } from '../../infra/environment/ExtensionListParser';

/** Результат запроса списка расширений у базы: код возврата Конфигуратора и сами имена. */
export interface DbExtensionListResult {
  readonly exitCode: number;
  readonly names: string[];
}

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

  const result = await queryDbExtensionList(connection);
  if (result.exitCode === 0) {
    writeUtf8BomLines(resultFile, result.names);
  }
  return result.exitCode;
}

/**
 * ЕДИНСТВЕННОЕ место вектора запроса списка расширений — его переиспользуют и
 * пакетные команды. `-AllExtensions` у `/DumpDBCfgList` ключ ШТАТНЫЙ и
 * обязательный (без него платформа отвечает «Ошибка в параметрах командной
 * строки»), в отличие от `/DumpCfg`/`/LoadCfg`, где такого ключа не существует
 * и он принимается молча. Копии этого вектора по командам разводить нельзя:
 * ошибку в нём не диагностирует ни код возврата, ни лог.
 */
export async function queryDbExtensionList(connection: OnecConnection): Promise<DbExtensionListResult> {
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

    return { exitCode, names: exitCode === 0 ? readExtensionListFromDumpFile(designerOut) : [] };
  } finally {
    safeRemoveDir(tempDir);
  }
}
/* c8 ignore stop */
