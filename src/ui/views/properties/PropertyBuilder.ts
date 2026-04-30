import { NodeKind } from '../../tree/TreeNode';
import {
  EnumPropertyOption,
  EnumPropertyValue,
  LocalizedStringValue,
  MetadataTypeValue,
  MultiEnumPropertyValue,
  ObjectPropertyItem,
  ObjectPropertiesCollection,
} from './_types';
import { extractSimpleTag } from '../../../infra/xml';
import { getTypedFieldPropertyKeys } from '../../../infra/xml/TypedFieldPropertyRules';
import { parseMetadataType } from './MetadataTypeService';
import { extractFirstBalancedBlock, extractTopLevelPropertiesChildren } from './MetadataXmlPropertiesService';
import {
  formatEnumDisplayValue,
  formatPropertyDisplayValue,
  formatXmlPropertyDisplay,
  getPropertyTitle,
} from './PropertyPresentationRegistry';

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
  'KeepMappingToExtendedConfigurationObjectsByIDs',
  'IncludeHelpInContents',
  'UseManagedFormInOrdinaryApplication',
  'UseOrdinaryFormInManagedApplication',
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
  HierarchyType: [
    { value: 'HierarchyFoldersAndItems', label: 'Иерархия групп и элементов' },
    { value: 'HierarchyOfItems', label: 'Иерархия элементов' },
  ],
  SubordinationUse: [
    { value: 'ToItems', label: 'Элементам' },
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
  EditType: 'Тип кода',
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
  FoldersOnTop: 'Группы сверху',
  SubordinationUse: 'Использование подчинения',
  Owners: 'Владельцы',
  ExtDimensionAccountingFlag: 'Признак учёта субконто',
  Balance: 'Баланс',
  AccountingFlag: 'Признак учёта',
  AutoUse: 'Автоиспользование',
  DataSeparation: 'Разделение данных',
  UsersSeparation: 'Разделение пользователей',
  AuthenticationSeparation: 'Разделение аутентификации',
  ConfigurationExtensionsSeparation: 'Разделение расширений конфигурации',
  SeparatedDataUse: 'Использование разделённых данных',
  IncludeConfigurationExtensions: 'Включать расширения конфигурации',
  PredefinedDataUpdate: 'Обновление предопределённых данных',
  Predefined: 'Предопределённый',
  ModifiesData: 'Изменяет данные',
  Transactioned: 'Транзакционный',
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

function isBooleanScalar(value: string | undefined): value is string {
  const normalized = value?.trim().toLowerCase();
  return normalized === 'true' || normalized === 'false';
}

function summarizeTypeBlock(propertiesSource: string): string {
  const m = /<Type>([\s\S]*?)<\/Type>/.exec(propertiesSource);
  if (!m) {
    return '';
  }
  return m[1].trim();
}

function propertyTitle(key: string): string {
  return getPropertyTitle(key, PROPERTY_TITLE_RU);
}

function buildEnumValue(current: string, options: EnumPropertyOption[]): EnumPropertyValue {
  const completeOptions = ensureCurrentOption(options, current);
  const opt = completeOptions.find((o) => o.value === current);
  return {
    current,
    currentLabel: opt?.label ?? current,
    allowedValues: completeOptions,
  };
}

function ensureCurrentOption(options: readonly EnumPropertyOption[], current: string): EnumPropertyOption[] {
  const result = [...options];
  if (current && !result.some((option) => option.value === current)) {
    result.push({ value: current, label: formatEnumDisplayValue(current) });
  }
  return result;
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
 * Строит список свойств из XML-текста блока {@code Properties} (или целого фрагмента элемента).
 */
export function buildPropertyItemsForKeys(
  xmlOrPropertiesInner: string,
  orderedKeys: string[],
  options?: { elementXmlForType?: string }
): ObjectPropertiesCollection {
  const propsInner = extractPropertiesInnerFromElement(xmlOrPropertiesInner) ?? xmlOrPropertiesInner;
  const typeSource = options?.elementXmlForType ?? xmlOrPropertiesInner;
  const childrenByTag = new Map(
    extractTopLevelPropertiesChildren(`<Properties>${propsInner}</Properties>`).map((child) => [child.tag, child.inner])
  );
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

    const rawSimpleValue = extractSimpleTag(propsInner, key);

    if ((BOOLEAN_PROPERTY_TAGS.has(key) || isBooleanScalar(rawSimpleValue)) && isBooleanScalar(rawSimpleValue)) {
      if (!propsInner.includes(`<${key}>`)) {
        continue;
      }
      items.push({
        key,
        title: propertyTitle(key),
        kind: 'boolean',
        value: rawSimpleValue.trim().toLowerCase() === 'true',
      });
      continue;
    }

    const enumOptions = ENUM_PROPERTY_OPTIONS[key];
    if (enumOptions) {
      const current = rawSimpleValue ?? '';
      if (!propsInner.includes(`<${key}>`)) {
        continue;
      }
      items.push({
        key,
        title: propertyTitle(key),
        kind: 'enum',
        value: buildEnumValue(current, [...enumOptions]),
      });
      continue;
    }

    const raw = rawSimpleValue;
    const complexInner = childrenByTag.get(key);
    if (raw === undefined && complexInner === undefined && !hasSelfClosingProperty(propsInner, key)) {
      continue;
    }
    items.push({
      key,
      title: propertyTitle(key),
      kind: 'string',
      value: raw === undefined
        ? complexInner === undefined ? '' : formatReadonlyXmlProperty(key, complexInner)
        : formatPropertyDisplayValue(raw),
      readonly: raw === undefined && complexInner !== undefined && complexInner.trim().includes('<'),
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
  const localEffectiveKeys = options?.includeExtraKeys
    ? extendKeysWithTopLevelProperties(orderedKeys, [localXmlOrPropertiesInner])
    : orderedKeys;

  if (!inheritedXmlOrPropertiesInner) {
    return buildPropertyItemsForKeys(localXmlOrPropertiesInner, localEffectiveKeys, {
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
    includeExtraKeys: true,
  });
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

    const enumOptions = ENUM_PROPERTY_OPTIONS[key];
    if (enumOptions) {
      result.push({
        key,
        title: propertyTitle(key),
        kind: 'enum',
        value: buildEnumValue((rawSimpleValue ?? '').trim(), [...enumOptions]),
      });
      continue;
    }

    const inner = byTag.get(key) ?? '';
    const raw = rawSimpleValue;
    result.push({
      key,
      title: propertyTitle(key),
      kind: 'string',
      value: raw === undefined ? formatReadonlyXmlProperty(key, inner) : formatPropertyDisplayValue(raw),
      readonly: raw === undefined && inner.trim().includes('<'),
    });
  }

  return result;
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
    includeExtraKeys: true,
  });
}

function hasSelfClosingProperty(xml: string, key: string): boolean {
  return new RegExp(`<${key}(?:\\s[^>]*)?\\/>`).test(xml);
}

function extractUsePurposeValues(innerXml: string): string[] {
  return Array.from(innerXml.matchAll(/<v8:Value\b[^>]*>([^<]+)<\/v8:Value>/g))
    .map((match) => match[1].trim())
    .filter((value) => value.length > 0);
}

function extractDefaultRoleValues(innerXml: string): string[] {
  return Array.from(innerXml.matchAll(/<xr:Item\b[^>]*>([^<]+)<\/xr:Item>/g))
    .map((match) => match[1].trim())
    .filter((value) => value.length > 0);
}

function buildRoleOptions(fullConfigXml: string): EnumPropertyOption[] {
  const childObjectsInner = extractFirstBalancedBlock(fullConfigXml, 'ChildObjects') ?? '';
  const roles = Array.from(childObjectsInner.matchAll(/<Role>([^<]+)<\/Role>/g))
    .map((match) => match[1].trim())
    .filter((value) => value.length > 0);
  return roles.map((role) => ({
    value: role.includes('.') ? role : `Role.${role}`,
    label: formatPropertyDisplayValue(role.includes('.') ? role : `Role.${role}`),
  }));
}

function formatReadonlyXmlProperty(key: string, innerXml: string): string {
  return formatXmlPropertyDisplay(key, innerXml);
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
  return buildEffectivePropertyItemsForKeys(elementFullXml, inheritedElementFullXml, TABULAR_SECTION_PROPERTY_KEYS, {
    includeExtraKeys: true,
  });
}

export function buildFormLikeProperties(elementFullXml: string, inheritedElementFullXml?: string | null): ObjectPropertiesCollection {
  return buildEffectivePropertyItemsForKeys(elementFullXml, inheritedElementFullXml, FORM_PROPERTY_KEYS, {
    includeExtraKeys: true,
  });
}

export function buildCommandProperties(elementFullXml: string, inheritedElementFullXml?: string | null): ObjectPropertiesCollection {
  return buildEffectivePropertyItemsForKeys(elementFullXml, inheritedElementFullXml, COMMAND_PROPERTY_KEYS, {
    includeExtraKeys: true,
  });
}

export function buildEnumValueProperties(elementFullXml: string, inheritedElementFullXml?: string | null): ObjectPropertiesCollection {
  return buildEffectivePropertyItemsForKeys(elementFullXml, inheritedElementFullXml, ENUM_VALUE_PROPERTY_KEYS, {
    includeExtraKeys: true,
  });
}

const TEMPLATE_META_PROPERTY_KEYS: string[] = ['Name', 'Synonym', 'Comment', 'TemplateType'];

/** Свойства макета по файлу описания в каталоге Templates */
export function buildTemplateMetaProperties(elementFullXml: string, inheritedElementFullXml?: string | null): ObjectPropertiesCollection {
  return buildEffectivePropertyItemsForKeys(elementFullXml, inheritedElementFullXml, TEMPLATE_META_PROPERTY_KEYS, {
    includeExtraKeys: true,
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
      return normalizeScalarValue(String(left.value ?? '')) === normalizeScalarValue(String(right.value ?? ''));
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
