/**
 * Манифест каталога пакетной выгрузки расширений — `cfe-dump.json`.
 *
 * Единственный способ при загрузке восстановить исходное имя расширения по
 * имени файла: санитизация имени необратима (`A:B` и `A/B` дают один и тот же
 * `A_B.cfe`), а содержимое `.cfe` не парсится никогда — контейнер закрытый и в
 * проекте не измерен.
 *
 * Чтение намеренно «недоверчивое»: отсутствующий, обрезанный, чужой версии или
 * частично испорченный манифест означает «манифеста нет» (`undefined`), а не
 * исключение и не частично принятые данные — по частичному манифесту загрузка
 * положила бы бэкап одного расширения в другое.
 *
 * Запись — через `AtomicFileWriter` (единственная реализация temp+rename в
 * проекте): обрыв процесса не должен оставить обрезанный манифест, иначе
 * нечитаемым становится весь набор бэкапов, а не один файл.
 */
import * as fs from 'fs';
import * as path from 'path';
import { writeFileAtomic } from '../fs/AtomicFileWriter';

export const CFE_MANIFEST_FILE_NAME = 'cfe-dump.json';

/** Версия формата манифеста: чужую версию читать нельзя (поля могли сменить смысл). */
const MANIFEST_VERSION = 1;

export type CfeManifestItemStatus = 'ok' | 'failed';

export interface CfeManifestItem {
  /** Имя расширения в базе — как его вернул `/DumpDBCfgList`. */
  readonly extensionName: string;
  /** Имя файла внутри каталога (без пути). */
  readonly fileName: string;
  readonly status: CfeManifestItemStatus;
  /** Размер выгруженного файла; у неудачной выгрузки файла нет. */
  readonly sizeBytes?: number;
}

export interface CfeManifest {
  readonly version: typeof MANIFEST_VERSION;
  readonly createdAt: string;
  readonly items: CfeManifestItem[];
}

/** Текст манифеста. В нём НЕТ ни пароля, ни параметров подключения (запрет №9). */
export function serializeCfeManifest(manifest: CfeManifest): string {
  return JSON.stringify(
    {
      version: MANIFEST_VERSION,
      createdAt: manifest.createdAt,
      items: manifest.items.map((item) => ({
        extensionName: item.extensionName,
        fileName: item.fileName,
        status: item.status,
        ...(item.sizeBytes === undefined ? {} : { sizeBytes: item.sizeBytes }),
      })),
    },
    null,
    2
  );
}

/** Разбор манифеста. Любая проблема — `undefined`, исключений наружу нет. */
export function parseCfeManifest(text: string): CfeManifest | undefined {
  const root = parseJsonObject(text);
  if (!root) {
    return undefined;
  }
  if (root.version !== MANIFEST_VERSION || typeof root.createdAt !== 'string' || !Array.isArray(root.items)) {
    return undefined;
  }

  const items: CfeManifestItem[] = [];
  for (const raw of root.items) {
    const item = parseManifestItem(raw);
    if (!item) {
      return undefined;
    }
    items.push(item);
  }
  return { version: MANIFEST_VERSION, createdAt: root.createdAt, items };
}

/** Читает манифест из каталога. Нет файла/каталога, битый файл — `undefined`. */
export function readCfeManifest(directory: string): CfeManifest | undefined {
  let text: string;
  try {
    text = fs.readFileSync(path.join(directory, CFE_MANIFEST_FILE_NAME), 'utf-8');
  } catch {
    // Отсутствие манифеста — штатный случай (каталог собран вручную), а
    // EISDIR/EACCES для чтения значат ровно то же: доверенных данных нет.
    return undefined;
  }
  return parseCfeManifest(text);
}

/**
 * Пишет манифест в каталог. Каталог обязан существовать: создание каталога
 * здесь означало бы «выгрузка в незаданное место», поэтому ошибка громкая.
 */
export function writeCfeManifest(directory: string, manifest: CfeManifest): void {
  writeFileAtomic(path.join(directory, CFE_MANIFEST_FILE_NAME), serializeCfeManifest(manifest));
}

/** JSON-объект верхнего уровня или `undefined` (битый текст, массив, скаляр, null). */
export function parseJsonObject(text: string): Record<string, unknown> | undefined {
  // Редактор Windows дописывает BOM — для JSON.parse это синтаксическая ошибка,
  // хотя содержимое корректно.
  const withoutBom = text.startsWith('﻿') ? text.slice(1) : text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(withoutBom);
  } catch {
    return undefined;
  }
  return asRecord(parsed);
}

/**
 * Пара «имя расширения ↔ имя файла» с необязательным размером — общая часть
 * элемента манифеста и элемента отчёта (`CfeBatchReport`). Разбирается ОДНОЙ
 * функцией: расходящиеся копии проверки означали бы, что отчёт принимает то,
 * что манифест считает мусором.
 */
export interface CfeNamedFileEntry {
  readonly extensionName: string;
  readonly fileName: string;
  readonly sizeBytes?: number;
}

/** Объект (не массив, не null, не скаляр) или `undefined`. */
export function asRecord(raw: unknown): Record<string, unknown> | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  return raw as Record<string, unknown>;
}

/** Общая часть элемента манифеста/отчёта; любая проблема — `undefined`. */
export function parseNamedFileEntry(item: Record<string, unknown>): CfeNamedFileEntry | undefined {
  const extensionName = item.extensionName;
  const fileName = item.fileName;
  if (typeof extensionName !== 'string' || extensionName.length === 0) {
    return undefined;
  }
  // Имя файла склеивается с каталогом загрузки: разделитель пути в нём означал
  // бы чтение файла ЗА пределами каталога.
  if (typeof fileName !== 'string' || fileName.length === 0 || /[\\/]/.test(fileName)) {
    return undefined;
  }
  if (item.sizeBytes === undefined) {
    return { extensionName, fileName };
  }
  if (typeof item.sizeBytes !== 'number' || !Number.isFinite(item.sizeBytes) || item.sizeBytes < 0) {
    return undefined;
  }
  return { extensionName, fileName, sizeBytes: item.sizeBytes };
}

function parseManifestItem(raw: unknown): CfeManifestItem | undefined {
  const item = asRecord(raw);
  if (!item) {
    return undefined;
  }
  const entry = parseNamedFileEntry(item);
  if (!entry) {
    return undefined;
  }
  const status = item.status;
  if (status !== 'ok' && status !== 'failed') {
    return undefined;
  }
  return { ...entry, status };
}
