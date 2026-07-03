import { findNestingAwareElementRange } from './XmlUtils';

export type TypeAwarePropertyOwnerKind =
  | 'Attribute'
  | 'AddressingAttribute'
  | 'Dimension'
  | 'Resource'
  | 'Column'
  | 'Constant'
  | 'CommonAttribute';

/**
 * Тип регистра-владельца измерения/ресурса. Набор допустимых свойств поля и их
 * значения по умолчанию зависят от типа регистра: платформа 1С отклоняет загрузку
 * при свойстве, не входящем в состав объекта (напр. `UseInTotals` у измерения ИР,
 * `Balance` у ресурса ИР), и при недопустимом значении перечисления (`Auto` у
 * `QuickChoice`/`CreateOnInput` ресурса ИР).
 */
export type RegisterOwnerKind = 'InformationRegister' | 'AccumulationRegister';

type FieldTypeCategory =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'reference'
  | 'defined'
  | 'binary'
  | 'other'
  | 'none';

const CONTROLLED_PROPERTY_KEYS = [
  'PasswordMode',
  'Format',
  'EditFormat',
  'ToolTip',
  'MarkNegatives',
  'Mask',
  'MultiLine',
  'ExtendedEdit',
  'MinValue',
  'MaxValue',
  'FillFromFillingValue',
  'FillValue',
  'FillChecking',
  'ChoiceFoldersAndItems',
  'ChoiceParameterLinks',
  'ChoiceParameters',
  'QuickChoice',
  'CreateOnInput',
  'ChoiceForm',
  'LinkByType',
  'ChoiceHistoryOnInput',
  'Indexing',
  'FullTextSearch',
  'DataHistory',
  'DenyIncompleteValues',
  'RoundingMode',
  'ShowInTotal',
  'Master',
  'MainFilter',
  'TypeReductionMode',
  'UseInTotals',
  'Balance',
  'AccountingFlag',
  'AddressingDimension',
] as const;

const COMMON_ORDER = [
  'ToolTip',
  'FillFromFillingValue',
  'FillValue',
  'FillChecking',
  'ChoiceFoldersAndItems',
  'QuickChoice',
  'CreateOnInput',
  'ChoiceHistoryOnInput',
  'Indexing',
  'FullTextSearch',
  'DataHistory',
] as const;

const STRING_ORDER = ['PasswordMode', 'Format', 'EditFormat', 'Mask', 'MultiLine', 'ExtendedEdit'] as const;
const NUMBER_ORDER = ['Format', 'EditFormat', 'MarkNegatives', 'MinValue', 'MaxValue', 'RoundingMode'] as const;
const DATE_ORDER = ['Format', 'EditFormat', 'Mask', 'MinValue', 'MaxValue'] as const;
const BOOLEAN_ORDER = ['Format', 'EditFormat'] as const;
const CHOICE_ORDER = ['ChoiceParameterLinks', 'ChoiceParameters', 'ChoiceForm', 'LinkByType'] as const;
const DIMENSION_ORDER = ['DenyIncompleteValues', 'Master', 'MainFilter', 'TypeReductionMode', 'UseInTotals'] as const;
const RESOURCE_ORDER = ['Balance', 'AccountingFlag'] as const;
const ADDRESSING_ORDER = ['AddressingDimension'] as const;

// Ролевые свойства измерения зависят от типа регистра (эталоны example/2.20
// InformationRegisters/AccumulationRegisters): у ИР — Master/MainFilter/
// DenyIncompleteValues/TypeReductionMode; у РН — DenyIncompleteValues/UseInTotals.
const IR_DIMENSION_ROLE = ['DenyIncompleteValues', 'Master', 'MainFilter', 'TypeReductionMode'] as const;
const ACCUM_DIMENSION_ROLE = ['DenyIncompleteValues', 'UseInTotals'] as const;
// Общие свойства, которые регистр накопления НЕ хранит у полей (в отличие от
// реквизита объекта): свойства заполнения и история данных.
const ACCUM_FIELD_DROP_KEYS = ['FillFromFillingValue', 'FillValue', 'DataHistory'] as const;

const DEFAULT_VALUES: Readonly<Record<string, string>> = {
  PasswordMode: 'false',
  ToolTip: '',
  MarkNegatives: 'false',
  Mask: '',
  MultiLine: 'false',
  ExtendedEdit: 'false',
  MinValue: 'nil',
  MaxValue: 'nil',
  FillFromFillingValue: 'false',
  FillValue: 'nil',
  FillChecking: 'DontCheck',
  ChoiceFoldersAndItems: 'Items',
  ChoiceParameterLinks: '',
  ChoiceParameters: '',
  QuickChoice: 'Auto',
  CreateOnInput: 'Auto',
  ChoiceForm: '',
  LinkByType: '',
  ChoiceHistoryOnInput: 'Auto',
  Indexing: 'DontIndex',
  FullTextSearch: 'Use',
  DataHistory: 'Use',
  DenyIncompleteValues: 'false',
  RoundingMode: 'Round15as20',
  ShowInTotal: 'false',
  Master: 'false',
  MainFilter: 'false',
  TypeReductionMode: 'Auto',
  UseInTotals: 'false',
  Balance: 'false',
  AccountingFlag: 'false',
  AddressingDimension: '',
};

const CONTROLLED_PROPERTY_KEY_SET: ReadonlySet<string> = new Set(CONTROLLED_PROPERTY_KEYS);

/**
 * Возвращает XML-блоки свойств, которые должны сопровождать typed field с заданным типом.
 * Используется при создании нового реквизита, чтобы не держать XML-правила в UI-командах.
 */
export function buildTypedFieldPropertyBlocks(
  kind: TypeAwarePropertyOwnerKind,
  typeInnerXml: string,
  indent: string,
  registerKind?: RegisterOwnerKind
): string[] {
  const defaults = getFieldDefaultValues(kind, registerKind);
  return getTypedFieldPropertyKeys(kind, typeInnerXml, registerKind)
    .map((key) => buildDefaultPropertyBlock(key, indent, defaults));
}

/** Возвращает ключи свойств typed field для выбранного типа без базовых `Name/Synonym/Comment/Type`. */
export function getTypedFieldPropertyKeys(
  kind: TypeAwarePropertyOwnerKind,
  typeInnerXml: string,
  registerKind?: RegisterOwnerKind
): string[] {
  return getAllowedPropertyKeys(kind, detectFieldTypeCategories(typeInnerXml), registerKind);
}

/** Проверяет, управляется ли свойство составом `<Type>` и должно ли скрываться для неподходящего типа. */
export function isTypedFieldControlledPropertyKey(key: string): boolean {
  return CONTROLLED_PROPERTY_KEY_SET.has(key);
}

/**
 * Перестраивает `<Properties>` после смены `<Type>`: недопустимые для нового типа теги убираются,
 * значения тегов, которые остались в новом составе, сохраняются.
 */
export function normalizeTypedFieldPropertiesAfterTypeChange(
  elementXml: string,
  kind: TypeAwarePropertyOwnerKind,
  typeInnerXml: string
): string {
  const properties = findPropertiesInner(elementXml);
  if (!properties) {
    return elementXml;
  }

  const indent = detectPropertyIndent(properties.inner);
  const existing = collectPropertyBlocks(properties.inner);
  const nextTypeBlock = `<Type>\n${typeInnerXml}\n${indent}</Type>`;
  const allowed = getAllowedPropertyKeys(kind, detectFieldTypeCategories(typeInnerXml));
  const resultBlocks: string[] = [];
  const emitted = new Set<string>();

  for (const key of ['Name', 'Synonym', 'Comment'] as const) {
    const block = existing.byKey.get(key);
    if (block) {
      resultBlocks.push(block);
      emitted.add(key);
    }
  }
  resultBlocks.push(nextTypeBlock);
  emitted.add('Type');

  if (shouldPreserveUncontrolledProperties(kind)) {
    for (const block of existing.ordered) {
      if (emitted.has(block.key)) {
        continue;
      }
      if (CONTROLLED_PROPERTY_KEY_SET.has(block.key) && !allowed.includes(block.key)) {
        continue;
      }
      resultBlocks.push(block.xml);
      emitted.add(block.key);
    }
  } else {
    for (const key of allowed) {
      resultBlocks.push(existing.byKey.get(key) ?? buildDefaultPropertyBlock(key, indent));
      emitted.add(key);
    }
    for (const block of existing.ordered) {
      if (!emitted.has(block.key) && shouldPreserveEmptyFormattingProperty(block)) {
        resultBlocks.push(block.xml);
        emitted.add(block.key);
      }
    }
  }

  for (const key of allowed) {
    if (!emitted.has(key)) {
      resultBlocks.push(buildDefaultPropertyBlock(key, indent));
      emitted.add(key);
    }
  }

  const nextInner = `\n${resultBlocks.join('\n')}\n${indent.slice(0, -1)}`;
  return `${elementXml.slice(0, properties.start)}${nextInner}${elementXml.slice(properties.end)}`;
}

function shouldPreserveUncontrolledProperties(kind: TypeAwarePropertyOwnerKind): boolean {
  return kind === 'Constant' || kind === 'CommonAttribute';
}

function shouldPreserveEmptyFormattingProperty(block: { key: string; xml: string }): boolean {
  return (block.key === 'Format' || block.key === 'EditFormat') && /\/>\s*$/.test(block.xml);
}

function getAllowedPropertyKeys(
  kind: TypeAwarePropertyOwnerKind,
  categories: ReadonlySet<FieldTypeCategory>,
  registerKind?: RegisterOwnerKind
): string[] {
  const keys: string[] = [];
  appendUnique(keys, COMMON_ORDER);

  if (categories.has('string')) {
    appendUnique(keys, STRING_ORDER);
  }
  if (categories.has('number')) {
    appendUnique(keys, NUMBER_ORDER);
  }
  if (categories.has('date')) {
    appendUnique(keys, DATE_ORDER);
  }
  if (categories.has('boolean')) {
    appendUnique(keys, BOOLEAN_ORDER);
  }

  if (categories.has('reference') || categories.has('defined') || categories.has('other')) {
    appendUnique(keys, CHOICE_ORDER);
  }
  if (kind === 'Dimension') {
    appendUnique(keys, getDimensionRoleKeys(registerKind));
  }
  if (kind === 'Resource') {
    appendUnique(keys, getResourceRoleKeys(registerKind));
  }
  if (kind === 'AddressingAttribute') {
    appendUnique(keys, ADDRESSING_ORDER);
  }

  // Колонка ТЧ (сериализуется как <Attribute> внутри TabularSection) не входит
  // в наполнение объекта, поэтому свойств заполнения у неё нет. Платформа 1С их
  // не принимает: «Свойство FillFromFillingValue/FillValue не входит в состав
  // объекта метаданных Attribute».
  const withoutColumnFill = kind === 'Column'
    ? keys.filter((key) => key !== 'FillFromFillingValue' && key !== 'FillValue')
    : keys;

  return sortByControlledOrder(dropRegisterOmittedKeys(withoutColumnFill, kind, registerKind));
}

/** Ролевые свойства измерения: зависят от типа регистра, вне регистра — совместимый полный набор. */
function getDimensionRoleKeys(registerKind?: RegisterOwnerKind): readonly string[] {
  if (registerKind === 'InformationRegister') {
    return IR_DIMENSION_ROLE;
  }
  if (registerKind === 'AccumulationRegister') {
    return ACCUM_DIMENSION_ROLE;
  }
  return DIMENSION_ORDER;
}

/** Ролевые свойства ресурса: у регистров с известным типом их нет (Balance/AccountingFlag опущены). */
function getResourceRoleKeys(registerKind?: RegisterOwnerKind): readonly string[] {
  if (registerKind === 'InformationRegister' || registerKind === 'AccumulationRegister') {
    return [];
  }
  return RESOURCE_ORDER;
}

/** Убирает у полей регистра накопления общие свойства, которые платформа для него не хранит. */
function dropRegisterOmittedKeys(
  keys: string[],
  kind: TypeAwarePropertyOwnerKind,
  registerKind?: RegisterOwnerKind
): string[] {
  if (registerKind !== 'AccumulationRegister' || (kind !== 'Dimension' && kind !== 'Resource')) {
    return keys;
  }
  const drop = new Set<string>(ACCUM_FIELD_DROP_KEYS);
  if (kind === 'Resource') {
    drop.add('Indexing');
  }
  return keys.filter((key) => !drop.has(key));
}

/**
 * Значения по умолчанию с учётом контекста. Поля регистра генерируются со
 * строковым типом (небором для выбора), у которого `QuickChoice`/`CreateOnInput`
 * не могут быть `Auto` — платформа: «Неверное значение перечисления - Auto». В
 * эталоне у нессылочных полей регистра это `DontUse`/`Use` (у ссылочных — `Auto`,
 * но генератор ссылочные поля по умолчанию не создаёт).
 */
function getFieldDefaultValues(
  kind: TypeAwarePropertyOwnerKind,
  registerKind?: RegisterOwnerKind
): Readonly<Record<string, string>> {
  if ((kind === 'Dimension' || kind === 'Resource') && registerKind) {
    const overrides: Record<string, string> = { ...DEFAULT_VALUES, QuickChoice: 'DontUse', CreateOnInput: 'Use' };
    // У измерения регистра `TypeReductionMode` для нессылочного типа — не `Auto`,
    // а `TransformValues` (эталон: string/decimal-измерения ИР). `Auto` платформа
    // отклоняет: «Неверное значение перечисления - Auto».
    if (kind === 'Dimension') {
      overrides.TypeReductionMode = 'TransformValues';
    }
    return overrides;
  }
  return DEFAULT_VALUES;
}

function appendUnique(target: string[], values: readonly string[]): void {
  for (const value of values) {
    if (!target.includes(value)) {
      target.push(value);
    }
  }
}

function sortByControlledOrder(keys: string[]): string[] {
  const order = new Map<string, number>();
  CONTROLLED_PROPERTY_KEYS.forEach((key, index) => order.set(key, index));
  return [...keys].sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999));
}

function detectFieldTypeCategories(typeInnerXml: string): ReadonlySet<FieldTypeCategory> {
  const rawTypes = Array.from(typeInnerXml.matchAll(/<(?:[\w-]+:)?Type(?:\s[^>]*)?>([^<]*)<\/(?:[\w-]+:)?Type>/g))
    .map((match) => normalizeRawType(match[1]));
  const typeSets = Array.from(typeInnerXml.matchAll(/<(?:[\w-]+:)?TypeSet(?:\s[^>]*)?>([^<]*)<\/(?:[\w-]+:)?TypeSet>/g))
    .map((match) => normalizeRawType(match[1]));
  const all = [...rawTypes, ...typeSets].filter((item) => item.length > 0);
  const result = new Set<FieldTypeCategory>();
  if (all.length === 0) {
    result.add('none');
    return result;
  }

  for (const typeName of all) {
    result.add(detectSingleFieldTypeCategory(typeName));
  }
  return result;
}

function detectSingleFieldTypeCategory(typeName: string): FieldTypeCategory {
  if (typeName === 'xs:string') {
    return 'string';
  }
  if (typeName === 'xs:decimal') {
    return 'number';
  }
  if (typeName === 'xs:boolean') {
    return 'boolean';
  }
  if (typeName === 'xs:dateTime') {
    return 'date';
  }
  if (typeName === 'xs:base64Binary' || typeName === 'v8:ValueStorage') {
    return 'binary';
  }
  if (typeName.includes('Ref.')) {
    return 'reference';
  }
  if (typeName.startsWith('DefinedType.')) {
    return 'defined';
  }
  return 'other';
}

function normalizeRawType(value: string): string {
  return value.trim().replace(/^d\d+p\d+:/, '').replace(/^cfg:/, '');
}

function buildDefaultPropertyBlock(
  key: string,
  indent: string,
  defaults: Readonly<Record<string, string>> = DEFAULT_VALUES
): string {
  const value = defaults[key] ?? '';
  if (value === 'nil') {
    return `${indent}<${key} xsi:nil="true"/>`;
  }
  if (value === '') {
    return `${indent}<${key}/>`;
  }
  return `${indent}<${key}>${value}</${key}>`;
}

function findPropertiesInner(xml: string): { inner: string; start: number; end: number } | null {
  const range = findNestingAwareElementRange(xml, 'Properties');
  if (!range) {
    return null;
  }
  return { inner: xml.slice(range.openEnd, range.closeStart), start: range.openEnd, end: range.closeStart };
}

function collectPropertyBlocks(propertiesInner: string): {
  byKey: Map<string, string>;
  ordered: { key: string; xml: string }[];
} {
  const byKey = new Map<string, string>();
  const ordered: { key: string; xml: string }[] = [];
  let index = 0;
  while (index < propertiesInner.length) {
    const open = /<([A-Za-z_][\w:.-]*)(?:\s[^>]*)?\/?>/.exec(propertiesInner.slice(index));
    if (!open) {
      break;
    }
    const tag = open[1];
    const start = index + open.index;
    const openEnd = start + open[0].length;
    if (open[0].endsWith('/>')) {
      const xml = propertiesInner.slice(start, openEnd);
      byKey.set(tag, xml);
      ordered.push({ key: tag, xml });
      index = openEnd;
      continue;
    }

    const closeTag = `</${tag}>`;
    const closeStart = propertiesInner.indexOf(closeTag, openEnd);
    if (closeStart < 0) {
      index = openEnd;
      continue;
    }
    const end = closeStart + closeTag.length;
    const xml = propertiesInner.slice(start, end);
    byKey.set(tag, xml);
    ordered.push({ key: tag, xml });
    index = end;
  }
  return { byKey, ordered };
}

function detectPropertyIndent(propertiesInner: string): string {
  return /\n([ \t]+)</.exec(propertiesInner)?.[1] ?? '\t\t\t';
}
