// СГЕНЕРИРОВАНО из эталонных выгрузок 1С (example/: 2.20 cf, 2.21 cf, 2.21 cfe/EVOLC).
//
// Метод снятия: по всем 28 257 корневым объектам корпуса собраны прямые дети
// `<Properties>`, из каждого файла взяты ВСЕ пары «раньше→позже», полученный
// граф проверен на ацикличность и линеаризован. Ноль контрпримеров: общая
// надпоследовательность существует для каждого из 48 видов, порядок 2.20 —
// подпоследовательность 2.21, поэтому оси версии формата здесь нет. Правило
// НЕ выведено из XSD платформы: доступной схемы у `<Properties>` в проекте нет,
// а наблюдаемый порядок различается по видам (`CommandParameterType` общей
// команды идёт десятым, `Type` константы — четвёртым).
//
// Вакуумный ноль: `ExternalDataSource`, `Sequence`, `Interface` и
// `WebSocketClient` в корпусе не встречаются ни разу — строк они не получают.
// Это «мерить было не на чем», а НЕ утверждение, что у этих видов порядка нет:
// при появлении эталона правило снимается тем же способом.
//
// Правка руками допустима только по новому эталону; см. docs/xml-format-rulesets.md.
import { META_TYPES, type MetaKind } from '../../../domain/MetaTypes';

/**
 * Канон порядка ПРЯМЫХ детей `<Properties>` по виду КОРНЕВОГО объекта выгрузки.
 *
 * Ключ — {@link MetaKind}, а не строка: завести правило мимо `META_TYPES`
 * невозможно типизацией (запрет на параллельные реестры видов). Числа в
 * комментариях — размер выборки корпуса по виду.
 *
 * Дочерние элементы (реквизиты, измерения, ресурсы, колонки) сюда НЕ входят:
 * замер снят с корней, а состав и порядок свойств поля живут в
 * `infra/xml/typedField/TypedFieldOwnerRules.ts` — другая ось.
 *
 * Расширение своей строки не имеет: корень `Configuration.xml` расширения —
 * тот же тег `<Configuration>`, и обслуживается строкой `configuration`.
 */
export const ROOT_PROPERTY_ORDER: Partial<Record<MetaKind, readonly string[]>> = {
  // 2 файла корпуса, корень <AccountingRegister>
  AccountingRegister: ['Name', 'Synonym', 'Comment', 'UseStandardCommands', 'IncludeHelpInContents', 'ChartOfAccounts', 'Correspondence', 'PeriodAdjustmentLength', 'DefaultListForm', 'AuxiliaryListForm', 'StandardAttributes', 'DataLockControlMode', 'EnableTotalsSplitting', 'FullTextSearch', 'ListPresentation', 'ExtendedListPresentation', 'Explanation'],
  // 140 файлов корпуса, корень <AccumulationRegister>
  AccumulationRegister: ['Name', 'Synonym', 'Comment', 'UseStandardCommands', 'DefaultListForm', 'AuxiliaryListForm', 'RegisterType', 'IncludeHelpInContents', 'StandardAttributes', 'DataLockControlMode', 'FullTextSearch', 'EnableTotalsSplitting', 'ListPresentation', 'ExtendedListPresentation', 'Explanation'],
  // 1 файл корпуса, корень <Bot>
  Bot: ['Name', 'Synonym', 'Comment', 'Predefined', 'Picture'],
  // 10 файлов корпуса, корень <BusinessProcess>
  BusinessProcess: ['Name', 'Synonym', 'Comment', 'UseStandardCommands', 'EditType', 'InputByString', 'CreateOnInput', 'SearchStringModeOnInputByString', 'ChoiceDataGetModeOnInputByString', 'FullTextSearchOnInputByString', 'DefaultObjectForm', 'DefaultListForm', 'DefaultChoiceForm', 'AuxiliaryObjectForm', 'AuxiliaryListForm', 'AuxiliaryChoiceForm', 'ChoiceHistoryOnInput', 'NumberType', 'NumberLength', 'NumberAllowedLength', 'CheckUnique', 'StandardAttributes', 'Characteristics', 'Autonumbering', 'BasedOn', 'NumberPeriodicity', 'Task', 'CreateTaskInPrivilegedMode', 'DataLockFields', 'DataLockControlMode', 'IncludeHelpInContents', 'FullTextSearch', 'ObjectPresentation', 'ExtendedObjectPresentation', 'ListPresentation', 'ExtendedListPresentation', 'Explanation', 'DataHistory', 'UpdateDataHistoryImmediatelyAfterWrite', 'ExecuteAfterWriteDataHistoryVersionProcessing'],
  // 1 файл корпуса, корень <CalculationRegister>
  CalculationRegister: ['Name', 'Synonym', 'Comment', 'UseStandardCommands', 'DefaultListForm', 'AuxiliaryListForm', 'Periodicity', 'ActionPeriod', 'BasePeriod', 'Schedule', 'ScheduleValue', 'ScheduleDate', 'ChartOfCalculationTypes', 'IncludeHelpInContents', 'StandardAttributes', 'DataLockControlMode', 'FullTextSearch', 'ListPresentation', 'ExtendedListPresentation', 'Explanation'],
  // 755 файлов корпуса, корень <Catalog>
  Catalog: ['ObjectBelonging', 'Name', 'Synonym', 'Comment', 'ExtendedConfigurationObject', 'Hierarchical', 'HierarchyType', 'LimitLevelCount', 'LevelCount', 'FoldersOnTop', 'UseStandardCommands', 'Owners', 'SubordinationUse', 'CodeLength', 'DescriptionLength', 'CodeType', 'CodeAllowedLength', 'CodeSeries', 'CheckUnique', 'Autonumbering', 'DefaultPresentation', 'StandardAttributes', 'Characteristics', 'PredefinedDataUpdate', 'EditType', 'QuickChoice', 'ChoiceMode', 'InputByString', 'SearchStringModeOnInputByString', 'FullTextSearchOnInputByString', 'ChoiceDataGetModeOnInputByString', 'DefaultObjectForm', 'DefaultFolderForm', 'DefaultListForm', 'DefaultChoiceForm', 'DefaultFolderChoiceForm', 'AuxiliaryObjectForm', 'AuxiliaryFolderForm', 'AuxiliaryListForm', 'AuxiliaryChoiceForm', 'AuxiliaryFolderChoiceForm', 'IncludeHelpInContents', 'BasedOn', 'DataLockFields', 'DataLockControlMode', 'FullTextSearch', 'ObjectPresentation', 'ExtendedObjectPresentation', 'ListPresentation', 'ExtendedListPresentation', 'Explanation', 'CreateOnInput', 'ChoiceHistoryOnInput', 'DataHistory', 'UpdateDataHistoryImmediatelyAfterWrite', 'ExecuteAfterWriteDataHistoryVersionProcessing'],
  // 2 файла корпуса, корень <ChartOfAccounts>
  ChartOfAccounts: ['Name', 'Synonym', 'Comment', 'UseStandardCommands', 'IncludeHelpInContents', 'BasedOn', 'ExtDimensionTypes', 'MaxExtDimensionCount', 'CodeMask', 'CodeLength', 'DescriptionLength', 'CodeSeries', 'CheckUnique', 'DefaultPresentation', 'StandardAttributes', 'Characteristics', 'StandardTabularSections', 'PredefinedDataUpdate', 'EditType', 'QuickChoice', 'ChoiceMode', 'InputByString', 'SearchStringModeOnInputByString', 'FullTextSearchOnInputByString', 'ChoiceDataGetModeOnInputByString', 'CreateOnInput', 'ChoiceHistoryOnInput', 'DefaultObjectForm', 'DefaultListForm', 'DefaultChoiceForm', 'AuxiliaryObjectForm', 'AuxiliaryListForm', 'AuxiliaryChoiceForm', 'AutoOrderByCode', 'OrderLength', 'DataLockFields', 'DataLockControlMode', 'FullTextSearch', 'DataHistory', 'UpdateDataHistoryImmediatelyAfterWrite', 'ExecuteAfterWriteDataHistoryVersionProcessing', 'ObjectPresentation', 'ExtendedObjectPresentation', 'ListPresentation', 'ExtendedListPresentation', 'Explanation'],
  // 3 файла корпуса, корень <ChartOfCalculationTypes>
  ChartOfCalculationTypes: ['Name', 'Synonym', 'Comment', 'UseStandardCommands', 'CodeLength', 'DescriptionLength', 'CodeType', 'CodeAllowedLength', 'DefaultPresentation', 'EditType', 'QuickChoice', 'ChoiceMode', 'InputByString', 'SearchStringModeOnInputByString', 'FullTextSearchOnInputByString', 'ChoiceDataGetModeOnInputByString', 'CreateOnInput', 'ChoiceHistoryOnInput', 'DefaultObjectForm', 'DefaultListForm', 'DefaultChoiceForm', 'AuxiliaryObjectForm', 'AuxiliaryListForm', 'AuxiliaryChoiceForm', 'BasedOn', 'DependenceOnCalculationTypes', 'BaseCalculationTypes', 'ActionPeriodUse', 'StandardAttributes', 'Characteristics', 'StandardTabularSections', 'PredefinedDataUpdate', 'IncludeHelpInContents', 'DataLockFields', 'DataLockControlMode', 'FullTextSearch', 'ObjectPresentation', 'ExtendedObjectPresentation', 'ListPresentation', 'ExtendedListPresentation', 'Explanation', 'DataHistory', 'UpdateDataHistoryImmediatelyAfterWrite', 'ExecuteAfterWriteDataHistoryVersionProcessing'],
  // 11 файлов корпуса, корень <ChartOfCharacteristicTypes>
  ChartOfCharacteristicTypes: ['Name', 'Synonym', 'Comment', 'UseStandardCommands', 'IncludeHelpInContents', 'CharacteristicExtValues', 'Type', 'Hierarchical', 'FoldersOnTop', 'CodeLength', 'CodeAllowedLength', 'DescriptionLength', 'CodeSeries', 'CheckUnique', 'Autonumbering', 'DefaultPresentation', 'StandardAttributes', 'Characteristics', 'PredefinedDataUpdate', 'EditType', 'QuickChoice', 'ChoiceMode', 'InputByString', 'CreateOnInput', 'SearchStringModeOnInputByString', 'ChoiceDataGetModeOnInputByString', 'FullTextSearchOnInputByString', 'ChoiceHistoryOnInput', 'DefaultObjectForm', 'DefaultFolderForm', 'DefaultListForm', 'DefaultChoiceForm', 'DefaultFolderChoiceForm', 'AuxiliaryObjectForm', 'AuxiliaryFolderForm', 'AuxiliaryListForm', 'AuxiliaryChoiceForm', 'AuxiliaryFolderChoiceForm', 'BasedOn', 'DataLockFields', 'DataLockControlMode', 'FullTextSearch', 'ObjectPresentation', 'ExtendedObjectPresentation', 'ListPresentation', 'ExtendedListPresentation', 'Explanation', 'DataHistory', 'UpdateDataHistoryImmediatelyAfterWrite', 'ExecuteAfterWriteDataHistoryVersionProcessing'],
  // 30 файлов корпуса, корень <CommandGroup>
  CommandGroup: ['Name', 'Synonym', 'Comment', 'Representation', 'ToolTip', 'Picture', 'Category'],
  // 7 файлов корпуса, корень <CommonAttribute>
  CommonAttribute: ['Name', 'Synonym', 'Comment', 'Type', 'PasswordMode', 'Format', 'EditFormat', 'ToolTip', 'MarkNegatives', 'Mask', 'MultiLine', 'ExtendedEdit', 'MinValue', 'MaxValue', 'FillFromFillingValue', 'FillValue', 'FillChecking', 'ChoiceFoldersAndItems', 'ChoiceParameterLinks', 'ChoiceParameters', 'QuickChoice', 'CreateOnInput', 'ChoiceForm', 'LinkByType', 'ChoiceHistoryOnInput', 'Content', 'AutoUse', 'DataSeparation', 'SeparatedDataUse', 'DataSeparationValue', 'DataSeparationUse', 'ConditionalSeparation', 'UsersSeparation', 'AuthenticationSeparation', 'ConfigurationExtensionsSeparation', 'Indexing', 'FullTextSearch', 'DataHistory'],
  // 316 файлов корпуса, корень <CommonCommand>
  CommonCommand: ['Name', 'Synonym', 'Comment', 'Group', 'Representation', 'ToolTip', 'Picture', 'Shortcut', 'IncludeHelpInContents', 'CommandParameterType', 'ParameterUseMode', 'ModifiesData', 'OnMainServerUnavalableBehavior'],
  // 397 файлов корпуса, корень <CommonForm>
  CommonForm: ['Name', 'Synonym', 'Comment', 'FormType', 'IncludeHelpInContents', 'UsePurposes', 'UseInInterfaceCompatibilityMode', 'UseStandardCommands', 'ExtendedPresentation', 'Explanation'],
  // 3333 файла корпуса, корень <CommonModule>
  CommonModule: ['Name', 'Synonym', 'Comment', 'Global', 'ClientManagedApplication', 'Server', 'ExternalConnection', 'ClientOrdinaryApplication', 'ServerCall', 'Privileged', 'ReturnValuesReuse'],
  // 3005 файлов корпуса, корень <CommonPicture>
  CommonPicture: ['ObjectBelonging', 'Name', 'Synonym', 'Comment', 'ExtendedConfigurationObject', 'AvailabilityForChoice', 'AvailabilityForAppearance'],
  // 282 файла корпуса, корень <CommonTemplate>
  CommonTemplate: ['Name', 'Synonym', 'Comment', 'TemplateType'],
  // 3 файла корпуса, корень <Configuration>
  configuration: ['ObjectBelonging', 'Name', 'Synonym', 'Comment', 'ConfigurationExtensionPurpose', 'KeepMappingToExtendedConfigurationObjectsByIDs', 'NamePrefix', 'ConfigurationExtensionCompatibilityMode', 'DefaultRunMode', 'UsePurposes', 'ScriptVariant', 'DefaultRoles', 'Vendor', 'Version', 'UpdateCatalogAddress', 'IncludeHelpInContents', 'UseManagedFormInOrdinaryApplication', 'UseOrdinaryFormInManagedApplication', 'AdditionalFullTextSearchDictionaries', 'CommonSettingsStorage', 'ReportsUserSettingsStorage', 'ReportsVariantsStorage', 'FormDataSettingsStorage', 'DynamicListsUserSettingsStorage', 'URLExternalDataStorage', 'Content', 'DefaultReportForm', 'DefaultReportVariantForm', 'DefaultReportSettingsForm', 'DefaultReportAppearanceTemplate', 'DefaultDynamicListSettingsForm', 'DefaultSearchForm', 'DefaultDataHistoryChangeHistoryForm', 'DefaultDataHistoryVersionDataForm', 'DefaultDataHistoryVersionDifferencesForm', 'DefaultCollaborationSystemUsersChoiceForm', 'AuxiliaryReportForm', 'AuxiliaryReportVariantForm', 'AuxiliaryReportSettingsForm', 'AuxiliaryDynamicListSettingsForm', 'AuxiliaryDataHistoryChangeHistoryForm', 'AuxiliaryDataHistoryVersionDataForm', 'AuxiliaryDataHistoryVersionDifferencesForm', 'AuxiliaryCollaborationSystemUsersChoiceForm', 'RequiredMobileApplicationPermissions', 'UsedMobileApplicationFunctionalities', 'StandaloneConfigurationRestrictionRoles', 'MobileApplicationURLs', 'AllowedIncomingShareRequestTypes', 'MainClientApplicationWindowInterfaceVariant', 'ClientApplicationTheme', 'MainClientApplicationWindowMode', 'ClientApplicationWindowsOpenVariant', 'DefaultInterface', 'Caption', 'ShortCaption', 'DefaultStyle', 'DefaultLanguage', 'BriefInformation', 'DetailedInformation', 'Copyright', 'VendorInformationAddress', 'ConfigurationInformationAddress', 'DataLockControlMode', 'ObjectAutonumerationMode', 'ModalityUseMode', 'SynchronousPlatformExtensionAndAddInCallUseMode', 'InterfaceCompatibilityMode', 'Version85InterfaceMigrationMode', 'DatabaseTablespacesUseMode', 'CompatibilityMode', 'DefaultConstantsForm'],
  // 999 файлов корпуса, корень <Constant>
  Constant: ['Name', 'Synonym', 'Comment', 'Type', 'UseStandardCommands', 'DefaultForm', 'ExtendedPresentation', 'Explanation', 'PasswordMode', 'Format', 'EditFormat', 'ToolTip', 'MarkNegatives', 'Mask', 'MultiLine', 'ExtendedEdit', 'MinValue', 'MaxValue', 'FillChecking', 'ChoiceFoldersAndItems', 'ChoiceParameterLinks', 'ChoiceParameters', 'QuickChoice', 'ChoiceForm', 'LinkByType', 'ChoiceHistoryOnInput', 'DataLockControlMode', 'DataHistory', 'UpdateDataHistoryImmediatelyAfterWrite', 'ExecuteAfterWriteDataHistoryVersionProcessing'],
  // 357 файлов корпуса, корень <DataProcessor>
  DataProcessor: ['Name', 'Synonym', 'Comment', 'UseStandardCommands', 'DefaultForm', 'AuxiliaryForm', 'IncludeHelpInContents', 'ExtendedPresentation', 'Explanation'],
  // 622 файла корпуса, корень <DefinedType>
  DefinedType: ['Name', 'Synonym', 'Comment', 'Type'],
  // 356 файлов корпуса, корень <Document>
  Document: ['Name', 'Synonym', 'Comment', 'UseStandardCommands', 'Numerator', 'NumberType', 'NumberLength', 'NumberAllowedLength', 'NumberPeriodicity', 'CheckUnique', 'Autonumbering', 'StandardAttributes', 'Characteristics', 'BasedOn', 'InputByString', 'CreateOnInput', 'SearchStringModeOnInputByString', 'FullTextSearchOnInputByString', 'ChoiceDataGetModeOnInputByString', 'DefaultObjectForm', 'DefaultListForm', 'DefaultChoiceForm', 'AuxiliaryObjectForm', 'AuxiliaryListForm', 'AuxiliaryChoiceForm', 'Posting', 'RealTimePosting', 'RegisterRecordsDeletion', 'RegisterRecordsWritingOnPost', 'SequenceFilling', 'RegisterRecords', 'PostInPrivilegedMode', 'UnpostInPrivilegedMode', 'IncludeHelpInContents', 'DataLockFields', 'DataLockControlMode', 'FullTextSearch', 'ObjectPresentation', 'ExtendedObjectPresentation', 'ListPresentation', 'ExtendedListPresentation', 'Explanation', 'ChoiceHistoryOnInput', 'DataHistory', 'UpdateDataHistoryImmediatelyAfterWrite', 'ExecuteAfterWriteDataHistoryVersionProcessing'],
  // 51 файл корпуса, корень <DocumentJournal>
  DocumentJournal: ['Name', 'Synonym', 'Comment', 'DefaultForm', 'AuxiliaryForm', 'UseStandardCommands', 'RegisteredDocuments', 'IncludeHelpInContents', 'StandardAttributes', 'ListPresentation', 'ExtendedListPresentation', 'Explanation'],
  // 2 файла корпуса, корень <DocumentNumerator>
  DocumentNumerator: ['Name', 'Synonym', 'Comment', 'NumberType', 'NumberLength', 'NumberAllowedLength', 'NumberPeriodicity', 'CheckUnique'],
  // 1146 файлов корпуса, корень <Enum>
  Enum: ['ObjectBelonging', 'Name', 'Synonym', 'Comment', 'ExtendedConfigurationObject', 'UseStandardCommands', 'StandardAttributes', 'Characteristics', 'QuickChoice', 'ChoiceMode', 'DefaultListForm', 'DefaultChoiceForm', 'AuxiliaryListForm', 'AuxiliaryChoiceForm', 'ListPresentation', 'ExtendedListPresentation', 'Explanation', 'ChoiceHistoryOnInput'],
  // 451 файл корпуса, корень <EventSubscription>
  EventSubscription: ['Name', 'Synonym', 'Comment', 'Source', 'Event', 'Handler'],
  // 26 файлов корпуса, корень <ExchangePlan>
  ExchangePlan: ['Name', 'Synonym', 'Comment', 'UseStandardCommands', 'CodeLength', 'CodeAllowedLength', 'DescriptionLength', 'DefaultPresentation', 'EditType', 'QuickChoice', 'ChoiceMode', 'InputByString', 'SearchStringModeOnInputByString', 'FullTextSearchOnInputByString', 'ChoiceDataGetModeOnInputByString', 'DefaultObjectForm', 'DefaultListForm', 'DefaultChoiceForm', 'AuxiliaryObjectForm', 'AuxiliaryListForm', 'AuxiliaryChoiceForm', 'StandardAttributes', 'Characteristics', 'BasedOn', 'DistributedInfoBase', 'IncludeConfigurationExtensions', 'CreateOnInput', 'ChoiceHistoryOnInput', 'IncludeHelpInContents', 'DataLockFields', 'DataLockControlMode', 'FullTextSearch', 'ObjectPresentation', 'ExtendedObjectPresentation', 'ListPresentation', 'ExtendedListPresentation', 'Explanation', 'DataHistory', 'UpdateDataHistoryImmediatelyAfterWrite', 'ExecuteAfterWriteDataHistoryVersionProcessing'],
  // 12 файлов корпуса, корень <FilterCriterion>
  FilterCriterion: ['Name', 'Synonym', 'Comment', 'Type', 'UseStandardCommands', 'Content', 'DefaultForm', 'AuxiliaryForm', 'ListPresentation', 'ExtendedListPresentation', 'Explanation'],
  // 5932 файла корпуса, корень <Form>
  Form: ['ObjectBelonging', 'Name', 'Synonym', 'Comment', 'ExtendedConfigurationObject', 'FormType', 'IncludeHelpInContents', 'UsePurposes', 'UseInInterfaceCompatibilityMode', 'ExtendedPresentation'],
  // 502 файла корпуса, корень <FunctionalOption>
  FunctionalOption: ['Name', 'Synonym', 'Comment', 'Location', 'PrivilegedGetMode', 'Content'],
  // 10 файлов корпуса, корень <FunctionalOptionsParameter>
  FunctionalOptionsParameter: ['Name', 'Synonym', 'Comment', 'Use'],
  // 20 файлов корпуса, корень <HTTPService>
  HTTPService: ['Name', 'Synonym', 'Comment', 'RootURL', 'ReuseSessions', 'SessionMaxAge'],
  // 1155 файлов корпуса, корень <InformationRegister>
  InformationRegister: ['Name', 'Synonym', 'Comment', 'UseStandardCommands', 'EditType', 'DefaultRecordForm', 'DefaultListForm', 'AuxiliaryRecordForm', 'AuxiliaryListForm', 'StandardAttributes', 'InformationRegisterPeriodicity', 'WriteMode', 'MainFilterOnPeriod', 'IncludeHelpInContents', 'DataLockControlMode', 'FullTextSearch', 'EnableTotalsSliceFirst', 'EnableTotalsSliceLast', 'RecordPresentation', 'ExtendedRecordPresentation', 'ListPresentation', 'ExtendedListPresentation', 'Explanation', 'DataHistory', 'UpdateDataHistoryImmediatelyAfterWrite', 'ExecuteAfterWriteDataHistoryVersionProcessing'],
  // 1 файл корпуса, корень <IntegrationService>
  IntegrationService: ['Name', 'Synonym', 'Comment', 'ExternalIntegrationServiceAddress'],
  // 3 файла корпуса, корень <Language>
  Language: ['ObjectBelonging', 'Name', 'Synonym', 'Comment', 'ExtendedConfigurationObject', 'LanguageCode'],
  // 129 файлов корпуса, корень <PaletteColor>
  PaletteColor: ['Name', 'Synonym', 'Comment', 'Color'],
  // 362 файла корпуса, корень <Report>
  Report: ['Name', 'Synonym', 'Comment', 'UseStandardCommands', 'DefaultForm', 'AuxiliaryForm', 'MainDataCompositionSchema', 'DefaultSettingsForm', 'AuxiliarySettingsForm', 'DefaultVariantForm', 'AuxiliaryVariantForm', 'VariantsStorage', 'SettingsStorage', 'IncludeHelpInContents', 'ExtendedPresentation', 'Explanation'],
  // 1038 файлов корпуса, корень <Role>
  Role: ['Name', 'Synonym', 'Comment'],
  // 178 файлов корпуса, корень <ScheduledJob>
  ScheduledJob: ['Name', 'Synonym', 'Comment', 'MethodName', 'Description', 'Key', 'Use', 'Predefined', 'RestartCountOnFailure', 'RestartIntervalOnFailure'],
  // 111 файлов корпуса, корень <SessionParameter>
  SessionParameter: ['Name', 'Synonym', 'Comment', 'Type'],
  // 5 файлов корпуса, корень <SettingsStorage>
  SettingsStorage: ['Name', 'Synonym', 'Comment', 'DefaultSaveForm', 'DefaultLoadForm', 'AuxiliarySaveForm', 'AuxiliaryLoadForm'],
  // 1 файл корпуса, корень <Style>
  Style: ['Name', 'Synonym', 'Comment'],
  // 529 файлов корпуса, корень <StyleItem>
  StyleItem: ['ObjectBelonging', 'Name', 'Synonym', 'Comment', 'ExtendedConfigurationObject', 'Type', 'Value'],
  // 732 файла корпуса, корень <Subsystem>
  Subsystem: ['Name', 'Synonym', 'Comment', 'IncludeHelpInContents', 'IncludeInCommandInterface', 'UseOneCommand', 'Explanation', 'Picture', 'Content'],
  // 2 файла корпуса, корень <Task>
  Task: ['Name', 'Synonym', 'Comment', 'UseStandardCommands', 'NumberType', 'NumberLength', 'NumberAllowedLength', 'CheckUnique', 'Autonumbering', 'TaskNumberAutoPrefix', 'DescriptionLength', 'Addressing', 'MainAddressingAttribute', 'CurrentPerformer', 'BasedOn', 'StandardAttributes', 'Characteristics', 'DefaultPresentation', 'EditType', 'InputByString', 'SearchStringModeOnInputByString', 'FullTextSearchOnInputByString', 'ChoiceDataGetModeOnInputByString', 'CreateOnInput', 'DefaultObjectForm', 'DefaultListForm', 'DefaultChoiceForm', 'AuxiliaryObjectForm', 'AuxiliaryListForm', 'AuxiliaryChoiceForm', 'ChoiceHistoryOnInput', 'IncludeHelpInContents', 'DataLockFields', 'DataLockControlMode', 'FullTextSearch', 'ObjectPresentation', 'ExtendedObjectPresentation', 'ListPresentation', 'ExtendedListPresentation', 'Explanation', 'DataHistory', 'UpdateDataHistoryImmediatelyAfterWrite', 'ExecuteAfterWriteDataHistoryVersionProcessing'],
  // 4797 файлов корпуса, корень <Template>
  Template: ['Name', 'Synonym', 'Comment', 'TemplateType'],
  // 19 файлов корпуса, корень <WebService>
  WebService: ['Name', 'Synonym', 'Comment', 'Namespace', 'XDTOPackages', 'DescriptorFileName', 'ReuseSessions', 'SessionMaxAge'],
  // 1 файл корпуса, корень <WSReference>
  WSReference: ['Name', 'Synonym', 'Comment', 'LocationURL'],
  // 410 файлов корпуса, корень <XDTOPackage>
  XDTOPackage: ['Name', 'Synonym', 'Comment', 'Namespace'],
};

/**
 * Корневой тег XML → вид метаданных. Строится ИЗ `META_TYPES`
 * (`englishKind ?? kind`), рукописной карты нет: у большинства видов тег
 * совпадает с `MetaKind`, но у корня выгрузки это `Configuration` при виде
 * `configuration`.
 */
const KIND_BY_XML_ROOT: ReadonlyMap<string, MetaKind> = new Map(
  Object.values(META_TYPES).map((def) => [def.englishKind ?? def.kind, def.kind] as const)
);

/** Строка канона по корневому тегу XML; `undefined` — правило для вида не снято. */
function rowOfXmlRoot(xmlRoot: string | undefined): readonly string[] | undefined {
  if (xmlRoot === undefined) {
    return undefined;
  }
  const kind = KIND_BY_XML_ROOT.get(xmlRoot);
  return kind ? ROOT_PROPERTY_ORDER[kind] : undefined;
}

/**
 * Ранг свойства — ИНДЕКС его места в строке вида (у `ObjectBelonging` он равен
 * 0, и это законный первый ранг, а не «нет ранга»). `null` — вид без снятого
 * правила, неизвестный корневой тег или ключ вне строки.
 *
 * Регистр значим: `ownerKind` — корневой тег XML (`Configuration`), а не
 * нормализуемая строка.
 */
export function rootPropertyRank(ownerKind: string | undefined, key: string): number | null {
  const index = rowOfXmlRoot(ownerKind)?.indexOf(key) ?? -1;
  return index >= 0 ? index : null;
}

/** Снято ли правило порядка для вида с этим корневым тегом XML. */
export function hasRootPropertyOrderRule(ownerKind: string | undefined): boolean {
  return (rowOfXmlRoot(ownerKind)?.length ?? 0) > 0;
}
