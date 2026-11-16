import { SupportMode } from './SupportMode';

/** Поставщик (конфигурация-родитель) из заголовка блока `ParentConfigurations.bin`. */
export interface SupportVendorInfo {
  name: string;
  vendor: string;
  version: string;
  /** Число записей, объявленное в заголовке блока. */
  declaredCount: number;
}

export interface ParentConfigurationsData {
  vendors: SupportVendorInfo[];
  /** Локальный uuid объекта (нижний регистр) → итоговый режим после слияния поставщиков. */
  modes: Map<string, SupportMode>;
  /** Сколько записей фактически найдено (с учётом повторов у разных поставщиков). */
  recordCount: number;
  /** Сумма объявленных в заголовках count — для сверки с recordCount. */
  declaredCount: number;
  /** Записи с кодом вне {0,1,2}: трактуются как Locked, счётчик — для диагностики формата. */
  unknownCodeCount: number;
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const QUOTED = '"((?:[^"]|"")*)"';

const VENDOR_HEADER_RE = new RegExp(`(${UUID}),\\d+,(${UUID}),${QUOTED},${QUOTED},${QUOTED},(\\d+)`, 'gi');

// Код режима — ПЕРВОЕ поле записи `code,0,localUuid,vendorUuid` (установлено на реальном
// файле: глобальный поиск по этому шаблону даёт ровно сумму объявленных count). Обрамление
// `[,{]…[,}]` не даёт зацепить хвост uuid заголовка или числа из служебного хвоста файла.
const RECORD_RE = new RegExp(`(?<=[,{])(\\d+),(\\d+),(${UUID}),(${UUID})(?=[,}])`, 'gi');

const CODE_TO_MODE: Readonly<Record<string, SupportMode>> = {
  '0': SupportMode.Locked,
  '1': SupportMode.Editable,
  '2': SupportMode.Removed,
};

// Объект может числиться у нескольких поставщиков: побеждает более строгое ограничение,
// иначе разрешение одного поставщика сняло бы запрет другого.
const STRICTNESS: Readonly<Record<SupportMode, number>> = {
  [SupportMode.Locked]: 3,
  [SupportMode.Editable]: 2,
  [SupportMode.Removed]: 1,
  [SupportMode.None]: 0,
};

function unquote(value: string): string {
  return value.replace(/""/g, '"');
}

/**
 * Разбирает текст `Ext/ParentConfigurations.bin`. Чистая функция без ФС:
 * чтение файла и кэширование — забота `SupportInfoService`.
 */
export function parseParentConfigurations(content: string): ParentConfigurationsData {
  const text = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;

  const vendors: SupportVendorInfo[] = [];
  let declaredCount = 0;
  for (const m of text.matchAll(VENDOR_HEADER_RE)) {
    const count = Number(m[6]);
    vendors.push({ name: unquote(m[5]), vendor: unquote(m[4]), version: unquote(m[3]), declaredCount: count });
    declaredCount += count;
  }

  const modes = new Map<string, SupportMode>();
  let recordCount = 0;
  let unknownCodeCount = 0;
  for (const m of text.matchAll(RECORD_RE)) {
    recordCount++;
    let mode = CODE_TO_MODE[m[1]] as SupportMode | undefined;
    if (mode === undefined) {
      // Неизвестный код — консервативно запрещаем правку, а не молча разрешаем.
      unknownCodeCount++;
      mode = SupportMode.Locked;
    }
    const key = m[3].toLowerCase();
    const prev = modes.get(key);
    if (prev === undefined || STRICTNESS[mode] > STRICTNESS[prev]) {
      modes.set(key, mode);
    }
  }

  return { vendors, modes, recordCount, declaredCount, unknownCodeCount };
}
