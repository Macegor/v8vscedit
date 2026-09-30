/**
 * Предполётные решения пакетных операций: проверка каталога выгрузки и план
 * загрузки.
 *
 * Оба решения принимаются ДО первого спавна Конфигуратора и до первого
 * изменения базы: `/LoadCfg` необратим, а неудачная загрузка НОВОГО расширения
 * всё равно регистрирует его в базе (замерено на 8.3.27.1989). Поэтому всё, что
 * можно отвергнуть заранее (расширение есть в каталоге, но нет в базе; манифест
 * обещает файл, которого нет), отвергается здесь, а не выясняется на середине
 * прогона.
 *
 * Сопоставление «файл ↔ имя расширения» — жёсткий приоритет: манифест, иначе
 * имя файла без `.cfe` (с пометкой `manifestMissing`). Содержимое `.cfe` не
 * парсится никогда.
 */
import * as fs from 'fs';
import { compareExtensionNames } from './CfeBatchNaming';
import { CFE_MANIFEST_FILE_NAME, type CfeManifest, type CfeManifestItem } from './CfeBatchManifest';

/** Запись файла первого уровня каталога: имя и размер (пустой `.cfe` не грузится). */
export interface CfeDirectoryEntry {
  readonly name: string;
  readonly sizeBytes: number;
}

export interface CfeLoadPlanItem {
  readonly extensionName: string;
  readonly fileName: string;
  /** Имя расширения восстановлено из имени файла, а не из манифеста. */
  readonly manifestMissing: boolean;
}

export interface CfeLoadPlan {
  readonly items: CfeLoadPlanItem[];
  /** Есть в каталоге, нет в базе (справочный список; ошибкой становится без `createMissing`). */
  readonly missingInDb: string[];
  /** Есть в базе, нет файла в каталоге — не трогается, ошибкой не считается. */
  readonly notInDirectory: string[];
  /** Файлы каталога, не взятые в работу. */
  readonly ignoredFiles: string[];
  /** Причины отказа до старта: непустой список означает «не запускать ничего». */
  readonly errors: string[];
}

export interface CfeLoadPlanOptions {
  /** Разрешено загружать расширение, которого в базе ещё нет (`/LoadCfg` его создаст). */
  readonly createMissing: boolean;
}

/** Каталог существует и это именно каталог; иначе — текст ошибки с путём. */
export function validateCfeDirectory(directoryPath: string, role: 'dump' | 'load'): string | undefined {
  const roleText = role === 'dump' ? 'выгрузки' : 'загрузки';
  let stats: fs.Stats;
  try {
    stats = fs.statSync(directoryPath);
  } catch {
    return `Каталог ${roleText} не существует: ${directoryPath}`;
  }
  if (!stats.isDirectory()) {
    return `Указанный путь ${roleText} не является каталогом: ${directoryPath}`;
  }
  return undefined;
}

/**
 * Предполётная проверка каталога выгрузки. Возвращает текст ошибки или
 * `undefined`.
 *
 * Посторонние файлы каталога не проверяются и не трогаются никогда: каталог
 * может быть обычной папкой пользователя, семантики зеркалирования нет.
 * Каталог на месте будущего файла отвергается и с `overwrite`: переименовать
 * staging-файл поверх каталога невозможно, и отказ вскрылся бы уже после
 * выгрузки — то есть после минут работы платформы.
 */
export function validateCfeDumpDirectory(
  directoryPath: string,
  plannedFileNames: readonly string[],
  overwrite: boolean
): string | undefined {
  const directoryError = validateCfeDirectory(directoryPath, 'dump');
  if (directoryError) {
    return directoryError;
  }

  const existing = new Map<string, fs.Dirent>();
  for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
    existing.set(entry.name.toLowerCase(), entry);
  }

  const directoryTargets: string[] = [];
  const occupied: string[] = [];
  for (const fileName of plannedFileNames) {
    const entry = existing.get(fileName.toLowerCase());
    if (!entry) {
      continue;
    }
    if (entry.isDirectory()) {
      directoryTargets.push(fileName);
      continue;
    }
    occupied.push(fileName);
  }

  if (directoryTargets.length > 0) {
    return `В каталоге выгрузки есть подкаталоги с именами будущих файлов: ${directoryTargets.join(', ')}. Освободите имена или выберите другой каталог.`;
  }
  if (!overwrite && occupied.length > 0) {
    return `В каталоге выгрузки уже есть файлы с именами из плана: ${occupied.join(', ')}. Разрешите перезапись, чтобы заменить их.`;
  }
  return undefined;
}

/**
 * План загрузки по содержимому каталога, манифесту и списку расширений базы.
 *
 * Пустые `.cfe` и файлы, помеченные в манифесте как неудачные, в план не
 * берутся: неудачная выгрузка оставляет прежний одноимённый файл нетронутым, он
 * старше остальных бэкапов набора, и загрузка его вместе с новыми смешала бы
 * поколения.
 */
export function planCfeLoad(
  entries: readonly CfeDirectoryEntry[],
  manifest: CfeManifest | undefined,
  dbNames: readonly string[],
  options: CfeLoadPlanOptions
): CfeLoadPlan {
  const manifestByFile = new Map<string, CfeManifestItem>(
    (manifest?.items ?? []).map((item) => [item.fileName.toLowerCase(), item])
  );

  const items: CfeLoadPlanItem[] = [];
  const ignoredFiles: string[] = [];
  const presentFiles = new Set<string>();

  for (const entry of entries) {
    presentFiles.add(entry.name.toLowerCase());
    if (entry.name.toLowerCase() === CFE_MANIFEST_FILE_NAME.toLowerCase()) {
      // Сам манифест — служебный файл каталога, а не «посторонний»: в отчёт о
      // проигнорированных он попадать не должен.
      continue;
    }
    if (!/\.cfe$/i.test(entry.name) || entry.sizeBytes === 0) {
      ignoredFiles.push(entry.name);
      continue;
    }
    const manifestItem = manifestByFile.get(entry.name.toLowerCase());
    if (manifestItem?.status === 'failed') {
      ignoredFiles.push(entry.name);
      continue;
    }
    items.push({
      extensionName: manifestItem?.extensionName ?? entry.name.slice(0, entry.name.length - '.cfe'.length),
      fileName: entry.name,
      manifestMissing: manifestItem === undefined,
    });
  }

  items.sort((left, right) => compareExtensionNames(left.extensionName, right.extensionName));
  ignoredFiles.sort(compareExtensionNames);

  const plannedNames = new Set(items.map((item) => item.extensionName));
  const dbNameSet = new Set(dbNames);
  const missingInDb = items
    .map((item) => item.extensionName)
    .filter((name) => !dbNameSet.has(name))
    .sort(compareExtensionNames);
  const notInDirectory = [...dbNames].filter((name) => !plannedNames.has(name)).sort(compareExtensionNames);

  const errors: string[] = [];
  const brokenManifestFiles = (manifest?.items ?? [])
    .filter((item) => item.status === 'ok' && !presentFiles.has(item.fileName.toLowerCase()))
    .map((item) => item.fileName);
  if (brokenManifestFiles.length > 0) {
    // Манифест обещает бэкап, которого нет: молча загрузить остальное значило
    // бы получить в базе набор расширений без части состава.
    errors.push(`Манифест ${CFE_MANIFEST_FILE_NAME} ссылается на отсутствующие файлы: ${brokenManifestFiles.join(', ')}.`);
  }
  if (!options.createMissing && missingInDb.length > 0) {
    errors.push(`В базе нет расширений: ${missingInDb.join(', ')}. Разрешите создание отсутствующих расширений или уберите их файлы из каталога.`);
  }

  return { items, missingInDb, notInDirectory, ignoredFiles, errors };
}
