/**
 * Низовой общий модуль билдеров формы: единственный экземпляр `WARN_SINK`,
 * `withCollectedWarnings`/`warn`, IdAllocator (реэкспорт из FormShared),
 * escape/indent-хелперы, константы (`FORM_XMLNS`/`KNOWN_FORM_EVENTS`),
 * общие типы и низовые эмиттеры типов. Все билдеры делят один sink, чтобы
 * изоляция предупреждений оставалась корректной (golden ловит это).
 */
import { createIdAllocator, escapeXml, FORM_XMLNS, type IdAllocator } from '../FormShared';

export { createIdAllocator, escapeXml, FORM_XMLNS };
export type { IdAllocator };

const EVENT_SUFFIX_MAP: Record<string, string> = {
  OnChange: 'ПриИзменении',
  StartChoice: 'НачалоВыбора',
  ChoiceProcessing: 'ОбработкаВыбора',
  AutoComplete: 'АвтоПодбор',
  Clearing: 'Очистка',
  Opening: 'Открытие',
  Click: 'Нажатие',
  OnActivateRow: 'ПриАктивизацииСтроки',
  BeforeAddRow: 'ПередНачаломДобавления',
  BeforeDeleteRow: 'ПередУдалением',
  BeforeRowChange: 'ПередНачаломИзменения',
  OnStartEdit: 'ПриНачалеРедактирования',
  OnEndEdit: 'ПриОкончанииРедактирования',
  Selection: 'ВыборСтроки',
  OnCurrentPageChange: 'ПриСменеСтраницы',
  TextEditEnd: 'ОкончаниеВводаТекста',
  URLProcessing: 'ОбработкаНавигационнойСсылки',
  DragStart: 'НачалоПеретаскивания',
  Drag: 'Перетаскивание',
  DragCheck: 'ПроверкаПеретаскивания',
  Drop: 'Помещение',
  AfterDeleteRow: 'ПослеУдаления',
};

export const KNOWN_EVENTS: Record<string, readonly string[]> = {
  input: ['OnChange', 'StartChoice', 'ChoiceProcessing', 'AutoComplete', 'TextEditEnd', 'Clearing', 'Creating', 'EditTextChange'],
  check: ['OnChange'],
  radio: ['OnChange'],
  label: ['Click', 'URLProcessing'],
  labelField: ['OnChange', 'StartChoice', 'ChoiceProcessing', 'Click', 'URLProcessing', 'Clearing'],
  table: ['Selection', 'BeforeAddRow', 'AfterDeleteRow', 'BeforeDeleteRow', 'OnActivateRow', 'OnEditEnd', 'OnStartEdit', 'BeforeRowChange', 'BeforeEditEnd', 'ValueChoice', 'OnActivateCell', 'OnActivateField', 'Drag', 'DragStart', 'DragCheck', 'DragEnd', 'OnGetDataAtServer', 'BeforeLoadUserSettingsAtServer', 'OnUpdateUserSettingSetAtServer', 'OnChange'],
  pages: ['OnCurrentPageChange'],
  page: ['OnCurrentPageChange'],
  button: ['Click'],
  picField: ['OnChange', 'StartChoice', 'ChoiceProcessing', 'Click', 'Clearing'],
  calendar: ['OnChange', 'OnActivate'],
  picture: ['Click'],
  cmdBar: [],
  popup: [],
  group: [],
};

export const KNOWN_FORM_EVENTS: readonly string[] = [
  'OnCreateAtServer', 'OnOpen', 'BeforeClose', 'OnClose', 'NotificationProcessing',
  'ChoiceProcessing', 'OnReadAtServer', 'AfterWriteAtServer', 'BeforeWriteAtServer',
  'AfterWrite', 'BeforeWrite', 'OnWriteAtServer', 'FillCheckProcessingAtServer',
  'OnLoadDataFromSettingsAtServer', 'BeforeLoadDataFromSettingsAtServer',
  'OnSaveDataInSettingsAtServer', 'ExternalEvent', 'OnReopen', 'Opening',
];

const V8_TYPES: Record<string, string> = {
  ValueStorage: 'v8:ValueStorage',
  ValueTable: 'v8:ValueTable',
  ValueTree: 'v8:ValueTree',
  ValueList: 'v8:ValueListType',
  TypeDescription: 'v8:TypeDescription',
  Universal: 'v8:Universal',
  Array: 'v8:Array',
  FixedArray: 'v8:FixedArray',
  Structure: 'v8:Structure',
  FixedStructure: 'v8:FixedStructure',
  UUID: 'v8:UUID',
};

const UI_TYPES: Record<string, string> = {
  FormattedString: 'v8ui:FormattedString',
  Picture: 'v8ui:Picture',
  Color: 'v8ui:Color',
  Font: 'v8ui:Font',
};

const DCS_MAP: Record<string, string> = {
  DataCompositionSettings: 'dcsset:DataCompositionSettings',
  DataCompositionSchema: 'dcssch:DataCompositionSchema',
  DataCompositionComparisonType: 'dcscor:DataCompositionComparisonType',
};

const CFG_REF_PATTERN = /^(CatalogRef|CatalogObject|DocumentRef|DocumentObject|EnumRef|ChartOfAccountsRef|ChartOfAccountsObject|ChartOfCharacteristicTypesRef|ChartOfCharacteristicTypesObject|ChartOfCalculationTypesRef|ChartOfCalculationTypesObject|ExchangePlanRef|ExchangePlanObject|BusinessProcessRef|BusinessProcessObject|TaskRef|TaskObject|InformationRegisterRecordSet|InformationRegisterRecordManager|AccumulationRegisterRecordSet|AccountingRegisterRecordSet|ConstantsSet|DataProcessorObject|ReportObject)\./;

const KNOWN_INVALID_TYPES: Record<string, string> = {
  FormDataStructure: 'Runtime type. Use object type without cfg: prefix (e.g. CatalogObject.Контрагенты, DocumentObject.Приход)',
  FormDataCollection: 'Runtime type. Use ValueTable',
  FormDataTree: 'Runtime type. Use ValueTree',
  FormDataTreeItem: 'Runtime type, not valid in XML',
  FormDataCollectionItem: 'Runtime type, not valid in XML',
  FormGroup: 'UI element type, not a data type',
  FormField: 'UI element type, not a data type',
  FormButton: 'UI element type, not a data type',
  FormDecoration: 'UI element type, not a data type',
  FormTable: 'UI element type, not a data type',
};

const FORM_TYPE_SYNONYMS: Record<string, string> = {
  строка: 'string',
  число: 'decimal',
  булево: 'boolean',
  дата: 'date',
  датавремя: 'dateTime',
  number: 'decimal',
  bool: 'boolean',
  справочникссылка: 'CatalogRef',
  справочникобъект: 'CatalogObject',
  документссылка: 'DocumentRef',
  документобъект: 'DocumentObject',
  перечислениессылка: 'EnumRef',
  плансчетовссылка: 'ChartOfAccountsRef',
  планвидовхарактеристикссылка: 'ChartOfCharacteristicTypesRef',
  планвидоврасчётассылка: 'ChartOfCalculationTypesRef',
  планвидоврасчетассылка: 'ChartOfCalculationTypesRef',
  планобменассылка: 'ExchangePlanRef',
  бизнеспроцессссылка: 'BusinessProcessRef',
  задачассылка: 'TaskRef',
  определяемыйтип: 'DefinedType',
};

export const REF_ROOT_SYNONYMS: Record<string, string> = {
  Перечисление: 'Enum',
  Справочник: 'Catalog',
  Документ: 'Document',
  ПланСчетов: 'ChartOfAccounts',
  ПланВидовХарактеристик: 'ChartOfCharacteristicTypes',
  ПланВидовРасчета: 'ChartOfCalculationTypes',
  ПланВидовРасчёта: 'ChartOfCalculationTypes',
  ПланОбмена: 'ExchangePlan',
  БизнесПроцесс: 'BusinessProcess',
  Задача: 'Task',
  РегистрСведений: 'InformationRegister',
  РегистрНакопления: 'AccumulationRegister',
  РегистрБухгалтерии: 'AccountingRegister',
  РегистрРасчета: 'CalculationRegister',
  РегистрРасчёта: 'CalculationRegister',
};
export const ENUM_VALUE_SYNONYMS = new Set(['EnumValue', 'ЗначениеПеречисления']);

// ─── WARN_SINK — единственный экземпляр, общий для всех билдеров ─────────────

const WARN_SINK: { warnings: string[] | null } = { warnings: null };

export function warn(message: string): void {
  if (WARN_SINK.warnings) {
    WARN_SINK.warnings.push(message);
  }
}

/** Соберёт массив предупреждений вместо вывода в stderr. */
export function withCollectedWarnings<T>(fn: () => T): { result: T; warnings: string[] } {
  const previous = WARN_SINK.warnings;
  const collected: string[] = [];
  WARN_SINK.warnings = collected;
  try {
    const result = fn();
    return { result, warnings: collected };
  } finally {
    WARN_SINK.warnings = previous;
  }
}

// ─── Element dispatch context ───────────────────────────────────────────────

export interface EmitContext {
  readonly inCmdBar?: boolean;
}

// ─── Общие утилиты ──────────────────────────────────────────────────────────

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Унифицированное приведение значения DSL-элемента (тип `unknown`) к строке
 * для XML. Нужно потому, что значения свойств элементов формы приходят из
 * пользовательского JSON и формально имеют тип `unknown`; прямой `String(v)`
 * на объекте даёт `"[object Object]"`. Здесь объекты/массивы сериализуются
 * через `JSON.stringify`, а примитивы конвертируются как есть.
 */
export function xmlStr(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return JSON.stringify(value);
}

export function getHandlerName(elementName: string, eventName: string): string {
  const suffix = EVENT_SUFFIX_MAP[eventName];
  return suffix ? `${elementName}${suffix}` : `${elementName}${eventName}`;
}

export function titleFromName(name: string): string {
  if (!name) {return '';}
  let s = name.replace(/([А-ЯA-Z])([А-ЯA-Z][а-яa-z])/g, '$1 $2');
  s = s.replace(/([а-яa-z0-9])([А-ЯA-Z])/g, '$1 $2');
  const parts = s.split(' ');
  if (parts.length === 0) {return s;}
  const out = [parts[0]];
  for (const p of parts.slice(1)) {
    out.push(p.length > 1 && p === p.toUpperCase() ? p : p.toLowerCase());
  }
  return out.join(' ');
}

// ─── Type emitters ──────────────────────────────────────────────────────────

function resolveTypeStr(typeStr: string): string {
  if (!typeStr) {return typeStr;}
  if (typeStr.startsWith('cfg:')) {
    typeStr = typeStr.slice(4);
  }
  const m1 = /^([^(]+)\((.+)\)$/.exec(typeStr);
  if (m1) {
    const base = m1[1].trim();
    const params = m1[2];
    const r = FORM_TYPE_SYNONYMS[base.toLowerCase()];
    return r ? `${r}(${params})` : typeStr;
  }
  if (typeStr.includes('.')) {
    const i = typeStr.indexOf('.');
    const prefix = typeStr.slice(0, i);
    const suffix = typeStr.slice(i);
    const r = FORM_TYPE_SYNONYMS[prefix.toLowerCase()];
    return r ? `${r}${suffix}` : typeStr;
  }
  const key = typeStr.toLowerCase();
  return key in FORM_TYPE_SYNONYMS ? FORM_TYPE_SYNONYMS[key] : typeStr;
}

function emitSingleType(lines: string[], rawType: string, indent: string): void {
  const typeStr = resolveTypeStr(rawType);
  if (typeStr === 'boolean') {
    lines.push(`${indent}<v8:Type>xs:boolean</v8:Type>`);
    return;
  }
  const mString = /^string(\((\d+)\))?$/.exec(typeStr);
  if (mString) {
    // Группа 2 формально типизирована как `string`, но фактически может быть
    // undefined при отсутствии скобок — берём явным присвоением для совместимости.
    const length: string = mString[2] || '0';
    lines.push(`${indent}<v8:Type>xs:string</v8:Type>`);
    lines.push(`${indent}<v8:StringQualifiers>`);
    lines.push(`${indent}\t<v8:Length>${length}</v8:Length>`);
    lines.push(`${indent}\t<v8:AllowedLength>Variable</v8:AllowedLength>`);
    lines.push(`${indent}</v8:StringQualifiers>`);
    return;
  }
  const mDecimal = /^decimal\((\d+),(\d+)(,nonneg)?\)$/.exec(typeStr);
  if (mDecimal) {
    const digits = mDecimal[1];
    const fraction = mDecimal[2];
    const sign = mDecimal[3] ? 'Nonnegative' : 'Any';
    lines.push(`${indent}<v8:Type>xs:decimal</v8:Type>`);
    lines.push(`${indent}<v8:NumberQualifiers>`);
    lines.push(`${indent}\t<v8:Digits>${digits}</v8:Digits>`);
    lines.push(`${indent}\t<v8:FractionDigits>${fraction}</v8:FractionDigits>`);
    lines.push(`${indent}\t<v8:AllowedSign>${sign}</v8:AllowedSign>`);
    lines.push(`${indent}</v8:NumberQualifiers>`);
    return;
  }
  const mDate = /^(date|dateTime|time)$/.exec(typeStr);
  if (mDate) {
    const fractionsMap: Record<string, string> = { date: 'Date', dateTime: 'DateTime', time: 'Time' };
    const fractions = fractionsMap[typeStr];
    lines.push(`${indent}<v8:Type>xs:dateTime</v8:Type>`);
    lines.push(`${indent}<v8:DateQualifiers>`);
    lines.push(`${indent}\t<v8:DateFractions>${fractions}</v8:DateFractions>`);
    lines.push(`${indent}</v8:DateQualifiers>`);
    return;
  }
  if (typeStr in V8_TYPES) {
    lines.push(`${indent}<v8:Type>${V8_TYPES[typeStr]}</v8:Type>`);
    return;
  }
  if (typeStr in UI_TYPES) {
    lines.push(`${indent}<v8:Type>${UI_TYPES[typeStr]}</v8:Type>`);
    return;
  }
  if (typeStr.startsWith('DataComposition') && typeStr in DCS_MAP) {
    lines.push(`${indent}<v8:Type>${DCS_MAP[typeStr]}</v8:Type>`);
    return;
  }
  if (typeStr === 'DynamicList') {
    lines.push(`${indent}<v8:Type>cfg:DynamicList</v8:Type>`);
    return;
  }
  if (CFG_REF_PATTERN.test(typeStr)) {
    lines.push(`${indent}<v8:Type>cfg:${typeStr}</v8:Type>`);
    return;
  }
  if (typeStr in KNOWN_INVALID_TYPES) {
    throw new Error(`Invalid form attribute type '${typeStr}': ${KNOWN_INVALID_TYPES[typeStr]}`);
  }
  if (typeStr.includes('.')) {
    lines.push(`${indent}<v8:Type>cfg:${typeStr}</v8:Type>`);
  } else {
    warn(`WARNING: Unrecognized bare type '${typeStr}' — will be emitted without namespace prefix`);
    lines.push(`${indent}<v8:Type>${escapeXml(typeStr)}</v8:Type>`);
  }
}

export function emitType(lines: string[], typeStr: string, indent: string): void {
  if (!typeStr) {
    lines.push(`${indent}<Type/>`);
    return;
  }
  const parts = typeStr.split(/[|+]/).map((s) => s.trim()).filter(Boolean);
  lines.push(`${indent}<Type>`);
  for (const part of parts) {
    emitSingleType(lines, part, `${indent}\t`);
  }
  lines.push(`${indent}</Type>`);
}
