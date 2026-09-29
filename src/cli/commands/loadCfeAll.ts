import * as path from 'path';
import { getBool, getString } from '../core/args';
import { resolveConnection } from '../core/connection';
import { createTempDir, printLogFile, runDesignerAndPrintResult, safeRemoveDir } from '../core/onecCommon';
import type { CliArgs } from '../core/types';
import {
  assertNoAllExtensionsFlag,
  buildCfFileDesignerArgs,
  planCfeLoad,
  readCfeManifest,
  type CfeBatchReport,
  type CfeBatchReportItem,
  type CfeLoadPlan,
} from '../../infra/cfFile';
import {
  BATCH_EXIT_FAILED,
  BATCH_EXIT_INTERRUPTED,
  BATCH_EXIT_OK,
  installInterruptionFlag,
  parseBatchDirectoryArg,
  readCfeDirectoryEntries,
  resolveExtensionNames,
  writeBatchReport,
} from './cfeBatchShared';

export interface LoadCfeAllRequest {
  readonly inputDir: string;
  /** Разрешает загружать расширение, которого в базе ещё нет (`/LoadCfg` его создаст). */
  readonly createMissing: boolean;
  readonly verbose: boolean;
}

/** Разбирает и ПОЛНОСТЬЮ валидирует аргументы `load-cfe-all` (до `resolveConnection`). */
export function parseLoadCfeAllArgs(args: CliArgs): LoadCfeAllRequest {
  // У `/LoadCfg` ключа `-AllExtensions` не существует: платформа принимает его
  // молча и работает с ОСНОВНОЙ конфигурацией.
  assertNoAllExtensionsFlag(getBool(args, 'AllExtensions'), 'load');

  return {
    inputDir: parseBatchDirectoryArg(args, 'InputDir', 'load'),
    createMissing: getBool(args, 'CreateMissing'),
    verbose: getBool(args, 'Verbose'),
  };
}

/**
 * Загружает в базу ВСЕ расширения из каталога `.cfe`-файлов.
 *
 * Политика отказа — ОСТАНОВИТЬСЯ на первом: каждый `/LoadCfg` необратимо меняет
 * базу, и остановка даёт точную границу «1..6 загружены, 7 — сбой, 8..15 не
 * трогались». Сбойный элемент попадает в `failedAt` отдельной категорией:
 * замерено, что неудачная загрузка нового расширения всё равно регистрирует его
 * в базе, поэтому его состояние НЕОПРЕДЕЛЕНО, а не «не загружено».
 *
 * `/UpdateDBCfg` здесь не выполняется никогда: вектор применения к базе живёт в
 * `update-configuration`, второй его экземпляр был бы дублированием источника
 * правды. Применение делает вызывающий, по расширению на вызов.
 */
export async function loadCfeAll(args: CliArgs): Promise<number> {
  const request = parseLoadCfeAllArgs(args);
  const connection = resolveConnection(args);
  const resultFile = getString(args, 'ResultFile', '').trim();

  /* c8 ignore start -- ниже только оркестрация спавна реального Конфигуратора 1С; в CI без платформы не исполнимо и в процессе Extension Host не инструментируется (CLI — дочерний node-процесс). Цикл целиком проверяется на POSIX-заглушке Конфигуратора в cfeBatchCliRun.test.ts, решения — в infra/cfFile/CfeBatchPlan. Тот же паттерн, что в loadCfFile.ts. */
  const dbNames = await resolveExtensionNames(connection);
  if (!dbNames) {
    return failBeforeStart(resultFile, undefined, 'Не удалось получить список расширений базы.');
  }

  const plan = planCfeLoad(
    readCfeDirectoryEntries(request.inputDir),
    readCfeManifest(request.inputDir),
    dbNames,
    { createMissing: request.createMissing }
  );
  const restoredByFileName = plan.items.filter((item) => item.manifestMissing).map((item) => item.fileName);
  if (restoredByFileName.length > 0) {
    // Манифест не покрывает эти файлы: их имена расширений угаданы из имён
    // файлов. Такое бывает у каталога, собранного вручную, и у каталога с
    // остатками прерванной выгрузки (манифест описывает только её успевшую
    // часть) — то есть ровно там, где в базу может уехать чужое поколение.
    console.log(`Имя расширения восстановлено по имени файла (манифест их не описывает): ${restoredByFileName.join(', ')}`);
  }
  if (plan.errors.length > 0) {
    // Отказ до старта обязан останавливать ВСЁ, включая расширения, с которыми
    // проблем нет: частично загруженный набор — это база в состоянии, которого
    // не было ни до, ни после.
    return failBeforeStart(resultFile, plan, ...plan.errors);
  }

  const items: CfeBatchReportItem[] = [];
  const interruption = installInterruptionFlag();
  const tempDir = createTempDir('db_load_cfe_all_');
  let failedAt: CfeBatchReport['failedAt'];
  try {
    for (let index = 0; index < plan.items.length; index += 1) {
      const planItem = plan.items[index];
      if (interruption.interrupted || failedAt) {
        items.push({ extensionName: planItem.extensionName, fileName: planItem.fileName, status: 'notAttempted' });
        continue;
      }

      const logFile = path.join(tempDir, `load_${String(index)}.txt`);
      const exitCode = await runDesignerAndPrintResult(
        connection,
        buildCfFileDesignerArgs({
          operation: 'load',
          filePath: path.join(request.inputDir, planItem.fileName),
          extensionName: planItem.extensionName,
          outLogFile: logFile,
        }),
        `Загружено расширение "${planItem.extensionName}" (${String(index + 1)} из ${String(plan.items.length)})`,
        `Ошибка загрузки расширения "${planItem.extensionName}"`,
        request.verbose ? undefined : logFile
      );
      if (request.verbose) {
        printLogFile(logFile);
      }

      if (exitCode === 0) {
        items.push({ extensionName: planItem.extensionName, fileName: planItem.fileName, status: 'ok' });
        continue;
      }
      failedAt = { extensionName: planItem.extensionName, fileName: planItem.fileName, stateUncertain: true };
      items.push({
        extensionName: planItem.extensionName,
        fileName: planItem.fileName,
        status: 'failed',
        message: `Конфигуратор завершился с кодом ${String(exitCode)}; состояние расширения в базе неопределённо`,
      });
    }
  } finally {
    interruption.dispose();
    safeRemoveDir(tempDir);
  }

  writeBatchReport(resultFile, {
    version: 1,
    operation: 'load',
    interrupted: interruption.interrupted,
    items,
    ...(failedAt === undefined ? {} : { failedAt }),
    missingInDb: plan.missingInDb,
    notInDirectory: plan.notInDirectory,
    ignoredFiles: plan.ignoredFiles,
    restoredByFileName,
  });

  if (failedAt) {
    return BATCH_EXIT_FAILED;
  }
  return interruption.interrupted ? BATCH_EXIT_INTERRUPTED : BATCH_EXIT_OK;
}

/** Отказ ДО первого `/LoadCfg`: база не тронута, отчёт объясняет причину. */
function failBeforeStart(resultFile: string, plan: CfeLoadPlan | undefined, ...errors: string[]): number {
  for (const error of errors) {
    console.error(error);
  }
  writeBatchReport(resultFile, {
    version: 1,
    operation: 'load',
    interrupted: false,
    items: [],
    missingInDb: plan?.missingInDb ?? [],
    notInDirectory: plan?.notInDirectory ?? [],
    ignoredFiles: plan?.ignoredFiles ?? [],
    restoredByFileName: (plan?.items ?? []).filter((item) => item.manifestMissing).map((item) => item.fileName),
    errors,
  });
  return BATCH_EXIT_FAILED;
}
/* c8 ignore stop */
