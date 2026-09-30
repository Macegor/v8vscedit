/**
 * Общая часть пакетных команд `dump-cfe-all`/`load-cfe-all`.
 *
 * Здесь живёт только то, что одинаково у обеих: разбор общих аргументов,
 * получение списка расширений базы, запись отчёта, флаг прерывания и работа со
 * staging-файлом. Вся принимающая решения логика — в `infra/cfFile/CfeBatch*`
 * (чистые функции, покрытые тестами), здесь — оркестрация спавна.
 *
 * Почему цикл вообще в CLI, а не в UI: один запуск node вместо N (иначе N раз
 * читается `env.json`, N раз резолвится платформа, N окон видимости пароля в
 * `ps`), прогресс идёт штатным `onStdout`, а весь цикл целиком проверяется на
 * заглушке Конфигуратора с точной сверкой вектора каждой итерации.
 */
import * as fs from 'fs';
import * as path from 'path';
import { getString } from '../core/args';
import type { CliArgs, OnecConnection } from '../core/types';
import {
  serializeCfeBatchReport,
  validateCfeDirectory,
  type CfeBatchReport,
  type CfeDirectoryEntry,
} from '../../infra/cfFile';
import { queryDbExtensionList } from './listDbExtensions';

/** Код возврата пакетной команды: 0 — успех, 1 — отказ, 2 — прервано сигналом. */
export const BATCH_EXIT_OK = 0;
export const BATCH_EXIT_FAILED = 1;
export const BATCH_EXIT_INTERRUPTED = 2;

/** Разбирает и проверяет путь каталога (`-OutputDir`/`-InputDir`). */
export function parseBatchDirectoryArg(args: CliArgs, key: string, role: 'dump' | 'load'): string {
  const raw = getString(args, key, '').trim();
  if (!raw) {
    throw new Error(`Error: -${key} is required`);
  }
  const directoryPath = path.resolve(raw);
  const error = validateCfeDirectory(directoryPath, role);
  if (error) {
    throw new Error(error);
  }
  return directoryPath;
}

/* c8 ignore start -- ниже только оркестрация спавна реального Конфигуратора 1С и работа с временными файлами прогона: в CI без установленной платформы не исполнимо и в процессе Extension Host не инструментируется (CLI запускается дочерним node-процессом). Поведение цикла целиком проверяется на POSIX-заглушке Конфигуратора в cfeBatchCliRun.test.ts. Тот же паттерн, что в dumpCfFile.ts и listDbExtensions.ts. */

/**
 * Имена расширений базы для прогона — единственный источник списка
 * (`/DumpDBCfgList -AllExtensions`: у ЭТОЙ команды ключ штатный и обязательный,
 * в отличие от `/DumpCfg`/`/LoadCfg`, где его не существует). `undefined` —
 * запрос списка не удался.
 */
export async function resolveExtensionNames(connection: OnecConnection): Promise<string[] | undefined> {
  const result = await queryDbExtensionList(connection);
  return result.exitCode === 0 ? result.names : undefined;
}

/** Записывает отчёт прогона. Отсутствие `-ResultFile` — не ошибка (CLI можно звать руками). */
export function writeBatchReport(resultFile: string, report: CfeBatchReport): void {
  if (!resultFile) {
    return;
  }
  try {
    fs.writeFileSync(resultFile, serializeCfeBatchReport(report), 'utf-8');
  } catch (error) {
    // Отчёт — канал диагностики; невозможность его записать не должна подменять
    // собой настоящую причину сбоя операции.
    console.error(`Не удалось записать отчёт ${resultFile}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export interface InterruptionFlag {
  readonly interrupted: boolean;
  dispose(): void;
}

/**
 * Флаг прерывания по SIGTERM/SIGINT.
 *
 * Обработчик подменяет поведение по умолчанию (немедленная смерть процесса):
 * прогон обязан остановиться МЕЖДУ итерациями, а не посреди `/LoadCfg`, иначе
 * база останется в состоянии, о котором мы ничего не сможем сказать. Текущая
 * итерация досматривается до конца, отчёт и манифест пишутся, код возврата — 2.
 */
export function installInterruptionFlag(): InterruptionFlag {
  let interrupted = false;
  const onSignal = (): void => {
    interrupted = true;
    console.log('Получен сигнал остановки: прогон будет прерван после текущего элемента.');
  };
  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);
  return {
    get interrupted(): boolean {
      return interrupted;
    },
    dispose(): void {
      process.off('SIGTERM', onSignal);
      process.off('SIGINT', onSignal);
    },
  };
}

/** Записи файлов первого уровня каталога (имя + размер) для `planCfeLoad`. */
export function readCfeDirectoryEntries(directoryPath: string): CfeDirectoryEntry[] {
  return fs.readdirSync(directoryPath, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => ({ name: entry.name, sizeBytes: fs.statSync(path.join(directoryPath, entry.name)).size }));
}

/** Имена файлов первого уровня каталога; недоступный каталог — пустой список. */
export function readDirectoryFileNames(directoryPath: string): string[] {
  try {
    return fs.readdirSync(directoryPath, { withFileTypes: true })
      .filter((entry) => !entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/** Размер готового файла; недоступный файл — `undefined` (в отчёте поле просто отсутствует). */
export function fileSizeOrUndefined(filePath: string): number | undefined {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return undefined;
  }
}
/* c8 ignore stop */
