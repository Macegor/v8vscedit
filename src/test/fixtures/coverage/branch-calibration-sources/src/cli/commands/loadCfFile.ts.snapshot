import * as path from 'path';
import { getBool, getString } from '../core/args';
import { resolveConnection } from '../core/connection';
import { createTempDir, printLogFile, runDesignerAndPrintResult, safeRemoveDir } from '../core/onecCommon';
import type { CliArgs } from '../core/types';
import { assertNoAllExtensionsFlag, buildCfFileDesignerArgs, validateCfFileRequest } from '../../infra/cfFile';

export interface LoadCfRequest {
  readonly inputFile: string;
  readonly extensionName: string;
  readonly isExtension: boolean;
  readonly verbose: boolean;
}

/**
 * Разбирает и ПОЛНОСТЬЮ валидирует аргументы `load-cf` — до `resolveConnection`
 * и до любого спавна. Прогон платформы показал, что неудачная загрузка с
 * `-Extension` всё равно создаёт расширение в базе: состояние базы после сбоя
 * чинить нечем, поэтому рассинхрон «расширение ↔ суффикс файла» обязан
 * останавливать операцию ещё на разборе аргументов.
 */
export function parseLoadCfArgs(args: CliArgs): LoadCfRequest {
  assertNoAllExtensionsFlag(getBool(args, 'AllExtensions'), 'load');

  const inputFileRaw = getString(args, 'InputFile', '').trim();
  if (!inputFileRaw) {
    throw new Error('Error: -InputFile is required');
  }

  const extensionName = getString(args, 'Extension', '').trim();
  const isExtension = extensionName.length > 0;

  const inputFile = path.resolve(inputFileRaw);
  validateCfFileRequest({ operation: 'load', filePath: inputFile, isExtension });

  return { inputFile, extensionName, isExtension, verbose: getBool(args, 'Verbose') };
}

/**
 * Загружает конфигурацию или расширение из бинарного файла (`/LoadCfg`).
 *
 * `/UpdateDBCfg` здесь НЕ выполняется сознательно: замерено на 8.3.27.1989 —
 * после `/LoadCfg` основная конфигурация стала 75408 байт, а конфигурация БД
 * осталась прежней (4973) до отдельного `/UpdateDBCfg`. Применение к базе —
 * самостоятельный шаг вызывающей стороны.
 */
export async function loadCfFile(args: CliArgs): Promise<number> {
  const request = parseLoadCfArgs(args);
  const connection = resolveConnection(args);

  /* c8 ignore start -- ниже только оркестрация спавна реального Конфигуратора 1С (runDesignerAndPrintResult); в CI без установленной платформы не исполнимо. Тестируемая логика (parseLoadCfArgs, вектор аргументов infra/cfFile) покрыта отдельно. Тот же паттерн, что и listDbExtensions. */
  const tempDir = createTempDir('db_load_cf_');
  try {
    const logFile = path.join(tempDir, 'load_cf_log.txt');
    const designerArgs = buildCfFileDesignerArgs({
      operation: 'load',
      filePath: request.inputFile,
      extensionName: request.extensionName,
      outLogFile: logFile,
    });

    const exitCode = await runDesignerAndPrintResult(
      connection,
      designerArgs,
      'Загрузка из файла завершена (конфигурация базы ещё не обновлена)',
      'Error loading configuration from file',
      request.verbose ? undefined : logFile
    );
    if (request.verbose) {
      printLogFile(logFile);
    }
    return exitCode;
  } finally {
    safeRemoveDir(tempDir);
  }
  /* c8 ignore stop */
}
