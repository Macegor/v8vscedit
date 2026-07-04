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
import {
  BOOLEAN_PROPERTY_TAGS,
  ENUM_DEFAULTS,
  ENUM_OPTIONS,
  LOCALIZED_PROPERTY_TAGS,
  PROPERTY_TITLE_RU,
  USE_PURPOSE_OPTIONS,
} from '../../../infra/xml/PropertySchema';
import { parseMetadataType } from './MetadataTypeService';
import {
  formatEnumDisplayValue,
  formatPropertyDisplayValue,
  formatXmlPropertyDisplay,
  getPropertyTitle,
} from './PropertyPresentationRegistry';
import { getStandardAttributePresentation } from '../../../domain/StandardAttribute';

/** Свойства, внутри которых хранится состав типа 1С. */
const TYPE_PROPERTY_TAGS = new Set(['Type', 'CommandParameterType']);

const ALWAYS_VISIBLE_STRING_PROPERTY_TAGS = new Set([
  'MethodName',
]);


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
          allowedValues: [...USE_PURPOSE_OPTIONS],
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

    const enumOptions = ENUM_OPTIONS[key] as readonly EnumPropertyOption[] | undefined;
    if (enumOptions) {
      if (!propsInner.includes(`<${key}>`) && options?.showMissingKeys !== true) {
        continue;
      }
      const current = coalesceSimpleTagText(rawSimpleValue) || ENUM_DEFAULTS[key] || enumOptions[0]?.value || '';
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
          allowedValues: [...USE_PURPOSE_OPTIONS],
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

    // Known-boolean тег остаётся boolean при ЛЮБОМ значении (в т.ч. пустом/self-closing):
    // раньше конъюнкция `(... || isBooleanScalar) && isBooleanScalar` схлопывалась в
    // `isBooleanScalar`, из-за чего known-boolean тег без 'true'/'false' уезжал в enum/string.
    // Эталон — buildPropertyItemsForKeys (~1795): правильное ИЛИ.
    if (BOOLEAN_PROPERTY_TAGS.has(key) || isBooleanScalar(rawSimpleValue)) {
      result.push({
        key,
        title: propertyTitle(key),
        kind: 'boolean',
        value: (rawSimpleValue ?? 'false').trim().toLowerCase() === 'true',
      });
      continue;
    }

    const enumOptions = ENUM_OPTIONS[key] as readonly EnumPropertyOption[] | undefined;
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
