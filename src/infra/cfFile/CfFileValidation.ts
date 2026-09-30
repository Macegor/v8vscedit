/**
 * Guard-функции операций с бинарными CF/CFE-файлами.
 *
 * Единственная защита от порчи данных: платформа не диагностирует ни неверный
 * ключ, ни рассинхрон «расширение ↔ суффикс файла» кодом возврата, а при
 * ненулевом коде возврата всё равно оставляет побочные эффекты (проверено на
 * 8.3.27.1989: неудачная выгрузка оставляет 16-байтный файл-мусор, неудачная
 * загрузка с `-Extension` всё равно создаёт расширение в базе). Поэтому все
 * проверки выполняются ДО спавна процесса, а `validateCfFileRequest` —
 * единственная точка их композиции (один и тот же текст ошибки в CLI, UI и
 * MCP).
 */
import * as fs from 'fs';
import * as path from 'path';
import type { CfFileOperation } from './CfFileArgs';

export interface CfFileRequest {
  readonly operation: CfFileOperation;
  readonly filePath: string;
  /** Признак расширения; выводится вызывающим из `extensionName.trim().length > 0`. */
  readonly isExtension: boolean;
  /** Пришедший извне флаг `-AllExtensions`: поддерживается только для того, чтобы его отвергнуть. */
  readonly allExtensionsFlag?: boolean;
  /** Только для `dump`: разрешение перезаписать существующий целевой файл. */
  readonly overwrite?: boolean;
}

/** Ожидаемый суффикс файла: `.cfe` для расширения, `.cf` для основной конфигурации. */
export function expectedCfFileSuffix(isExtension: boolean): '.cfe' | '.cf' {
  return isExtension ? '.cfe' : '.cf';
}

/** Проверяет суффикс файла (регистронезависимо). Возвращает текст ошибки или `undefined`. */
export function validateCfFileSuffix(filePath: string, isExtension: boolean): string | undefined {
  const expected = expectedCfFileSuffix(isExtension);
  const actual = path.extname(filePath).toLowerCase();
  if (actual === expected) {
    return undefined;
  }
  const target = isExtension ? 'расширения' : 'основной конфигурации';
  const actualText = actual ? `"${actual}"` : 'без расширения';
  return `Для ${target} ожидается файл с суффиксом "${expected}", а указан файл ${actualText}: ${filePath}`;
}

/**
 * Отвергает `-AllExtensions`. Прогон платформы: `/DumpCfg <файл> -AllExtensions`
 * завершается с exit 0, но кладёт в файл выгрузку ОСНОВНОЙ конфигурации —
 * пользователь получил бы «резервную копию расширений», которой не существует.
 * Рабочий путь — узнать реальный список расширений и работать поштучно.
 */
export function assertNoAllExtensionsFlag(flag: boolean, operation: CfFileOperation): void {
  if (!flag) {
    return;
  }
  const operationText = operation === 'dump' ? 'выгрузки' : 'загрузки';
  throw new Error(
    `Флаг -AllExtensions не поддерживается для ${operationText} CF/CFE: Конфигуратор принимает его молча (код возврата 0), `
    + 'но работает с основной конфигурацией, а не с расширениями. '
    + 'Получите список расширений базы командой list-db-extensions и выполните операцию поштучно через -Extension <имя>.'
  );
}

/** Проверяет входной файл загрузки: существует, это файл, он непустой. */
export function validateCfFileInputFile(filePath: string): string | undefined {
  if (!fs.existsSync(filePath)) {
    return `Файл не найден: ${filePath}`;
  }
  const stats = fs.statSync(filePath);
  if (!stats.isFile()) {
    return `Указанный путь не является файлом: ${filePath}`;
  }
  if (stats.size === 0) {
    return `Файл пуст (0 байт) и не может быть загружен: ${filePath}`;
  }
  return undefined;
}

/** Проверяет целевой файл выгрузки: каталог существует, файл не занят (или разрешена перезапись). */
export function validateCfFileOutputTarget(filePath: string, overwrite: boolean): string | undefined {
  const targetDir = path.dirname(filePath);
  if (!fs.existsSync(targetDir)) {
    return `Каталог назначения не существует: ${targetDir}`;
  }
  if (!overwrite && fs.existsSync(filePath)) {
    return `Файл уже существует: ${filePath}. Разрешите перезапись, чтобы заменить его.`;
  }
  return undefined;
}

/**
 * Хвост имени staging-файла выгрузки. Это МАРКЕР ПРИНАДЛЕЖНОСТИ, а не просто
 * расширение: по нему (и только по нему) уборка отличает свой остаток от чужого
 * файла. Форма самого `uniqueSuffix` у разных вызывающих разная (`pid-время` у
 * одиночной выгрузки, `pid-время-индекс` у пакетной), поэтому опознавать по ней
 * нельзя — предикат либо не узнал бы одного из генераторов, либо съел бы
 * пользовательский `.backup.2024-01-15.part`.
 */
const DUMP_STAGING_SUFFIX = '.v8vscedit.part';

/**
 * Путь промежуточного (staging) файла выгрузки — в том же каталоге, что и
 * целевой, чтобы перенос был атомарным переименованием внутри одной ФС.
 * Нужен потому, что при ошибке платформа всё равно создаёт выходной файл
 * (замерено: 16 байт мусора) — без staging пользователь получил бы битый
 * «бэкап» или потерял бы уже существующий файл.
 *
 * Имя НЕ оканчивается на `.cf`/`.cfe`/`.xml`: временный файл не должен попадать
 * ни в выборку бэкапов, ни под watcher выгрузки.
 */
export function resolveDumpStagingPath(outputFile: string, uniqueSuffix: string): string {
  const targetDir = path.dirname(outputFile);
  return path.join(targetDir, `.${path.basename(outputFile)}.${uniqueSuffix}${DUMP_STAGING_SUFFIX}`);
}

/**
 * Признак «это наш staging-файл выгрузки» по имени файла.
 *
 * Проверяется МАРКЕР (`DUMP_STAGING_SUFFIX`), а не форма уникального суффикса:
 * так предикат покрывает обоих генераторов имени сразу и по построению не может
 * принять за свой чужой `.part` пользователя — удаление постороннего файла
 * молчаливо уничтожило бы чужие данные.
 *
 * Нужен, чтобы пакетная выгрузка убирала собственные остатки: процесс CLI могут
 * убить SIGKILL'ом (отмена операции из UI добивает его через 5 секунд), и тогда
 * `finally` с уборкой не отрабатывает, а staging-файл остаётся в каталоге
 * бэкапов навсегда — с планом выгрузки он не конфликтует и сам не исчезнет.
 */
export function isDumpStagingFileName(fileName: string): boolean {
  // Ведущая точка и непустая часть перед маркером — то, что строит
  // `resolveDumpStagingPath`; голый маркер именем нашего файла быть не может.
  return new RegExp(`^\\..+${DUMP_STAGING_SUFFIX.replace(/\./g, '\\.')}$`).test(fileName);
}

/**
 * Единственная точка композиции правил. Порядок намеренный:
 * `-AllExtensions` → обязательность пути → суффикс → проверки файловой системы.
 * Сначала отбиваются ошибки, при которых любая дальнейшая диагностика вводит в
 * заблуждение (неверный флаг/пустой путь), и только потом трогается диск.
 */
export function validateCfFileRequest(request: CfFileRequest): void {
  assertNoAllExtensionsFlag(request.allExtensionsFlag === true, request.operation);

  if (!request.filePath.trim()) {
    const operationText = request.operation === 'dump' ? 'выгрузки' : 'загрузки';
    throw new Error(`Не указан путь к файлу ${operationText} конфигурации.`);
  }

  const suffixError = validateCfFileSuffix(request.filePath, request.isExtension);
  if (suffixError) {
    throw new Error(suffixError);
  }

  const fsError = request.operation === 'load'
    ? validateCfFileInputFile(request.filePath)
    : validateCfFileOutputTarget(request.filePath, request.overwrite === true);
  if (fsError) {
    throw new Error(fsError);
  }
}
