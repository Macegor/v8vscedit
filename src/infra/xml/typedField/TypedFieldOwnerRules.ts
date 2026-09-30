import { META_TYPES, type MetaKind } from '../../../domain/MetaTypes';

/**
 * Роль типизированного поля — чем поле является для своего владельца
 * (реквизит, измерение, ресурс, колонка ТЧ, адресный реквизит), либо
 * «самовладеющий» вид (константа, общий реквизит), у которого поле и владелец
 * совпадают.
 */
export type TypeAwarePropertyOwnerKind =
  | 'Attribute'
  | 'AddressingAttribute'
  | 'Dimension'
  | 'Resource'
  | 'Column'
  | 'Constant'
  | 'CommonAttribute';

/**
 * Множество ролей выводится из {@link META_TYPES} (`propertySchema === 'typedField'`)
 * плюс самовладеющие виды: иначе новая роль, добавленная одной записью в реестр,
 * сюда бы не попала, а её поле молча пошло бы по «не типизированной» ветке.
 */
const TYPED_FIELD_ROLES: ReadonlySet<string> = new Set<string>([
  ...Object.values(META_TYPES).filter((def) => def.propertySchema === 'typedField').map((def) => def.kind),
  'Constant',
  'CommonAttribute',
]);

/** Является ли вид элемента ролью типизированного поля (нормализация состава свойств применима). */
export function isTypedFieldRole(kind: string): kind is TypeAwarePropertyOwnerKind {
  return TYPED_FIELD_ROLES.has(kind);
}



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
export const CONTROLLED_PROPERTY_KEYS = [
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
  // Ниже — свойства, которые не встречаются ни у одного типизированного поля
  // эталона (ни у одного владельца и ни в одной роли). Они остаются в списке,
  // чтобы смена типа вычищала их из уже испорченных файлов.
  'RoundingMode',
  'ShowInTotal',
] as const;

const CONTROLLED_PROPERTY_KEY_SET: ReadonlySet<string> = new Set(CONTROLLED_PROPERTY_KEYS);

/** Управляется ли свойство составом типизированного поля (иначе тег не наш и не трогается). */
export function isTypedFieldControlledPropertyKey(key: string): boolean {
  return CONTROLLED_PROPERTY_KEY_SET.has(key);
}

const CONTROLLED_ORDER: ReadonlyMap<string, number> = new Map(
  CONTROLLED_PROPERTY_KEYS.map((key, index) => [key, index])
);

/** Порядковый номер свойства в `xs:sequence`; неуправляемые ключи — в конец. */
export function controlledPropertyOrder(key: string): number {
  return CONTROLLED_ORDER.get(key) ?? CONTROLLED_PROPERTY_KEYS.length;
}

/** Сортирует ключи в каноническом порядке `<Properties>`. */
export function sortByControlledOrder(keys: readonly string[]): string[] {
  return [...keys].sort((a, b) => controlledPropertyOrder(a) - controlledPropertyOrder(b));
}

// ── Ось ТИПА: какие свойства уместны для значений <Type> ────────────────────
//
// Это политика генератора, а не ограничение формата: платформа выгружает
// типозависимые свойства (`PasswordMode`, `MinValue`, …) у поля ЛЮБОГО типа
// (эталон: example/2.20/src/cf/Catalogs/Контрагенты.xml — ссылочный реквизит с
// PasswordMode/Mask/MinValue/MaxValue). Поэтому ось типа участвует только в том,
// что мы ДОПИСЫВАЕМ, и никогда — в том, что мы удаляем или считаем недопустимым.

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

const COMMON_KEYS = ['ToolTip', 'FillChecking', 'ChoiceFoldersAndItems', 'QuickChoice', 'CreateOnInput', 'ChoiceHistoryOnInput'] as const;
const STRING_KEYS = ['PasswordMode', 'Format', 'EditFormat', 'Mask', 'MultiLine', 'ExtendedEdit'] as const;
// `RoundingMode` в NUMBER_KEYS не входит намеренно: ни у одного типизированного
// поля реальной выгрузки этого свойства нет, а платформа отклоняет загрузку
// («Свойство RoundingMode не входит в состав объекта метаданных Resource»).
const NUMBER_KEYS = ['Format', 'EditFormat', 'MarkNegatives', 'MinValue', 'MaxValue'] as const;
const DATE_KEYS = ['Format', 'EditFormat', 'Mask', 'MinValue', 'MaxValue'] as const;
const BOOLEAN_KEYS = ['Format', 'EditFormat'] as const;
const CHOICE_KEYS = ['ChoiceParameterLinks', 'ChoiceParameters', 'ChoiceForm', 'LinkByType'] as const;

/** Свойства оси типа для конкретного `<Type>`. */
function typeAxisKeys(categories: ReadonlySet<FieldTypeCategory>): string[] {
  const keys: string[] = [...COMMON_KEYS];
  if (categories.has('string')) {
    appendUnique(keys, STRING_KEYS);
  }
  if (categories.has('number')) {
    appendUnique(keys, NUMBER_KEYS);
  }
  if (categories.has('date')) {
    appendUnique(keys, DATE_KEYS);
  }
  if (categories.has('boolean')) {
    appendUnique(keys, BOOLEAN_KEYS);
  }
  if (categories.has('reference') || categories.has('defined') || categories.has('other')) {
    appendUnique(keys, CHOICE_KEYS);
  }
  return keys;
}

/**
 * Полный состав оси типа — объединение по всем категориям. Именно он образует
 * owner-независимую часть {@link getMemberPropertyKeys}: у КАЖДОЙ пары
 * владелец×роль эталона все эти свойства присутствуют у 100% полей.
 */
const ALL_TYPE_AXIS_KEYS: readonly string[] = typeAxisKeys(
  new Set<FieldTypeCategory>(['string', 'number', 'boolean', 'date', 'reference'])
);

// ── Ось ВЛАДЕЛЬЦА×РОЛИ: снято с эталона example/ (обе генерации, cf и cfe) ──
//
// Правило двумерное. Пример зеркальной замены состава, из-за которого платформа
// 8.3.27 отказывалась читать колонку: у справочника/документа свойства заполнения
// есть у реквизита верхнего уровня и НЕТ у колонки ТЧ, а у обработки/отчёта —
// ровно наоборот (и там, и там без исключений: 14 955 колонок эталона).
// Доли промежуточными не бывают: свойство либо есть у 100% полей пары, либо нет
// ни у одного (это же проверяет тест, снимающий правило заново).

/** Правила одной пары владелец×роль. */
interface OwnerRoleRule {
  /** Owner-зависимые свойства, которые у пары ЕСТЬ (100% полей эталона). */
  readonly ownerKeys: readonly string[];
  /** Свойства оси типа, которых у пары НЕТ (обратное исключение, см. константу). */
  readonly withoutKeys?: readonly string[];
  /** Значения по умолчанию, отличные от общих (генерация новых блоков). */
  readonly defaults?: Readonly<Record<string, string>>;
}

const FILL_KEYS = ['FillFromFillingValue', 'FillValue'] as const;
const SEARCH_KEYS = ['Indexing', 'FullTextSearch'] as const;

/** Реквизит верхнего уровня объекта, участвующего в наполнении данными. */
const OBJECT_ATTRIBUTE_KEYS = [...FILL_KEYS, ...SEARCH_KEYS, 'DataHistory'] as const;
/** Колонка ТЧ того же объекта: свойств заполнения нет — их место у реквизита. */
const OBJECT_COLUMN_KEYS = [...SEARCH_KEYS, 'DataHistory'] as const;
/** Реквизит обработки/отчёта: ни заполнения, ни поиска, ни истории данных. */
const PROCESSING_ATTRIBUTE_KEYS: readonly string[] = [];
/** Колонка ТЧ обработки/отчёта: зеркально реквизиту — свойства заполнения есть. */
const PROCESSING_COLUMN_KEYS = [...FILL_KEYS] as const;

/**
 * Поля регистра генерируются нессылочного типа, у которого `QuickChoice`/
 * `CreateOnInput` не могут быть `Auto` — платформа: «Неверное значение
 * перечисления - Auto». В эталоне у нессылочных полей регистра это `DontUse`/`Use`.
 */
const REGISTER_FIELD_DEFAULTS: Readonly<Record<string, string>> = { QuickChoice: 'DontUse', CreateOnInput: 'Use' };
/** У измерения регистра `TypeReductionMode` для нессылочного типа — `TransformValues`, не `Auto`. */
const REGISTER_DIMENSION_DEFAULTS: Readonly<Record<string, string>> = {
  ...REGISTER_FIELD_DEFAULTS,
  TypeReductionMode: 'TransformValues',
};

type OwnerRules = Partial<Record<TypeAwarePropertyOwnerKind, OwnerRoleRule>>;

/** Владелец, участвующий в наполнении данными (справочник, документ, план обмена, …). */
const DATA_OWNER_RULES: OwnerRules = {
  Attribute: { ownerKeys: OBJECT_ATTRIBUTE_KEYS },
  Column: { ownerKeys: OBJECT_COLUMN_KEYS },
};

/** Обработка/отчёт: состав реквизита и колонки зеркален объектам данных. */
const PROCESSING_OWNER_RULES: OwnerRules = {
  Attribute: { ownerKeys: PROCESSING_ATTRIBUTE_KEYS },
  Column: { ownerKeys: PROCESSING_COLUMN_KEYS },
};

/**
 * Таблица «владелец × роль». Ключи верхнего уровня — виды из {@link META_TYPES}
 * (типизация `MetaKind` не даёт завести владельца мимо реестра), ключи второго —
 * роли. Отсутствие пары означает «роль у владельца структурно невозможна»
 * (ресурс у справочника) и даёт owner-независимый состав; отсутствие ВЛАДЕЛЬЦА
 * целиком — консервативный режим (см. {@link getMemberPropertyKeys}).
 */
const OWNER_ROLE_RULES: Partial<Record<MetaKind, OwnerRules>> = {
  Catalog: DATA_OWNER_RULES,
  Document: DATA_OWNER_RULES,
  ExchangePlan: DATA_OWNER_RULES,
  BusinessProcess: DATA_OWNER_RULES,
  ChartOfCharacteristicTypes: DATA_OWNER_RULES,
  ChartOfAccounts: DATA_OWNER_RULES,
  ChartOfCalculationTypes: DATA_OWNER_RULES,
  Task: {
    ...DATA_OWNER_RULES,
    // Адресный реквизит задачи — реквизит верхнего уровня плюс ссылка на
    // измерение адресации регистра адресации.
    AddressingAttribute: { ownerKeys: [...OBJECT_ATTRIBUTE_KEYS, 'AddressingDimension'] },
  },
  DataProcessor: PROCESSING_OWNER_RULES,
  Report: PROCESSING_OWNER_RULES,
  InformationRegister: {
    Attribute: { ownerKeys: OBJECT_ATTRIBUTE_KEYS },
    Dimension: {
      ownerKeys: [...OBJECT_ATTRIBUTE_KEYS, 'DenyIncompleteValues', 'Master', 'MainFilter', 'TypeReductionMode'],
      defaults: REGISTER_DIMENSION_DEFAULTS,
    },
    Resource: { ownerKeys: OBJECT_ATTRIBUTE_KEYS, defaults: REGISTER_FIELD_DEFAULTS },
  },
  AccumulationRegister: {
    Attribute: { ownerKeys: SEARCH_KEYS },
    Dimension: {
      ownerKeys: [...SEARCH_KEYS, 'DenyIncompleteValues', 'UseInTotals'],
      defaults: REGISTER_DIMENSION_DEFAULTS,
    },
    // У ресурса регистра накопления и бухгалтерии нет даже `Indexing`.
    Resource: { ownerKeys: ['FullTextSearch'], defaults: REGISTER_FIELD_DEFAULTS },
  },
  AccountingRegister: {
    Attribute: { ownerKeys: SEARCH_KEYS },
    Dimension: {
      ownerKeys: [...SEARCH_KEYS, 'DenyIncompleteValues', 'Balance', 'AccountingFlag'],
      defaults: REGISTER_DIMENSION_DEFAULTS,
    },
    Resource: {
      ownerKeys: ['FullTextSearch', 'Balance', 'AccountingFlag', 'ExtDimensionAccountingFlag'],
      defaults: REGISTER_FIELD_DEFAULTS,
    },
  },
  // Самовладеющие виды: поле и владелец — один и тот же объект.
  Constant: {
    // У константы нет `CreateOnInput` (единственное обратное исключение оси
    // типа во всём эталоне: 999 констант, ни одной с этим свойством).
    Constant: { ownerKeys: ['DataHistory'], withoutKeys: ['CreateOnInput'] },
  },
  CommonAttribute: {
    CommonAttribute: { ownerKeys: OBJECT_ATTRIBUTE_KEYS },
  },
};

/**
 * Свойства, наличие которых определяется владельцем, а не типом поля —
 * объединение по всей таблице (не отдельный список, иначе разъехался бы с ней).
 * Для владельца без снятых правил такие свойства только СОХРАНЯЮТСЯ из
 * исходного XML и никогда не дописываются.
 */
const OWNER_DEPENDENT_KEYS: ReadonlySet<string> = new Set(
  Object.values(OWNER_ROLE_RULES)
    .flatMap((rules) => Object.values(rules))
    .flatMap((rule) => [...rule.ownerKeys])
);

/** Виды-владельцы, правила которых сняты с эталона — перебор, когда владелец неизвестен. */
export function listRuleOwnerKinds(): string[] {
  return Object.keys(OWNER_ROLE_RULES);
}

/**
 * Роли-кандидаты владельца — перебор, когда роль поля неизвестна (панель
 * открыта вне контекста узла дерева). Для неизвестного владельца это ТОЛЬКО
 * «реквизит»: объединять по всем ролям нельзя — панель обычного реквизита
 * предложила бы ролевые свойства измерения регистра и записала бы их в файл
 * при первом же вводе.
 */
export function listRolesForOwner(ownerKind?: string): TypeAwarePropertyOwnerKind[] {
  const rules = ownerRules(ownerKind);
  return rules ? Object.keys(rules).filter(isTypedFieldRole) : ['Attribute'];
}

/**
 * Зависит ли наличие свойства от вида владельца. Панель не вправе спрятать
 * такое свойство, если платформа его уже записала: типозависимые она сужает по
 * `<Type>` намеренно (у ссылочного поля не место строковому `PasswordMode`),
 * а owner-зависимое прятать нельзя — правил его владельца мы могли не снимать.
 */
export function isOwnerDependentPropertyKey(key: string): boolean {
  return OWNER_DEPENDENT_KEYS.has(key);
}

function findRule(role: TypeAwarePropertyOwnerKind, ownerKind?: string): OwnerRoleRule | undefined {
  return ownerRules(ownerKind)?.[role];
}

function ownerRules(ownerKind?: string): OwnerRules | undefined {
  return ownerKind ? OWNER_ROLE_RULES[ownerKind as MetaKind] : undefined;
}

/**
 * Что у поля ДОПУСТИМО существовать. Единый критерий двух потребителей:
 * `property-not-allowed` в `validate_metadata` и удаление свойства при смене
 * типа — буквально одна функция, а не две согласованные.
 *
 * Владелец без снятых с эталона правил (регистр расчёта, неизвестный вид,
 * отсутствующий `ownerKind`) — консервативный режим: owner-зависимые свойства
 * считаются допустимыми все, то есть валидация молчит, а смена типа ничего не
 * удаляет. Дописывать их при этом нельзя (см. {@link getGeneratedPropertyKeys}).
 */
export function getMemberPropertyKeys(role: TypeAwarePropertyOwnerKind, ownerKind?: string): string[] {
  const rules = ownerRules(ownerKind);
  if (!rules) {
    return sortByControlledOrder([...ALL_TYPE_AXIS_KEYS, ...OWNER_DEPENDENT_KEYS]);
  }
  const rule = rules[role];
  const without = new Set(rule?.withoutKeys ?? []);
  const keys = [...ALL_TYPE_AXIS_KEYS, ...(rule?.ownerKeys ?? [])].filter((key) => !without.has(key));
  return sortByControlledOrder(unique(keys));
}

/**
 * Что мы ДОПИСЫВАЕМ: генерация нового поля, дописывание недостающего при смене
 * типа, показ недостающего в панели свойств. Инвариант — результат всегда
 * подмножество {@link getMemberPropertyKeys} той же пары.
 */
export function getGeneratedPropertyKeys(
  role: TypeAwarePropertyOwnerKind,
  ownerKind: string | undefined,
  typeInnerXml: string
): string[] {
  const rule = findRule(role, ownerKind);
  const without = new Set(rule?.withoutKeys ?? []);
  const keys = [...typeAxisKeys(detectFieldTypeCategories(typeInnerXml)), ...(rule?.ownerKeys ?? [])]
    .filter((key) => !without.has(key));
  return sortByControlledOrder(unique(keys));
}

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

/** Значения по умолчанию для новых блоков свойств пары владелец×роль. */
export function getFieldDefaultValues(
  role: TypeAwarePropertyOwnerKind,
  ownerKind?: string
): Readonly<Record<string, string>> {
  const overrides = findRule(role, ownerKind)?.defaults;
  return overrides ? { ...DEFAULT_VALUES, ...overrides } : DEFAULT_VALUES;
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

function appendUnique(target: string[], values: readonly string[]): void {
  for (const value of values) {
    if (!target.includes(value)) {
      target.push(value);
    }
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
