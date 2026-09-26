/**
 * Тонкая обёртка запуска внутреннего CLI для выгрузки/загрузки CF/CFE.
 *
 * Своей логики процесса не содержит: подключение к базе и запуск CLI берутся
 * из уже существующего `ExtensionCommandRunner` (тот же путь, что у импорта/
 * обновления конфигураций), валидация — из `infra/cfFile` (те же guard'ы и те
 * же тексты ошибок, что в CLI и MCP).
 *
 * Валидация выполняется ПЕРВОЙ — раньше обращения к рабочей папке и настройкам
 * подключения: платформа при сбое всё равно оставляет побочные эффекты
 * (создаёт файл-мусор при выгрузке, создаёт расширение в базе при загрузке),
 * поэтому операцию нужно останавливать до любых приготовлений.
 */
import type * as vscode from 'vscode';
import * as path from 'path';
import { validateCfFileRequest } from '../../../infra/cfFile';
import {
  buildConnectionCliArgs,
  resolveConnectionFromSettings,
  resolveSettingsPath,
  runInternalCliCommand,
} from './ExtensionCommandRunner';

interface CfFileRunnerContext {
  readonly workspaceFolder: vscode.WorkspaceFolder;
  readonly outputChannel: vscode.OutputChannel;
  /** Имя расширения; пустое значение означает основную конфигурацию. */
  readonly extensionName?: string;
  /** MCP-вызовы подавляют popup-уведомления: результат возвращается вызывающему агенту. */
  readonly silent?: boolean;
}

export interface DumpCfFileOptions extends CfFileRunnerContext {
  readonly outputFile: string;
  readonly overwrite?: boolean;
}

export interface LoadCfFileOptions extends CfFileRunnerContext {
  readonly inputFile: string;
}

/** Выгружает конфигурацию/расширение базы в бинарный файл через CLI `dump-cf`. */
export async function runDumpConfigurationToCf(options: DumpCfFileOptions): Promise<boolean> {
  const extensionName = (options.extensionName ?? '').trim();
  const isExtension = extensionName.length > 0;
  const overwrite = options.overwrite === true;
  validateCfFileRequest({ operation: 'dump', filePath: options.outputFile, isExtension, overwrite });

  const cliArgs = [
    'dump-cf',
    '-OutputFile',
    options.outputFile,
    ...(isExtension ? ['-Extension', extensionName] : []),
    ...(overwrite ? ['-Overwrite'] : []),
    ...await resolveConnectionArgs(options.workspaceFolder),
  ];

  const targetLabel = isExtension ? `расширения "${extensionName}"` : 'основной конфигурации';
  return runInternalCliCommand(
    {
      cliArgs,
      progressTitle: 'Выгрузка в файл',
      progressStartMessage: `Выгрузка ${targetLabel} в файл...`,
      successMessage: `Выгрузка завершена: ${options.outputFile}`,
      errorTitle: 'Не удалось выгрузить конфигурацию в файл.',
      failureOperation: 'выгрузке конфигурации в файл',
      logPrefix: 'dump-cf',
      showSuccessMessage: options.silent !== true,
      showErrorMessage: options.silent !== true,
    },
    options.workspaceFolder,
    options.outputChannel
  );
}

/**
 * Загружает конфигурацию/расширение из бинарного файла через CLI `load-cf`.
 * Конфигурацию БАЗЫ не обновляет: `/LoadCfg` меняет только основную
 * конфигурацию (замерено на 8.3.27.1989), применение — отдельный шаг.
 */
export async function runLoadConfigurationFromCf(options: LoadCfFileOptions): Promise<boolean> {
  const extensionName = (options.extensionName ?? '').trim();
  const isExtension = extensionName.length > 0;
  validateCfFileRequest({ operation: 'load', filePath: options.inputFile, isExtension });

  const cliArgs = [
    'load-cf',
    '-InputFile',
    options.inputFile,
    ...(isExtension ? ['-Extension', extensionName] : []),
    ...await resolveConnectionArgs(options.workspaceFolder),
  ];

  const targetLabel = isExtension ? `расширения "${extensionName}"` : 'основной конфигурации';
  return runInternalCliCommand(
    {
      cliArgs,
      progressTitle: 'Загрузка из файла',
      progressStartMessage: `Загрузка ${targetLabel} из файла...`,
      successMessage: 'Загрузка завершена. Конфигурация базы ещё НЕ обновлена — выполните применение к базе.',
      errorTitle: 'Не удалось загрузить конфигурацию из файла. Часть изменений могла быть применена — проверьте состояние базы.',
      failureOperation: 'загрузке конфигурации из файла',
      logPrefix: 'load-cf',
      showSuccessMessage: options.silent !== true,
      showErrorMessage: options.silent !== true,
    },
    options.workspaceFolder,
    options.outputChannel
  );
}

/** Параметры подключения к базе проекта — тем же путём, что `listConnectedDatabaseExtensions`. */
async function resolveConnectionArgs(workspaceFolder: vscode.WorkspaceFolder): Promise<string[]> {
  const workspaceRoot = workspaceFolder.uri.fsPath;
  const settingsPath = resolveSettingsPath(workspaceRoot, path.join(workspaceRoot, 'src', 'cfe', '_probe'));
  return buildConnectionCliArgs(await resolveConnectionFromSettings(settingsPath));
}
