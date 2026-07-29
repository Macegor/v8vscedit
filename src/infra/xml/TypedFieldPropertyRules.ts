import { META_TYPES } from '../../domain/MetaTypes';
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
export type RegisterOwnerKind = 'InformationRegister' | 'AccumulationRegister' | 'AccountingRegister';

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

/**
 * Порядок свойств в `<Properties>`. Схема 1С — `xs:sequence`, платформа
 * чувствительна к порядку (см. комментарий в `ObjectXmlReader.updatePropertyInElement`
 * про `ServerCall` у общего модуля), поэтому список — не произвольный, а единая
 * последовательность, подпоследовательностями которой являются ВСЕ наблюдаемые
 * в `example/2.20`+`example/2.21` порядки: реквизит справочника, адресный
 * реквизит задачи, измерение/ресурс регистров сведений, накопления и бухгалтерии.
 *
 * Ключевое следствие: ролевые свойства владельца (`Master`/`MainFilter`/`Balance`/
 * `AccountingFlag`) идут ДО `Indexing`/`FullTextSearch`/`DataHistory`, а
 * `UseInTotals`/`TypeReductionMode` — после них.
 */
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
  'Master',
  'MainFilter',
  'Balance',
  'AccountingFlag',
  'ExtDimensionAccountingFlag',
  'DenyIncompleteValues',
  'Indexing',
  'AddressingDimension',
  'FullTextSearch',
  'DataHistory',
  'UseInTotals',
  'TypeReductionMode',
  // Ниже — свойства, которые генератор не пишет никогда (в эталонных выгрузках
  // не встречаются ни у одного типизированного поля). Они остаются в списке,
  // чтобы смена типа вычищала их из уже испорченных файлов.
  'RoundingMode',
  'ShowInTotal',
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
// `RoundingMode` в NUMBER_ORDER не входит намеренно: ни у одного типизированного
// поля реальной выгрузки (example/2.20, example/2.21 — реквизиты, измерения,
// ресурсы, константы) этого свойства нет, а платформа отклоняет загрузку
// («Свойство RoundingMode не входит в состав объекта метаданных Resource»).
const NUMBER_ORDER = ['Format', 'EditFormat', 'MarkNegatives', 'MinValue', 'MaxValue'] as const;
const DATE_ORDER = ['Format', 'EditFormat', 'Mask', 'MinValue', 'MaxValue'] as const;
const BOOLEAN_ORDER = ['Format', 'EditFormat'] as const;
const CHOICE_ORDER = ['ChoiceParameterLinks', 'ChoiceParameters', 'ChoiceForm', 'LinkByType'] as const;
const ADDRESSING_ORDER = ['AddressingDimension'] as const;

/**
 * Состав свойств измерения/ресурса, зависящий ТОЛЬКО от вида регистра-владельца
 * (не от типа поля). Снято с эталонных выгрузок `example/2.21/src/cf`:
 * `InformationRegisters`, `AccumulationRegisters`, `AccountingRegisters`.
 *
 * `dropKeys` — общие свойства, которых у полей этого регистра нет (платформа их
 * не принимает), `resourceDropKeys` — дополнительно только у ресурса.
 */
const REGISTER_FIELD_RULES: Readonly<Record<RegisterOwnerKind, {
  dimensionRole: readonly string[];
  resourceRole: readonly string[];
  dropKeys: readonly string[];
  resourceDropKeys: readonly string[];
}>> = {
  InformationRegister: {
    dimensionRole: ['DenyIncompleteValues', 'Master', 'MainFilter', 'TypeReductionMode'],
    resourceRole: [],
    dropKeys: [],
    resourceDropKeys: [],
  },
  AccumulationRegister: {
    dimensionRole: ['DenyIncompleteValues', 'UseInTotals'],
    resourceRole: [],
    dropKeys: ['FillFromFillingValue', 'FillValue', 'DataHistory'],
    resourceDropKeys: ['Indexing'],
  },
  AccountingRegister: {
    dimensionRole: ['DenyIncompleteValues', 'Balance', 'AccountingFlag'],
    resourceRole: ['Balance', 'AccountingFlag', 'ExtDimensionAccountingFlag'],
    dropKeys: ['FillFromFillingValue', 'FillValue', 'DataHistory'],
    resourceDropKeys: ['Indexing'],
  },
};

/**
 * Виды объектов, у полей которых состав свойств задаётся правилами регистра.
 * Выводится из {@link META_TYPES} по наличию дочернего тега `Dimension`, а не
 * перечислением: иначе новый вид-владелец, добавленный единственной записью в
 * реестр (инвариант CLAUDE.md), сюда бы не попал и его реквизиту молча
 * дописались бы свойства заполнения.
 *
 * Виды из этого набора, отсутствующие в {@link REGISTER_FIELD_RULES} (правила не
 * сняты с эталона), обрабатываются консервативно — см. {@link isUnmodelledRegisterField}.
 */
const REGISTER_OWNER_KINDS: ReadonlySet<string> = new Set(
  Object.values(META_TYPES)
    .filter((def) => def.childTags?.includes('Dimension'))
    .map((def) => def.kind)
);

/**
 * Свойства, наличие которых определяется видом объекта-владельца, а не типом поля.
 * Смена `<Type>` их состав менять не должна: когда владелец неизвестен или не
 * описан в {@link REGISTER_FIELD_RULES}, такие свойства только сохраняются из
 * исходного XML и никогда не дописываются «по умолчанию» — иначе в файл попадает
 * свойство чужого вида метаданных и платформа отказывается грузить конфигурацию.
 */
const OWNER_DEPENDENT_KEYS: ReadonlySet<string> = new Set([
  'FillFromFillingValue',
  'FillValue',
  'DataHistory',
  'Indexing',
  'DenyIncompleteValues',
  'ShowInTotal',
  'Master',
  'MainFilter',
  'TypeReductionMode',
  'UseInTotals',
  'Balance',
  'AccountingFlag',
  'ExtDimensionAccountingFlag',
]);

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
  // AccountingFlag/ExtDimensionAccountingFlag — не булево, а ссылка на признак
  // учёта плана счетов (`ChartOfAccounts.X.AccountingFlag.Y`). В эталонах либо
  // такая ссылка, либо пустой самозакрытый тег; `false` платформа не примет.
  AccountingFlag: '',
  ExtDimensionAccountingFlag: '',
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

/**
 * Набор ключей для ПАНЕЛИ СВОЙСТВ. Панель показывает недостающие свойства как
 * редактируемые поля и дописывает их в XML при первом же вводе, поэтому список
 * обязан совпадать с контрактом записи: иначе один клик вернул бы в файл
 * `UseInTotals` измерению регистра сведений.
 *
 * Когда вид владельца известен — набор строгий, как при генерации. Владелец
 * неизвестен (панель открыта вне контекста объекта) — ролевые свойства
 * объединяются по всем описанным видам регистров, чтобы не спрятать уже
 * записанное платформой свойство.
 */
export function getDisplayTypedFieldPropertyKeys(
  kind: TypeAwarePropertyOwnerKind,
  typeInnerXml: string,
  ownerKind?: string,
  elementXml?: string
): string[] {
  const registerKind = toRegisterOwnerKind(ownerKind);
  const keys = getAllowedPropertyKeys(kind, detectFieldTypeCategories(typeInnerXml), registerKind);
  if (ownerKind) {
    // Тот же доводчик, что и на пути записи: для регистра без снятых с эталона
    // правил (регистр расчёта) ролевые свойства берутся из самого XML — панель
    // не прячет уже записанное и не предлагает дописать непроверенное.
    return restrictOwnerDependentKeysToExisting(
      keys,
      collectExistingPropertyBlocks(elementXml),
      kind,
      ownerKind,
      registerKind
    );
  }
  // Владелец не передан. Для константы и общего реквизита это штатный путь
  // (getTypeAwarePropertyKeyOrder владельца не знает и не должен).
  if (kind !== 'Dimension' && kind !== 'Resource') {
    return keys;
  }
  // Измерение/ресурс без владельца из UI недостижимы: единственный вызывающий
  // (structuredMetaChildHandler) всегда передаёт rootMetaKind. Ветка оставлена
  // как контракт публичного API infra — без владельца прятать записанное
  // платформой ролевое свойство нельзя.
  const roleKeys = Object.values(REGISTER_FIELD_RULES)
    .flatMap((rules) => (kind === 'Dimension' ? rules.dimensionRole : rules.resourceRole));
  appendUnique(keys, roleKeys);
  return sortByControlledOrder(keys);
}

/** Блоки свойств элемента; пустой список, если XML не передан или `<Properties>` нет. */
function collectExistingPropertyBlocks(elementXml?: string): { ordered: { key: string; xml: string }[] } {
  const properties = elementXml ? findPropertiesInner(elementXml) : null;
  return properties ? collectPropertyBlocks(properties.inner) : { ordered: [] };
}

/**
 * Возвращает управляемые свойства элемента, не входящие в состав его вида
 * метаданных. Основа проверки `validate_metadata`: платформа 1С отклоняет
 * загрузку конфигурации при свойстве чужого вида («Свойство UseInTotals не
 * входит в состав объекта метаданных Dimension»).
 *
 * Проверяется принадлежность ВИДУ, а не соответствие текущему `<Type>`:
 * платформа выгружает типозависимые свойства (`PasswordMode`, `MinValue`, …)
 * у поля любого типа, и сужение состава по типу — политика генератора
 * ({@link getTypedFieldPropertyKeys}), а не ограничение формата.
 */
export function findDisallowedTypedFieldProperties(
  elementXml: string,
  kind: TypeAwarePropertyOwnerKind,
  ownerKind?: string
): string[] {
  const properties = findPropertiesInner(elementXml);
  if (!properties) {
    return [];
  }
  const registerKind = toRegisterOwnerKind(ownerKind);
  if (isUnmodelledRegisterField(kind, ownerKind, registerKind)) {
    return [];
  }
  const members = new Set(getMemberPropertyKeys(kind, registerKind));
  return collectPropertyBlocks(properties.inner).ordered
    .map((block) => block.key)
    .filter((key) => CONTROLLED_PROPERTY_KEY_SET.has(key) && !members.has(key));
}

/** Полный состав управляемых свойств вида поля — объединение по всем категориям типа. */
function getMemberPropertyKeys(
  kind: TypeAwarePropertyOwnerKind,
  registerKind?: RegisterOwnerKind
): string[] {
  const allCategories: ReadonlySet<FieldTypeCategory> = new Set<FieldTypeCategory>([
    'string',
    'number',
    'boolean',
    'date',
    'reference',
  ]);
  const keys = getAllowedPropertyKeys(kind, allCategories, registerKind);
  if (kind === 'Column') {
    // У колонки ТЧ обработки/отчёта реальная выгрузка свойства заполнения содержит,
    // у колонки справочника/документа — нет: состав определяется владельцем ТЧ,
    // поэтому для проверки принадлежности виду они допустимы всегда (генератор
    // их по-прежнему не пишет — см. getAllowedPropertyKeys).
    appendUnique(keys, ['FillFromFillingValue', 'FillValue']);
    return sortByControlledOrder(keys);
  }
  return keys;
}

/** Сужает вид объекта-владельца до регистра с описанными правилами полей. */
export function toRegisterOwnerKind(ownerKind?: string): RegisterOwnerKind | undefined {
  return ownerKind && ownerKind in REGISTER_FIELD_RULES ? (ownerKind as RegisterOwnerKind) : undefined;
}

/** Проверяет, управляется ли свойство составом `<Type>` и должно ли скрываться для неподходящего типа. */
export function isTypedFieldControlledPropertyKey(key: string): boolean {
  return CONTROLLED_PROPERTY_KEY_SET.has(key);
}

/**
 * Перестраивает `<Properties>` после смены `<Type>`: недопустимые для нового типа теги убираются,
 * значения тегов, которые остались в новом составе, сохраняются.
 *
 * `ownerKind` — вид объекта из корня файла (`InformationRegister`, `Catalog`, …).
 * Без него состав ролевых свойств измерения/ресурса не определить, и в XML
 * попадали свойства чужого вида регистра (`UseInTotals` измерению РС, `Balance`
 * ресурсу РС) — конфигурация переставала грузиться платформой.
 */
export function normalizeTypedFieldPropertiesAfterTypeChange(
  elementXml: string,
  kind: TypeAwarePropertyOwnerKind,
  typeInnerXml: string,
  ownerKind?: string
): string {
  const properties = findPropertiesInner(elementXml);
  if (!properties) {
    return elementXml;
  }

  const indent = detectPropertyIndent(properties.inner);
  const existing = collectPropertyBlocks(properties.inner);
  const nextTypeBlock = `<Type>\n${typeInnerXml}\n${indent}</Type>`;
  const registerKind = toRegisterOwnerKind(ownerKind);
  const allowed = restrictOwnerDependentKeysToExisting(
    getAllowedPropertyKeys(kind, detectFieldTypeCategories(typeInnerXml), registerKind),
    existing,
    kind,
    ownerKind,
    registerKind
  );
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
  if (kind === 'Dimension' && registerKind) {
    appendUnique(keys, REGISTER_FIELD_RULES[registerKind].dimensionRole);
  }
  if (kind === 'Resource' && registerKind) {
    appendUnique(keys, REGISTER_FIELD_RULES[registerKind].resourceRole);
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

/**
 * Убирает у полей регистра общие свойства, которые платформа для него не хранит.
 * Правило распространяется и на РЕКВИЗИТ регистра: в эталонах у реквизита РН и РБ
 * (в отличие от реквизита РС) нет `FillFromFillingValue`/`FillValue`/`DataHistory`.
 */
function dropRegisterOmittedKeys(
  keys: string[],
  kind: TypeAwarePropertyOwnerKind,
  registerKind?: RegisterOwnerKind
): string[] {
  if (!registerKind) {
    return keys;
  }
  const rules = REGISTER_FIELD_RULES[registerKind];
  const drop = new Set<string>(rules.dropKeys);
  if (kind === 'Resource') {
    for (const key of rules.resourceDropKeys) {
      drop.add(key);
    }
  }
  return keys.filter((key) => !drop.has(key));
}

/**
 * Поле регистра, правила которого не описаны в {@link REGISTER_FIELD_RULES}
 * (регистр расчёта). Измерение и ресурс существуют только у регистров, поэтому
 * для них достаточно отсутствия описанных правил; реквизит же бывает у любого
 * объекта, и признаком служит сам вид владельца.
 */
function isUnmodelledRegisterField(
  kind: TypeAwarePropertyOwnerKind,
  ownerKind?: string,
  registerKind?: RegisterOwnerKind
): boolean {
  if (registerKind) {
    return false;
  }
  return kind === 'Dimension' || kind === 'Resource' || REGISTER_OWNER_KINDS.has(ownerKind ?? '');
}

/**
 * Для поля регистра с неописанными правилами: свойства, зависящие от вида
 * владельца, только сохраняются из исходного XML. Смена типа поля не повод ни
 * дописать `UseInTotals`/`Balance` «по умолчанию», ни выбросить уже записанные
 * платформой ролевые свойства.
 */
function restrictOwnerDependentKeysToExisting(
  allowed: string[],
  existing: { ordered: { key: string; xml: string }[] },
  kind: TypeAwarePropertyOwnerKind,
  ownerKind?: string,
  registerKind?: RegisterOwnerKind
): string[] {
  if (!isUnmodelledRegisterField(kind, ownerKind, registerKind)) {
    return allowed;
  }
  const present = new Set(existing.ordered.map((block) => block.key));
  const kept = allowed.filter((key) => !OWNER_DEPENDENT_KEYS.has(key) || present.has(key));
  appendUnique(kept, [...present].filter((key) => OWNER_DEPENDENT_KEYS.has(key)));
  return sortByControlledOrder(kept);
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
