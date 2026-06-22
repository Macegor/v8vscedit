import type { NodeKind } from '../../tree/TreeNode';
import type {
  EnumPropertyOption,
  EnumPropertyValue,
  LocalizedStringValue,
  MetadataReferenceListValue,
  MetadataTypeValue,
  MultiEnumPropertyValue,
  ObjectPropertyItem,
  ObjectPropertiesCollection,
} from './_types';
import {
  escapeXmlText,
  extractElementInnerXml,
  extractFirstBalancedBlock,
  extractOpeningTagName,
  extractRepeatedSimpleTagValues,
  extractRootMetadataObjectElementXml,
  extractRootMetadataObjectPropertiesInnerXml,
  extractSimpleTag,
  extractTagInnerXml,
  extractTopLevelPropertiesChildren,
  extractXmlAttribute,
  hasSelfClosingXmlTag,
  parseLocalizedStringSection,
  stripXmlTagNamespacePrefixes,
} from '../../../infra/xml';
import {
  getTypedFieldPropertyKeys,
  isTypedFieldControlledPropertyKey,
  type TypeAwarePropertyOwnerKind,
} from '../../../infra/xml/TypedFieldPropertyRules';
import { parseMetadataType } from './MetadataTypeService';
import {
  formatEnumDisplayValue,
  formatPropertyDisplayValue,
  formatXmlPropertyDisplay,
  getPropertyTitle,
} from './PropertyPresentationRegistry';
import { getStandardAttributePresentation } from '../../../domain/StandardAttribute';

/** Теги со строкой локализации (v8:item) */
const LOCALIZED_PROPERTY_TAGS = new Set([
  'Synonym',
  'Comment',
  'Caption',
  'ShortCaption',
  'BriefInformation',
  'DetailedInformation',
  'Copyright',
  'VendorInformationAddress',
  'ConfigurationInformationAddress',
  'ToolTip',
  'ObjectPresentation',
  'ExtendedObjectPresentation',
  'ListPresentation',
  'ExtendedListPresentation',
  'Explanation',
  'ExtendedExplanation',
]);

/** Свойства, внутри которых хранится состав типа 1С. */
const TYPE_PROPERTY_TAGS = new Set(['Type', 'CommandParameterType']);

/** Теги булевых свойств в блоке Properties */
const BOOLEAN_PROPERTY_TAGS = new Set([
  'PasswordMode',
  'MarkNegatives',
  'MultiLine',
  'ExtendedEdit',
  'FillFromFillingValue',
  'DenyIncompleteValues',
  'ShowInTotal',
  'UseStandardCommands',
  'IncludeHelpInContents',
  'Modality',
  'ModifiesData',
  'Use',
  'Predefined',
  'Global',
  'ClientManagedApplication',
  'Server',
  'ExternalConnection',
  'ClientOrdinaryApplication',
  'ServerCall',
  'Privileged',
  'SetForNewObjects',
  'SetForAttributesByDefault',
  'IndependentRightsOfChildObjects',
  'CheckUnique',
  'Autonumbering',
  'Hierarchical',
  'LimitLevelCount',
  'FoldersOnTop',
  'IncludeConfigurationExtensions',
  'MainFilterOnPeriod',
  'EnableTotalsSliceFirst',
  'EnableTotalsSliceLast',
  'EnableTotalsSplitting',
  'Correspondence',
  'CreateTaskInPrivilegedMode',
  'Addressing',
  'TaskNumberAutoPrefix',
  'AutoOrderByCode',
  'DistributedInfoBase',
  'ThisNodeBelongsToExchangePlan',
  'SendData',
  'ReceiveData',
  'SequentialDataExchange',
  'PostInPrivilegedMode',
  'UnpostInPrivilegedMode',
  'KeepMappingToExtendedConfigurationObjectsByIDs',
  'UseManagedFormInOrdinaryApplication',
  'UseOrdinaryFormInManagedApplication',
  'Hierarchical',
  'LimitLevelCount',
  'FoldersOnTop',
  'UpdateDataHistoryImmediatelyAfterWrite',
  'ExecuteAfterWriteDataHistoryVersionProcessing',
]);

const ALWAYS_VISIBLE_STRING_PROPERTY_TAGS = new Set([
  'MethodName',
]);

const DEFAULT_ENUM_PROPERTY_VALUES: Readonly<Record<string, string>> = {
  CodeAllowedLength: 'Variable',
  NumberAllowedLength: 'Variable',
  CodeType: 'String',
  NumberType: 'String',
  CodeSeries: 'WholeCatalog',
  NumberPeriodicity: 'Nonperiodical',
  DefaultPresentation: 'AsDescription',
  EditType: 'InDialog',
  Posting: 'Allow',
  RealTimePosting: 'Deny',
  RegisterRecordsDeletion: 'AutoDelete',
  RegisterRecordsWritingOnPost: 'WriteSelected',
  SequenceFilling: 'AutoFill',
  ChoiceMode: 'FromForm',
  FormType: 'Managed',
  Representation: 'Auto',
  TemplateType: 'SpreadsheetDocument',
  RegisterType: 'Balance',
  InformationRegisterPeriodicity: 'Nonperiodical',
  WriteMode: 'Independent',
  ReturnValuesReuse: 'DontUse',
  ReuseSessions: 'DontUse',
  ParameterUseMode: 'Single',
  OnMainServerUnavalableBehavior: 'Auto',
  HierarchyType: 'HierarchyFoldersAndItems',
  SubordinationUse: 'ToItems',
  AutoUse: 'DontUse',
  PredefinedDataUpdate: 'Auto',
};

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

const COMMAND_INTERFACE_GROUP_OPTIONS: EnumPropertyOption[] = [
  { value: 'NavigationPanelImportant', label: 'Панель навигации: важное' },
  { value: 'NavigationPanelOrdinary', label: 'Панель навигации: обычное' },
  { value: 'NavigationPanelSeeAlso', label: 'Панель навигации: см. также' },
  { value: 'ActionsPanelCreate', label: 'Панель действий: создать' },
  { value: 'ActionsPanelReports', label: 'Панель действий: отчёты' },
  { value: 'ActionsPanelTools', label: 'Панель действий: сервис' },
  { value: 'FormNavigationPanelImportant', label: 'Панель навигации формы: важное' },
  { value: 'FormNavigationPanelGoTo', label: 'Панель навигации формы: перейти' },
  { value: 'FormNavigationPanelSeeAlso', label: 'Панель навигации формы: см. также' },
  { value: 'FormCommandBarImportant', label: 'Командная панель формы: важное' },
  { value: 'FormCommandBarCreateBasedOn', label: 'Командная панель формы: создать на основании' },
];

const COMPATIBILITY_MODE_OPTIONS: EnumPropertyOption[] = [
  { value: 'DontUse', label: 'Не использовать' },
  { value: 'Version8_1', label: 'Версия 8.1' },
  { value: 'Version8_2_13', label: 'Версия 8.2.13' },
  { value: 'Version8_2_16', label: 'Версия 8.2.16' },
  { value: 'Version8_3_1', label: 'Версия 8.3.1' },
  { value: 'Version8_3_2', label: 'Версия 8.3.2' },
  { value: 'Version8_3_3', label: 'Версия 8.3.3' },
  { value: 'Version8_3_4', label: 'Версия 8.3.4' },
  { value: 'Version8_3_5', label: 'Версия 8.3.5' },
  { value: 'Version8_3_6', label: 'Версия 8.3.6' },
  { value: 'Version8_3_7', label: 'Версия 8.3.7' },
  { value: 'Version8_3_8', label: 'Версия 8.3.8' },
  { value: 'Version8_3_9', label: 'Версия 8.3.9' },
  { value: 'Version8_3_10', label: 'Версия 8.3.10' },
  { value: 'Version8_3_11', label: 'Версия 8.3.11' },
  { value: 'Version8_3_12', label: 'Версия 8.3.12' },
  { value: 'Version8_3_13', label: 'Версия 8.3.13' },
  { value: 'Version8_3_14', label: 'Версия 8.3.14' },
  { value: 'Version8_3_15', label: 'Версия 8.3.15' },
  { value: 'Version8_3_16', label: 'Версия 8.3.16' },
  { value: 'Version8_3_17', label: 'Версия 8.3.17' },
  { value: 'Version8_3_18', label: 'Версия 8.3.18' },
  { value: 'Version8_3_19', label: 'Версия 8.3.19' },
  { value: 'Version8_3_20', label: 'Версия 8.3.20' },
  { value: 'Version8_3_21', label: 'Версия 8.3.21' },
  { value: 'Version8_3_22', label: 'Версия 8.3.22' },
  { value: 'Version8_3_23', label: 'Версия 8.3.23' },
  { value: 'Version8_3_24', label: 'Версия 8.3.24' },
  { value: 'Version8_3_25', label: 'Версия 8.3.25' },
  { value: 'Version8_3_26', label: 'Версия 8.3.26' },
  { value: 'Version8_3_27', label: 'Версия 8.3.27' },
  { value: 'Version8_3_28', label: 'Версия 8.3.28' },
  { value: 'Version8_5_1', label: 'Версия 8.5.1' },
];

const ENUM_PROPERTY_OPTIONS: Readonly<Record<string, readonly EnumPropertyOption[]>> = {
  FillChecking: FILL_CHECKING_OPTIONS,
  Indexing: INDEXING_OPTIONS,
  CodeAllowedLength: [
    { value: 'Variable', label: 'Переменная' },
    { value: 'Fixed', label: 'Фиксированная' },
  ],
  NumberAllowedLength: [
    { value: 'Variable', label: 'Переменная' },
    { value: 'Fixed', label: 'Фиксированная' },
  ],
  CodeType: [
    { value: 'String', label: 'Строка' },
    { value: 'Number', label: 'Число' },
  ],
  NumberType: [
    { value: 'String', label: 'Строка' },
    { value: 'Number', label: 'Число' },
  ],
  CodeSeries: [
    { value: 'WholeCatalog', label: 'Во всём справочнике' },
    { value: 'WithinSubordination', label: 'В пределах подчинения' },
    { value: 'WithinOwnerSubordination', label: 'В пределах подчинения владельцу' },
    { value: 'WholeCharacteristicKind', label: 'Во всём виде характеристик' },
    { value: 'WholeChartOfAccounts', label: 'Во всём плане счетов' },
  ],
  NumberPeriodicity: [
    { value: 'Nonperiodical', label: 'Непериодический' },
    { value: 'Year', label: 'Год' },
    { value: 'Quarter', label: 'Квартал' },
    { value: 'Month', label: 'Месяц' },
    { value: 'Day', label: 'День' },
  ],
  ChoiceFoldersAndItems: [
    { value: 'Items', label: 'Элементы' },
    { value: 'Folders', label: 'Группы' },
    { value: 'FoldersAndItems', label: 'Группы и элементы' },
  ],
  ChoiceHistoryOnInput: [
    { value: 'Auto', label: 'Автоматически' },
    { value: 'DontUse', label: 'Не использовать' },
  ],
  QuickChoice: [
    { value: 'Auto', label: 'Автоматически' },
    { value: 'DontUse', label: 'Не использовать' },
    { value: 'Use', label: 'Использовать' },
  ],
  CreateOnInput: [
    { value: 'Auto', label: 'Автоматически' },
    { value: 'DontUse', label: 'Не использовать' },
    { value: 'Use', label: 'Использовать' },
  ],
  FullTextSearch: [
    { value: 'DontUse', label: 'Не использовать' },
    { value: 'Use', label: 'Использовать' },
  ],
  FullTextSearchOnInputByString: [
    { value: 'DontUse', label: 'Не использовать' },
    { value: 'Use', label: 'Использовать' },
  ],
  DataHistory: [
    { value: 'DontUse', label: 'Не использовать' },
    { value: 'Use', label: 'Использовать' },
  ],
  SearchStringModeOnInputByString: [
    { value: 'Begin', label: 'С начала строки' },
    { value: 'AnyPart', label: 'Любая часть строки' },
  ],
  ChoiceDataGetModeOnInputByString: [
    { value: 'Directly', label: 'Непосредственно' },
  ],
  DefaultPresentation: [
    { value: 'AsCode', label: 'В виде кода' },
    { value: 'AsDescription', label: 'В виде наименования' },
  ],
  EditType: [
    { value: 'InList', label: 'В списке' },
    { value: 'InDialog', label: 'В диалоге' },
    { value: 'BothWays', label: 'Обоими способами' },
  ],
  Posting: [
    { value: 'Allow', label: 'Разрешить' },
    { value: 'Deny', label: 'Запретить' },
  ],
  RealTimePosting: [
    { value: 'Allow', label: 'Разрешить' },
    { value: 'Deny', label: 'Запретить' },
  ],
  RegisterRecordsDeletion: [
    { value: 'AutoDelete', label: 'Удалять автоматически' },
    { value: 'AutoDeleteOnUnpost', label: 'Удалять автоматически при отмене проведения' },
    { value: 'AutoDeleteOff', label: 'Не удалять автоматически' },
  ],
  RegisterRecordsWritingOnPost: [
    { value: 'WriteSelected', label: 'Записывать выбранные' },
    { value: 'WriteModified', label: 'Записывать изменённые' },
  ],
  SequenceFilling: [
    { value: 'AutoFill', label: 'Заполнять автоматически' },
    { value: 'AutoFillOff', label: 'Не заполнять автоматически' },
  ],
  ChoiceMode: [
    { value: 'FromForm', label: 'Из формы' },
    { value: 'QuickChoice', label: 'Быстрый выбор' },
    { value: 'BothWays', label: 'Обоими способами' },
  ],
  FormType: [
    { value: 'Managed', label: 'Управляемая' },
  ],
  Representation: [
    { value: 'Auto', label: 'Автоматически' },
    { value: 'Text', label: 'Текст' },
    { value: 'Picture', label: 'Картинка' },
    { value: 'PictureAndText', label: 'Картинка и текст' },
  ],
  Group: COMMAND_INTERFACE_GROUP_OPTIONS,
  TemplateType: [
    { value: 'SpreadsheetDocument', label: 'Табличный документ' },
    { value: 'TextDocument', label: 'Текстовый документ' },
    { value: 'HTMLDocument', label: 'HTML-документ' },
    { value: 'BinaryData', label: 'Двоичные данные' },
    { value: 'DataCompositionSchema', label: 'Схема компоновки данных' },
    { value: 'DataCompositionAppearanceTemplate', label: 'Шаблон оформления компоновки данных' },
    { value: 'GraphicalSchema', label: 'Графическая схема' },
    { value: 'AddIn', label: 'Внешняя компонента' },
  ],
  UseInInterfaceCompatibilityMode: [
    { value: 'Any', label: 'Любой' },
    { value: 'Version85', label: 'Версия 8.5' },
  ],
  RegisterType: [
    { value: 'Balance', label: 'Остатки' },
    { value: 'Turnovers', label: 'Обороты' },
  ],
  InformationRegisterPeriodicity: [
    { value: 'Nonperiodical', label: 'Непериодический' },
    { value: 'Second', label: 'Секунда' },
    { value: 'Day', label: 'День' },
    { value: 'Month', label: 'Месяц' },
    { value: 'Quarter', label: 'Квартал' },
    { value: 'Year', label: 'Год' },
    { value: 'RecorderPosition', label: 'Позиция регистратора' },
  ],
  WriteMode: [
    { value: 'Independent', label: 'Независимый' },
    { value: 'RecorderSubordinate', label: 'Подчинение регистратору' },
  ],
  ReturnValuesReuse: [
    { value: 'DontUse', label: 'Не использовать' },
    { value: 'DuringRequest', label: 'На время вызова' },
    { value: 'DuringSession', label: 'На время сеанса' },
  ],
  ReuseSessions: [
    { value: 'AutoUse', label: 'Использовать автоматически' },
    { value: 'DontUse', label: 'Не использовать' },
    { value: 'Use', label: 'Использовать' },
  ],
  ParameterUseMode: [
    { value: 'Single', label: 'Одиночный' },
    { value: 'Multiple', label: 'Множественный' },
  ],
  OnMainServerUnavalableBehavior: [
    { value: 'Auto', label: 'Авто' },
    { value: 'DontChangeBehavior', label: 'Не изменять поведение' },
  ],
  HierarchyType: [
    { value: 'HierarchyFoldersAndItems', label: 'Иерархия групп и элементов' },
    { value: 'HierarchyOfItems', label: 'Иерархия элементов' },
  ],
  SubordinationUse: [
    { value: 'ToItems', label: 'Элементам' },
    { value: 'ToFolders', label: 'Группам' },
    { value: 'ToFoldersAndItems', label: 'Группам и элементам' },
  ],
  AutoUse: [
    { value: 'DontUse', label: 'Не использовать' },
    { value: 'Use', label: 'Использовать' },
  ],
  PredefinedDataUpdate: [
    { value: 'Auto', label: 'Автоматически' },
    { value: 'AutoUpdate', label: 'Автообновление' },
    { value: 'DontAutoUpdate', label: 'Не обновлять автоматически' },
  ],
  HTTPMethod: [
    { value: 'GET', label: 'Получение' },
    { value: 'POST', label: 'Отправка' },
    { value: 'PUT', label: 'Замена' },
    { value: 'DELETE', label: 'Удаление' },
  ],
  CompatibilityMode: COMPATIBILITY_MODE_OPTIONS,
  ConfigurationExtensionCompatibilityMode: COMPATIBILITY_MODE_OPTIONS,
  ConfigurationExtensionPurpose: [
    { value: 'Patch', label: 'Исправление' },
    { value: 'Customization', label: 'Адаптация' },
    { value: 'AddOn', label: 'Дополнение' },
  ],
  DefaultRunMode: [
    { value: 'ManagedApplication', label: 'Управляемое приложение' },
    { value: 'OrdinaryApplication', label: 'Обычное приложение' },
    { value: 'Auto', label: 'Автоматически' },
  ],
  ScriptVariant: [
    { value: 'Russian', label: 'Русский' },
    { value: 'English', label: 'Английский' },
  ],
  DataLockControlMode: [
    { value: 'Automatic', label: 'Автоматический' },
    { value: 'Managed', label: 'Управляемый' },
    { value: 'AutomaticAndManaged', label: 'Автоматический и управляемый' },
  ],
  ObjectAutonumerationMode: [
    { value: 'NotAutoFree', label: 'Не освобождать автоматически' },
    { value: 'AutoFree', label: 'Освобождать автоматически' },
  ],
  ModalityUseMode: [
    { value: 'DontUse', label: 'Не использовать' },
    { value: 'Use', label: 'Использовать' },
    { value: 'UseWithWarnings', label: 'Использовать с предупреждениями' },
  ],
  SynchronousPlatformExtensionAndAddInCallUseMode: [
    { value: 'DontUse', label: 'Не использовать' },
    { value: 'Use', label: 'Использовать' },
    { value: 'UseWithWarnings', label: 'Использовать с предупреждениями' },
  ],
  InterfaceCompatibilityMode: [
    { value: 'Version8_2', label: 'Версия 8.2' },
    { value: 'Version8_2EnableTaxi', label: 'Версия 8.2 с возможностью Такси' },
    { value: 'Taxi', label: 'Такси' },
    { value: 'TaxiEnableVersion8_2', label: 'Такси с возможностью версии 8.2' },
    { value: 'TaxiEnableVersion8_5', label: 'Такси с возможностью версии 8.5' },
    { value: 'Version8_5EnableTaxi', label: 'Версия 8.5 с возможностью Такси' },
    { value: 'Version8_5', label: 'Версия 8.5' },
  ],
  Version85InterfaceMigrationMode: [
    { value: 'DontUse', label: 'Не использовать' },
    { value: 'Use', label: 'Использовать' },
  ],
  DatabaseTablespacesUseMode: [
    { value: 'DontUse', label: 'Не использовать' },
    { value: 'Use', label: 'Использовать' },
  ],
  MainClientApplicationWindowMode: [
    { value: 'Normal', label: 'Обычный' },
    { value: 'Fullscreen', label: 'Полноэкранный' },
    { value: 'Kiosk', label: 'Киоск' },
  ],
  MainClientApplicationWindowInterfaceVariant: [
    { value: 'NavigationLeft', label: 'Панель разделов слева' },
    { value: 'NavigationTop', label: 'Панель разделов сверху' },
  ],
  ClientApplicationTheme: [
    { value: 'Auto', label: 'Автоматически' },
    { value: 'Light', label: 'Светлая' },
    { value: 'Dark', label: 'Тёмная' },
  ],
  ClientApplicationWindowsOpenVariant: [
    { value: 'OpenDataInTabs', label: 'Открывать в закладках' },
    { value: 'OpenDataInSeparateWindows', label: 'Открывать в отдельных окнах' },
  ],
};

const USE_PURPOSE_OPTIONS: EnumPropertyOption[] = [
  { value: 'PlatformApplication', label: 'Приложение платформы' },
  { value: 'MobilePlatformApplication', label: 'Мобильное приложение' },
];

/** Русские подписи известных тегов свойств */
const PROPERTY_TITLE_RU: Record<string, string> = {
  Name: 'Имя',
  Synonym: 'Синоним',
  Comment: 'Комментарий',
  Caption: 'Заголовок приложения',
  ShortCaption: 'Краткий заголовок приложения',
  BriefInformation: 'Краткая информация',
  DetailedInformation: 'Подробная информация',
  Copyright: 'Авторские права',
  VendorInformationAddress: 'Адрес информации о поставщике',
  ConfigurationInformationAddress: 'Адрес информации о конфигурации',
  Type: 'Тип',
  Source: 'Источник',
  PasswordMode: 'Режим пароля',
  Format: 'Формат',
  EditFormat: 'Формат редактирования',
  ToolTip: 'Подсказка',
  Picture: 'Картинка',
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
  ChoiceParameters: 'Параметры выбора',
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
  ConfigurationExtensionPurpose: 'Назначение расширения',
  KeepMappingToExtendedConfigurationObjectsByIDs: 'Сохранять соответствие объектам по идентификаторам',
  NamePrefix: 'Префикс имён',
  ConfigurationExtensionCompatibilityMode: 'Режим совместимости расширений конфигурации',
  CompatibilityMode: 'Режим совместимости',
  DefaultRunMode: 'Основной режим запуска',
  UsePurposes: 'Назначение использования',
  ScriptVariant: 'Вариант встроенного языка',
  DefaultRoles: 'Основные роли',
  Vendor: 'Поставщик',
  Version: 'Версия',
  UpdateCatalogAddress: 'Адрес каталога обновлений',
  UseManagedFormInOrdinaryApplication: 'Использовать управляемые формы в обычном приложении',
  UseOrdinaryFormInManagedApplication: 'Использовать обычные формы в управляемом приложении',
  AdditionalFullTextSearchDictionaries: 'Дополнительные словари полнотекстового поиска',
  CommonSettingsStorage: 'Общее хранилище настроек',
  ReportsUserSettingsStorage: 'Хранилище пользовательских настроек отчётов',
  ReportsVariantsStorage: 'Хранилище вариантов отчётов',
  FormDataSettingsStorage: 'Хранилище настроек данных форм',
  DynamicListsUserSettingsStorage: 'Хранилище пользовательских настроек динамических списков',
  URLExternalDataStorage: 'Адрес внешнего хранилища данных',
  Content: 'Содержимое',
  DefaultReportForm: 'Основная форма отчёта',
  DefaultReportVariantForm: 'Основная форма варианта отчёта',
  DefaultReportSettingsForm: 'Основная форма настроек отчёта',
  DefaultReportAppearanceTemplate: 'Основной шаблон оформления отчёта',
  DefaultDynamicListSettingsForm: 'Основная форма настроек динамического списка',
  DefaultSearchForm: 'Основная форма поиска',
  DefaultDataHistoryChangeHistoryForm: 'Основная форма истории изменений',
  DefaultDataHistoryVersionDataForm: 'Основная форма данных версии',
  DefaultDataHistoryVersionDifferencesForm: 'Основная форма различий версий',
  DefaultCollaborationSystemUsersChoiceForm: 'Основная форма выбора пользователей системы взаимодействия',
  AuxiliaryReportForm: 'Дополнительная форма отчёта',
  AuxiliaryReportVariantForm: 'Дополнительная форма варианта отчёта',
  AuxiliaryReportSettingsForm: 'Дополнительная форма настроек отчёта',
  AuxiliaryDynamicListSettingsForm: 'Дополнительная форма настроек динамического списка',
  AuxiliaryDataHistoryChangeHistoryForm: 'Дополнительная форма истории изменений',
  AuxiliaryDataHistoryVersionDataForm: 'Дополнительная форма данных версии',
  AuxiliaryDataHistoryVersionDifferencesForm: 'Дополнительная форма различий версий',
  AuxiliaryCollaborationSystemUsersChoiceForm: 'Дополнительная форма выбора пользователей системы взаимодействия',
  RequiredMobileApplicationPermissions: 'Требуемые разрешения мобильного приложения',
  UsedMobileApplicationFunctionalities: 'Используемые возможности мобильного приложения',
  StandaloneConfigurationRestrictionRoles: 'Роли ограничения автономной конфигурации',
  MobileApplicationURLs: 'URL мобильного приложения',
  AllowedIncomingShareRequestTypes: 'Разрешённые типы входящих запросов обмена',
  MainClientApplicationWindowInterfaceVariant: 'Вариант интерфейса основного окна клиентского приложения',
  ClientApplicationTheme: 'Тема клиентского приложения',
  MainClientApplicationWindowMode: 'Режим основного окна клиентского приложения',
  ClientApplicationWindowsOpenVariant: 'Вариант открытия окон клиентского приложения',
  DefaultInterface: 'Основной интерфейс',
  DefaultStyle: 'Основной стиль',
  DefaultLanguage: 'Основной язык',
  ObjectAutonumerationMode: 'Режим автоосвобождения номеров',
  ModalityUseMode: 'Режим использования модальности',
  SynchronousPlatformExtensionAndAddInCallUseMode: 'Режим синхронных вызовов расширений платформы и внешних компонент',
  InterfaceCompatibilityMode: 'Режим совместимости интерфейса',
  Version85InterfaceMigrationMode: 'Режим перехода интерфейса версии 8.5',
  DatabaseTablespacesUseMode: 'Режим использования табличных пространств базы данных',
  DefaultConstantsForm: 'Основная форма констант',
  CodeLength: 'Длина кода',
  CodeAllowedLength: 'Допустимая длина кода',
  CodeSeries: 'Серия кодов',
  CheckUnique: 'Контроль уникальности',
  Autonumbering: 'Автонумерация',
  DefaultPresentation: 'Основное представление',
  EditType: 'Способ редактирования',
  CodeType: 'Тип кода',
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
  BasedFor: 'Является основанием для',
  StandardTabularSections: 'Стандартные табличные части',
  DistributedInfoBase: 'Распределённая информационная база',
  ThisNodeBelongsToExchangePlan: 'Узел принадлежит плану обмена',
  SendData: 'Отправка данных',
  ReceiveData: 'Получение данных',
  SequentialDataExchange: 'Последовательный обмен данными',
  Numerator: 'Нумератор',
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
  CommandParameterType: 'Тип параметра команды',
  Representation: 'Представление',
  Modality: 'Модальность',
  IncludeHelpInContents: 'Включать справку в содержимое',
  FormType: 'Тип формы',
  UseStandardCommands: 'Использовать стандартные команды',
  DefaultForm: 'Основная форма',
  ExtendedPresentation: 'Расширенное представление',
  ChoiceMode: 'Режим выбора',
  Color: 'Цвет',
  ObjectPresentation: 'Представление объекта',
  ExtendedObjectPresentation: 'Расширенное представление объекта',
  ListPresentation: 'Представление списка',
  ExtendedListPresentation: 'Расширенное представление списка',
  Explanation: 'Пояснение',
  ExtendedExplanation: 'Расширенное пояснение',
  DataLockControlMode: 'Режим управления блокировкой данных',
  TemplateType: 'Тип макета',
  UseInInterfaceCompatibilityMode: 'Использовать в режиме совместимости интерфейса',
  RegisterType: 'Вид регистра',
  InformationRegisterPeriodicity: 'Периодичность регистра сведений',
  WriteMode: 'Режим записи',
  UseInTotals: 'Использовать в итогах',
  EnableTotalsSplitting: 'Разрешить разделение итогов',
  EnableTotalsSliceFirst: 'Разрешить итоги среза первых',
  EnableTotalsSliceLast: 'Разрешить итоги среза последних',
  ReturnValuesReuse: 'Повторное использование возвращаемых значений',
  ReuseSessions: 'Повторное использование сеансов',
  Server: 'Сервер',
  ExternalConnection: 'Внешнее соединение',
  ClientManagedApplication: 'Клиент управляемого приложения',
  ClientOrdinaryApplication: 'Клиент обычного приложения',
  Privileged: 'Привилегированный',
  Global: 'Глобальный',
  FunctionalOption: 'Функциональная опция',
  ParameterUseMode: 'Режим использования параметра',
  Hierarchical: 'Иерархический',
  HierarchyType: 'Вид иерархии',
  LimitLevelCount: 'Ограничение количества уровней иерархии',
  LevelCount: 'Количество уровней иерархии',
  FoldersOnTop: 'Группы сверху',
  SubordinationUse: 'Использование подчинения',
  Owners: 'Владельцы',
  DescriptionLength: 'Длина наименования',
  DefaultFolderForm: 'Основная форма группы',
  DefaultFolderChoiceForm: 'Основная форма выбора группы',
  AuxiliaryFolderForm: 'Дополнительная форма группы',
  AuxiliaryFolderChoiceForm: 'Дополнительная форма выбора группы',
  DataLockFields: 'Поля блокировки данных',
  ExtDimensionAccountingFlag: 'Признак учёта субконто',
  Balance: 'Баланс',
  AccountingFlag: 'Признак учёта',
  AutoUse: 'Автоиспользование',
  DataSeparation: 'Разделение данных',
  DataSeparationValue: 'Значение разделения данных',
  DataSeparationUse: 'Использование разделения данных',
  UsersSeparation: 'Разделение пользователей',
  AuthenticationSeparation: 'Разделение аутентификации',
  ConfigurationExtensionsSeparation: 'Разделение расширений конфигурации',
  SeparatedDataUse: 'Использование разделённых данных',
  IncludeConfigurationExtensions: 'Включать расширения конфигурации',
  PredefinedDataUpdate: 'Обновление предопределённых данных',
  Predefined: 'Предопределённый',
  Use: 'Использовать',
  MethodName: 'Имя метода',
  ModifiesData: 'Изменяет данные',
  OnMainServerUnavalableBehavior: 'Поведение при недоступности основного сервера',
  Shortcut: 'Сочетание клавиш',
  Transactioned: 'Транзакционный',
  UpdateDataHistoryImmediatelyAfterWrite: 'Обновлять историю данных сразу после записи',
  ExecuteAfterWriteDataHistoryVersionProcessing: 'Выполнять обработку версии истории данных после записи',
  HTTPMethod: 'Метод HTTP',
  RootURL: 'Корневой URL',
  Template: 'Шаблон',
  Handler: 'Обработчик',
  Event: 'Событие',
  ProcedureName: 'Имя процедуры',
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

/** Поля корня «Справочник» по разделам конфигуратора, без реквизитов и табличных частей. */
const CATALOG_ROOT_META_PROPERTY_KEYS: string[] = [
  'Name',
  'Synonym',
  'Comment',
  'ObjectPresentation',
  'ExtendedObjectPresentation',
  'ListPresentation',
  'ExtendedListPresentation',
  'Explanation',
  'ObjectBelonging',
  'ExtendedConfigurationObject',
  'Hierarchical',
  'HierarchyType',
  'FoldersOnTop',
  'LimitLevelCount',
  'LevelCount',
  'Owners',
  'SubordinationUse',
  'CodeLength',
  'DescriptionLength',
  'CodeType',
  'CodeAllowedLength',
  'CodeSeries',
  'CheckUnique',
  'Autonumbering',
  'DefaultPresentation',
  'DefaultObjectForm',
  'DefaultFolderForm',
  'DefaultListForm',
  'DefaultChoiceForm',
  'DefaultFolderChoiceForm',
  'AuxiliaryObjectForm',
  'AuxiliaryFolderForm',
  'AuxiliaryListForm',
  'AuxiliaryChoiceForm',
  'AuxiliaryFolderChoiceForm',
  'QuickChoice',
  'CreateOnInput',
  'InputByString',
  'SearchStringModeOnInputByString',
  'FullTextSearchOnInputByString',
  'ChoiceDataGetModeOnInputByString',
  'ChoiceHistoryOnInput',
  'UseStandardCommands',
  'BasedOn',
  'DataLockFields',
  'DataLockControlMode',
  'FullTextSearch',
  'DataHistory',
  'UpdateDataHistoryImmediatelyAfterWrite',
  'ExecuteAfterWriteDataHistoryVersionProcessing',
  'PredefinedDataUpdate',
  'Characteristics',
  'EditType',
  'IncludeHelpInContents',
];

const CATALOG_HIDDEN_PROPERTIES = new Set([
  'Characteristics',
]);

const CATALOG_READONLY_COMPLEX_PROPERTIES = new Set<string>();

const CATALOG_PROPERTY_SECTIONS: Readonly<Record<string, { title: string; order: number }>> = {
  _other: { title: 'Прочее', order: 900 },
  Name: { title: 'Основные', order: 10 },
  Synonym: { title: 'Основные', order: 10 },
  Comment: { title: 'Основные', order: 10 },
  ObjectPresentation: { title: 'Основные', order: 10 },
  ExtendedObjectPresentation: { title: 'Основные', order: 10 },
  ListPresentation: { title: 'Основные', order: 10 },
  ExtendedListPresentation: { title: 'Основные', order: 10 },
  Explanation: { title: 'Основные', order: 10 },
  Hierarchical: { title: 'Иерархия', order: 40 },
  HierarchyType: { title: 'Иерархия', order: 40 },
  FoldersOnTop: { title: 'Иерархия', order: 40 },
  LimitLevelCount: { title: 'Иерархия', order: 40 },
  LevelCount: { title: 'Иерархия', order: 40 },
  Owners: { title: 'Владельцы', order: 50 },
  SubordinationUse: { title: 'Владельцы', order: 50 },
  CodeLength: { title: 'Данные', order: 60 },
  DescriptionLength: { title: 'Данные', order: 60 },
  CodeType: { title: 'Данные', order: 60 },
  CodeAllowedLength: { title: 'Данные', order: 60 },
  DefaultPresentation: { title: 'Данные', order: 60 },
  EditType: { title: 'Данные', order: 60 },
  CodeSeries: { title: 'Нумерация', order: 70 },
  CheckUnique: { title: 'Нумерация', order: 70 },
  Autonumbering: { title: 'Нумерация', order: 70 },
  DefaultObjectForm: { title: 'Формы', order: 80 },
  DefaultFolderForm: { title: 'Формы', order: 80 },
  DefaultListForm: { title: 'Формы', order: 80 },
  DefaultChoiceForm: { title: 'Формы', order: 80 },
  DefaultFolderChoiceForm: { title: 'Формы', order: 80 },
  AuxiliaryObjectForm: { title: 'Формы', order: 80 },
  AuxiliaryFolderForm: { title: 'Формы', order: 80 },
  AuxiliaryListForm: { title: 'Формы', order: 80 },
  AuxiliaryChoiceForm: { title: 'Формы', order: 80 },
  AuxiliaryFolderChoiceForm: { title: 'Формы', order: 80 },
  QuickChoice: { title: 'Поле ввода', order: 90 },
  CreateOnInput: { title: 'Поле ввода', order: 90 },
  InputByString: { title: 'Поле ввода', order: 90 },
  SearchStringModeOnInputByString: { title: 'Поле ввода', order: 90 },
  FullTextSearchOnInputByString: { title: 'Поле ввода', order: 90 },
  ChoiceDataGetModeOnInputByString: { title: 'Поле ввода', order: 90 },
  ChoiceHistoryOnInput: { title: 'Поле ввода', order: 90 },
  UseStandardCommands: { title: 'Команды', order: 100 },
  BasedOn: { title: 'Ввод на основании', order: 120 },
  BasedFor: { title: 'Ввод на основании', order: 120 },
  DataLockFields: { title: 'Прочее', order: 900 },
  DataLockControlMode: { title: 'Служебное', order: 160 },
  FullTextSearch: { title: 'Прочее', order: 900 },
  DataHistory: { title: 'Прочее', order: 900 },
  UpdateDataHistoryImmediatelyAfterWrite: { title: 'Прочее', order: 900 },
  ExecuteAfterWriteDataHistoryVersionProcessing: { title: 'Прочее', order: 900 },
  PredefinedDataUpdate: { title: 'Прочее', order: 900 },
  IncludeHelpInContents: { title: 'Прочее', order: 900 },
  ObjectBelonging: { title: 'Служебное', order: 160 },
  ExtendedConfigurationObject: { title: 'Служебное', order: 160 },
};

/** Поля корня «Документ» по разделам конфигуратора, без реквизитов и табличных частей. */
const DOCUMENT_ROOT_META_PROPERTY_KEYS: string[] = [
  'Name',
  'Synonym',
  'Comment',
  'ObjectPresentation',
  'ExtendedObjectPresentation',
  'ListPresentation',
  'ExtendedListPresentation',
  'Explanation',
  'ObjectBelonging',
  'ExtendedConfigurationObject',
  'Numerator',
  'NumberType',
  'NumberLength',
  'NumberAllowedLength',
  'NumberPeriodicity',
  'CheckUnique',
  'Autonumbering',
  'DefaultObjectForm',
  'DefaultListForm',
  'DefaultChoiceForm',
  'AuxiliaryObjectForm',
  'AuxiliaryListForm',
  'AuxiliaryChoiceForm',
  'CreateOnInput',
  'InputByString',
  'SearchStringModeOnInputByString',
  'FullTextSearchOnInputByString',
  'ChoiceDataGetModeOnInputByString',
  'ChoiceHistoryOnInput',
  'UseStandardCommands',
  'BasedOn',
  'Posting',
  'RealTimePosting',
  'RegisterRecordsDeletion',
  'RegisterRecordsWritingOnPost',
  'SequenceFilling',
  'RegisterRecords',
  'PostInPrivilegedMode',
  'UnpostInPrivilegedMode',
  'DataLockFields',
  'DataLockControlMode',
  'FullTextSearch',
  'DataHistory',
  'UpdateDataHistoryImmediatelyAfterWrite',
  'ExecuteAfterWriteDataHistoryVersionProcessing',
  'Characteristics',
  'IncludeHelpInContents',
];

const DOCUMENT_HIDDEN_PROPERTIES = new Set([
  'Characteristics',
]);

const DOCUMENT_READONLY_COMPLEX_PROPERTIES = new Set<string>();

const DOCUMENT_PROPERTY_SECTIONS: Readonly<Record<string, { title: string; order: number }>> = {
  _other: { title: 'Прочее', order: 900 },
  Name: { title: 'Основные', order: 10 },
  Synonym: { title: 'Основные', order: 10 },
  Comment: { title: 'Основные', order: 10 },
  ObjectPresentation: { title: 'Основные', order: 10 },
  ExtendedObjectPresentation: { title: 'Основные', order: 10 },
  ListPresentation: { title: 'Основные', order: 10 },
  ExtendedListPresentation: { title: 'Основные', order: 10 },
  Explanation: { title: 'Основные', order: 10 },
  Numerator: { title: 'Нумерация', order: 50 },
  NumberType: { title: 'Нумерация', order: 50 },
  NumberLength: { title: 'Нумерация', order: 50 },
  NumberAllowedLength: { title: 'Нумерация', order: 50 },
  NumberPeriodicity: { title: 'Нумерация', order: 50 },
  CheckUnique: { title: 'Нумерация', order: 50 },
  Autonumbering: { title: 'Нумерация', order: 50 },
  DefaultObjectForm: { title: 'Формы', order: 80 },
  DefaultListForm: { title: 'Формы', order: 80 },
  DefaultChoiceForm: { title: 'Формы', order: 80 },
  AuxiliaryObjectForm: { title: 'Формы', order: 80 },
  AuxiliaryListForm: { title: 'Формы', order: 80 },
  AuxiliaryChoiceForm: { title: 'Формы', order: 80 },
  CreateOnInput: { title: 'Поле ввода', order: 90 },
  InputByString: { title: 'Поле ввода', order: 90 },
  SearchStringModeOnInputByString: { title: 'Поле ввода', order: 90 },
  FullTextSearchOnInputByString: { title: 'Поле ввода', order: 90 },
  ChoiceDataGetModeOnInputByString: { title: 'Поле ввода', order: 90 },
  ChoiceHistoryOnInput: { title: 'Поле ввода', order: 90 },
  UseStandardCommands: { title: 'Команды', order: 100 },
  BasedOn: { title: 'Ввод на основании', order: 120 },
  BasedFor: { title: 'Ввод на основании', order: 120 },
  Posting: { title: 'Проведение', order: 130 },
  RealTimePosting: { title: 'Проведение', order: 130 },
  RegisterRecordsDeletion: { title: 'Проведение', order: 130 },
  RegisterRecordsWritingOnPost: { title: 'Проведение', order: 130 },
  SequenceFilling: { title: 'Проведение', order: 130 },
  RegisterRecords: { title: 'Проведение', order: 130 },
  PostInPrivilegedMode: { title: 'Проведение', order: 130 },
  UnpostInPrivilegedMode: { title: 'Проведение', order: 130 },
  DataLockFields: { title: 'Прочее', order: 900 },
  DataLockControlMode: { title: 'Служебное', order: 160 },
  FullTextSearch: { title: 'Прочее', order: 900 },
  DataHistory: { title: 'Прочее', order: 900 },
  UpdateDataHistoryImmediatelyAfterWrite: { title: 'Прочее', order: 900 },
  ExecuteAfterWriteDataHistoryVersionProcessing: { title: 'Прочее', order: 900 },
  IncludeHelpInContents: { title: 'Прочее', order: 900 },
  ObjectBelonging: { title: 'Служебное', order: 160 },
  ExtendedConfigurationObject: { title: 'Служебное', order: 160 },
};

/** Дополнительные поля объектов с документной нумерацией/проведением. */
const DOCUMENT_LIKE_ROOT_EXTRA_KEYS: string[] = [
  'UseStandardCommands',
  'Numerator',
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

const DOCUMENT_NUMERATOR_ROOT_META_PROPERTY_KEYS: string[] = [
  'Name',
  'Synonym',
  'Comment',
  'NumberType',
  'NumberLength',
  'NumberAllowedLength',
  'NumberPeriodicity',
  'CheckUnique',
];

const REPORT_ROOT_META_PROPERTY_KEYS: string[] = [
  'Name',
  'Synonym',
  'Comment',
  'UseStandardCommands',
  'DefaultForm',
  'AuxiliaryForm',
  'MainDataCompositionSchema',
  'DefaultSettingsForm',
  'AuxiliarySettingsForm',
  'DefaultVariantForm',
  'AuxiliaryVariantForm',
  'VariantsStorage',
  'SettingsStorage',
  'IncludeHelpInContents',
  'ExtendedPresentation',
  'Explanation',
];

const DATA_PROCESSOR_ROOT_META_PROPERTY_KEYS: string[] = [
  'Name',
  'Synonym',
  'Comment',
  'UseStandardCommands',
  'DefaultForm',
  'AuxiliaryForm',
  'IncludeHelpInContents',
  'ExtendedPresentation',
  'Explanation',
];

const DOCUMENT_JOURNAL_ROOT_META_PROPERTY_KEYS: string[] = [
  'Name',
  'Synonym',
  'Comment',
  'DefaultForm',
  'AuxiliaryForm',
  'UseStandardCommands',
  'RegisteredDocuments',
  'IncludeHelpInContents',
  'ListPresentation',
  'ExtendedListPresentation',
  'Explanation',
];

const FILTER_CRITERION_ROOT_META_PROPERTY_KEYS: string[] = [
  'Name',
  'Synonym',
  'Comment',
  'Type',
  'UseStandardCommands',
  'Content',
  'DefaultForm',
  'AuxiliaryForm',
  'ListPresentation',
  'ExtendedListPresentation',
  'Explanation',
];

/** Поля корня «Регламентное задание» */
const SCHEDULED_JOB_ROOT_META_PROPERTY_KEYS: string[] = [
  'Name',
  'Synonym',
  'Comment',
  'MethodName',
  'Description',
  'Key',
  'Use',
  'Predefined',
  'RestartCountOnFailure',
  'RestartIntervalOnFailure',
];

const FUNCTIONAL_OPTION_ROOT_META_PROPERTY_KEYS: string[] = [
  'Name',
  'Synonym',
  'Comment',
  'Location',
  'PrivilegedGetMode',
  'Content',
];

const FUNCTIONAL_OPTIONS_PARAMETER_ROOT_META_PROPERTY_KEYS: string[] = [
  'Name',
  'Synonym',
  'Comment',
  'Use',
];

const SETTINGS_STORAGE_ROOT_META_PROPERTY_KEYS: string[] = [
  'Name',
  'Synonym',
  'Comment',
  'DefaultSaveForm',
  'DefaultLoadForm',
  'AuxiliarySaveForm',
  'AuxiliaryLoadForm',
];

const COMMAND_GROUP_ROOT_META_PROPERTY_KEYS: string[] = [
  'Name',
  'Synonym',
  'Comment',
  'Representation',
  'ToolTip',
  'Picture',
  'Category',
];

const COMMON_FORM_ROOT_META_PROPERTY_KEYS: string[] = [
  'Name',
  'Synonym',
  'Comment',
  'FormType',
  'IncludeHelpInContents',
  'UsePurposes',
  'UseInInterfaceCompatibilityMode',
  'UseStandardCommands',
  'ExtendedPresentation',
  'Explanation',
];

const COMMON_PICTURE_ROOT_META_PROPERTY_KEYS: string[] = [
  'Name',
  'Synonym',
  'Comment',
  'AvailabilityForChoice',
  'AvailabilityForAppearance',
];

const XDTO_PACKAGE_ROOT_META_PROPERTY_KEYS: string[] = [
  'Name',
  'Synonym',
  'Comment',
  'Namespace',
];

const WEB_SERVICE_ROOT_META_PROPERTY_KEYS: string[] = [
  'Name',
  'Synonym',
  'Comment',
  'Namespace',
  'XDTOPackages',
  'DescriptorFileName',
  'ReuseSessions',
  'SessionMaxAge',
];

const HTTP_SERVICE_ROOT_META_PROPERTY_KEYS: string[] = [
  'Name',
  'Synonym',
  'Comment',
  'RootURL',
  'ReuseSessions',
  'SessionMaxAge',
];

const WS_REFERENCE_ROOT_META_PROPERTY_KEYS: string[] = [
  'Name',
  'Synonym',
  'Comment',
  'LocationURL',
];

const INTEGRATION_SERVICE_ROOT_META_PROPERTY_KEYS: string[] = [
  'Name',
  'Synonym',
  'Comment',
  'ExternalIntegrationServiceAddress',
];

const STYLE_ROOT_META_PROPERTY_KEYS: string[] = ['Name', 'Synonym', 'Comment'];

const LANGUAGE_ROOT_META_PROPERTY_KEYS: string[] = [
  'Name',
  'Synonym',
  'Comment',
  'LanguageCode',
];

const STYLE_ITEM_ROOT_META_PROPERTY_KEYS: string[] = [
  'Name',
  'Synonym',
  'Comment',
  'Type',
  'Value',
];

const INFORMATION_REGISTER_ROOT_META_PROPERTY_KEYS: string[] = [
  'Name',
  'Synonym',
  'Comment',
  'UseStandardCommands',
  'EditType',
  'DefaultRecordForm',
  'DefaultListForm',
  'AuxiliaryRecordForm',
  'AuxiliaryListForm',
  'InformationRegisterPeriodicity',
  'WriteMode',
  'MainFilterOnPeriod',
  'IncludeHelpInContents',
  'DataLockControlMode',
  'FullTextSearch',
  'EnableTotalsSliceFirst',
  'EnableTotalsSliceLast',
  'RecordPresentation',
  'ExtendedRecordPresentation',
  'ListPresentation',
  'ExtendedListPresentation',
  'Explanation',
  'DataHistory',
  'UpdateDataHistoryImmediatelyAfterWrite',
  'ExecuteAfterWriteDataHistoryVersionProcessing',
];

const ACCUMULATION_REGISTER_ROOT_META_PROPERTY_KEYS: string[] = [
  'Name',
  'Synonym',
  'Comment',
  'UseStandardCommands',
  'DefaultListForm',
  'AuxiliaryListForm',
  'RegisterType',
  'IncludeHelpInContents',
  'DataLockControlMode',
  'FullTextSearch',
  'EnableTotalsSplitting',
  'ListPresentation',
  'ExtendedListPresentation',
  'Explanation',
];

const ACCOUNTING_REGISTER_ROOT_META_PROPERTY_KEYS: string[] = [
  'Name',
  'Synonym',
  'Comment',
  'UseStandardCommands',
  'IncludeHelpInContents',
  'ChartOfAccounts',
  'Correspondence',
  'PeriodAdjustmentLength',
  'DefaultListForm',
  'AuxiliaryListForm',
  'DataLockControlMode',
  'EnableTotalsSplitting',
  'FullTextSearch',
  'ListPresentation',
  'ExtendedListPresentation',
  'Explanation',
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

const STANDARD_ATTRIBUTE_PROPERTY_KEYS: string[] = TYPED_FIELD_PROPERTY_KEYS.filter((key) => key !== 'Type');

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
  'CommandParameterType',
  'ParameterUseMode',
  'ModifiesData',
  'OnMainServerUnavalableBehavior',
  'Representation',
  'ToolTip',
  'Shortcut',
  'Picture',
  'IncludeHelpInContents',
];

/** Поля значения перечисления (в т.ч. оформление в списке) */
const ENUM_VALUE_PROPERTY_KEYS: string[] = ['Name', 'Synonym', 'Comment', 'Color'];

/** Канонический порядок свойств корня Configuration.xml */
const CONFIGURATION_PROPERTY_KEYS: string[] = [
  'ObjectBelonging',
  'Name',
  'Synonym',
  'Comment',
  'ConfigurationExtensionPurpose',
  'KeepMappingToExtendedConfigurationObjectsByIDs',
  'NamePrefix',
  'ConfigurationExtensionCompatibilityMode',
  'DefaultRunMode',
  'UsePurposes',
  'ScriptVariant',
  'DefaultRoles',
  'Vendor',
  'Version',
  'UpdateCatalogAddress',
  'IncludeHelpInContents',
  'UseManagedFormInOrdinaryApplication',
  'UseOrdinaryFormInManagedApplication',
  'AdditionalFullTextSearchDictionaries',
  'CommonSettingsStorage',
  'ReportsUserSettingsStorage',
  'ReportsVariantsStorage',
  'FormDataSettingsStorage',
  'DynamicListsUserSettingsStorage',
  'URLExternalDataStorage',
  'Content',
  'DefaultReportForm',
  'DefaultReportVariantForm',
  'DefaultReportSettingsForm',
  'DefaultReportAppearanceTemplate',
  'DefaultDynamicListSettingsForm',
  'DefaultSearchForm',
  'DefaultDataHistoryChangeHistoryForm',
  'DefaultDataHistoryVersionDataForm',
  'DefaultDataHistoryVersionDifferencesForm',
  'DefaultCollaborationSystemUsersChoiceForm',
  'AuxiliaryReportForm',
  'AuxiliaryReportVariantForm',
  'AuxiliaryReportSettingsForm',
  'AuxiliaryDynamicListSettingsForm',
  'AuxiliaryDataHistoryChangeHistoryForm',
  'AuxiliaryDataHistoryVersionDataForm',
  'AuxiliaryDataHistoryVersionDifferencesForm',
  'AuxiliaryCollaborationSystemUsersChoiceForm',
  'RequiredMobileApplicationPermissions',
  'UsedMobileApplicationFunctionalities',
  'StandaloneConfigurationRestrictionRoles',
  'MobileApplicationURLs',
  'AllowedIncomingShareRequestTypes',
  'MainClientApplicationWindowInterfaceVariant',
  'ClientApplicationTheme',
  'MainClientApplicationWindowMode',
  'ClientApplicationWindowsOpenVariant',
  'DefaultInterface',
  'Caption',
  'ShortCaption',
  'DefaultStyle',
  'DefaultLanguage',
  'BriefInformation',
  'DetailedInformation',
  'Copyright',
  'VendorInformationAddress',
  'ConfigurationInformationAddress',
  'DataLockControlMode',
  'ObjectAutonumerationMode',
  'ModalityUseMode',
  'SynchronousPlatformExtensionAndAddInCallUseMode',
  'InterfaceCompatibilityMode',
  'Version85InterfaceMigrationMode',
  'DatabaseTablespacesUseMode',
  'CompatibilityMode',
  'DefaultConstantsForm',
];

/** Порядок ключей корня по типу объекта */
export function getRootPropertyKeyOrder(rootMetaKind: NodeKind): string[] {
  if (rootMetaKind === 'DefinedType' || rootMetaKind === 'SessionParameter') {
    return ['Name', 'Synonym', 'Comment', 'Type'];
  }
  if (rootMetaKind === 'ExchangePlan') {
    return [...COMMON_ROOT_META_PROPERTY_KEYS, ...EXCHANGE_PLAN_ROOT_EXTRA_KEYS];
  }
  if (rootMetaKind === 'Enum') {
    return ENUM_ROOT_META_PROPERTY_KEYS;
  }
  if (rootMetaKind === 'Document') {
    return DOCUMENT_ROOT_META_PROPERTY_KEYS;
  }
  if (rootMetaKind === 'Catalog') {
    return CATALOG_ROOT_META_PROPERTY_KEYS;
  }
  if (rootMetaKind === 'CommonCommand') {
    return COMMAND_PROPERTY_KEYS;
  }
  if (rootMetaKind === 'ScheduledJob') {
    return SCHEDULED_JOB_ROOT_META_PROPERTY_KEYS;
  }
  if (rootMetaKind === 'DocumentNumerator' || rootMetaKind === 'Sequence') {
    return DOCUMENT_NUMERATOR_ROOT_META_PROPERTY_KEYS;
  }
  if (rootMetaKind === 'Report') {
    return REPORT_ROOT_META_PROPERTY_KEYS;
  }
  if (rootMetaKind === 'DataProcessor') {
    return DATA_PROCESSOR_ROOT_META_PROPERTY_KEYS;
  }
  if (rootMetaKind === 'DocumentJournal') {
    return DOCUMENT_JOURNAL_ROOT_META_PROPERTY_KEYS;
  }
  if (rootMetaKind === 'FilterCriterion') {
    return FILTER_CRITERION_ROOT_META_PROPERTY_KEYS;
  }
  if (rootMetaKind === 'FunctionalOption') {
    return FUNCTIONAL_OPTION_ROOT_META_PROPERTY_KEYS;
  }
  if (rootMetaKind === 'FunctionalOptionsParameter') {
    return FUNCTIONAL_OPTIONS_PARAMETER_ROOT_META_PROPERTY_KEYS;
  }
  if (rootMetaKind === 'SettingsStorage') {
    return SETTINGS_STORAGE_ROOT_META_PROPERTY_KEYS;
  }
  if (rootMetaKind === 'CommandGroup') {
    return COMMAND_GROUP_ROOT_META_PROPERTY_KEYS;
  }
  if (rootMetaKind === 'CommonForm') {
    return COMMON_FORM_ROOT_META_PROPERTY_KEYS;
  }
  if (rootMetaKind === 'CommonPicture') {
    return COMMON_PICTURE_ROOT_META_PROPERTY_KEYS;
  }
  if (rootMetaKind === 'CommonTemplate') {
    return TEMPLATE_META_PROPERTY_KEYS;
  }
  if (rootMetaKind === 'XDTOPackage') {
    return XDTO_PACKAGE_ROOT_META_PROPERTY_KEYS;
  }
  if (rootMetaKind === 'WebService') {
    return WEB_SERVICE_ROOT_META_PROPERTY_KEYS;
  }
  if (rootMetaKind === 'HTTPService') {
    return HTTP_SERVICE_ROOT_META_PROPERTY_KEYS;
  }
  if (rootMetaKind === 'WSReference' || rootMetaKind === 'WebSocketClient') {
    return WS_REFERENCE_ROOT_META_PROPERTY_KEYS;
  }
  if (rootMetaKind === 'IntegrationService') {
    return INTEGRATION_SERVICE_ROOT_META_PROPERTY_KEYS;
  }
  if (rootMetaKind === 'Style') {
    return STYLE_ROOT_META_PROPERTY_KEYS;
  }
  if (rootMetaKind === 'Language') {
    return LANGUAGE_ROOT_META_PROPERTY_KEYS;
  }
  if (rootMetaKind === 'StyleItem' || rootMetaKind === 'PaletteColor') {
    return STYLE_ITEM_ROOT_META_PROPERTY_KEYS;
  }
  if (rootMetaKind === 'InformationRegister' || rootMetaKind === 'CalculationRegister') {
    return INFORMATION_REGISTER_ROOT_META_PROPERTY_KEYS;
  }
  if (rootMetaKind === 'AccumulationRegister') {
    return ACCUMULATION_REGISTER_ROOT_META_PROPERTY_KEYS;
  }
  if (rootMetaKind === 'AccountingRegister') {
    return ACCOUNTING_REGISTER_ROOT_META_PROPERTY_KEYS;
  }
  if (rootMetaKind === 'BusinessProcess') {
    return mergePropertyKeys(COMMON_ROOT_META_PROPERTY_KEYS, DOCUMENT_LIKE_ROOT_EXTRA_KEYS, ['Task', 'CreateTaskInPrivilegedMode']);
  }
  if (rootMetaKind === 'Task') {
    return mergePropertyKeys(COMMON_ROOT_META_PROPERTY_KEYS, DOCUMENT_LIKE_ROOT_EXTRA_KEYS, [
      'TaskNumberAutoPrefix',
      'DescriptionLength',
      'Addressing',
      'MainAddressingAttribute',
      'CurrentPerformer',
    ]);
  }
  if (rootMetaKind === 'ChartOfCharacteristicTypes') {
    return mergePropertyKeys(CATALOG_ROOT_META_PROPERTY_KEYS, ['CharacteristicExtValues', 'Type']);
  }
  if (rootMetaKind === 'ChartOfAccounts') {
    return mergePropertyKeys(CATALOG_ROOT_META_PROPERTY_KEYS, [
      'ExtDimensionTypes',
      'MaxExtDimensionCount',
      'CodeMask',
      'AutoOrderByCode',
      'OrderLength',
    ]);
  }
  if (rootMetaKind === 'ChartOfCalculationTypes') {
    return mergePropertyKeys(CATALOG_ROOT_META_PROPERTY_KEYS, [
      'DependenceOnCalculationTypes',
      'BaseCalculationTypes',
      'ActionPeriodUse',
    ]);
  }
  return COMMON_ROOT_META_PROPERTY_KEYS;
}

/** Извлекает внутренность первого блока Properties корневого тега объекта (Catalog, ExchangePlan, …) */
export function extractRootObjectPropertiesInnerXml(fullXml: string): string | null {
  return extractRootMetadataObjectPropertiesInnerXml(fullXml);
}

function extractRootObjectElementXml(fullXml: string): string | null {
  return extractRootMetadataObjectElementXml(fullXml);
}

/** Внутренность блока Properties внутри XML-фрагмента элемента */
export function extractPropertiesInnerFromElement(elementXml: string): string | null {
  return extractTagInnerXml(elementXml, 'Properties');
}

/** Локализованная строка свойства (как в общем модуле) */
export function extractLocalizedStringValue(xml: string, tagName: string): LocalizedStringValue {
  const inner = extractTagInnerXml(xml, tagName);
  if (inner === null) {
    return { presentation: '', values: [] };
  }
  return parseLocalizedStringSection(inner);
}

function isBooleanScalar(value: string | undefined): value is string {
  const normalized = value?.trim().toLowerCase();
  return normalized === 'true' || normalized === 'false';
}

function summarizeTypeBlock(propertiesSource: string): string {
  return extractTypePropertyInner(propertiesSource, 'Type');
}

function extractTypePropertyInner(propertiesSource: string, key: string): string {
  return extractTagInnerXml(propertiesSource, key)?.trim() ?? '';
}

function propertyTitle(key: string): string {
  return getPropertyTitle(key, PROPERTY_TITLE_RU);
}

function buildEnumValueForKey(key: string, current: string, options: EnumPropertyOption[]): EnumPropertyValue {
  const completeOptions = ensureCurrentOptionForKey(key, options, current);
  const opt = completeOptions.find((o) => o.value === current);
  return {
    current,
    currentLabel: opt?.label ?? current,
    allowedValues: completeOptions,
  };
}

function ensureCurrentOptionForKey(
  key: string,
  options: readonly EnumPropertyOption[],
  current: string
): EnumPropertyOption[] {
  const result = [...options];
  if (current && !result.some((option) => option.value === current)) {
    result.push({ value: current, label: formatEnumValueForKey(key, current) });
  }
  return result;
}

function formatEnumValueForKey(key: string, value: string): string {
  if (key === 'Group') {
    const customGroup = /^CommandGroup\.(.+)$/.exec(value);
    if (customGroup) {
      return `Группа команд: ${customGroup[1]}`;
    }
  }
  return formatEnumDisplayValue(value);
}

function ensureSelectedOptions(options: readonly EnumPropertyOption[], selected: readonly string[]): EnumPropertyOption[] {
  const result = [...options];
  for (const value of selected) {
    if (value && !result.some((option) => option.value === value)) {
      result.push({ value, label: formatPropertyDisplayValue(value) });
    }
  }
  return result;
}

/**
 * Нормализует значение простого тега; вынесено из цикла, чтобы параметр не сужался CFA до только `undefined`.
 */
function coalesceSimpleTagText(simple: string | undefined): string {
  return simple ?? '';
}

/**
 * Собирает строковое свойство из простого тега и/или вложенного XML.
 * Параметр {@code simple} передаётся явно как {@code string | undefined}, без ложного сужения из цикла.
 */
function tryBuildScalarStringPropertyItem(params: {
  key: string;
  propsInner: string;
  simple: string | undefined;
  complexInner: string | undefined;
  showMissing?: boolean;
}): ObjectPropertyItem | null {
  const { key, propsInner, simple, complexInner, showMissing } = params;
  if (
    simple === undefined &&
    complexInner === undefined &&
    !hasSelfClosingProperty(propsInner, key) &&
    !ALWAYS_VISIBLE_STRING_PROPERTY_TAGS.has(key) &&
    showMissing !== true
  ) {
    return null;
  }
  return {
    key,
    title: propertyTitle(key),
    kind: 'string',
    value:
      complexInner?.trim().includes('<')
        ? formatReadonlyXmlProperty(key, complexInner)
        : simple === undefined
        ? ''
        : formatPropertyDisplayValue(simple),
    readonly: Boolean(complexInner?.trim().includes('<')),
  };
}

/**
 * Строит список свойств из XML-текста блока {@code Properties} (или целого фрагмента элемента).
 */
export function buildPropertyItemsForKeys(
  xmlOrPropertiesInner: string,
  orderedKeys: string[],
  options?: { elementXmlForType?: string; showMissingKeys?: boolean }
): ObjectPropertiesCollection {
  const propsInner = extractPropertiesInnerFromElement(xmlOrPropertiesInner) ?? xmlOrPropertiesInner;
  const typeSource = options?.elementXmlForType ?? xmlOrPropertiesInner;
  const childrenByTag = new Map(
    extractTopLevelPropertiesChildren(`<Properties>${propsInner}</Properties>`).map((child) => [child.tag, child.inner])
  );
  const items: ObjectPropertyItem[] = [];

  for (const key of orderedKeys) {
    if (TYPE_PROPERTY_TAGS.has(key)) {
      const typeInner = extractTypePropertyInner(typeSource.includes('<Properties>') ? typeSource : propsInner, key);
      if (!typeInner && !propsInner.includes(`<${key}`) && options?.showMissingKeys !== true) {
        continue;
      }
      items.push({
        key,
        title: propertyTitle(key),
        kind: 'metadataType',
        value: parseMetadataType(typeInner),
      });
      continue;
    }

    if (key === 'UsePurposes') {
      items.push({
        key,
        title: propertyTitle(key),
        kind: 'multiEnum',
        value: {
          selected: extractUsePurposeValues(childrenByTag.get(key) ?? ''),
          allowedValues: USE_PURPOSE_OPTIONS,
        },
      });
      continue;
    }

    if (LOCALIZED_PROPERTY_TAGS.has(key)) {
      const loc = extractLocalizedStringValue(propsInner, key);
      if (!loc.presentation && loc.values.length === 0 && !propsInner.includes(`<${key}`) && options?.showMissingKeys !== true) {
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

    const rawSimpleValue = extractSimpleTag(propsInner, key);

    if (key === 'Owners') {
      items.push({
        key,
        title: propertyTitle(key),
        kind: 'metadataReferenceList',
        value: buildMetadataReferenceListValue(childrenByTag.get(key) ?? ''),
      });
      continue;
    }

    if (key === 'InputByString' || key === 'DataLockFields') {
      if (!propsInner.includes(`<${key}`) && options?.showMissingKeys !== true) {
        continue;
      }
      items.push({
        key,
        title: propertyTitle(key),
        kind: 'metadataReferenceList',
        value: buildMetadataReferenceListValue(childrenByTag.get(key) ?? '', 'Field', formatMetadataFieldDisplay),
      });
      continue;
    }

    if (key === 'BasedOn') {
      if (!propsInner.includes('<BasedOn') && options?.showMissingKeys !== true) {
        continue;
      }
      items.push({
        key,
        title: propertyTitle(key),
        kind: 'metadataReferenceList',
        value: buildMetadataReferenceListValue(childrenByTag.get(key) ?? ''),
      });
      continue;
    }

    const isKnownBoolean = BOOLEAN_PROPERTY_TAGS.has(key);
    if (isKnownBoolean || isBooleanScalar(rawSimpleValue)) {
      if (!isKnownBoolean && !propsInner.includes(`<${key}>`)) {
        continue;
      }
      items.push({
        key,
        title: propertyTitle(key),
        kind: 'boolean',
        value: (rawSimpleValue ?? 'false').trim().toLowerCase() === 'true',
      });
      continue;
    }

    const enumOptions = ENUM_PROPERTY_OPTIONS[key] as readonly EnumPropertyOption[] | undefined;
    if (enumOptions) {
      if (!propsInner.includes(`<${key}>`) && options?.showMissingKeys !== true) {
        continue;
      }
      const current = coalesceSimpleTagText(rawSimpleValue) || DEFAULT_ENUM_PROPERTY_VALUES[key] || enumOptions[0]?.value || '';
      items.push({
        key,
        title: propertyTitle(key),
        kind: 'enum',
        value: buildEnumValueForKey(key, current, [...enumOptions]),
      });
      continue;
    }

    const scalarString = tryBuildScalarStringPropertyItem({
      key,
      propsInner,
      simple: rawSimpleValue,
      complexInner: childrenByTag.get(key),
      showMissing: options?.showMissingKeys === true,
    });
    if (!scalarString) {
      continue;
    }
    items.push(scalarString);
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
    excludeExtraKey?: (key: string) => boolean;
    showMissingKeys?: boolean;
  }
): ObjectPropertiesCollection {
  const localEffectiveKeys = options?.includeExtraKeys
    ? extendKeysWithTopLevelProperties(orderedKeys, [localXmlOrPropertiesInner], options.excludeExtraKey)
    : orderedKeys;

  if (!inheritedXmlOrPropertiesInner) {
    return buildPropertyItemsForKeys(localXmlOrPropertiesInner, localEffectiveKeys, {
      elementXmlForType: options?.elementXmlForType,
      showMissingKeys: options?.showMissingKeys,
    }).map(markLocal);
  }

  const effectiveKeys = options?.includeExtraKeys
    ? extendKeysWithTopLevelProperties(
        orderedKeys,
        [localXmlOrPropertiesInner, inheritedXmlOrPropertiesInner],
        options.excludeExtraKey
      )
    : orderedKeys;

  const localItems = buildPropertyItemsForKeys(localXmlOrPropertiesInner, effectiveKeys, {
    elementXmlForType: options?.elementXmlForType,
    showMissingKeys: options?.showMissingKeys,
  });
  const inheritedItems = buildPropertyItemsForKeys(inheritedXmlOrPropertiesInner, effectiveKeys, {
    elementXmlForType: options?.inheritedElementXmlForType ?? inheritedXmlOrPropertiesInner,
    showMissingKeys: options?.showMissingKeys,
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
  if (isTypeAwareRootKind(rootMetaKind)) {
    return buildTypeAwareRootProperties(
      extractRootObjectElementXml(fullObjectXml) ?? fullObjectXml,
      inheritedFullObjectXml ? extractRootObjectElementXml(inheritedFullObjectXml) ?? inheritedFullObjectXml : null,
      rootMetaKind
    );
  }

  const inner = extractRootObjectPropertiesInnerXml(fullObjectXml);
  if (!inner) {
    return [];
  }
  const inheritedInner = inheritedFullObjectXml
    ? extractRootObjectPropertiesInnerXml(inheritedFullObjectXml)
    : null;
  const properties = buildEffectivePropertyItemsForKeys(inner, inheritedInner, getRootPropertyKeyOrder(rootMetaKind), {
    includeExtraKeys: true,
    showMissingKeys: hasExplicitRootPropertyContract(rootMetaKind),
  });
  if (rootMetaKind === 'Catalog') {
    return applyCatalogPropertySections(properties);
  }
  if (rootMetaKind === 'Document') {
    return applyDocumentPropertySections(properties);
  }
  return properties;
}

function hasExplicitRootPropertyContract(rootMetaKind: NodeKind): boolean {
  return rootMetaKind !== 'Subsystem'
    && rootMetaKind !== 'CommonModule'
    && rootMetaKind !== 'Role'
    && rootMetaKind !== 'EventSubscription'
    && rootMetaKind !== 'configuration'
    && rootMetaKind !== 'extension'
    && rootMetaKind !== 'extensions-root'
    && rootMetaKind !== 'group-common'
    && rootMetaKind !== 'group-type'
    && rootMetaKind !== 'NumeratorsBranch'
    && rootMetaKind !== 'SequencesBranch';
}

function applyCatalogPropertySections(properties: ObjectPropertiesCollection): ObjectPropertiesCollection {
  return properties.filter((property) => !CATALOG_HIDDEN_PROPERTIES.has(property.key)).map((property) => {
    const section = CATALOG_PROPERTY_SECTIONS[property.key] ?? CATALOG_PROPERTY_SECTIONS._other;
    return {
      ...property,
      section: section.title,
      sectionOrder: section.order,
      readonly: property.readonly === true || CATALOG_READONLY_COMPLEX_PROPERTIES.has(property.key),
    };
  });
}

function applyDocumentPropertySections(properties: ObjectPropertiesCollection): ObjectPropertiesCollection {
  return properties.filter((property) => !DOCUMENT_HIDDEN_PROPERTIES.has(property.key)).map((property) => {
    const section = DOCUMENT_PROPERTY_SECTIONS[property.key] ?? DOCUMENT_PROPERTY_SECTIONS._other;
    return {
      ...property,
      section: section.title,
      sectionOrder: section.order,
      readonly: property.readonly === true || DOCUMENT_READONLY_COMPLEX_PROPERTIES.has(property.key),
    };
  });
}

function isTypeAwareRootKind(rootMetaKind: NodeKind): rootMetaKind is 'Constant' | 'CommonAttribute' {
  return rootMetaKind === 'Constant' || rootMetaKind === 'CommonAttribute';
}

/** Свойства корневого объекта, где состав полей зависит от блока `<Type>`. */
export function buildTypeAwareRootProperties(
  elementFullXml: string,
  inheritedElementFullXml: string | null | undefined,
  kind: 'Constant' | 'CommonAttribute'
): ObjectPropertiesCollection {
  const keySource = elementFullXml || (inheritedElementFullXml ?? '');
  return buildEffectivePropertyItemsForKeys(
    elementFullXml,
    inheritedElementFullXml,
    getTypeAwarePropertyKeyOrder(keySource, kind),
    {
      elementXmlForType: elementFullXml,
      inheritedElementXmlForType: inheritedElementFullXml ?? undefined,
      includeExtraKeys: true,
      excludeExtraKey: isTypedFieldControlledPropertyKey,
      showMissingKeys: true,
    }
  );
}

/** Свойства самой конфигурации или расширения из корневого Configuration.xml */
export function buildConfigurationProperties(fullConfigXml: string): ObjectPropertiesCollection {
  const propertiesInner = extractFirstBalancedBlock(fullConfigXml, 'Properties');
  if (propertiesInner === null) {
    return [];
  }

  const children = extractTopLevelPropertiesChildren(`<Properties>${propertiesInner}</Properties>`);
  const byTag = new Map(children.map((child) => [child.tag, child.inner]));
  const orderedKeys = extendKeysWithTopLevelProperties(CONFIGURATION_PROPERTY_KEYS, [propertiesInner]);
  const roleOptions = buildRoleOptions(fullConfigXml);
  const result: ObjectPropertyItem[] = [];

  for (const key of orderedKeys) {
    if (!byTag.has(key)) {
      continue;
    }

    if (key === 'UsePurposes') {
      result.push({
        key,
        title: propertyTitle(key),
        kind: 'multiEnum',
        value: {
          selected: extractUsePurposeValues(byTag.get(key) ?? ''),
          allowedValues: USE_PURPOSE_OPTIONS,
        },
      });
      continue;
    }

    if (key === 'DefaultRoles') {
      const selected = extractDefaultRoleValues(byTag.get(key) ?? '');
      result.push({
        key,
        title: propertyTitle(key),
        kind: 'multiEnum',
        value: {
          selected,
          allowedValues: ensureSelectedOptions(roleOptions, selected),
        },
      });
      continue;
    }

    if (LOCALIZED_PROPERTY_TAGS.has(key)) {
      result.push({
        key,
        title: propertyTitle(key),
        kind: 'localizedString',
        value: extractLocalizedStringValue(propertiesInner, key),
      });
      continue;
    }

    const rawSimpleValue = extractSimpleTag(propertiesInner, key);

    if ((BOOLEAN_PROPERTY_TAGS.has(key) || isBooleanScalar(rawSimpleValue)) && isBooleanScalar(rawSimpleValue)) {
      result.push({
        key,
        title: propertyTitle(key),
        kind: 'boolean',
        value: rawSimpleValue.trim().toLowerCase() === 'true',
      });
      continue;
    }

    const enumOptions = ENUM_PROPERTY_OPTIONS[key] as readonly EnumPropertyOption[] | undefined;
    if (enumOptions) {
      result.push({
        key,
        title: propertyTitle(key),
        kind: 'enum',
        value: buildEnumValueForKey(key, coalesceSimpleTagText(rawSimpleValue).trim(), [...enumOptions]),
      });
      continue;
    }

    const inner = byTag.get(key) ?? '';
    const configString = tryBuildScalarStringPropertyItem({
      key,
      propsInner: propertiesInner,
      simple: rawSimpleValue,
      complexInner: inner,
    });
    if (!configString) {
      continue;
    }
    result.push(configString);
  }

  return result;
}

/** Свойства типового реквизита / измерения / ресурса / колонки */
export function buildTypedFieldProperties(
  elementFullXml: string,
  inheritedElementFullXml?: string | null
): ObjectPropertiesCollection {
  const keySource = elementFullXml || (inheritedElementFullXml ?? '');
  return buildEffectivePropertyItemsForKeys(elementFullXml, inheritedElementFullXml, getTypedFieldPropertyKeyOrder(keySource), {
    elementXmlForType: elementFullXml,
    inheritedElementXmlForType: inheritedElementFullXml ?? undefined,
    includeExtraKeys: true,
    excludeExtraKey: isTypedFieldControlledPropertyKey,
    showMissingKeys: true,
  });
}

function hasSelfClosingProperty(xml: string, key: string): boolean {
  return hasSelfClosingXmlTag(xml, key);
}

function extractUsePurposeValues(innerXml: string): string[] {
  return extractRepeatedSimpleTagValues(innerXml, 'Value');
}

function extractDefaultRoleValues(innerXml: string): string[] {
  return extractRepeatedSimpleTagValues(innerXml, 'Item');
}

function buildRoleOptions(fullConfigXml: string): EnumPropertyOption[] {
  const childObjectsInner = extractFirstBalancedBlock(fullConfigXml, 'ChildObjects') ?? '';
  const roles = extractRepeatedSimpleTagValues(childObjectsInner, 'Role');
  return roles.map((role) => ({
    value: role.includes('.') ? role : `Role.${role}`,
    label: formatPropertyDisplayValue(role.includes('.') ? role : `Role.${role}`),
  }));
}

function formatReadonlyXmlProperty(key: string, innerXml: string): string {
  return formatXmlPropertyDisplay(key, innerXml);
}

function buildMetadataReferenceListValue(
  innerXml: string,
  itemLocalName = 'Item',
  formatDisplay: (canonical: string) => string = formatPropertyDisplayValue
): MetadataReferenceListValue {
  return {
    items: extractRepeatedSimpleTagValues(innerXml, itemLocalName)
      .map((canonical) => ({
        canonical,
        display: formatDisplay(canonical),
      })),
  };
}

function formatMetadataFieldDisplay(canonical: string): string {
  const standardAttribute = /\.StandardAttribute\.([A-Za-z][A-Za-z0-9]*)$/.exec(canonical);
  if (standardAttribute) {
    return getStandardAttributePresentation(standardAttribute[1]);
  }
  const namedField = /\.(?:Attribute|Dimension|Resource)\.([^.]+)$/.exec(canonical);
  if (namedField) {
    return namedField[1];
  }
  return canonical.split('.').at(-1) ?? canonical;
}

export function buildStandardAttributeProperties(
  elementXml: string,
  inheritedElementXml?: string | null
): ObjectPropertiesCollection {
  const local = normalizeStandardAttributeElementXml(elementXml);
  const inherited = inheritedElementXml ? normalizeStandardAttributeElementXml(inheritedElementXml) : null;
  return buildEffectivePropertyItemsForKeys(local, inherited, STANDARD_ATTRIBUTE_PROPERTY_KEYS, {
    includeExtraKeys: true,
    showMissingKeys: true,
  });
}

function normalizeStandardAttributeElementXml(elementXml: string): string {
  if (!elementXml.trim()) {
    return '';
  }
  const name = extractXmlAttribute(elementXml, 'name') ?? '';
  const inner = extractElementInnerXml(elementXml);
  const normalizedInner = stripXmlTagNamespacePrefixes(inner);
  const displayName = escapeXmlText(getStandardAttributePresentation(name));
  return `<StandardAttribute><Properties><Name>${displayName}</Name>${normalizedInner}</Properties></StandardAttribute>`;
}

function getTypedFieldPropertyKeyOrder(elementFullXml: string): string[] {
  const openingTag = extractOpeningTagName(elementFullXml);
  const tag = openingTag ? stripXmlTagNamespacePrefix(openingTag) : '';
  const typeInner = summarizeTypeBlock(elementFullXml);
  if (
    typeInner &&
    (tag === 'Attribute' || tag === 'AddressingAttribute' || tag === 'Dimension' || tag === 'Resource' || tag === 'Column')
  ) {
    return ['Name', 'Synonym', 'Comment', 'Type', ...getTypedFieldPropertyKeys(toTypedFieldOwnerKind(tag), typeInner)];
  }
  return TYPED_FIELD_PROPERTY_KEYS;
}

function stripXmlTagNamespacePrefix(tagName: string): string {
  const colon = tagName.indexOf(':');
  return colon >= 0 ? tagName.slice(colon + 1) : tagName;
}

function toTypedFieldOwnerKind(tagName: 'Attribute' | 'AddressingAttribute' | 'Dimension' | 'Resource' | 'Column'): TypeAwarePropertyOwnerKind {
  return tagName === 'Column' ? 'Attribute' : tagName;
}

function getTypeAwarePropertyKeyOrder(elementFullXml: string, kind: TypeAwarePropertyOwnerKind): string[] {
  const typeInner = summarizeTypeBlock(elementFullXml);
  if (!typeInner) {
    return ['Name', 'Synonym', 'Comment', 'Type'];
  }
  return ['Name', 'Synonym', 'Comment', 'Type', ...getTypedFieldPropertyKeys(kind, typeInner)];
}

export function buildTabularSectionProperties(
  elementFullXml: string,
  inheritedElementFullXml?: string | null
): ObjectPropertiesCollection {
  return buildEffectivePropertyItemsForKeys(elementFullXml, inheritedElementFullXml, TABULAR_SECTION_PROPERTY_KEYS, {
    includeExtraKeys: true,
    showMissingKeys: true,
  });
}

export function buildFormLikeProperties(elementFullXml: string, inheritedElementFullXml?: string | null): ObjectPropertiesCollection {
  return buildEffectivePropertyItemsForKeys(elementFullXml, inheritedElementFullXml, FORM_PROPERTY_KEYS, {
    includeExtraKeys: true,
    showMissingKeys: true,
  });
}

export function buildCommandProperties(elementFullXml: string, inheritedElementFullXml?: string | null): ObjectPropertiesCollection {
  return buildEffectivePropertyItemsForKeys(elementFullXml, inheritedElementFullXml, COMMAND_PROPERTY_KEYS, {
    includeExtraKeys: true,
    showMissingKeys: true,
  });
}

export function buildEnumValueProperties(elementFullXml: string, inheritedElementFullXml?: string | null): ObjectPropertiesCollection {
  return buildEffectivePropertyItemsForKeys(elementFullXml, inheritedElementFullXml, ENUM_VALUE_PROPERTY_KEYS, {
    includeExtraKeys: true,
    showMissingKeys: true,
  });
}

const TEMPLATE_META_PROPERTY_KEYS: string[] = ['Name', 'Synonym', 'Comment', 'TemplateType'];

/** Свойства макета по файлу описания в каталоге Templates */
export function buildTemplateMetaProperties(elementFullXml: string, inheritedElementFullXml?: string | null): ObjectPropertiesCollection {
  return buildEffectivePropertyItemsForKeys(elementFullXml, inheritedElementFullXml, TEMPLATE_META_PROPERTY_KEYS, {
    includeExtraKeys: true,
    showMissingKeys: true,
  });
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

function extendKeysWithTopLevelProperties(
  orderedKeys: string[],
  sources: string[],
  excludeKey?: (key: string) => boolean
): string[] {
  const result = [...orderedKeys];
  const seen = new Set(result);

  for (const source of sources) {
    const propertiesXml = source.includes('<Properties') ? source : `<Properties>${source}</Properties>`;
    for (const child of extractTopLevelPropertiesChildren(propertiesXml)) {
      if (seen.has(child.tag) || excludeKey?.(child.tag)) {
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
    case 'multiEnum':
      return areStringArraysEquivalent(
        (left.value as MultiEnumPropertyValue).selected,
        (right.value as MultiEnumPropertyValue).selected
      );
    case 'localizedString':
      return areLocalizedValuesEquivalent(left.value as LocalizedStringValue, right.value as LocalizedStringValue);
    case 'metadataType':
      return areMetadataTypesEquivalent(left.value as MetadataTypeValue, right.value as MetadataTypeValue);
    case 'string':
    default:
      return normalizeScalarValue(left.value as string) === normalizeScalarValue(right.value as string);
  }
}

function areStringArraysEquivalent(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function areLocalizedValuesEquivalent(left: LocalizedStringValue, right: LocalizedStringValue): boolean {
  if (normalizeScalarValue(left.presentation) !== normalizeScalarValue(right.presentation)) {
    return false;
  }
  if (left.values.length !== right.values.length) {
    return false;
  }
  return left.values.every((item, index) => {
    const other = right.values.at(index);
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
