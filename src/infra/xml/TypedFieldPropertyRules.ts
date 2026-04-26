type TypedFieldKind = 'Attribute' | 'AddressingAttribute' | 'Dimension' | 'Resource' | 'Column';

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

/**
 * Возвращает XML-блоки свойств, которые должны сопровождать typed field с заданным типом.
 * Используется при создании нового реквизита, чтобы не держать XML-правила в UI-командах.
 */
export function buildTypedFieldPropertyBlocks(
  kind: TypedFieldKind,
  typeInnerXml: string,
  indent: string
): string[] {
  return getTypedFieldPropertyKeys(kind, typeInnerXml)
    .map((key) => buildDefaultPropertyBlock(key, indent));
}

/** Возвращает ключи свойств typed field для выбранного типа без базовых `Name/Synonym/Comment/Type`. */
export function getTypedFieldPropertyKeys(kind: TypedFieldKind, typeInnerXml: string): string[] {
  return getAllowedPropertyKeys(kind, detectFieldTypeCategories(typeInnerXml));
}

/**
 * Перестраивает `<Properties>` после смены `<Type>`: недопустимые для нового типа теги убираются,
 * значения тегов, которые остались в новом составе, сохраняются.
 */
export function normalizeTypedFieldPropertiesAfterTypeChange(
  elementXml: string,
  kind: TypedFieldKind,
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

  for (const key of ['Name', 'Synonym', 'Comment'] as const) {
    const block = existing.get(key);
    if (block) {
      resultBlocks.push(block);
    }
  }
  resultBlocks.push(nextTypeBlock);

  for (const key of allowed) {
    resultBlocks.push(existing.get(key) ?? buildDefaultPropertyBlock(key, indent));
  }

  const nextInner = `\n${resultBlocks.join('\n')}\n${indent.slice(0, -1)}`;
  return `${elementXml.slice(0, properties.start)}${nextInner}${elementXml.slice(properties.end)}`;
}

function getAllowedPropertyKeys(kind: TypedFieldKind, categories: ReadonlySet<FieldTypeCategory>): string[] {
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
    appendUnique(keys, DIMENSION_ORDER);
  }
  if (kind === 'Resource') {
    appendUnique(keys, RESOURCE_ORDER);
  }
  if (kind === 'AddressingAttribute') {
    appendUnique(keys, ADDRESSING_ORDER);
  }

  return sortByControlledOrder(keys);
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
  const rawTypes = Array.from(typeInnerXml.matchAll(/<v8:Type(?:\s[^>]*)?>([^<]*)<\/v8:Type>/g))
    .map((match) => normalizeRawType(match[1]));
  const typeSets = Array.from(typeInnerXml.matchAll(/<v8:TypeSet(?:\s[^>]*)?>([^<]*)<\/v8:TypeSet>/g))
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

function buildDefaultPropertyBlock(key: string, indent: string): string {
  const value = DEFAULT_VALUES[key] ?? '';
  if (value === 'nil') {
    return `${indent}<${key} xsi:nil="true"/>`;
  }
  if (value === '') {
    return `${indent}<${key}/>`;
  }
  return `${indent}<${key}>${value}</${key}>`;
}

function findPropertiesInner(xml: string): { inner: string; start: number; end: number } | null {
  const match = /<Properties>([\s\S]*?)<\/Properties>/.exec(xml);
  if (!match || match.index === undefined) {
    return null;
  }
  const start = match.index + match[0].indexOf('>') + 1;
  return { inner: match[1], start, end: start + match[1].length };
}

function collectPropertyBlocks(propertiesInner: string): Map<string, string> {
  const result = new Map<string, string>();
  let index = 0;
  while (index < propertiesInner.length) {
    const open = /<([A-Za-z_][\w:.-]*)(?:\s[^>]*)?>/.exec(propertiesInner.slice(index));
    if (!open) {
      break;
    }
    const tag = open[1];
    const start = index + open.index;
    const openEnd = start + open[0].length;
    if (open[0].endsWith('/>')) {
      result.set(tag, propertiesInner.slice(start, openEnd));
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
    result.set(tag, propertiesInner.slice(start, end));
    index = end;
  }
  return result;
}

function detectPropertyIndent(propertiesInner: string): string {
  return /\n([ \t]+)</.exec(propertiesInner)?.[1] ?? '\t\t\t';
}
