import { NodeKind } from '../../tree/TreeNode';
import {
  EnumPropertyOption,
  EnumPropertyValue,
  LocalizedStringValue,
  MetadataTypeValue,
  ObjectPropertyItem,
  ObjectPropertiesCollection,
} from './_types';
import { extractSimpleTag } from '../../../infra/xml';
import { getTypedFieldPropertyKeys } from '../../../infra/xml/TypedFieldPropertyRules';
import { parseMetadataType } from './MetadataTypeService';
import { extractTopLevelPropertiesChildren } from './MetadataXmlPropertiesService';

/** Теги со строкой локализации (v8:item) */
const LOCALIZED_PROPERTY_TAGS = new Set([
  'Synonym',
  'Comment',
  'ToolTip',
  'Explanation',
  'ExtendedExplanation',
]);

/** Теги булевых свойств в блоке Properties */
const BOOLEAN_PROPERTY_TAGS = new Set([
  'PasswordMode',
  'MarkNegatives',
  'MultiLine',
  'ExtendedEdit',
  'FillFromFillingValue',
  'CreateOnInput',
  'QuickChoice',
  'FullTextSearch',
  'DenyIncompleteValues',
  'ShowInTotal',
  'UseStandardCommands',
  'IncludeHelpInContents',
  'Modality',
  'Representation',
  'CheckUnique',
  'Autonumbering',
  'DefaultPresentation',
  'DataLockControlMode',
  'FullTextSearchOnInputByString',
  'DistributedInfoBase',
  'ThisNodeBelongsToExchangePlan',
  'SendData',
  'ReceiveData',
  'SequentialDataExchange',
  'PostInPrivilegedMode',
  'UnpostInPrivilegedMode',
]);

const FILL_CHECKING_OPTIONS: EnumPropertyOption[] = [
  { value: 'DontCheck', label: 'Не проверять' },
  { value: 'ShowError', label: 'Выдавать ошибку' },
  { value: 'ShowWarning', label: 'Показывать предупреждение' },
];

const INDEXING_OPTIONS: EnumPropertyOption[] = [
  { value: 'DontIndex', label: 'Не индексировать' },
  { value: 'Index', label: 'Индексировать' },
  { value: 'IndexWithAdditionalOrder', label: 'Индексировать с дополнительным упорядочиванием' },
];

/** Русские подписи известных тегов свойств */
const PROPERTY_TITLE_RU: Record<string, string> = {
  Name: 'Имя',
  Synonym: 'Синоним',
  Comment: 'Комментарий',
  Type: 'Тип',
  PasswordMode: 'Режим пароля',
  Format: 'Формат',
  EditFormat: 'Формат редактирования',
  ToolTip: 'Подсказка',
  MarkNegatives: 'Отметка отрицательных',
  Mask: 'Маска',
  MultiLine: 'Многострочный режим',
  ExtendedEdit: 'Расширенное редактирование',
  MinValue: 'Минимальное значение',
  MaxValue: 'Максимальное значение',
  FillFromFillingValue: 'Заполнять из данных заполнения',
  FillValue: 'Значение заполнения',
  FillChecking: 'Проверка заполнения',
  ChoiceFoldersAndItems: 'Выбор групп и элементов',
  ChoiceParameterLinks: 'Связи параметров выбора',
  ChoiceForm: 'Форма выбора',
  QuickChoice: 'Быстрый выбор',
  CreateOnInput: 'Создание при вводе',
  ChoiceHistoryOnInput: 'История выбора при вводе',
  Indexing: 'Индексирование',
  FullTextSearch: 'Полнотекстовый поиск',
  DataHistory: 'История данных',
  LinkByType: 'Связь по типу',
  DenyIncompleteValues: 'Запрет неполного ввода',
  RoundingMode: 'Режим округления',
  ShowInTotal: 'Показывать итог',
  LineNumberLength: 'Длина номера строки',
  StandardAttributes: 'Стандартные реквизиты',
  ObjectBelonging: 'Владение объектом',
  ExtendedConfigurationObject: 'Расширенный объект конфигурации',
  CodeLength: 'Длина кода',
  CodeAllowedLength: 'Допустимая длина кода',
  CodeSeries: 'Серия кодов',
  CheckUnique: 'Контроль уникальности',
  Autonumbering: 'Автонумерация',
  DefaultPresentation: 'Основное представление',
  EditType: 'Тип кода',
  DefaultObjectForm: 'Основная форма объекта',
  DefaultRecordForm: 'Основная форма записи',
  DefaultListForm: 'Основная форма списка',
  DefaultChoiceForm: 'Основная форма выбора',
  AuxiliaryObjectForm: 'Дополнительная форма объекта',
  AuxiliaryRecordForm: 'Дополнительная форма записи',
  AuxiliaryListForm: 'Дополнительная форма списка',
  AuxiliaryChoiceForm: 'Дополнительная форма выбора',
  InputByString: 'Ввод по строке',
  SearchStringModeOnInputByString: 'Режим строки поиска при вводе по строке',
  FullTextSearchOnInputByString: 'Полнотекстовый поиск при вводе по строке',
  ChoiceDataGetModeOnInputByString: 'Режим получения данных при вводе по строке',
  Characteristics: 'Характеристики',
  BasedOn: 'Вводится на основании',
  StandardTabularSections: 'Стандартные табличные части',
  DistributedInfoBase: 'Распределённая информационная база',
  ThisNodeBelongsToExchangePlan: 'Узел принадлежит плану обмена',
  SendData: 'Отправка данных',
  ReceiveData: 'Получение данных',
  SequentialDataExchange: 'Последовательный обмен данными',
  NumberType: 'Тип номера',
  NumberLength: 'Длина номера',
  NumberAllowedLength: 'Допустимая длина номера',
  NumberPeriodicity: 'Периодичность номера',
  Posting: 'Проведение',
  RealTimePosting: 'Оперативное проведение',
  RegisterRecordsDeletion: 'Удаление движений',
  RegisterRecordsWritingOnPost: 'Запись движений при проведении',
  SequenceFilling: 'Заполнение последовательностей',
  RegisterRecords: 'Движения',
  PostInPrivilegedMode: 'Проведение в привилегированном режиме',
  UnpostInPrivilegedMode: 'Отмена проведения в привилегированном режиме',
  Group: 'Группа командного интерфейса',
  Representation: 'Представление',
  Modality: 'Модальность',
  IncludeHelpInContents: 'Включать справку в содержимое',
  FormType: 'Тип формы',
  UseStandardCommands: 'Использовать стандартные команды',
  ChoiceMode: 'Режим выбора',
  Color: 'Цвет',
  Explanation: 'Пояснение',
  ExtendedExplanation: 'Расширенное пояснение',
  DataLockControlMode: 'Режим управления блокировкой данных',
  TemplateType: 'Тип макета',
};

/** Общие поля корневого объекта (справочник, документ, план обмена, …) */
const COMMON_ROOT_META_PROPERTY_KEYS: string[] = [
  'Name',
  'Synonym',
  'Comment',
  'ObjectBelonging',
  'ExtendedConfigurationObject',
  'DefaultObjectForm',
  'DefaultRecordForm',
  'DefaultListForm',
  'DefaultChoiceForm',
  'AuxiliaryObjectForm',
  'AuxiliaryRecordForm',
  'AuxiliaryListForm',
  'AuxiliaryChoiceForm',
  'InputByString',
  'SearchStringModeOnInputByString',
  'FullTextSearchOnInputByString',
  'ChoiceDataGetModeOnInputByString',
  'CreateOnInput',
  'ChoiceHistoryOnInput',
  'DataLockControlMode',
  'FullTextSearch',
  'ObjectPresentation',
  'ExtendedObjectPresentation',
  'ListPresentation',
  'ExtendedListPresentation',
  'Explanation',
  'BasedOn',
];

/** Поля корня «Перечисление» (без реквизитов/ТЧ/форм объекта метаданных) */
const ENUM_ROOT_META_PROPERTY_KEYS: string[] = [
  'Name',
  'Synonym',
  'Comment',
  'ObjectBelonging',
  'ExtendedConfigurationObject',
  'UseStandardCommands',
  'QuickChoice',
  'ChoiceMode',
  'DefaultListForm',
  'DefaultChoiceForm',
  'AuxiliaryListForm',
  'AuxiliaryChoiceForm',
  'ListPresentation',
  'ExtendedListPresentation',
  'Explanation',
  'ChoiceHistoryOnInput',
];

/** Дополнительные поля корня «План обмена» */
const EXCHANGE_PLAN_ROOT_EXTRA_KEYS: string[] = [
  'CodeLength',
  'CodeAllowedLength',
  'CodeSeries',
  'CheckUnique',
  'Autonumbering',
  'DefaultPresentation',
  'EditType',
  'Characteristics',
  'StandardAttributes',
  'StandardTabularSections',
  'DistributedInfoBase',
  'ThisNodeBelongsToExchangePlan',
  'SendData',
  'ReceiveData',
  'SequentialDataExchange',
];

/** Дополнительные поля корня «Документ» */
const DOCUMENT_ROOT_EXTRA_KEYS: string[] = [
  'UseStandardCommands',
  'NumberType',
  'NumberLength',
  'NumberAllowedLength',
  'NumberPeriodicity',
  'CheckUnique',
  'Autonumbering',
  'Posting',
  'RealTimePosting',
  'RegisterRecordsDeletion',
  'RegisterRecordsWritingOnPost',
  'SequenceFilling',
  'RegisterRecords',
  'PostInPrivilegedMode',
  'UnpostInPrivilegedMode',
  'IncludeHelpInContents',
];

/** Поля типового реквизита / колонки / измерения / ресурса */
const TYPED_FIELD_PROPERTY_KEYS: string[] = [
  'Name',
  'Synonym',
  'Comment',
  'Type',
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
  'ChoiceForm',
  'QuickChoice',
  'CreateOnInput',
  'ChoiceHistoryOnInput',
  'Indexing',
  'FullTextSearch',
  'DataHistory',
  'LinkByType',
  'DenyIncompleteValues',
  'RoundingMode',
  'ShowInTotal',
];

/** Поля табличной части */
const TABULAR_SECTION_PROPERTY_KEYS: string[] = [
  'Name',
  'Synonym',
  'Comment',
  'ToolTip',
  'FillChecking',
  'StandardAttributes',
  'LineNumberLength',
];

/** Поля формы (файл описания формы) */
const FORM_PROPERTY_KEYS: string[] = [
  'Name',
  'Synonym',
  'Comment',
  'FormType',
  'IncludeHelpInContents',
  'UseStandardCommands',
];

/** Поля команды */
const COMMAND_PROPERTY_KEYS: string[] = [
  'Name',
  'Synonym',
  'Comment',
  'Group',
  'Representation',
  'Modality',
  'IncludeHelpInContents',
];

/** Поля значения перечисления (в т.ч. оформление в списке) */
const ENUM_VALUE_PROPERTY_KEYS: string[] = ['Name', 'Synonym', 'Comment', 'Color'];

/** Порядок ключей корня по типу объекта */
export function getRootPropertyKeyOrder(rootMetaKind: NodeKind): string[] {
  if (rootMetaKind === 'ExchangePlan') {
    return [...COMMON_ROOT_META_PROPERTY_KEYS, ...EXCHANGE_PLAN_ROOT_EXTRA_KEYS];
  }
  if (rootMetaKind === 'Enum') {
    return ENUM_ROOT_META_PROPERTY_KEYS;
  }
  if (rootMetaKind === 'Document') {
    return mergePropertyKeys(COMMON_ROOT_META_PROPERTY_KEYS, DOCUMENT_ROOT_EXTRA_KEYS);
  }
  return COMMON_ROOT_META_PROPERTY_KEYS;
}

/** Извлекает внутренность первого блока Properties корневого тега объекта (Catalog, ExchangePlan, …) */
export function extractRootObjectPropertiesInnerXml(fullXml: string): string | null {
  const rootMatch = fullXml.match(/<MetaDataObject[^>]*>\s*<([A-Za-z][A-Za-z0-9]*)\b/);
  const rootTag = rootMatch?.[1];
  if (!rootTag) {
    return null;
  }
  const re = new RegExp(`<${rootTag}\\b[^>]*>[\\s\\S]*?<Properties>([\\s\\S]*?)<\\/Properties>`);
  const m = re.exec(fullXml);
  return m?.[1] ?? null;
}

/** Внутренность блока Properties внутри XML-фрагмента элемента */
export function extractPropertiesInnerFromElement(elementXml: string): string | null {
  const m = /<Properties>([\s\S]*?)<\/Properties>/.exec(elementXml);
  return m?.[1] ?? null;
}

/** Локализованная строка свойства (как в общем модуле) */
export function extractLocalizedStringValue(xml: string, tagName: string): LocalizedStringValue {
  const sectionMatch = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`).exec(xml);
  if (!sectionMatch) {
    return { presentation: '', values: [] };
  }
  const values = Array.from(
    sectionMatch[1].matchAll(/<v8:item>\s*<v8:lang>([^<]*)<\/v8:lang>\s*<v8:content>([\s\S]*?)<\/v8:content>\s*<\/v8:item>/g)
  ).map((match) => ({
    lang: match[1].trim(),
    content: match[2].trim(),
  }));
  return {
    presentation: values[0]?.content ?? '',
    values,
  };
}

function isBooleanTrue(xml: string, tag: string): boolean {
  return (extractSimpleTag(xml, tag) ?? '').trim().toLowerCase() === 'true';
}

function summarizeTypeBlock(propertiesSource: string): string {
  const m = /<Type>([\s\S]*?)<\/Type>/.exec(propertiesSource);
  if (!m) {
    return '';
  }
  return m[1].trim();
}

function propertyTitle(key: string): string {
  return PROPERTY_TITLE_RU[key] ?? key;
}

function buildEnumValue(current: string, options: EnumPropertyOption[]): EnumPropertyValue {
  const opt = options.find((o) => o.value === current);
  return {
    current,
    currentLabel: opt?.label ?? current,
    allowedValues: options,
  };
}

/**
 * Строит список свойств из XML-текста блока {@code Properties} (или целого фрагмента элемента).
 */
export function buildPropertyItemsForKeys(
  xmlOrPropertiesInner: string,
  orderedKeys: string[],
  options?: { elementXmlForType?: string }
): ObjectPropertiesCollection {
  const propsInner = extractPropertiesInnerFromElement(xmlOrPropertiesInner) ?? xmlOrPropertiesInner;
  const typeSource = options?.elementXmlForType ?? xmlOrPropertiesInner;
  const items: ObjectPropertyItem[] = [];

  for (const key of orderedKeys) {
    if (key === 'Type') {
      const typeInner = summarizeTypeBlock(typeSource.includes('<Properties>') ? typeSource : propsInner);
      if (!typeInner) {
        continue;
      }
      items.push({
        key: 'Type',
        title: propertyTitle('Type'),
        kind: 'metadataType',
        value: parseMetadataType(typeInner),
      });
      continue;
    }

    if (LOCALIZED_PROPERTY_TAGS.has(key)) {
      const loc = extractLocalizedStringValue(propsInner, key);
      if (!loc.presentation && loc.values.length === 0) {
        continue;
      }
      items.push({
        key,
        title: propertyTitle(key),
        kind: 'localizedString',
        value: loc,
      });
      continue;
    }

    if (BOOLEAN_PROPERTY_TAGS.has(key)) {
      if (!propsInner.includes(`<${key}>`)) {
        continue;
      }
      items.push({
        key,
        title: propertyTitle(key),
        kind: 'boolean',
        value: isBooleanTrue(propsInner, key),
      });
      continue;
    }

    if (key === 'FillChecking') {
      const current = extractSimpleTag(propsInner, key) ?? 'DontCheck';
      if (!propsInner.includes('<FillChecking>')) {
        continue;
      }
      items.push({
        key,
        title: propertyTitle(key),
        kind: 'enum',
        value: buildEnumValue(current, FILL_CHECKING_OPTIONS),
      });
      continue;
    }

    if (key === 'Indexing') {
      const current = extractSimpleTag(propsInner, key) ?? 'DontIndex';
      if (!propsInner.includes('<Indexing>')) {
        continue;
      }
      items.push({
        key,
        title: propertyTitle(key),
        kind: 'enum',
        value: buildEnumValue(current, INDEXING_OPTIONS),
      });
      continue;
    }

    const raw = extractSimpleTag(propsInner, key);
    if (raw === undefined && !hasSelfClosingProperty(propsInner, key)) {
      continue;
    }
    items.push({
      key,
      title: propertyTitle(key),
      kind: 'string',
      value: raw ?? '',
    });
  }

  return items;
}

/**
 * Строит свойства с учётом заимствования: локальное значение имеет приоритет,
 * совпадающее с основной конфигурацией значение считается унаследованным.
 */
export function buildEffectivePropertyItemsForKeys(
  localXmlOrPropertiesInner: string,
  inheritedXmlOrPropertiesInner: string | null | undefined,
  orderedKeys: string[],
  options?: {
    elementXmlForType?: string;
    inheritedElementXmlForType?: string;
    includeExtraKeys?: boolean;
  }
): ObjectPropertiesCollection {
  if (!inheritedXmlOrPropertiesInner) {
    return buildPropertyItemsForKeys(localXmlOrPropertiesInner, orderedKeys, {
      elementXmlForType: options?.elementXmlForType,
    }).map(markLocal);
  }

  const effectiveKeys = options?.includeExtraKeys
    ? extendKeysWithTopLevelProperties(orderedKeys, [localXmlOrPropertiesInner, inheritedXmlOrPropertiesInner])
    : orderedKeys;

  const localItems = buildPropertyItemsForKeys(localXmlOrPropertiesInner, effectiveKeys, {
    elementXmlForType: options?.elementXmlForType,
  });
  const inheritedItems = buildPropertyItemsForKeys(inheritedXmlOrPropertiesInner, effectiveKeys, {
    elementXmlForType: options?.inheritedElementXmlForType ?? inheritedXmlOrPropertiesInner,
  });

  const localByKey = new Map(localItems.map((item) => [item.key, item]));
  const inheritedByKey = new Map(inheritedItems.map((item) => [item.key, item]));
  const result: ObjectPropertyItem[] = [];

  for (const key of effectiveKeys) {
    const local = localByKey.get(key);
    const inherited = inheritedByKey.get(key);
    if (local && inherited && arePropertyItemsEquivalent(local, inherited)) {
      result.push(markInherited(local));
      continue;
    }
    if (local) {
      result.push(markLocal(local));
      continue;
    }
    if (inherited) {
      result.push(markInherited(inherited));
    }
  }

  return result;
}

/** Свойства корневого объекта метаданных по его полному XML */
export function buildRootMetaObjectProperties(
  fullObjectXml: string,
  rootMetaKind: NodeKind,
  inheritedFullObjectXml?: string | null
): ObjectPropertiesCollection {
  const inner = extractRootObjectPropertiesInnerXml(fullObjectXml);
  if (!inner) {
    return [];
  }
  const inheritedInner = inheritedFullObjectXml
    ? extractRootObjectPropertiesInnerXml(inheritedFullObjectXml)
    : null;
  return buildEffectivePropertyItemsForKeys(inner, inheritedInner, getRootPropertyKeyOrder(rootMetaKind), {
    includeExtraKeys: Boolean(inheritedInner),
  });
}

/** Свойства типового реквизита / измерения / ресурса / колонки */
export function buildTypedFieldProperties(
  elementFullXml: string,
  inheritedElementFullXml?: string | null
): ObjectPropertiesCollection {
  const keySource = elementFullXml || inheritedElementFullXml || '';
  return buildEffectivePropertyItemsForKeys(elementFullXml, inheritedElementFullXml, getTypedFieldPropertyKeyOrder(keySource), {
    elementXmlForType: elementFullXml,
    inheritedElementXmlForType: inheritedElementFullXml ?? undefined,
  });
}

function hasSelfClosingProperty(xml: string, key: string): boolean {
  return new RegExp(`<${key}(?:\\s[^>]*)?\\/>`).test(xml);
}

function getTypedFieldPropertyKeyOrder(elementFullXml: string): string[] {
  const tag = /^<([A-Za-z][A-Za-z0-9]*)\b/.exec(elementFullXml.trimStart())?.[1];
  const typeInner = summarizeTypeBlock(elementFullXml);
  if (
    typeInner &&
    (tag === 'Attribute' || tag === 'AddressingAttribute' || tag === 'Dimension' || tag === 'Resource')
  ) {
    return ['Name', 'Synonym', 'Comment', 'Type', ...getTypedFieldPropertyKeys(tag, typeInner)];
  }
  return TYPED_FIELD_PROPERTY_KEYS;
}

export function buildTabularSectionProperties(
  elementFullXml: string,
  inheritedElementFullXml?: string | null
): ObjectPropertiesCollection {
  return buildEffectivePropertyItemsForKeys(elementFullXml, inheritedElementFullXml, TABULAR_SECTION_PROPERTY_KEYS);
}

export function buildFormLikeProperties(elementFullXml: string, inheritedElementFullXml?: string | null): ObjectPropertiesCollection {
  return buildEffectivePropertyItemsForKeys(elementFullXml, inheritedElementFullXml, FORM_PROPERTY_KEYS);
}

export function buildCommandProperties(elementFullXml: string, inheritedElementFullXml?: string | null): ObjectPropertiesCollection {
  return buildEffectivePropertyItemsForKeys(elementFullXml, inheritedElementFullXml, COMMAND_PROPERTY_KEYS);
}

export function buildEnumValueProperties(elementFullXml: string, inheritedElementFullXml?: string | null): ObjectPropertiesCollection {
  return buildEffectivePropertyItemsForKeys(elementFullXml, inheritedElementFullXml, ENUM_VALUE_PROPERTY_KEYS);
}

const TEMPLATE_META_PROPERTY_KEYS: string[] = ['Name', 'Synonym', 'Comment', 'TemplateType'];

/** Свойства макета по файлу описания в каталоге Templates */
export function buildTemplateMetaProperties(elementFullXml: string, inheritedElementFullXml?: string | null): ObjectPropertiesCollection {
  return buildEffectivePropertyItemsForKeys(elementFullXml, inheritedElementFullXml, TEMPLATE_META_PROPERTY_KEYS);
}

const READONLY_SYSTEM_PROPERTY_KEYS = new Set(['ObjectBelonging', 'ExtendedConfigurationObject']);

function markInherited(item: ObjectPropertyItem): ObjectPropertyItem {
  return {
    ...item,
    inherited: true,
    readonly: true,
    source: 'inherited',
  };
}

function markLocal(item: ObjectPropertyItem): ObjectPropertyItem {
  if (!READONLY_SYSTEM_PROPERTY_KEYS.has(item.key)) {
    return {
      ...item,
      source: 'local',
    };
  }

  return {
    ...item,
    readonly: true,
    source: 'local',
  };
}

function extendKeysWithTopLevelProperties(orderedKeys: string[], sources: string[]): string[] {
  const result = [...orderedKeys];
  const seen = new Set(result);

  for (const source of sources) {
    const propertiesXml = source.includes('<Properties') ? source : `<Properties>${source}</Properties>`;
    for (const child of extractTopLevelPropertiesChildren(propertiesXml)) {
      if (seen.has(child.tag)) {
        continue;
      }
      seen.add(child.tag);
      result.push(child.tag);
    }
  }

  return result;
}

function mergePropertyKeys(...groups: string[][]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const key of group) {
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      result.push(key);
    }
  }
  return result;
}

function arePropertyItemsEquivalent(left: ObjectPropertyItem, right: ObjectPropertyItem): boolean {
  if (left.kind !== right.kind) {
    return false;
  }

  switch (left.kind) {
    case 'boolean':
      return left.value === right.value;
    case 'enum':
      return (left.value as EnumPropertyValue).current === (right.value as EnumPropertyValue).current;
    case 'localizedString':
      return areLocalizedValuesEquivalent(left.value as LocalizedStringValue, right.value as LocalizedStringValue);
    case 'metadataType':
      return areMetadataTypesEquivalent(left.value as MetadataTypeValue, right.value as MetadataTypeValue);
    case 'string':
    default:
      return normalizeScalarValue(String(left.value ?? '')) === normalizeScalarValue(String(right.value ?? ''));
  }
}

function areLocalizedValuesEquivalent(left: LocalizedStringValue, right: LocalizedStringValue): boolean {
  if (normalizeScalarValue(left.presentation) !== normalizeScalarValue(right.presentation)) {
    return false;
  }
  if (left.values.length !== right.values.length) {
    return false;
  }
  return left.values.every((item, index) => {
    const other = right.values[index];
    return item.lang === other?.lang && normalizeScalarValue(item.content) === normalizeScalarValue(other.content);
  });
}

function areMetadataTypesEquivalent(left: MetadataTypeValue, right: MetadataTypeValue): boolean {
  if (left.items.length !== right.items.length) {
    return false;
  }
  const sameItems = left.items.every((item, index) => item.canonical === right.items[index]?.canonical);
  if (!sameItems) {
    return false;
  }
  return (
    JSON.stringify(left.stringQualifiers ?? null) === JSON.stringify(right.stringQualifiers ?? null) &&
    JSON.stringify(left.numberQualifiers ?? null) === JSON.stringify(right.numberQualifiers ?? null) &&
    JSON.stringify(left.dateQualifiers ?? null) === JSON.stringify(right.dateQualifiers ?? null)
  );
}

function normalizeScalarValue(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
