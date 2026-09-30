/**
 * Имена файлов пакетной выгрузки расширений (`.cfe`) и план каталога выгрузки.
 *
 * Имя расширения в 1С — почти произвольная строка: в нём бывают символы,
 * запрещённые в именах файлов Windows (`:`, `/`, `*`, `?`, `"`, `<`, `>`, `|`),
 * управляющие символы, хвостовые точки и пробелы (Windows их молча отбрасывает),
 * совпадения с зарезервированными именами устройств (`CON`, `COM1`) и имена,
 * различающиеся ТОЛЬКО регистром — а ФС macOS/Windows регистронезависимы.
 * Любой из этих случаев без обработки даёт либо падение выгрузки на середине,
 * либо ТИХУЮ перезапись бэкапа одного расширения бэкапом другого.
 *
 * Санитизация необратима (`A:B` и `A/B` дают один и тот же `A_B`), поэтому
 * обратное сопоставление «файл → расширение» хранится в манифесте
 * (`CfeBatchManifest`), а не выводится из имени файла.
 */

/** Запрещённые в именах файлов Windows символы. */
const FORBIDDEN_CHARS = /[\\/:*?"<>|]/g;

// eslint-disable-next-line no-control-regex -- управляющие символы недопустимы в именах файлов, их и ищем
const CONTROL_CHARS = /[\u0000-\u001F]/g;

/** Имена устройств Windows: файл с таким именем создать нельзя даже с расширением. */
const RESERVED_BASE_NAMES = new Set<string>([
  'CON', 'PRN', 'AUX', 'NUL',
  ...Array.from({ length: 9 }, (_unused, index) => `COM${String(index + 1)}`),
  ...Array.from({ length: 9 }, (_unused, index) => `LPT${String(index + 1)}`),
]);

/**
 * Предел длины базы имени. Не «лимит ФС», а запас: полный путь в Windows
 * ограничен 260 символами, а каталог выгрузки задаёт пользователь.
 */
const MAX_BASE_LENGTH = 100;

const CFE_SUFFIX = '.cfe';

export interface CfeDumpPlanItem {
  /** Имя расширения КАК В БАЗЕ — по нему манифест восстановит исходное значение. */
  readonly extensionName: string;
  /** Имя файла внутри каталога выгрузки (без пути). */
  readonly fileName: string;
}

export interface CfeDumpPlan {
  readonly items: CfeDumpPlanItem[];
  /** Имена файлов из плана, которые уже существуют в каталоге (регистронезависимо). */
  readonly conflicts: string[];
}

/**
 * Имя `.cfe`-файла для расширения базы.
 *
 * Порядок шагов значим и зафиксирован тестами: `trim` → замена запрещённых и
 * управляющих символов → снятие хвостовых точек/пробелов → префикс для
 * зарезервированных имён → подстановка `_` вместо пустого результата → обрезка
 * длины → суффикс. Перестановка соседних шагов меняет результат: например,
 * замена ПОСЛЕ снятия хвоста превратила бы `A:.` в `A` вместо `A_`, а проверка
 * зарезервированных ДО снятия хвоста пропустила бы `CON.`.
 */
export function cfeFileNameForExtension(extensionName: string): string {
  let base = extensionName.trim()
    .replace(FORBIDDEN_CHARS, '_')
    .replace(CONTROL_CHARS, '_')
    .replace(/[. ]+$/, '');

  if (RESERVED_BASE_NAMES.has(base.split('.')[0].toUpperCase())) {
    base = `_${base}`;
  }
  if (base.length === 0) {
    base = '_';
  }
  return `${truncateUtf16(base, MAX_BASE_LENGTH)}${CFE_SUFFIX}`;
}

/**
 * План имён файлов для набора расширений базы.
 *
 * Два разных расширения могут дать одну и ту же базу имени (`A:B` и `A/B`), и
 * это не ошибка входа, а нормальная ситуация — коллизия разрешается суффиксом
 * `~N` ВНУТРИ плана. Конфликт с УЖЕ существующим файлом каталога именем не
 * правится: молчаливый обход суффиксом положил бы второй бэкап рядом с первым,
 * а решение «перезаписать или отказаться» принимает вызывающий (`-Overwrite`).
 *
 * Порядок элементов — по имени расширения (ru, с учётом локали), чтобы план не
 * зависел от порядка, в котором платформа вернула список.
 */
export function planCfeDumpFiles(
  names: readonly string[],
  existingNames: readonly string[]
): CfeDumpPlan {
  const usedFileNames = new Set<string>();
  const items: CfeDumpPlanItem[] = [];

  for (const extensionName of [...names].sort(compareExtensionNames)) {
    const fileName = allocateFileName(cfeFileNameForExtension(extensionName), usedFileNames);
    usedFileNames.add(fileName.toLowerCase());
    items.push({ extensionName, fileName });
  }

  const existingLower = new Set(existingNames.map((name) => name.toLowerCase()));
  const conflicts = items
    .map((item) => item.fileName)
    .filter((fileName) => existingLower.has(fileName.toLowerCase()));

  return { items, conflicts };
}

/**
 * Сравнение имён расширений: человеческий порядок («арбуз» перед «Банан»,
 * регистр не главнее буквы), а не порядок кодовых единиц.
 *
 * ICU может счесть равными две РАЗНЫЕ строки (часть символов, например
 * управляющие, при сравнении игнорируется). Сортировка в JS стабильна, поэтому
 * такие имена сохраняют взаимный порядок входа; на корректность плана это не
 * влияет — имена файлов остаются уникальными, различается лишь то, кому из
 * пары достанется суффикс `~N`.
 */
export function compareExtensionNames(left: string, right: string): number {
  return left.localeCompare(right, 'ru');
}

/** Первое свободное имя: `A_B.cfe`, затем `A_B~2.cfe`, `A_B~3.cfe` … */
function allocateFileName(preferred: string, usedFileNames: ReadonlySet<string>): string {
  const base = preferred.slice(0, -CFE_SUFFIX.length);
  let candidate = preferred;
  let index = 1;
  while (usedFileNames.has(candidate.toLowerCase())) {
    index += 1;
    candidate = `${base}~${String(index)}${CFE_SUFFIX}`;
  }
  return candidate;
}

/**
 * Обрезка по единицам UTF-16 без разрыва суррогатной пары: одиночный суррогат
 * при записи на диск превращается в U+FFFD, и имя файла перестаёт совпадать с
 * записанным в манифесте — сопоставление «файл ↔ расширение» теряется.
 */
function truncateUtf16(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  const lastCode = text.charCodeAt(maxLength - 1);
  const isHighSurrogate = lastCode >= 0xd800 && lastCode <= 0xdbff;
  return text.slice(0, isHighSurrogate ? maxLength - 1 : maxLength);
}
