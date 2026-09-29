import * as path from 'path';
import { getBool, getString } from '../core/args';
import { resolveConnection } from '../core/connection';
import {
  createTempDir,
  moveStagingToTarget,
  printLogFile,
  runDesignerAndPrintResult,
  safeRemoveDir,
  safeRemoveFile,
} from '../core/onecCommon';
import type { CliArgs } from '../core/types';
import {
  assertNoAllExtensionsFlag,
  buildCfFileDesignerArgs,
  isDumpStagingFileName,
  planCfeDumpFiles,
  resolveDumpStagingPath,
  validateCfeDumpDirectory,
  writeCfeManifest,
  type CfeBatchReport,
  type CfeBatchReportItem,
  type CfeManifestItem,
} from '../../infra/cfFile';
import {
  BATCH_EXIT_FAILED,
  BATCH_EXIT_INTERRUPTED,
  BATCH_EXIT_OK,
  fileSizeOrUndefined,
  installInterruptionFlag,
  parseBatchDirectoryArg,
  readDirectoryFileNames,
  resolveExtensionNames,
  writeBatchReport,
} from './cfeBatchShared';

export interface DumpCfeAllRequest {
  readonly outputDir: string;
  readonly overwrite: boolean;
  readonly verbose: boolean;
}

/**
 * Разбирает и ПОЛНОСТЬЮ валидирует аргументы `dump-cfe-all`.
 *
 * Вызывается до `resolveConnection`: платформа не диагностирует ни неверный
 * ключ, ни рассинхрон, а при сбое всё равно оставляет побочные эффекты.
 */
export function parseDumpCfeAllArgs(args: CliArgs): DumpCfeAllRequest {
  // Пакетность — это ЦИКЛ по списку, а не ключ платформы: у `/DumpCfg` ключа
  // `-AllExtensions` не существует, он принимается молча (код 0) и выгружает
  // ОСНОВНУЮ конфигурацию — результат неотличим от обычной выгрузки.
  assertNoAllExtensionsFlag(getBool(args, 'AllExtensions'), 'dump');

  return {
    outputDir: parseBatchDirectoryArg(args, 'OutputDir', 'dump'),
    overwrite: getBool(args, 'Overwrite'),
    verbose: getBool(args, 'Verbose'),
  };
}

/**
 * Выгружает ВСЕ расширения базы в каталог, по файлу `.cfe` на расширение.
 *
 * Политика отказа — ПРОДОЛЖАТЬ: выгрузка базу не трогает, 14 корректных
 * бэкапов из 15 ценны, а каждый стоит минут работы платформы. Каждый файл
 * пишется через свой staging-файл и переносится на целевой путь только при
 * `exitCode === 0` — при ошибке платформа всё равно создаёт файл-мусор
 * (замерено: 16 байт), и прямая выгрузка затирала бы прежний бэкап.
 *
 * Манифест `cfe-dump.json` пишется последним и целиком результатом ТЕКУЩЕГО
 * прогона: санитизация имени необратима, по `A_B.cfe` исходное `A:B` не
 * восстановить ничем другим.
 */
export async function dumpCfeAll(args: CliArgs): Promise<number> {
  const request = parseDumpCfeAllArgs(args);
  const connection = resolveConnection(args);
  const resultFile = getString(args, 'ResultFile', '').trim();

  /* c8 ignore start -- ниже только оркестрация спавна реального Конфигуратора 1С и переноса результатов; в CI без платформы не исполнимо и в процессе Extension Host не инструментируется (CLI — дочерний node-процесс). Цикл целиком проверяется на POSIX-заглушке Конфигуратора в cfeBatchCliRun.test.ts, решения — в infra/cfFile/CfeBatch*. Тот же паттерн, что в dumpCfFile.ts. */
  const names = await resolveExtensionNames(connection);
  if (!names) {
    return failBeforeStart(resultFile, 'Не удалось получить список расширений базы.');
  }

  const plan = planCfeDumpFiles(names, readDirectoryFileNames(request.outputDir));
  const validationError = validateCfeDumpDirectory(
    request.outputDir,
    plan.items.map((item) => item.fileName),
    request.overwrite
  );
  if (validationError) {
    return failBeforeStart(resultFile, validationError);
  }
  if (plan.conflicts.length > 0) {
    console.log(`Существующие файлы будут заменены: ${plan.conflicts.join(', ')}`);
  }
  removeStagingLeftovers(request.outputDir);

  const items: CfeBatchReportItem[] = [];
  const manifestItems: CfeManifestItem[] = [];
  const interruption = installInterruptionFlag();
  const tempDir = createTempDir('db_dump_cfe_all_');
  let failed = false;
  try {
    for (let index = 0; index < plan.items.length; index += 1) {
      const planItem = plan.items[index];
      if (interruption.interrupted) {
        items.push({ extensionName: planItem.extensionName, fileName: planItem.fileName, status: 'notAttempted' });
        continue;
      }

      const targetPath = path.join(request.outputDir, planItem.fileName);
      const stagingPath = resolveDumpStagingPath(
        targetPath,
        `${String(process.pid)}-${String(Date.now())}-${String(index)}`
      );
      const logFile = path.join(tempDir, `dump_${String(index)}.txt`);
      let exitCode: number;
      try {
        exitCode = await runDesignerAndPrintResult(
          connection,
          buildCfFileDesignerArgs({
            operation: 'dump',
            filePath: stagingPath,
            extensionName: planItem.extensionName,
            outLogFile: logFile,
          }),
          `Выгружено расширение "${planItem.extensionName}" (${String(index + 1)} из ${String(plan.items.length)})`,
          `Ошибка выгрузки расширения "${planItem.extensionName}"`,
          request.verbose ? undefined : logFile
        );
        if (request.verbose) {
          printLogFile(logFile);
        }
        if (exitCode === 0) {
          moveStagingToTarget(stagingPath, targetPath);
        }
      } finally {
        safeRemoveFile(stagingPath);
      }

      if (exitCode === 0) {
        const sizeBytes = fileSizeOrUndefined(targetPath);
        items.push({ extensionName: planItem.extensionName, fileName: planItem.fileName, status: 'ok', ...(sizeBytes === undefined ? {} : { sizeBytes }) });
        manifestItems.push({ extensionName: planItem.extensionName, fileName: planItem.fileName, status: 'ok', ...(sizeBytes === undefined ? {} : { sizeBytes }) });
        continue;
      }
      failed = true;
      items.push({
        extensionName: planItem.extensionName,
        fileName: planItem.fileName,
        status: 'failed',
        message: `Конфигуратор завершился с кодом ${String(exitCode)}`,
      });
      manifestItems.push({ extensionName: planItem.extensionName, fileName: planItem.fileName, status: 'failed' });
    }
  } finally {
    interruption.dispose();
    safeRemoveDir(tempDir);
  }

  writeCfeManifest(request.outputDir, {
    version: 1,
    createdAt: new Date().toISOString(),
    items: manifestItems,
  });
  writeBatchReport(resultFile, {
    version: 1,
    operation: 'dump',
    interrupted: interruption.interrupted,
    items,
  });

  if (interruption.interrupted) {
    return BATCH_EXIT_INTERRUPTED;
  }
  return failed ? BATCH_EXIT_FAILED : BATCH_EXIT_OK;
}

/**
 * Убирает staging-остатки ПРОШЛЫХ прогонов.
 *
 * Свой остаток каждая итерация убирает сама, но при SIGKILL (отмена операции из
 * UI добивает CLI через 5 секунд после SIGTERM, а `/DumpCfg` большого расширения
 * в них не укладывается) `finally` не отрабатывает. Такой файл не конфликтует с
 * планом выгрузки и не исчезает сам — единственная точка уборки — старт
 * следующего прогона. Трогаются ТОЛЬКО файлы нашего формата имени
 * (`isDumpStagingFileName`), посторонние — никогда.
 */
function removeStagingLeftovers(outputDir: string): void {
  const leftovers = readDirectoryFileNames(outputDir).filter(isDumpStagingFileName);
  for (const fileName of leftovers) {
    safeRemoveFile(path.join(outputDir, fileName));
  }
  if (leftovers.length > 0) {
    console.log(`Убраны остатки прерванной выгрузки: ${leftovers.join(', ')}`);
  }
}

/** Отказ ДО первого спавна: манифест не трогается, отчёт пишется с причиной. */
function failBeforeStart(resultFile: string, error: string): number {
  console.error(error);
  const report: CfeBatchReport = { version: 1, operation: 'dump', interrupted: false, items: [], errors: [error] };
  writeBatchReport(resultFile, report);
  return BATCH_EXIT_FAILED;
}
/* c8 ignore stop */
