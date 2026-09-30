/**
 * Отчёт прогона пакетной выгрузки/загрузки расширений.
 *
 * Канал «CLI → UI/MCP»: результат передаётся файлом (`-ResultFile`), а не
 * marker-блоком в stdout — построчный декодер вывода портит произвольный текст
 * (см. паттерн file-handoff в docs/architecture.md).
 *
 * Читающая сторона обязана пережить ЛЮБОЙ файл: CLI мог быть убит на середине
 * записи, файла могло не быть вовсе. Поэтому `parseCfeBatchReport` возвращает
 * `undefined`, а не бросает: исключение при чтении отчёта затёрло бы настоящую
 * причину сбоя операции.
 *
 * `failedAt` — ОТДЕЛЬНАЯ категория, а не просто элемент со статусом `failed`:
 * замерено на 8.3.27.1989, что неудачная загрузка нового расширения всё равно
 * регистрирует его в базе, поэтому состояние именно этого элемента
 * неопределённо, а не «не загружено».
 */
import { asRecord, parseJsonObject, parseNamedFileEntry } from './CfeBatchManifest';

const REPORT_VERSION = 1;

export type CfeBatchOperation = 'dump' | 'load';

/**
 * `notAttempted` — элемент, до которого прогон не дошёл (остановка загрузки на
 * первом отказе или прерывание сигналом). Отличать его от `failed` обязательно:
 * «не пробовали» и «пробовали и не вышло» требуют разных действий.
 */
export type CfeBatchItemStatus = 'ok' | 'failed' | 'notAttempted';

const ITEM_STATUSES: readonly string[] = ['ok', 'failed', 'notAttempted'];

export interface CfeBatchReportItem {
  readonly extensionName: string;
  readonly fileName: string;
  readonly status: CfeBatchItemStatus;
  readonly sizeBytes?: number;
  readonly message?: string;
}

export interface CfeBatchFailedAt {
  readonly extensionName: string;
  readonly fileName: string;
  /** Состояние этого расширения в базе неопределённо — см. заголовок модуля. */
  readonly stateUncertain: true;
}

export interface CfeBatchReport {
  readonly version: typeof REPORT_VERSION;
  readonly operation: CfeBatchOperation;
  /** Прогон остановлен сигналом между итерациями. */
  readonly interrupted: boolean;
  readonly items: CfeBatchReportItem[];
  readonly failedAt?: CfeBatchFailedAt;
  /** Есть в каталоге, нет в базе. */
  readonly missingInDb?: string[];
  /** Есть в базе, нет файла в каталоге. */
  readonly notInDirectory?: string[];
  /** Файлы каталога, не взятые в работу (не `.cfe`, пустые, отказ прошлой выгрузки). */
  readonly ignoredFiles?: string[];
  /**
   * Файлы, имя расширения для которых восстановлено ПО ИМЕНИ ФАЙЛА, а не по
   * манифесту: `A_B.cfe` — это и `A:B`, и `A/B`, и «A_B». Каталог с такими
   * файлами мог быть собран вручную или остаться от прерванной выгрузки, чей
   * манифест описывает лишь успевшую часть, — то есть это единственный сигнал
   * «в базу может уехать чужое поколение», и молчать о нём нельзя.
   */
  readonly restoredByFileName?: string[];
  /** Причины отказа ДО старта: ни одного спавна Конфигуратора не было. */
  readonly errors?: string[];
}

export function serializeCfeBatchReport(report: CfeBatchReport): string {
  return JSON.stringify(
    {
      version: REPORT_VERSION,
      operation: report.operation,
      interrupted: report.interrupted,
      items: report.items.map((item) => ({
        extensionName: item.extensionName,
        fileName: item.fileName,
        status: item.status,
        ...(item.sizeBytes === undefined ? {} : { sizeBytes: item.sizeBytes }),
        ...(item.message === undefined ? {} : { message: item.message }),
      })),
      ...(report.failedAt === undefined ? {} : { failedAt: report.failedAt }),
      ...presentOptionalLists(report),
    },
    null,
    2
  );
}

/** Разбор отчёта. Любая проблема — `undefined`, исключений наружу нет. */
export function parseCfeBatchReport(text: string): CfeBatchReport | undefined {
  const root = parseJsonObject(text);
  if (!root) {
    return undefined;
  }
  if (root.version !== REPORT_VERSION) {
    return undefined;
  }
  if (root.operation !== 'dump' && root.operation !== 'load') {
    return undefined;
  }
  if (typeof root.interrupted !== 'boolean' || !Array.isArray(root.items)) {
    return undefined;
  }

  const items: CfeBatchReportItem[] = [];
  for (const raw of root.items) {
    const item = parseReportItem(raw);
    if (!item) {
      return undefined;
    }
    items.push(item);
  }

  const failedAt = parseFailedAt(root.failedAt);
  return {
    version: REPORT_VERSION,
    operation: root.operation,
    interrupted: root.interrupted,
    items,
    ...(failedAt === undefined ? {} : { failedAt }),
    ...parseOptionalLists(root),
  };
}

/**
 * Элемент отчёта. Пара «расширение ↔ файл» и размер разбираются ТОЙ ЖЕ
 * функцией, что и элемент манифеста: разошедшиеся проверки означали бы, что
 * отчёт принимает то, что манифест считает мусором.
 *
 * `message` — диагностический текст; из-за его формы терять весь отчёт незачем,
 * поэтому нестроковое значение просто не берётся.
 */
function parseReportItem(raw: unknown): CfeBatchReportItem | undefined {
  const item = asRecord(raw);
  if (!item) {
    return undefined;
  }
  const entry = parseNamedFileEntry(item);
  if (!entry) {
    return undefined;
  }
  if (typeof item.status !== 'string' || !ITEM_STATUSES.includes(item.status)) {
    return undefined;
  }
  return {
    ...entry,
    status: item.status as CfeBatchItemStatus,
    ...(typeof item.message === 'string' ? { message: item.message } : {}),
  };
}

/**
 * Испорченный `failedAt` читается как «его нет»: поле справочное, а сам факт
 * неуспеха вызывающий видит по коду возврата CLI и статусам элементов.
 */
function parseFailedAt(raw: unknown): CfeBatchFailedAt | undefined {
  const value = asRecord(raw);
  const entry = value?.stateUncertain === true ? parseNamedFileEntry(value) : undefined;
  return entry === undefined
    ? undefined
    : { extensionName: entry.extensionName, fileName: entry.fileName, stateUncertain: true };
}

/**
 * Необязательные списки строк отчёта. Перечислены ОДНИМ списком ключей, который
 * читают и запись, и разбор: разъехавшиеся перечни означали бы поле, которое
 * пишется и теряется при чтении.
 */
const OPTIONAL_LIST_KEYS = ['missingInDb', 'notInDirectory', 'ignoredFiles', 'restoredByFileName', 'errors'] as const;

type OptionalListKey = typeof OPTIONAL_LIST_KEYS[number];

type OptionalReportLists = Pick<CfeBatchReport, OptionalListKey>;

/** Тот же набор ключей, но записываемый — общая «черновая» форма для записи и разбора. */
type MutableOptionalLists = Partial<Record<OptionalListKey, string[]>>;

/** Только реально заданные списки: отсутствующий ключ в объект не попадает. */
function presentOptionalLists(report: CfeBatchReport): OptionalReportLists {
  const result: MutableOptionalLists = {};
  for (const key of OPTIONAL_LIST_KEYS) {
    const value = report[key];
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Необязательные справочные списки строк. Отсутствующий (как и испорченный)
 * ключ в результат не попадает вовсе — иначе round-trip добавлял бы ключи со
 * значением `undefined`, а испорченный список не стоит того, чтобы из-за него
 * терять список сбойных расширений.
 */
function parseOptionalLists(root: Record<string, unknown>): OptionalReportLists {
  const result: MutableOptionalLists = {};
  for (const key of OPTIONAL_LIST_KEYS) {
    const value = root[key];
    if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
      result[key] = value;
    }
  }
  return result;
}
