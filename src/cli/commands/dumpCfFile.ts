import * as fs from 'fs';
import * as path from 'path';
import { getBool, getString } from '../core/args';
import { resolveConnection } from '../core/connection';
import { createTempDir, printLogFile, runDesignerAndPrintResult, safeRemoveDir } from '../core/onecCommon';
import type { CliArgs } from '../core/types';
import {
  assertNoAllExtensionsFlag,
  buildCfFileDesignerArgs,
  resolveDumpStagingPath,
  validateCfFileRequest,
} from '../../infra/cfFile';

export interface DumpCfRequest {
  readonly outputFile: string;
  readonly extensionName: string;
  readonly isExtension: boolean;
  readonly overwrite: boolean;
  readonly verbose: boolean;
}

/**
 * Разбирает и ПОЛНОСТЬЮ валидирует аргументы `dump-cf`.
 *
 * Вызывается до `resolveConnection`: все guard'ы обязаны срабатывать раньше,
 * чем начнётся подключение к базе и спавн Конфигуратора, — платформа не
 * диагностирует ни неверный ключ, ни рассинхрон «расширение ↔ суффикс», а при
 * сбое всё равно оставляет побочные эффекты (см. `infra/cfFile`).
 */
export function parseDumpCfArgs(args: CliArgs): DumpCfRequest {
  assertNoAllExtensionsFlag(getBool(args, 'AllExtensions'), 'dump');

  const outputFileRaw = getString(args, 'OutputFile', '').trim();
  if (!outputFileRaw) {
    throw new Error('Error: -OutputFile is required');
  }

  // Признак расширения выводится ЕДИНООБРАЗНО во всех точках входа (CLI/UI/MCP)
  // — из непустого имени расширения, а не из отдельного флага.
  const extensionName = getString(args, 'Extension', '').trim();
  const isExtension = extensionName.length > 0;
  const overwrite = getBool(args, 'Overwrite');

  const outputFile = path.resolve(outputFileRaw);
  validateCfFileRequest({ operation: 'dump', filePath: outputFile, isExtension, overwrite });

  return { outputFile, extensionName, isExtension, overwrite, verbose: getBool(args, 'Verbose') };
}

/**
 * Выгружает конфигурацию или расширение в бинарный файл (`/DumpCfg`).
 *
 * Выгрузка идёт в staging-файл рядом с целевым и переносится на целевой путь
 * ТОЛЬКО при `exitCode === 0`: замерено на 8.3.27.1989 — при ошибке платформа
 * всё равно создаёт выходной файл (16 байт мусора), поэтому прямая выгрузка в
 * целевой путь давала бы битый «бэкап» либо уничтожала уже существующий файл.
 */
export async function dumpCfFile(args: CliArgs): Promise<number> {
  const request = parseDumpCfArgs(args);
  const connection = resolveConnection(args);

  /* c8 ignore start -- ниже только оркестрация спавна реального Конфигуратора 1С (runDesignerAndPrintResult) и перенос результата; в CI без установленной платформы не исполнимо. Вся тестируемая логика — parseDumpCfArgs (валидация) и infra/cfFile (вектор аргументов, staging-путь) — покрыта отдельно. Тот же паттерн, что и listDbExtensions. */
  const stagingPath = resolveDumpStagingPath(request.outputFile, `${String(process.pid)}-${String(Date.now())}`);
  const tempDir = createTempDir('db_dump_cf_');
  try {
    const logFile = path.join(tempDir, 'dump_cf_log.txt');
    const designerArgs = buildCfFileDesignerArgs({
      operation: 'dump',
      filePath: stagingPath,
      extensionName: request.extensionName,
      outLogFile: logFile,
    });

    const exitCode = await runDesignerAndPrintResult(
      connection,
      designerArgs,
      'Выгрузка в файл завершена',
      'Error dumping configuration to file',
      request.verbose ? undefined : logFile
    );
    if (request.verbose) {
      printLogFile(logFile);
    }

    if (exitCode === 0) {
      moveStagingToTarget(stagingPath, request.outputFile);
      console.log(`Файл создан: ${request.outputFile}`);
    }
    return exitCode;
  } finally {
    safeRemoveFile(stagingPath);
    safeRemoveDir(tempDir);
  }
}

/** Переносит успешно выгруженный staging-файл на целевой путь. */
function moveStagingToTarget(stagingPath: string, outputFile: string): void {
  // На Windows rename поверх существующего файла падает — удаляем цель явно
  // (перезапись к этому моменту уже разрешена guard'ом -Overwrite).
  if (fs.existsSync(outputFile)) {
    fs.rmSync(outputFile, { force: true });
  }
  fs.renameSync(stagingPath, outputFile);
}

function safeRemoveFile(filePath: string): void {
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    // Остаток staging-файла не должен ломать результат операции.
  }
}
/* c8 ignore stop */
