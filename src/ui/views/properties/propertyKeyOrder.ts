import type { NodeKind } from '../../tree/TreeNode';
import type { ObjectPropertiesCollection } from './_types';
import {
  getDisplayTypedFieldPropertyKeys,
  type TypeAwarePropertyOwnerKind,
} from '../../../infra/xml/TypedFieldPropertyRules';
import { summarizeTypeBlock } from './propertyExtractors';
import { getFormPropertyKeys, isFormPropertyKey } from '../../../infra/xml/PropertySchema';

/**
 * Заголовок и порядок секции выбора форм — единые для всех видов метаданных.
 *
 * Экспортируется не ради удобства: тот же литерал заголовка стоит в webview
 * (`src-ui/apps/dynamic-panel/views/properties/PropertiesView.vue`), и именно
 * по нему панель включает контрол выбора формы. Связка неявная и через границу
 * сборки, поэтому её стережёт тест `formSectionContract.test.ts`.
 */
export const FORM_PROPERTY_SECTION = { title: 'Формы', order: 80 } as const;

/**
 * Общие поля корневого объекта (план обмена, бизнес-процесс, задача, …).
 *
 * Свойства выбора форм не перечисляются здесь списком: их состав у каждого вида
 * свой и снят с эталона — единственный источник `FORM_PROPERTY_KEYS_BY_KIND`.
 * Вид, которого нет в той таблице (служебные узлы, дочерние элементы), получает
 * набор вообще без форм — панель не должна предлагать записать свойство,
 * которого у вида не бывает.
 */
function buildCommonRootKeys(rootMetaKind: NodeKind): string[] {
  return [
    'Name',
    'Synonym',
    'Comment',
    'ObjectBelonging',
    'ExtendedConfigurationObject',
    ...getObjectFormPropertyKeys(rootMetaKind),
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
}

/**
 * Свойства выбора форм ОБЪЕКТА метаданных.
 *
 * Корень выгрузки в этот набор не попадает: у конфигурации и расширения формы
 * уровня приложения (`DefaultReportForm`, `DefaultConstantsForm`, …), и место им
 * в собственном каноне {@link CONFIGURATION_PROPERTY_KEYS}, а не в общем наборе
 * свойств объекта метаданных, куда общая ветка подставляет формы по виду.
 */
function getObjectFormPropertyKeys(rootMetaKind: NodeKind): readonly string[] {
  if (rootMetaKind === 'configuration' || rootMetaKind === 'extension') {
    return [];
  }
  return getFormPropertyKeys(rootMetaKind);
}

/** Поля корня «Справочник» по разделам конфигуратора, без реквизитов и табличных частей. */
function buildCatalogLikeRootKeys(rootMetaKind: NodeKind): string[] {
  return [
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
    ...getFormPropertyKeys(rootMetaKind),
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
}

/** Порядок свойств корня «Справочник» (переиспользуется планами счетов/видов расчёта через merge). */
export const CATALOG_ROOT_META_PROPERTY_KEYS: string[] = buildCatalogLikeRootKeys('Catalog');

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
  DefaultObjectForm: FORM_PROPERTY_SECTION,
  DefaultFolderForm: FORM_PROPERTY_SECTION,
  DefaultListForm: FORM_PROPERTY_SECTION,
  DefaultChoiceForm: FORM_PROPERTY_SECTION,
  DefaultFolderChoiceForm: FORM_PROPERTY_SECTION,
  AuxiliaryObjectForm: FORM_PROPERTY_SECTION,
  AuxiliaryFolderForm: FORM_PROPERTY_SECTION,
  AuxiliaryListForm: FORM_PROPERTY_SECTION,
  AuxiliaryChoiceForm: FORM_PROPERTY_SECTION,
  AuxiliaryFolderChoiceForm: FORM_PROPERTY_SECTION,
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
  ...getFormPropertyKeys('Document'),
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
  DefaultObjectForm: FORM_PROPERTY_SECTION,
  DefaultListForm: FORM_PROPERTY_SECTION,
  DefaultChoiceForm: FORM_PROPERTY_SECTION,
  AuxiliaryObjectForm: FORM_PROPERTY_SECTION,
  AuxiliaryListForm: FORM_PROPERTY_SECTION,
  AuxiliaryChoiceForm: FORM_PROPERTY_SECTION,
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
  ...getFormPropertyKeys('Enum'),
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
  ...getFormPropertyKeys('Report'),
  'MainDataCompositionSchema',
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
  ...getFormPropertyKeys('DataProcessor'),
  'IncludeHelpInContents',
  'ExtendedPresentation',
  'Explanation',
];

const DOCUMENT_JOURNAL_ROOT_META_PROPERTY_KEYS: string[] = [
  'Name',
  'Synonym',
  'Comment',
  ...getFormPropertyKeys('DocumentJournal'),
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
  ...getFormPropertyKeys('FilterCriterion'),
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
  ...getFormPropertyKeys('SettingsStorage'),
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

/**
 * Поля корня регистра сведений и регистра расчёта: отличаются только составом
 * форм — у регистра расчёта в эталоне нет формы записи.
 */
function buildInformationRegisterLikeKeys(rootMetaKind: NodeKind): string[] {
  return [
    'Name',
    'Synonym',
    'Comment',
    'UseStandardCommands',
    'EditType',
    ...getFormPropertyKeys(rootMetaKind),
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
}

const ACCUMULATION_REGISTER_ROOT_META_PROPERTY_KEYS: string[] = [
  'Name',
  'Synonym',
  'Comment',
  'UseStandardCommands',
  ...getFormPropertyKeys('AccumulationRegister'),
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
  ...getFormPropertyKeys('AccountingRegister'),
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
  // Формы уровня приложения — из общего реестра, как и у видов метаданных.
  // `DefaultReportAppearanceTemplate` в блок не входит: это макет оформления,
  // а не форма, и ему не место в секции выбора форм.
  ...getFormPropertyKeys('configuration'),
  'DefaultReportAppearanceTemplate',
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
];

/** Порядок ключей корня по типу объекта */
export function getRootPropertyKeyOrder(rootMetaKind: NodeKind): string[] {
  if (rootMetaKind === 'DefinedType' || rootMetaKind === 'SessionParameter') {
    return ['Name', 'Synonym', 'Comment', 'Type'];
  }
  if (rootMetaKind === 'ExchangePlan') {
    return [...buildCommonRootKeys(rootMetaKind), ...EXCHANGE_PLAN_ROOT_EXTRA_KEYS];
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
    return buildInformationRegisterLikeKeys(rootMetaKind);
  }
  if (rootMetaKind === 'AccumulationRegister') {
    return ACCUMULATION_REGISTER_ROOT_META_PROPERTY_KEYS;
  }
  if (rootMetaKind === 'AccountingRegister') {
    return ACCOUNTING_REGISTER_ROOT_META_PROPERTY_KEYS;
  }
  if (rootMetaKind === 'BusinessProcess') {
    return mergePropertyKeys(buildCommonRootKeys(rootMetaKind), DOCUMENT_LIKE_ROOT_EXTRA_KEYS, ['Task', 'CreateTaskInPrivilegedMode']);
  }
  if (rootMetaKind === 'Task') {
    return mergePropertyKeys(buildCommonRootKeys(rootMetaKind), DOCUMENT_LIKE_ROOT_EXTRA_KEYS, [
      'TaskNumberAutoPrefix',
      'DescriptionLength',
      'Addressing',
      'MainAddressingAttribute',
      'CurrentPerformer',
    ]);
  }
  if (rootMetaKind === 'ChartOfCharacteristicTypes') {
    return mergePropertyKeys(buildCatalogLikeRootKeys(rootMetaKind), ['CharacteristicExtValues', 'Type']);
  }
  if (rootMetaKind === 'ChartOfAccounts') {
    return mergePropertyKeys(buildCatalogLikeRootKeys(rootMetaKind), [
      'ExtDimensionTypes',
      'MaxExtDimensionCount',
      'CodeMask',
      'AutoOrderByCode',
      'OrderLength',
    ]);
  }
  if (rootMetaKind === 'ChartOfCalculationTypes') {
    return mergePropertyKeys(buildCatalogLikeRootKeys(rootMetaKind), [
      'DependenceOnCalculationTypes',
      'BaseCalculationTypes',
      'ActionPeriodUse',
    ]);
  }
  return buildCommonRootKeys(rootMetaKind);
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

/**
 * Относит свойства выбора форм к секции «Формы».
 *
 * Секция не косметика: панель рендерит блок с этим заголовком отдельным
 * контролом выбора формы (вкладки «Основные»/«Дополнительные», кнопки выбора и
 * очистки). Пока секцию проставляли только справочник и документ, у остальных
 * видов — обработки, отчёта, журнала, регистров, перечисления, хранилища
 * настроек — свойства форм попадали в общий список как безымянная строка, и
 * выбора формы не было вовсе. Применяется ко всем видам, поверх собственных
 * карт секций справочника/документа (там для этих ключей ровно те же значения).
 */
export function applyFormPropertySection(properties: ObjectPropertiesCollection): ObjectPropertiesCollection {
  return properties.map((property) => (isFormPropertyKey(property.key)
    ? { ...property, section: FORM_PROPERTY_SECTION.title, sectionOrder: FORM_PROPERTY_SECTION.order }
    : property));
}

export function isTypeAwareRootKind(rootMetaKind: NodeKind): rootMetaKind is 'Constant' | 'CommonAttribute' {
  return rootMetaKind === 'Constant' || rootMetaKind === 'CommonAttribute';
}

/**
 * Порядок ключей панели свойств типизированного поля.
 *
 * `role` передаёт вызывающий (узел дерева знает, реквизит это или колонка ТЧ):
 * тег XML источником решения быть не может — колонка ТЧ сериализуется тем же
 * `<Attribute>`, что и реквизит верхнего уровня, а состав свойств у них разный.
 * Неизвестная роль/владелец — не повод уходить на общий список без учёта
 * владельца: состав объединяется по кандидатам (см. getDisplayTypedFieldPropertyKeys).
 */
export function getTypedFieldPropertyKeyOrder(
  elementFullXml: string,
  ownerKind?: string,
  role?: TypeAwarePropertyOwnerKind
): string[] {
  return [
    'Name',
    'Synonym',
    'Comment',
    'Type',
    ...getDisplayTypedFieldPropertyKeys(role, summarizeTypeBlock(elementFullXml), ownerKind, elementFullXml),
  ];
}

export function getTypeAwarePropertyKeyOrder(elementFullXml: string, kind: TypeAwarePropertyOwnerKind): string[] {
  // Константа и общий реквизит — самовладеющие: роль и владелец совпадают.
  // Основная форма константы — не свойство типизированного поля, а свойство
  // самого объекта (999 из 999 констант эталона несут `<DefaultForm/>`),
  // поэтому она добавляется поверх набора типизированного поля.
  return [...getTypedFieldPropertyKeyOrder(elementFullXml, kind, kind), ...getFormPropertyKeys(kind)];
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
