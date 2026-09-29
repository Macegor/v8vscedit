/**
 * Тонкая обёртка запуска внутреннего CLI для пакетной выгрузки/загрузки ВСЕХ
 * расширений базы (`dump-cfe-all`/`load-cfe-all`).
 *
 * Своей логики процесса не содержит: подключение к базе и запуск CLI берутся из
 * `ExtensionCommandRunner` (тот же путь, что у импорта/обновления и одиночного
 * CF-файла), решения — из `infra/cfFile` (те же функции, что в CLI и MCP).
 * Цикл по расширениям живёт в CLI: один запуск node вместо N, один резолвинг
 * платформы и одно окно видимости пароля в `ps`.
 *
 * Валидация каталога выполняется ПЕРВОЙ — раньше обращения к рабочей папке и
 * настройкам подключения: операцию, которую заведомо некуда писать или неоткуда
 * читать, нельзя начинать вовсе.
 *
 * Отчёт читается при ЛЮБОМ коде возврата CLI: при частичном отказе
 * `runInternalCliCommand` возвращает `false`, а весь смысл произошедшего
 * (сбойные расширения, `failedAt` с неопределённым состоянием базы) лежит
 * именно в отчёте.
 */
import type * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
  parseCfeBatchReport,
  validateCfeDirectory,
  type CfeBatchReport,
} from '../../../infra/cfFile';
import {
  buildConnectionCliArgs,
  createWorkspaceTempDir,
  removeTempDir,
  resolveConnectionFromSettings,
  resolveProjectSettingsPath,
  runInternalCliCommand,
} from './ExtensionCommandRunner';

interface CfeBatchRunnerContext {
  readonly workspaceFolder: vscode.WorkspaceFolder;
  readonly outputChannel: vscode.OutputChannel;
  /** MCP-вызовы подавляют popup-уведомления: результат возвращается вызывающему агенту. */
  readonly silent?: boolean;
}

export interface DumpAllExtensionsOptions extends CfeBatchRunnerContext {
  readonly outputDir: string;
  readonly overwrite?: boolean;
}

export interface LoadAllExtensionsOptions extends CfeBatchRunnerContext {
  readonly inputDir: string;
  readonly createMissing?: boolean;
}

export interface CfeBatchRunResult {
  readonly success: boolean;
  /** Отчёт прогона; `undefined` — CLI не дошёл даже до его записи. */
  readonly report: CfeBatchReport | undefined;
}

/** Выгружает все расширения базы в каталог через CLI `dump-cfe-all`. */
export async function runDumpAllExtensionsToCfe(options: DumpAllExtensionsOptions): Promise<CfeBatchRunResult> {
  // Здесь проверяется только сам каталог: конфликты имён считает CLI — план
  // имён файлов известен лишь после того, как база отдала список расширений.
  const validationError = validateCfeDirectory(options.outputDir, 'dump');
  if (validationError) {
    throw new Error(validationError);
  }

  return runBatchCli(options, (resultFile, connectionArgs) => [
    'dump-cfe-all',
    '-OutputDir',
    options.outputDir,
    ...(options.overwrite === true ? ['-Overwrite'] : []),
    '-ResultFile',
    resultFile,
    ...connectionArgs,
  ], {
    progressTitle: 'Выгрузка всех расширений в файлы',
    progressStartMessage: 'Выгрузка расширений базы в CFE-файлы...',
    successMessage: `Выгрузка расширений завершена: ${options.outputDir}`,
    errorTitle: 'Не удалось выгрузить расширения базы в файлы.',
    failureOperation: 'выгрузке расширений базы в файлы',
    logPrefix: 'dump-cfe-all',
  });
}

/** Загружает все расширения из каталога `.cfe` в базу через CLI `load-cfe-all`. */
export async function runLoadAllExtensionsFromCfe(options: LoadAllExtensionsOptions): Promise<CfeBatchRunResult> {
  const validationError = validateCfeDirectory(options.inputDir, 'load');
  if (validationError) {
    throw new Error(validationError);
  }

  return runBatchCli(options, (resultFile, connectionArgs) => [
    'load-cfe-all',
    '-InputDir',
    options.inputDir,
    ...(options.createMissing === true ? ['-CreateMissing'] : []),
    '-ResultFile',
    resultFile,
    ...connectionArgs,
  ], {
    progressTitle: 'Загрузка всех расширений из файлов',
    progressStartMessage: 'Загрузка расширений в базу из CFE-файлов...',
    successMessage: 'Загрузка расширений завершена. Конфигурация базы ещё НЕ обновлена — выполните применение к базе.',
    errorTitle: 'Не удалось загрузить расширения в базу. Часть расширений могла быть загружена — проверьте состояние базы.',
    failureOperation: 'загрузке расширений в базу',
    logPrefix: 'load-cfe-all',
  });
}

interface BatchRunMessages {
  readonly progressTitle: string;
  readonly progressStartMessage: string;
  readonly successMessage: string;
  readonly errorTitle: string;
  readonly failureOperation: string;
  readonly logPrefix: string;
}

/**
 * Общая часть обеих операций: файл отчёта во ВРЕМЕННОМ каталоге проекта (а не в
 * каталоге данных — там он стал бы посторонним файлом среди бэкапов), запуск
 * CLI, чтение отчёта при любом исходе и уборка временного каталога.
 */
async function runBatchCli(
  context: CfeBatchRunnerContext,
  buildArgs: (resultFile: string, connectionArgs: string[]) => string[],
  messages: BatchRunMessages
): Promise<CfeBatchRunResult> {
  const workspaceRoot = context.workspaceFolder.uri.fsPath;
  const connectionArgs = buildConnectionCliArgs(
    await resolveConnectionFromSettings(resolveProjectSettingsPath(workspaceRoot))
  );

  const tempRoot = createWorkspaceTempDir(workspaceRoot, 'cfe-batch-');
  const resultFile = path.join(tempRoot, 'cfe-batch-report.json');
  try {
    const success = await runInternalCliCommand(
      {
        cliArgs: buildArgs(resultFile, connectionArgs),
        progressTitle: messages.progressTitle,
        progressStartMessage: messages.progressStartMessage,
        successMessage: messages.successMessage,
        errorTitle: messages.errorTitle,
        failureOperation: messages.failureOperation,
        logPrefix: messages.logPrefix,
        showSuccessMessage: context.silent !== true,
        showErrorMessage: context.silent !== true,
      },
      context.workspaceFolder,
      context.outputChannel
    );
    return { success, report: readReport(resultFile) };
  } finally {
    removeTempDir(tempRoot, context.outputChannel);
  }
}

/** Отчёт прогона; недоступный или битый файл — `undefined`, а не исключение. */
function readReport(resultFile: string): CfeBatchReport | undefined {
  try {
    return parseCfeBatchReport(fs.readFileSync(resultFile, 'utf-8'));
  } catch {
    // CLI мог не дойти до записи отчёта (например, платформа не найдена) —
    // это штатный случай, настоящая причина уже в журнале.
    return undefined;
  }
}
