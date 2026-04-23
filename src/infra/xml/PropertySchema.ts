/**
 * Декларативные схемы свойств объектов метаданных.
 *
 * Идея: всё, что панель свойств показывает по XML-фрагменту объекта —
 * это упорядоченный список ключей из блока `<Properties>`. Наборы ключей
 * и правила их отображения описываются тут, а не в хэндлерах.
 *
 * При добавлении нового набора свойств нужно:
 *   1) добавить ключ → подпись в `PROPERTY_TITLE_RU` (если отсутствует);
 *   2) при необходимости — расширить множества в `BOOLEAN_PROPERTY_TAGS` /
 *      `LOCALIZED_PROPERTY_TAGS` / enum-опции;
 *   3) зарегистрировать `PropertySchema` в `PROPERTY_SCHEMAS`;
 *   4) привязать схему к типу через поле `propertySchema` в `META_TYPES`.
 */

/** Опция enum-свойства (например, FillChecking, Indexing) */
export interface EnumPropertyOption {
  value: string;
  label: string;
}

/** Набор допустимых enum-значений по ключу */
export type EnumOptionsMap = Readonly<Record<string, readonly EnumPropertyOption[]>>;

/** Описание схемы свойств: упорядоченный список XML-ключей */
export interface PropertySchema {
  /** Технический идентификатор схемы (соответствует META_TYPES.propertySchema) */
  id: string;
  /** Порядок ключей при отрисовке */
  keys: readonly string[];
  /**
   * Источник XML: целый фрагмент элемента (берём `<Properties>` внутри) или
   * уже извлечённая внутренность `<Properties>`. По умолчанию — «фрагмент элемента».
   */
  source?: 'element' | 'propertiesInner';
}

/** Теги со строкой локализации (v8:item/v8:lang/v8:content) */
export const LOCALIZED_PROPERTY_TAGS: ReadonlySet<string> = new Set([
  'Synonym',
  'Comment',
  'ToolTip',
  'Explanation',
  'ExtendedExplanation',
]);

/** Теги булевых свойств */
export const BOOLEAN_PROPERTY_TAGS: ReadonlySet<string> = new Set([
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
]);

export const ENUM_OPTIONS: EnumOptionsMap = {
  FillChecking: [
    { value: 'DontCheck', label: 'Не проверять' },
    { value: 'ShowError', label: 'Выдавать ошибку' },
    { value: 'ShowWarning', label: 'Показывать предупреждение' },
  ],
  Indexing: [
    { value: 'DontIndex', label: 'Не индексировать' },
    { value: 'Index', label: 'Индексировать' },
    { value: 'IndexWithAdditionalOrder', label: 'Индексировать с дополнительным упорядочиванием' },
  ],
};

/** Значения enum-свойств по умолчанию, когда тег отсутствует, но ключ пришёл в схеме */
export const ENUM_DEFAULTS: Readonly<Record<string, string>> = {
  FillChecking: 'DontCheck',
  Indexing: 'DontIndex',
};

/** Русские подписи известных тегов свойств */
export const PROPERTY_TITLE_RU: Readonly<Record<string, string>> = {
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
  ObjectPresentation: 'Представление объекта',
  ExtendedObjectPresentation: 'Расширенное представление объекта',
  ListPresentation: 'Представление списка',
  ExtendedListPresentation: 'Расширенное представление списка',
};

// ── Наборы ключей по типам ─────────────────────────────────────────────

const COMMON_ROOT_KEYS = [
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
] as const;

const ENUM_ROOT_KEYS = [
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
] as const;

const EXCHANGE_PLAN_ROOT_EXTRA = [
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
] as const;

const TYPED_FIELD_KEYS = [
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
] as const;

const TABULAR_SECTION_KEYS = [
  'Name',
  'Synonym',
  'Comment',
  'ToolTip',
  'FillChecking',
  'StandardAttributes',
  'LineNumberLength',
] as const;

const FORM_KEYS = ['Name', 'Synonym', 'Comment', 'FormType', 'IncludeHelpInContents', 'UseStandardCommands'] as const;
const COMMAND_KEYS = ['Name', 'Synonym', 'Comment', 'Group', 'Representation', 'Modality', 'IncludeHelpInContents'] as const;
const ENUM_VALUE_KEYS = ['Name', 'Synonym', 'Comment', 'Color'] as const;
const TEMPLATE_KEYS = ['Name', 'Synonym', 'Comment', 'TemplateType'] as const;

/** Реестр схем по ключу `META_TYPES.propertySchema` */
export const PROPERTY_SCHEMAS: Readonly<Record<string, PropertySchema>> = {
  catalog: { id: 'catalog', keys: COMMON_ROOT_KEYS, source: 'propertiesInner' },
  document: { id: 'document', keys: COMMON_ROOT_KEYS, source: 'propertiesInner' },
  exchangePlan: {
    id: 'exchangePlan',
    keys: [...COMMON_ROOT_KEYS, ...EXCHANGE_PLAN_ROOT_EXTRA],
    source: 'propertiesInner',
  },
  enumRoot: { id: 'enumRoot', keys: ENUM_ROOT_KEYS, source: 'propertiesInner' },

  typedField: { id: 'typedField', keys: TYPED_FIELD_KEYS, source: 'element' },
  tabularSection: { id: 'tabularSection', keys: TABULAR_SECTION_KEYS, source: 'element' },
  form: { id: 'form', keys: FORM_KEYS, source: 'element' },
  command: { id: 'command', keys: COMMAND_KEYS, source: 'element' },
  enumValue: { id: 'enumValue', keys: ENUM_VALUE_KEYS, source: 'element' },
  template: { id: 'template', keys: TEMPLATE_KEYS, source: 'element' },

  // схемы для корневых «общих» объектов — включают сравнительно небольшой набор полей
  constant: {
    id: 'constant',
    keys: [
      'Name',
      'Synonym',
      'Comment',
      'Type',
      'Format',
      'EditFormat',
      'ToolTip',
      'FillChecking',
      'ChoiceFoldersAndItems',
      'ChoiceParameterLinks',
      'ChoiceForm',
    ],
    source: 'propertiesInner',
  },
  sessionParameter: {
    id: 'sessionParameter',
    keys: ['Name', 'Synonym', 'Comment', 'Type'],
    source: 'propertiesInner',
  },
  commonAttribute: {
    id: 'commonAttribute',
    keys: ['Name', 'Synonym', 'Comment', 'Type', 'Format', 'EditFormat', 'ToolTip', 'FillValue', 'FillChecking'],
    source: 'propertiesInner',
  },
};

/** Достаёт подпись для ключа (русскую, если известна) */
export function propertyTitle(key: string): string {
  return PROPERTY_TITLE_RU[key] ?? key;
}
