import type { NodeKind } from '../../tree/TreeNode';
import type { ObjectPropertiesCollection } from './_types';
import { extractOpeningTagName } from '../../../infra/xml';
import {
  getDisplayTypedFieldPropertyKeys,
  type TypeAwarePropertyOwnerKind,
} from '../../../infra/xml/TypedFieldPropertyRules';
import { stripXmlTagNamespacePrefix, summarizeTypeBlock } from './propertyExtractors';

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
export const CATALOG_ROOT_META_PROPERTY_KEYS: string[] = [
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
export const TYPED_FIELD_PROPERTY_KEYS: string[] = [
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
  // RoundingMode/ShowInTotal сюда не входят: в эталонных выгрузках их нет ни у
  // одного типизированного поля, а панель показывает недостающие ключи
  // редактируемыми и дописала бы их в XML — платформа такой файл отклоняет.
];

export const STANDARD_ATTRIBUTE_PROPERTY_KEYS: string[] = TYPED_FIELD_PROPERTY_KEYS.filter((key) => key !== 'Type');

/** Поля табличной части */
export const TABULAR_SECTION_PROPERTY_KEYS: string[] = [
  'Name',
  'Synonym',
  'Comment',
  'ToolTip',
  'FillChecking',
  'StandardAttributes',
  'LineNumberLength',
];

/** Поля формы (файл описания формы) */
export const FORM_PROPERTY_KEYS: string[] = [
  'Name',
  'Synonym',
  'Comment',
  'FormType',
  'IncludeHelpInContents',
  'UseStandardCommands',
];

/** Поля команды */
export const COMMAND_PROPERTY_KEYS: string[] = [
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
export const ENUM_VALUE_PROPERTY_KEYS: string[] = ['Name', 'Synonym', 'Comment', 'Color'];

export const TEMPLATE_META_PROPERTY_KEYS: string[] = ['Name', 'Synonym', 'Comment', 'TemplateType'];

/** Канонический порядок свойств URL-шаблона HTTP-сервиса */
export const URL_TEMPLATE_PROPERTY_KEYS: string[] = ['Name', 'Synonym', 'Comment', 'Template'];

/** Канонический порядок свойств метода URL-шаблона HTTP-сервиса */
export const HTTP_METHOD_PROPERTY_KEYS: string[] = ['Name', 'Synonym', 'Comment', 'HTTPMethod', 'Handler'];

/** Канонический порядок свойств корня Configuration.xml */
export const CONFIGURATION_PROPERTY_KEYS: string[] = [
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

export function hasExplicitRootPropertyContract(rootMetaKind: NodeKind): boolean {
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

export function applyCatalogPropertySections(properties: ObjectPropertiesCollection): ObjectPropertiesCollection {
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

export function applyDocumentPropertySections(properties: ObjectPropertiesCollection): ObjectPropertiesCollection {
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

export function isTypeAwareRootKind(rootMetaKind: NodeKind): rootMetaKind is 'Constant' | 'CommonAttribute' {
  return rootMetaKind === 'Constant' || rootMetaKind === 'CommonAttribute';
}

export function getTypedFieldPropertyKeyOrder(elementFullXml: string, ownerKind?: string): string[] {
  const openingTag = extractOpeningTagName(elementFullXml);
  const tag = openingTag ? stripXmlTagNamespacePrefix(openingTag) : '';
  const typeInner = summarizeTypeBlock(elementFullXml);
  if (
    typeInner &&
    (tag === 'Attribute' || tag === 'AddressingAttribute' || tag === 'Dimension' || tag === 'Resource' || tag === 'Column')
  ) {
    return [
      'Name',
      'Synonym',
      'Comment',
      'Type',
      ...getDisplayTypedFieldPropertyKeys(toTypedFieldOwnerKind(tag), typeInner, ownerKind, elementFullXml),
    ];
  }
  return TYPED_FIELD_PROPERTY_KEYS;
}

function toTypedFieldOwnerKind(tagName: 'Attribute' | 'AddressingAttribute' | 'Dimension' | 'Resource' | 'Column'): TypeAwarePropertyOwnerKind {
  return tagName === 'Column' ? 'Attribute' : tagName;
}

export function getTypeAwarePropertyKeyOrder(elementFullXml: string, kind: TypeAwarePropertyOwnerKind): string[] {
  const typeInner = summarizeTypeBlock(elementFullXml);
  if (!typeInner) {
    return ['Name', 'Synonym', 'Comment', 'Type'];
  }
  return ['Name', 'Synonym', 'Comment', 'Type', ...getDisplayTypedFieldPropertyKeys(kind, typeInner)];
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
