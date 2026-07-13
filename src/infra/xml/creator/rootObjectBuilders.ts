import type { MetaKind } from '../../../domain/MetaTypes';
import type { FormatRuleset } from '../format/FormatRuleset';
import {
  buildInternalInfo,
  buildLocalizedTag,
  escapeXml,
  needsChildObjects,
  newUuid,
  resolveTemplateType,
  saBlock,
  splitCamelCase,
  stsBlock,
  type TemplateType,
} from './creatorShared';

export function buildRootObjectXml(kind: MetaKind, name: string, formatVersion: string, ruleset: FormatRuleset, templateType?: TemplateType): string {
  const parts = [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<MetaDataObject ${ruleset.metaDataObjectXmlns} version="${formatVersion}">`,
    `\t<${kind} uuid="${newUuid()}">`,
    buildInternalInfo(kind, name, '\t\t', ruleset),
    `\t\t<Properties>${buildRootProperties(kind, name, ruleset, templateType)}\n\t\t</Properties>`,
    needsChildObjects(kind) ? '\t\t<ChildObjects/>' : '',
    `\t</${kind}>`,
    '</MetaDataObject>',
    '',
  ].filter((item) => item.length > 0);
  return parts.join('\n');
}

function buildRootProperties(kind: MetaKind, name: string, ruleset: FormatRuleset, templateType?: TemplateType): string {
  const base = [
    `\n\t\t\t<Name>${escapeXml(name)}</Name>`,
    buildLocalizedTag('\t\t\t', 'Synonym', splitCamelCase(name)),
    '\t\t\t<Comment/>',
  ];

  const typeBlock = () => ruleset.buildDefaultTypeBlock('\t\t\t');
  const join = (parts: string[]) => parts.filter((part) => part.length > 0).join('\n');
  switch (kind) {
    case 'Catalog':
      return join([...base, ...buildCatalogProperties(name, ruleset)]);
    case 'Document':
      return join([...base, ...buildDocumentProperties(ruleset)]);
    case 'DocumentJournal':
      return join([...base, ...buildDocumentJournalProperties()]);
    case 'Enum':
      return join([...base, ...buildEnumProperties()]);
    case 'InformationRegister':
      return join([...base, ...buildInformationRegisterProperties()]);
    case 'AccumulationRegister':
      return join([...base, ...buildAccumulationRegisterProperties(ruleset)]);
    case 'AccountingRegister':
      return join([...base, ...buildAccountingRegisterProperties(ruleset)]);
    case 'CalculationRegister':
      return join([...base, ...buildCalculationRegisterProperties(ruleset)]);
    case 'ChartOfAccounts':
      return join([...base, ...buildChartOfAccountsProperties(name, ruleset)]);
    case 'ChartOfCharacteristicTypes':
      return join([...base, ...buildChartOfCharacteristicTypesProperties(name, ruleset)]);
    case 'ChartOfCalculationTypes':
      return join([...base, ...buildChartOfCalculationTypesProperties(name, ruleset)]);
    case 'BusinessProcess':
      return join([...base, ...buildBusinessProcessProperties(name, ruleset)]);
    case 'Task':
      return join([...base, ...buildTaskProperties(name, ruleset)]);
    case 'ExchangePlan':
      return join([...base, ...buildExchangePlanProperties(ruleset)]);
    case 'Report':
      return join([...base, ...buildReportProperties(ruleset)]);
    case 'DataProcessor':
      return join([...base, ...buildDataProcessorProperties()]);
    case 'Constant':
      return join([...base, typeBlock(), ...buildConstantPropertiesAfterType()]);
    case 'CommonAttribute':
      return join([...base, typeBlock(), ...buildCommonAttributePropertiesAfterType()]);
    case 'DefinedType':
    case 'SessionParameter':
      return join([...base, typeBlock()]);
    case 'CommonModule':
      return join([...base, ...buildCommonModuleProperties()]);
    case 'CommonForm':
      return join([...base, ...buildCommonFormProperties()]);
    case 'ScheduledJob':
      return join([...base, ...buildScheduledJobProperties()]);
    case 'Subsystem':
      return join([...base, ...buildSubsystemProperties()]);
    case 'CommonCommand':
      return join([...base, ...buildCommonCommandProperties()]);
    case 'CommandGroup':
      return join([...base, ...buildCommandGroupProperties()]);
    case 'HTTPService':
      return join([...base, ...buildHttpServiceProperties()]);
    case 'WebService':
      return join([...base, ...buildWebServiceProperties()]);
    case 'FunctionalOption':
      return join([...base, ...buildFunctionalOptionProperties()]);
    case 'FunctionalOptionsParameter':
      return join([...base, '\t\t\t<Use/>']);
    case 'EventSubscription':
      return join([...base, ...buildEventSubscriptionProperties()]);
    case 'FilterCriterion':
      return join([...base, ...buildFilterCriterionProperties()]);
    case 'SettingsStorage':
      return join([...base, ...buildSettingsStorageProperties()]);
    case 'StyleItem':
      return join([...base, ...buildStyleItemProperties()]);
    case 'CommonPicture':
      return join([...base, ...buildCommonPictureProperties()]);
    case 'Bot':
      return join([...base, ...buildBotProperties()]);
    case 'Language':
      return join([...base, ...buildLanguageProperties()]);
    case 'CommonTemplate':
      return join([...base, `\t\t\t<TemplateType>${escapeXml(resolveTemplateType(templateType))}</TemplateType>`]);
    default:
      return join(base);
  }
}

function buildCatalogProperties(name: string, ruleset: FormatRuleset): string[] {
  return [
    '\t\t\t<Hierarchical>false</Hierarchical>',
    '\t\t\t<HierarchyType>HierarchyFoldersAndItems</HierarchyType>',
    '\t\t\t<LimitLevelCount>false</LimitLevelCount>',
    '\t\t\t<LevelCount>2</LevelCount>',
    '\t\t\t<FoldersOnTop>true</FoldersOnTop>',
    '\t\t\t<UseStandardCommands>true</UseStandardCommands>',
    '\t\t\t<Owners/>',
    '\t\t\t<SubordinationUse>ToItems</SubordinationUse>',
    '\t\t\t<CodeLength>9</CodeLength>',
    '\t\t\t<DescriptionLength>25</DescriptionLength>',
    '\t\t\t<CodeType>String</CodeType>',
    '\t\t\t<CodeAllowedLength>Variable</CodeAllowedLength>',
    '\t\t\t<CodeSeries>WholeCatalog</CodeSeries>',
    '\t\t\t<CheckUnique>true</CheckUnique>',
    '\t\t\t<Autonumbering>true</Autonumbering>',
    '\t\t\t<DefaultPresentation>AsDescription</DefaultPresentation>',
    ...saBlock('Catalog', ruleset),
    '\t\t\t<Characteristics/>',
    '\t\t\t<PredefinedDataUpdate>Auto</PredefinedDataUpdate>',
    '\t\t\t<EditType>InDialog</EditType>',
    '\t\t\t<QuickChoice>false</QuickChoice>',
    '\t\t\t<ChoiceMode>BothWays</ChoiceMode>',
    '\t\t\t<InputByString>',
    `\t\t\t\t<xr:Field>Catalog.${escapeXml(name)}.StandardAttribute.Description</xr:Field>`,
    `\t\t\t\t<xr:Field>Catalog.${escapeXml(name)}.StandardAttribute.Code</xr:Field>`,
    '\t\t\t</InputByString>',
    '\t\t\t<SearchStringModeOnInputByString>Begin</SearchStringModeOnInputByString>',
    '\t\t\t<FullTextSearchOnInputByString>DontUse</FullTextSearchOnInputByString>',
    '\t\t\t<ChoiceDataGetModeOnInputByString>Directly</ChoiceDataGetModeOnInputByString>',
    '\t\t\t<DefaultObjectForm/>',
    '\t\t\t<DefaultFolderForm/>',
    '\t\t\t<DefaultListForm/>',
    '\t\t\t<DefaultChoiceForm/>',
    '\t\t\t<DefaultFolderChoiceForm/>',
    '\t\t\t<AuxiliaryObjectForm/>',
    '\t\t\t<AuxiliaryFolderForm/>',
    '\t\t\t<AuxiliaryListForm/>',
    '\t\t\t<AuxiliaryChoiceForm/>',
    '\t\t\t<AuxiliaryFolderChoiceForm/>',
    '\t\t\t<IncludeHelpInContents>false</IncludeHelpInContents>',
    '\t\t\t<BasedOn/>',
    '\t\t\t<DataLockFields/>',
    '\t\t\t<DataLockControlMode>Managed</DataLockControlMode>',
    '\t\t\t<FullTextSearch>Use</FullTextSearch>',
    '\t\t\t<ObjectPresentation/>',
    '\t\t\t<ExtendedObjectPresentation/>',
    '\t\t\t<ListPresentation/>',
    '\t\t\t<ExtendedListPresentation/>',
    '\t\t\t<Explanation/>',
    '\t\t\t<CreateOnInput>Use</CreateOnInput>',
    '\t\t\t<ChoiceHistoryOnInput>Auto</ChoiceHistoryOnInput>',
    '\t\t\t<DataHistory>DontUse</DataHistory>',
    '\t\t\t<UpdateDataHistoryImmediatelyAfterWrite>false</UpdateDataHistoryImmediatelyAfterWrite>',
    '\t\t\t<ExecuteAfterWriteDataHistoryVersionProcessing>false</ExecuteAfterWriteDataHistoryVersionProcessing>',
  ];
}

function buildReportProperties(ruleset: FormatRuleset): string[] {
  return [
    '\t\t\t<UseStandardCommands>false</UseStandardCommands>',
    '\t\t\t<DefaultForm/>',
    '\t\t\t<AuxiliaryForm/>',
    '\t\t\t<MainDataCompositionSchema/>',
    '\t\t\t<DefaultSettingsForm/>',
    '\t\t\t<AuxiliarySettingsForm/>',
    '\t\t\t<DefaultVariantForm/>',
    ...(ruleset.includeReportAuxiliaryVariantForm ? ['\t\t\t<AuxiliaryVariantForm/>'] : []),
    '\t\t\t<VariantsStorage/>',
    '\t\t\t<SettingsStorage/>',
    '\t\t\t<IncludeHelpInContents>false</IncludeHelpInContents>',
    '\t\t\t<ExtendedPresentation/>',
    '\t\t\t<Explanation/>',
  ];
}

function buildDataProcessorProperties(): string[] {
  return [
    '\t\t\t<UseStandardCommands>true</UseStandardCommands>',
    '\t\t\t<DefaultForm/>',
    '\t\t\t<AuxiliaryForm/>',
    '\t\t\t<IncludeHelpInContents>false</IncludeHelpInContents>',
    '\t\t\t<ExtendedPresentation/>',
    '\t\t\t<Explanation/>',
  ];
}

/**
 * Свойства дескриптора общей формы (`CommonForms/<Имя>.xml`). Ключевое —
 * `<FormType>Managed</FormType>`: при отсутствии тега платформа 1С трактует форму
 * как обычную (Ordinary), а расширение создаёт только управляемые формы. Порядок и
 * состав свойств сняты с эталона 2.21 (`example/.../CommonForms/*.xml`) и совпадают
 * с каноном `COMMON_FORM_ROOT_META_PROPERTY_KEYS` панели свойств.
 */
function buildCommonFormProperties(): string[] {
  return [
    '\t\t\t<FormType>Managed</FormType>',
    '\t\t\t<IncludeHelpInContents>false</IncludeHelpInContents>',
    '\t\t\t<UsePurposes>',
    '\t\t\t\t<v8:Value xsi:type="app:ApplicationUsePurpose">PlatformApplication</v8:Value>',
    '\t\t\t</UsePurposes>',
    '\t\t\t<UseInInterfaceCompatibilityMode>Any</UseInInterfaceCompatibilityMode>',
    '\t\t\t<UseStandardCommands>true</UseStandardCommands>',
    '\t\t\t<ExtendedPresentation/>',
    '\t\t\t<Explanation/>',
  ];
}

/** Свойства константы после блока `<Type>` (его добавляет вызывающий через ruleset). */
function buildConstantPropertiesAfterType(): string[] {
  return [
    '\t\t\t<UseStandardCommands>false</UseStandardCommands>',
    '\t\t\t<DefaultForm/>',
    '\t\t\t<ExtendedPresentation/>',
    '\t\t\t<Explanation/>',
    '\t\t\t<PasswordMode>false</PasswordMode>',
    '\t\t\t<Format/>',
    '\t\t\t<EditFormat/>',
    '\t\t\t<ToolTip/>',
    '\t\t\t<MarkNegatives>false</MarkNegatives>',
    '\t\t\t<Mask/>',
    '\t\t\t<MultiLine>false</MultiLine>',
    '\t\t\t<ExtendedEdit>false</ExtendedEdit>',
    '\t\t\t<MinValue xsi:nil="true"/>',
    '\t\t\t<MaxValue xsi:nil="true"/>',
    '\t\t\t<FillChecking>DontCheck</FillChecking>',
    '\t\t\t<ChoiceFoldersAndItems>Items</ChoiceFoldersAndItems>',
    '\t\t\t<ChoiceParameterLinks/>',
    '\t\t\t<ChoiceParameters/>',
    '\t\t\t<QuickChoice>Auto</QuickChoice>',
    '\t\t\t<ChoiceForm/>',
    '\t\t\t<LinkByType/>',
    '\t\t\t<ChoiceHistoryOnInput>Auto</ChoiceHistoryOnInput>',
    '\t\t\t<DataLockControlMode>Managed</DataLockControlMode>',
    '\t\t\t<DataHistory>DontUse</DataHistory>',
    '\t\t\t<UpdateDataHistoryImmediatelyAfterWrite>false</UpdateDataHistoryImmediatelyAfterWrite>',
    '\t\t\t<ExecuteAfterWriteDataHistoryVersionProcessing>false</ExecuteAfterWriteDataHistoryVersionProcessing>',
  ];
}

function buildDocumentProperties(ruleset: FormatRuleset): string[] {
  return [
    '\t\t\t<UseStandardCommands>true</UseStandardCommands>',
    '\t\t\t<Numerator/>',
    '\t\t\t<NumberType>String</NumberType>',
    '\t\t\t<NumberLength>9</NumberLength>',
    '\t\t\t<NumberAllowedLength>Variable</NumberAllowedLength>',
    '\t\t\t<NumberPeriodicity>Nonperiodical</NumberPeriodicity>',
    '\t\t\t<CheckUnique>true</CheckUnique>',
    '\t\t\t<Autonumbering>true</Autonumbering>',
    ...saBlock('Document', ruleset),
    '\t\t\t<Characteristics/>',
    '\t\t\t<BasedOn/>',
    '\t\t\t<InputByString/>',
    '\t\t\t<CreateOnInput>Use</CreateOnInput>',
    '\t\t\t<SearchStringModeOnInputByString>Begin</SearchStringModeOnInputByString>',
    '\t\t\t<FullTextSearchOnInputByString>DontUse</FullTextSearchOnInputByString>',
    '\t\t\t<ChoiceDataGetModeOnInputByString>Directly</ChoiceDataGetModeOnInputByString>',
    '\t\t\t<DefaultObjectForm/>',
    '\t\t\t<DefaultListForm/>',
    '\t\t\t<DefaultChoiceForm/>',
    '\t\t\t<AuxiliaryObjectForm/>',
    '\t\t\t<AuxiliaryListForm/>',
    '\t\t\t<AuxiliaryChoiceForm/>',
    '\t\t\t<Posting>Allow</Posting>',
    '\t\t\t<RealTimePosting>Deny</RealTimePosting>',
    '\t\t\t<RegisterRecordsDeletion>AutoDeleteOff</RegisterRecordsDeletion>',
    '\t\t\t<RegisterRecordsWritingOnPost>WriteModified</RegisterRecordsWritingOnPost>',
    '\t\t\t<SequenceFilling>AutoFill</SequenceFilling>',
    '\t\t\t<RegisterRecords/>',
    '\t\t\t<PostInPrivilegedMode>false</PostInPrivilegedMode>',
    '\t\t\t<UnpostInPrivilegedMode>false</UnpostInPrivilegedMode>',
    '\t\t\t<IncludeHelpInContents>false</IncludeHelpInContents>',
    '\t\t\t<DataLockFields/>',
    '\t\t\t<DataLockControlMode>Automatic</DataLockControlMode>',
    '\t\t\t<FullTextSearch>Use</FullTextSearch>',
    '\t\t\t<ObjectPresentation/>',
    '\t\t\t<ExtendedObjectPresentation/>',
    '\t\t\t<ListPresentation/>',
    '\t\t\t<ExtendedListPresentation/>',
    '\t\t\t<Explanation/>',
    '\t\t\t<ChoiceHistoryOnInput>Auto</ChoiceHistoryOnInput>',
    '\t\t\t<DataHistory>DontUse</DataHistory>',
    '\t\t\t<UpdateDataHistoryImmediatelyAfterWrite>false</UpdateDataHistoryImmediatelyAfterWrite>',
    '\t\t\t<ExecuteAfterWriteDataHistoryVersionProcessing>false</ExecuteAfterWriteDataHistoryVersionProcessing>',
  ];
}

function buildDocumentJournalProperties(): string[] {
  return [
    '\t\t\t<DefaultForm/>',
    '\t\t\t<AuxiliaryForm/>',
    '\t\t\t<UseStandardCommands>true</UseStandardCommands>',
    '\t\t\t<RegisteredDocuments/>',
    '\t\t\t<IncludeHelpInContents>false</IncludeHelpInContents>',
    '\t\t\t<ListPresentation/>',
    '\t\t\t<ExtendedListPresentation/>',
    '\t\t\t<Explanation/>',
  ];
}

function buildEnumProperties(): string[] {
  return [
    '\t\t\t<UseStandardCommands>true</UseStandardCommands>',
    '\t\t\t<Characteristics/>',
    '\t\t\t<QuickChoice>true</QuickChoice>',
    '\t\t\t<ChoiceMode>BothWays</ChoiceMode>',
    '\t\t\t<DefaultListForm/>',
    '\t\t\t<DefaultChoiceForm/>',
    '\t\t\t<AuxiliaryListForm/>',
    '\t\t\t<AuxiliaryChoiceForm/>',
    '\t\t\t<ListPresentation/>',
    '\t\t\t<ExtendedListPresentation/>',
    '\t\t\t<Explanation/>',
    '\t\t\t<ChoiceHistoryOnInput>Auto</ChoiceHistoryOnInput>',
  ];
}

function buildInformationRegisterProperties(): string[] {
  return [
    '\t\t\t<UseStandardCommands>true</UseStandardCommands>',
    '\t\t\t<EditType>InDialog</EditType>',
    '\t\t\t<DefaultRecordForm/>',
    '\t\t\t<DefaultListForm/>',
    '\t\t\t<AuxiliaryRecordForm/>',
    '\t\t\t<AuxiliaryListForm/>',
    '\t\t\t<InformationRegisterPeriodicity>Nonperiodical</InformationRegisterPeriodicity>',
    '\t\t\t<WriteMode>Independent</WriteMode>',
    '\t\t\t<MainFilterOnPeriod>false</MainFilterOnPeriod>',
    '\t\t\t<IncludeHelpInContents>false</IncludeHelpInContents>',
    '\t\t\t<DataLockControlMode>Managed</DataLockControlMode>',
    '\t\t\t<FullTextSearch>DontUse</FullTextSearch>',
    '\t\t\t<EnableTotalsSliceFirst>false</EnableTotalsSliceFirst>',
    '\t\t\t<EnableTotalsSliceLast>false</EnableTotalsSliceLast>',
    '\t\t\t<RecordPresentation/>',
    '\t\t\t<ExtendedRecordPresentation/>',
    '\t\t\t<ListPresentation/>',
    '\t\t\t<ExtendedListPresentation/>',
    '\t\t\t<Explanation/>',
    '\t\t\t<DataHistory>DontUse</DataHistory>',
    '\t\t\t<UpdateDataHistoryImmediatelyAfterWrite>false</UpdateDataHistoryImmediatelyAfterWrite>',
    '\t\t\t<ExecuteAfterWriteDataHistoryVersionProcessing>false</ExecuteAfterWriteDataHistoryVersionProcessing>',
  ];
}

function buildAccumulationRegisterProperties(ruleset: FormatRuleset): string[] {
  return [
    '\t\t\t<UseStandardCommands>true</UseStandardCommands>',
    '\t\t\t<DefaultListForm/>',
    '\t\t\t<AuxiliaryListForm/>',
    '\t\t\t<RegisterType>Balance</RegisterType>',
    '\t\t\t<IncludeHelpInContents>false</IncludeHelpInContents>',
    ...saBlock('AccumulationRegister', ruleset),
    '\t\t\t<DataLockControlMode>Managed</DataLockControlMode>',
    '\t\t\t<FullTextSearch>DontUse</FullTextSearch>',
    '\t\t\t<EnableTotalsSplitting>false</EnableTotalsSplitting>',
    '\t\t\t<ListPresentation/>',
    '\t\t\t<ExtendedListPresentation/>',
    '\t\t\t<Explanation/>',
  ];
}

function buildAccountingRegisterProperties(ruleset: FormatRuleset): string[] {
  return [
    '\t\t\t<UseStandardCommands>true</UseStandardCommands>',
    '\t\t\t<IncludeHelpInContents>false</IncludeHelpInContents>',
    '\t\t\t<ChartOfAccounts/>',
    '\t\t\t<Correspondence>true</Correspondence>',
    '\t\t\t<PeriodAdjustmentLength>0</PeriodAdjustmentLength>',
    '\t\t\t<DefaultListForm/>',
    '\t\t\t<AuxiliaryListForm/>',
    ...saBlock('AccountingRegister', ruleset),
    '\t\t\t<DataLockControlMode>Managed</DataLockControlMode>',
    '\t\t\t<EnableTotalsSplitting>false</EnableTotalsSplitting>',
    '\t\t\t<FullTextSearch>DontUse</FullTextSearch>',
    '\t\t\t<ListPresentation/>',
    '\t\t\t<ExtendedListPresentation/>',
    '\t\t\t<Explanation/>',
  ];
}

function buildCalculationRegisterProperties(ruleset: FormatRuleset): string[] {
  return [
    '\t\t\t<UseStandardCommands>true</UseStandardCommands>',
    '\t\t\t<DefaultListForm/>',
    '\t\t\t<AuxiliaryListForm/>',
    '\t\t\t<Periodicity>Month</Periodicity>',
    '\t\t\t<ActionPeriod>false</ActionPeriod>',
    '\t\t\t<BasePeriod>false</BasePeriod>',
    '\t\t\t<Schedule/>',
    '\t\t\t<ScheduleValue/>',
    '\t\t\t<ScheduleDate/>',
    '\t\t\t<ChartOfCalculationTypes/>',
    '\t\t\t<IncludeHelpInContents>false</IncludeHelpInContents>',
    ...saBlock('CalculationRegister', ruleset),
    '\t\t\t<DataLockControlMode>Automatic</DataLockControlMode>',
    '\t\t\t<FullTextSearch>Use</FullTextSearch>',
    '\t\t\t<ListPresentation/>',
    '\t\t\t<ExtendedListPresentation/>',
    '\t\t\t<Explanation/>',
  ];
}

function buildChartOfAccountsProperties(name: string, ruleset: FormatRuleset): string[] {
  return [
    '\t\t\t<UseStandardCommands>true</UseStandardCommands>',
    '\t\t\t<IncludeHelpInContents>false</IncludeHelpInContents>',
    '\t\t\t<BasedOn/>',
    '\t\t\t<ExtDimensionTypes/>',
    '\t\t\t<MaxExtDimensionCount>0</MaxExtDimensionCount>',
    '\t\t\t<CodeMask/>',
    '\t\t\t<CodeLength>0</CodeLength>',
    '\t\t\t<DescriptionLength>25</DescriptionLength>',
    '\t\t\t<CodeSeries>WholeChartOfAccounts</CodeSeries>',
    '\t\t\t<CheckUnique>true</CheckUnique>',
    '\t\t\t<DefaultPresentation>AsDescription</DefaultPresentation>',
    ...saBlock('ChartOfAccounts', ruleset),
    '\t\t\t<Characteristics/>',
    ...stsBlock('ChartOfAccounts', ruleset),
    '\t\t\t<PredefinedDataUpdate>Auto</PredefinedDataUpdate>',
    '\t\t\t<EditType>InDialog</EditType>',
    '\t\t\t<QuickChoice>false</QuickChoice>',
    '\t\t\t<ChoiceMode>BothWays</ChoiceMode>',
    '\t\t\t<InputByString>',
    `\t\t\t\t<xr:Field>ChartOfAccounts.${escapeXml(name)}.StandardAttribute.Description</xr:Field>`,
    '\t\t\t</InputByString>',
    '\t\t\t<SearchStringModeOnInputByString>Begin</SearchStringModeOnInputByString>',
    '\t\t\t<FullTextSearchOnInputByString>DontUse</FullTextSearchOnInputByString>',
    '\t\t\t<ChoiceDataGetModeOnInputByString>Directly</ChoiceDataGetModeOnInputByString>',
    '\t\t\t<CreateOnInput>DontUse</CreateOnInput>',
    '\t\t\t<ChoiceHistoryOnInput>Auto</ChoiceHistoryOnInput>',
    '\t\t\t<DefaultObjectForm/>',
    '\t\t\t<DefaultListForm/>',
    '\t\t\t<DefaultChoiceForm/>',
    '\t\t\t<AuxiliaryObjectForm/>',
    '\t\t\t<AuxiliaryListForm/>',
    '\t\t\t<AuxiliaryChoiceForm/>',
    '\t\t\t<AutoOrderByCode>false</AutoOrderByCode>',
    '\t\t\t<OrderLength>0</OrderLength>',
    '\t\t\t<DataLockFields/>',
    '\t\t\t<DataLockControlMode>Managed</DataLockControlMode>',
    '\t\t\t<FullTextSearch>Use</FullTextSearch>',
    '\t\t\t<DataHistory>DontUse</DataHistory>',
    '\t\t\t<UpdateDataHistoryImmediatelyAfterWrite>false</UpdateDataHistoryImmediatelyAfterWrite>',
    '\t\t\t<ExecuteAfterWriteDataHistoryVersionProcessing>false</ExecuteAfterWriteDataHistoryVersionProcessing>',
    '\t\t\t<ObjectPresentation/>',
    '\t\t\t<ExtendedObjectPresentation/>',
    '\t\t\t<ListPresentation/>',
    '\t\t\t<ExtendedListPresentation/>',
    '\t\t\t<Explanation/>',
  ];
}

function buildChartOfCharacteristicTypesProperties(name: string, ruleset: FormatRuleset): string[] {
  return [
    '\t\t\t<UseStandardCommands>true</UseStandardCommands>',
    '\t\t\t<IncludeHelpInContents>false</IncludeHelpInContents>',
    '\t\t\t<CharacteristicExtValues/>',
    '\t\t\t<Type/>',
    '\t\t\t<Hierarchical>false</Hierarchical>',
    '\t\t\t<FoldersOnTop>true</FoldersOnTop>',
    '\t\t\t<CodeLength>0</CodeLength>',
    '\t\t\t<CodeAllowedLength>Variable</CodeAllowedLength>',
    '\t\t\t<DescriptionLength>25</DescriptionLength>',
    '\t\t\t<CodeSeries>WholeCharacteristicKind</CodeSeries>',
    '\t\t\t<CheckUnique>true</CheckUnique>',
    '\t\t\t<Autonumbering>true</Autonumbering>',
    '\t\t\t<DefaultPresentation>AsDescription</DefaultPresentation>',
    ...saBlock('ChartOfCharacteristicTypes', ruleset),
    '\t\t\t<Characteristics/>',
    '\t\t\t<PredefinedDataUpdate>Auto</PredefinedDataUpdate>',
    '\t\t\t<EditType>InDialog</EditType>',
    '\t\t\t<QuickChoice>false</QuickChoice>',
    '\t\t\t<ChoiceMode>BothWays</ChoiceMode>',
    '\t\t\t<InputByString>',
    `\t\t\t\t<xr:Field>ChartOfCharacteristicTypes.${escapeXml(name)}.StandardAttribute.Description</xr:Field>`,
    '\t\t\t</InputByString>',
    '\t\t\t<CreateOnInput>DontUse</CreateOnInput>',
    '\t\t\t<SearchStringModeOnInputByString>Begin</SearchStringModeOnInputByString>',
    '\t\t\t<ChoiceDataGetModeOnInputByString>Directly</ChoiceDataGetModeOnInputByString>',
    '\t\t\t<FullTextSearchOnInputByString>DontUse</FullTextSearchOnInputByString>',
    '\t\t\t<ChoiceHistoryOnInput>Auto</ChoiceHistoryOnInput>',
    '\t\t\t<DefaultObjectForm/>',
    '\t\t\t<DefaultFolderForm/>',
    '\t\t\t<DefaultListForm/>',
    '\t\t\t<DefaultChoiceForm/>',
    '\t\t\t<DefaultFolderChoiceForm/>',
    '\t\t\t<AuxiliaryObjectForm/>',
    '\t\t\t<AuxiliaryFolderForm/>',
    '\t\t\t<AuxiliaryListForm/>',
    '\t\t\t<AuxiliaryChoiceForm/>',
    '\t\t\t<AuxiliaryFolderChoiceForm/>',
    '\t\t\t<BasedOn/>',
    '\t\t\t<DataLockFields/>',
    '\t\t\t<DataLockControlMode>Managed</DataLockControlMode>',
    '\t\t\t<FullTextSearch>Use</FullTextSearch>',
    '\t\t\t<ObjectPresentation/>',
    '\t\t\t<ExtendedObjectPresentation/>',
    '\t\t\t<ListPresentation/>',
    '\t\t\t<ExtendedListPresentation/>',
    '\t\t\t<Explanation/>',
    '\t\t\t<DataHistory>DontUse</DataHistory>',
    '\t\t\t<UpdateDataHistoryImmediatelyAfterWrite>false</UpdateDataHistoryImmediatelyAfterWrite>',
    '\t\t\t<ExecuteAfterWriteDataHistoryVersionProcessing>false</ExecuteAfterWriteDataHistoryVersionProcessing>',
  ];
}

function buildChartOfCalculationTypesProperties(name: string, ruleset: FormatRuleset): string[] {
  return [
    '\t\t\t<UseStandardCommands>true</UseStandardCommands>',
    '\t\t\t<CodeLength>5</CodeLength>',
    '\t\t\t<DescriptionLength>100</DescriptionLength>',
    '\t\t\t<CodeType>String</CodeType>',
    '\t\t\t<CodeAllowedLength>Variable</CodeAllowedLength>',
    '\t\t\t<DefaultPresentation>AsDescription</DefaultPresentation>',
    '\t\t\t<EditType>InDialog</EditType>',
    '\t\t\t<QuickChoice>false</QuickChoice>',
    '\t\t\t<ChoiceMode>BothWays</ChoiceMode>',
    '\t\t\t<InputByString>',
    `\t\t\t\t<xr:Field>ChartOfCalculationTypes.${escapeXml(name)}.StandardAttribute.Description</xr:Field>`,
    `\t\t\t\t<xr:Field>ChartOfCalculationTypes.${escapeXml(name)}.StandardAttribute.Code</xr:Field>`,
    '\t\t\t</InputByString>',
    '\t\t\t<SearchStringModeOnInputByString>Begin</SearchStringModeOnInputByString>',
    '\t\t\t<FullTextSearchOnInputByString>DontUse</FullTextSearchOnInputByString>',
    '\t\t\t<ChoiceDataGetModeOnInputByString>Directly</ChoiceDataGetModeOnInputByString>',
    '\t\t\t<CreateOnInput>DontUse</CreateOnInput>',
    '\t\t\t<ChoiceHistoryOnInput>Auto</ChoiceHistoryOnInput>',
    '\t\t\t<DefaultObjectForm/>',
    '\t\t\t<DefaultListForm/>',
    '\t\t\t<DefaultChoiceForm/>',
    '\t\t\t<AuxiliaryObjectForm/>',
    '\t\t\t<AuxiliaryListForm/>',
    '\t\t\t<AuxiliaryChoiceForm/>',
    '\t\t\t<BasedOn/>',
    '\t\t\t<DependenceOnCalculationTypes>DontUse</DependenceOnCalculationTypes>',
    '\t\t\t<BaseCalculationTypes/>',
    '\t\t\t<ActionPeriodUse>false</ActionPeriodUse>',
    ...saBlock('ChartOfCalculationTypes', ruleset),
    '\t\t\t<Characteristics/>',
    '\t\t\t<PredefinedDataUpdate>Auto</PredefinedDataUpdate>',
    '\t\t\t<IncludeHelpInContents>false</IncludeHelpInContents>',
    '\t\t\t<DataLockFields/>',
    '\t\t\t<DataLockControlMode>Managed</DataLockControlMode>',
    '\t\t\t<FullTextSearch>Use</FullTextSearch>',
    '\t\t\t<ObjectPresentation/>',
    '\t\t\t<ExtendedObjectPresentation/>',
    '\t\t\t<ListPresentation/>',
    '\t\t\t<ExtendedListPresentation/>',
    '\t\t\t<Explanation/>',
    '\t\t\t<DataHistory>DontUse</DataHistory>',
    '\t\t\t<UpdateDataHistoryImmediatelyAfterWrite>false</UpdateDataHistoryImmediatelyAfterWrite>',
    '\t\t\t<ExecuteAfterWriteDataHistoryVersionProcessing>false</ExecuteAfterWriteDataHistoryVersionProcessing>',
  ];
}

function buildBusinessProcessProperties(name: string, ruleset: FormatRuleset): string[] {
  return [
    '\t\t\t<UseStandardCommands>true</UseStandardCommands>',
    '\t\t\t<EditType>InDialog</EditType>',
    '\t\t\t<InputByString>',
    `\t\t\t\t<xr:Field>BusinessProcess.${escapeXml(name)}.StandardAttribute.Number</xr:Field>`,
    '\t\t\t</InputByString>',
    '\t\t\t<CreateOnInput>DontUse</CreateOnInput>',
    '\t\t\t<SearchStringModeOnInputByString>Begin</SearchStringModeOnInputByString>',
    '\t\t\t<ChoiceDataGetModeOnInputByString>Directly</ChoiceDataGetModeOnInputByString>',
    '\t\t\t<FullTextSearchOnInputByString>DontUse</FullTextSearchOnInputByString>',
    '\t\t\t<DefaultObjectForm/>',
    '\t\t\t<DefaultListForm/>',
    '\t\t\t<DefaultChoiceForm/>',
    '\t\t\t<AuxiliaryObjectForm/>',
    '\t\t\t<AuxiliaryListForm/>',
    '\t\t\t<AuxiliaryChoiceForm/>',
    '\t\t\t<ChoiceHistoryOnInput>Auto</ChoiceHistoryOnInput>',
    '\t\t\t<NumberType>String</NumberType>',
    '\t\t\t<NumberLength>11</NumberLength>',
    '\t\t\t<NumberAllowedLength>Variable</NumberAllowedLength>',
    '\t\t\t<CheckUnique>true</CheckUnique>',
    ...saBlock('BusinessProcess', ruleset),
    '\t\t\t<Characteristics/>',
    '\t\t\t<Autonumbering>true</Autonumbering>',
    '\t\t\t<BasedOn/>',
    '\t\t\t<NumberPeriodicity>Nonperiodical</NumberPeriodicity>',
    '\t\t\t<Task/>',
    '\t\t\t<CreateTaskInPrivilegedMode>true</CreateTaskInPrivilegedMode>',
    '\t\t\t<DataLockFields/>',
    '\t\t\t<DataLockControlMode>Managed</DataLockControlMode>',
    '\t\t\t<IncludeHelpInContents>true</IncludeHelpInContents>',
    '\t\t\t<FullTextSearch>Use</FullTextSearch>',
    '\t\t\t<ObjectPresentation/>',
    '\t\t\t<ExtendedObjectPresentation/>',
    '\t\t\t<ListPresentation/>',
    '\t\t\t<ExtendedListPresentation/>',
    '\t\t\t<Explanation/>',
    '\t\t\t<DataHistory>DontUse</DataHistory>',
    '\t\t\t<UpdateDataHistoryImmediatelyAfterWrite>false</UpdateDataHistoryImmediatelyAfterWrite>',
    '\t\t\t<ExecuteAfterWriteDataHistoryVersionProcessing>false</ExecuteAfterWriteDataHistoryVersionProcessing>',
  ];
}

function buildTaskProperties(name: string, ruleset: FormatRuleset): string[] {
  return [
    '\t\t\t<UseStandardCommands>false</UseStandardCommands>',
    '\t\t\t<NumberType>String</NumberType>',
    '\t\t\t<NumberLength>14</NumberLength>',
    '\t\t\t<NumberAllowedLength>Fixed</NumberAllowedLength>',
    '\t\t\t<CheckUnique>true</CheckUnique>',
    '\t\t\t<Autonumbering>true</Autonumbering>',
    '\t\t\t<TaskNumberAutoPrefix>BusinessProcessNumber</TaskNumberAutoPrefix>',
    '\t\t\t<DescriptionLength>150</DescriptionLength>',
    '\t\t\t<Addressing/>',
    '\t\t\t<MainAddressingAttribute/>',
    '\t\t\t<CurrentPerformer/>',
    '\t\t\t<BasedOn/>',
    ...saBlock('Task', ruleset),
    '\t\t\t<Characteristics/>',
    '\t\t\t<DefaultPresentation>AsDescription</DefaultPresentation>',
    '\t\t\t<EditType>InDialog</EditType>',
    '\t\t\t<InputByString>',
    `\t\t\t\t<xr:Field>Task.${escapeXml(name)}.StandardAttribute.Description</xr:Field>`,
    `\t\t\t\t<xr:Field>Task.${escapeXml(name)}.StandardAttribute.Number</xr:Field>`,
    '\t\t\t</InputByString>',
    '\t\t\t<SearchStringModeOnInputByString>Begin</SearchStringModeOnInputByString>',
    '\t\t\t<FullTextSearchOnInputByString>DontUse</FullTextSearchOnInputByString>',
    '\t\t\t<ChoiceDataGetModeOnInputByString>Directly</ChoiceDataGetModeOnInputByString>',
    '\t\t\t<CreateOnInput>DontUse</CreateOnInput>',
    '\t\t\t<DefaultObjectForm/>',
    '\t\t\t<DefaultListForm/>',
    '\t\t\t<DefaultChoiceForm/>',
    '\t\t\t<AuxiliaryObjectForm/>',
    '\t\t\t<AuxiliaryListForm/>',
    '\t\t\t<AuxiliaryChoiceForm/>',
    '\t\t\t<ChoiceHistoryOnInput>Auto</ChoiceHistoryOnInput>',
    '\t\t\t<IncludeHelpInContents>true</IncludeHelpInContents>',
    '\t\t\t<DataLockFields/>',
    '\t\t\t<DataLockControlMode>Managed</DataLockControlMode>',
    '\t\t\t<FullTextSearch>Use</FullTextSearch>',
    '\t\t\t<ObjectPresentation/>',
    '\t\t\t<ExtendedObjectPresentation/>',
    '\t\t\t<ListPresentation/>',
    '\t\t\t<ExtendedListPresentation/>',
    '\t\t\t<Explanation/>',
    '\t\t\t<DataHistory>DontUse</DataHistory>',
    '\t\t\t<UpdateDataHistoryImmediatelyAfterWrite>false</UpdateDataHistoryImmediatelyAfterWrite>',
    '\t\t\t<ExecuteAfterWriteDataHistoryVersionProcessing>false</ExecuteAfterWriteDataHistoryVersionProcessing>',
  ];
}

function buildExchangePlanProperties(ruleset: FormatRuleset): string[] {
  return [
    '\t\t\t<UseStandardCommands>true</UseStandardCommands>',
    '\t\t\t<CodeLength>9</CodeLength>',
    '\t\t\t<CodeAllowedLength>Variable</CodeAllowedLength>',
    '\t\t\t<DescriptionLength>25</DescriptionLength>',
    '\t\t\t<DefaultPresentation>AsDescription</DefaultPresentation>',
    '\t\t\t<EditType>InDialog</EditType>',
    '\t\t\t<QuickChoice>false</QuickChoice>',
    '\t\t\t<ChoiceMode>BothWays</ChoiceMode>',
    '\t\t\t<InputByString/>',
    '\t\t\t<SearchStringModeOnInputByString>Begin</SearchStringModeOnInputByString>',
    '\t\t\t<FullTextSearchOnInputByString>DontUse</FullTextSearchOnInputByString>',
    '\t\t\t<ChoiceDataGetModeOnInputByString>Directly</ChoiceDataGetModeOnInputByString>',
    '\t\t\t<DefaultObjectForm/>',
    '\t\t\t<DefaultListForm/>',
    '\t\t\t<DefaultChoiceForm/>',
    '\t\t\t<AuxiliaryObjectForm/>',
    '\t\t\t<AuxiliaryListForm/>',
    '\t\t\t<AuxiliaryChoiceForm/>',
    ...saBlock('ExchangePlan', ruleset),
    '\t\t\t<Characteristics/>',
    '\t\t\t<BasedOn/>',
    '\t\t\t<DistributedInfoBase>false</DistributedInfoBase>',
    '\t\t\t<IncludeConfigurationExtensions>false</IncludeConfigurationExtensions>',
    '\t\t\t<CreateOnInput>DontUse</CreateOnInput>',
    '\t\t\t<ChoiceHistoryOnInput>Auto</ChoiceHistoryOnInput>',
    '\t\t\t<IncludeHelpInContents>false</IncludeHelpInContents>',
    '\t\t\t<DataLockFields/>',
    '\t\t\t<DataLockControlMode>Managed</DataLockControlMode>',
    '\t\t\t<FullTextSearch>Use</FullTextSearch>',
    '\t\t\t<ObjectPresentation/>',
    '\t\t\t<ExtendedObjectPresentation/>',
    '\t\t\t<ListPresentation/>',
    '\t\t\t<ExtendedListPresentation/>',
    '\t\t\t<Explanation/>',
    '\t\t\t<DataHistory>DontUse</DataHistory>',
    '\t\t\t<UpdateDataHistoryImmediatelyAfterWrite>false</UpdateDataHistoryImmediatelyAfterWrite>',
    '\t\t\t<ExecuteAfterWriteDataHistoryVersionProcessing>false</ExecuteAfterWriteDataHistoryVersionProcessing>',
  ];
}

function buildCommonModuleProperties(): string[] {
  return [
    '\t\t\t<Global>false</Global>',
    '\t\t\t<ClientManagedApplication>true</ClientManagedApplication>',
    '\t\t\t<Server>true</Server>',
    '\t\t\t<ExternalConnection>false</ExternalConnection>',
    '\t\t\t<ClientOrdinaryApplication>false</ClientOrdinaryApplication>',
    '\t\t\t<ServerCall>false</ServerCall>',
    '\t\t\t<Privileged>false</Privileged>',
    '\t\t\t<ReturnValuesReuse>DontUse</ReturnValuesReuse>',
  ];
}

/** Свойства общего реквизита после блока `<Type>` (его добавляет вызывающий через ruleset). */
function buildCommonAttributePropertiesAfterType(): string[] {
  return [
    '\t\t\t<PasswordMode>false</PasswordMode>',
    '\t\t\t<Format/>',
    '\t\t\t<EditFormat/>',
    '\t\t\t<ToolTip/>',
    '\t\t\t<MarkNegatives>false</MarkNegatives>',
    '\t\t\t<Mask/>',
    '\t\t\t<MultiLine>false</MultiLine>',
    '\t\t\t<ExtendedEdit>false</ExtendedEdit>',
    '\t\t\t<MinValue xsi:nil="true"/>',
    '\t\t\t<MaxValue xsi:nil="true"/>',
    '\t\t\t<FillFromFillingValue>false</FillFromFillingValue>',
    '\t\t\t<FillValue xsi:type="xs:string"/>',
    '\t\t\t<FillChecking>DontCheck</FillChecking>',
    '\t\t\t<ChoiceFoldersAndItems>Items</ChoiceFoldersAndItems>',
    '\t\t\t<ChoiceParameterLinks/>',
    '\t\t\t<ChoiceParameters/>',
    '\t\t\t<QuickChoice>Auto</QuickChoice>',
    '\t\t\t<CreateOnInput>Auto</CreateOnInput>',
    '\t\t\t<ChoiceForm/>',
    '\t\t\t<LinkByType/>',
    '\t\t\t<ChoiceHistoryOnInput>Auto</ChoiceHistoryOnInput>',
    '\t\t\t<Content/>',
    '\t\t\t<AutoUse>DontUse</AutoUse>',
    '\t\t\t<DataSeparation>DontUse</DataSeparation>',
    '\t\t\t<SeparatedDataUse>Independently</SeparatedDataUse>',
    '\t\t\t<DataSeparationValue/>',
    '\t\t\t<DataSeparationUse/>',
    '\t\t\t<ConditionalSeparation/>',
    '\t\t\t<UsersSeparation>DontUse</UsersSeparation>',
    '\t\t\t<AuthenticationSeparation>DontUse</AuthenticationSeparation>',
    '\t\t\t<ConfigurationExtensionsSeparation>DontUse</ConfigurationExtensionsSeparation>',
    '\t\t\t<Indexing>DontIndex</Indexing>',
    '\t\t\t<FullTextSearch>Use</FullTextSearch>',
    '\t\t\t<DataHistory>Use</DataHistory>',
  ];
}

function buildScheduledJobProperties(): string[] {
  return [
    '\t\t\t<MethodName/>',
    '\t\t\t<Description/>',
    '\t\t\t<Key/>',
    '\t\t\t<Use>false</Use>',
    '\t\t\t<Predefined>false</Predefined>',
    '\t\t\t<RestartCountOnFailure>0</RestartCountOnFailure>',
    '\t\t\t<RestartIntervalOnFailure>0</RestartIntervalOnFailure>',
  ];
}

function buildSubsystemProperties(): string[] {
  return [
    '\t\t\t<IncludeHelpInContents>true</IncludeHelpInContents>',
    '\t\t\t<IncludeInCommandInterface>true</IncludeInCommandInterface>',
    '\t\t\t<UseOneCommand>false</UseOneCommand>',
    '\t\t\t<Explanation/>',
    '\t\t\t<Picture/>',
    '\t\t\t<Content/>',
  ];
}

function buildCommonCommandProperties(): string[] {
  return [
    '\t\t\t<Group/>',
    '\t\t\t<Representation>Auto</Representation>',
    '\t\t\t<ToolTip/>',
    '\t\t\t<Picture/>',
    '\t\t\t<Shortcut/>',
    '\t\t\t<IncludeHelpInContents>false</IncludeHelpInContents>',
    '\t\t\t<CommandParameterType/>',
    '\t\t\t<ParameterUseMode>Single</ParameterUseMode>',
    '\t\t\t<ModifiesData>false</ModifiesData>',
    '\t\t\t<OnMainServerUnavalableBehavior>Auto</OnMainServerUnavalableBehavior>',
  ];
}

function buildHttpServiceProperties(): string[] {
  return [
    '\t\t\t<RootURL/>',
    '\t\t\t<ReuseSessions>AutoUse</ReuseSessions>',
    '\t\t\t<SessionMaxAge>20</SessionMaxAge>',
  ];
}

function buildWebServiceProperties(): string[] {
  return [
    '\t\t\t<Namespace/>',
    '\t\t\t<XDTOPackages/>',
    '\t\t\t<DescriptorFileName/>',
    '\t\t\t<ReuseSessions>AutoUse</ReuseSessions>',
    '\t\t\t<SessionMaxAge>20</SessionMaxAge>',
  ];
}

function buildFunctionalOptionProperties(): string[] {
  return [
    '\t\t\t<Location/>',
    '\t\t\t<PrivilegedGetMode>true</PrivilegedGetMode>',
    '\t\t\t<Content/>',
  ];
}

function buildEventSubscriptionProperties(): string[] {
  return [
    '\t\t\t<Source/>',
    '\t\t\t<Event/>',
    '\t\t\t<Handler/>',
  ];
}

function buildFilterCriterionProperties(): string[] {
  return [
    '\t\t\t<Type/>',
    '\t\t\t<UseStandardCommands>true</UseStandardCommands>',
    '\t\t\t<Content/>',
    '\t\t\t<DefaultForm/>',
    '\t\t\t<AuxiliaryForm/>',
    '\t\t\t<ListPresentation/>',
    '\t\t\t<ExtendedListPresentation/>',
    '\t\t\t<Explanation/>',
  ];
}

function buildSettingsStorageProperties(): string[] {
  return [
    '\t\t\t<DefaultSaveForm/>',
    '\t\t\t<DefaultLoadForm/>',
    '\t\t\t<AuxiliarySaveForm/>',
    '\t\t\t<AuxiliaryLoadForm/>',
  ];
}

function buildCommandGroupProperties(): string[] {
  return [
    '\t\t\t<Representation>Auto</Representation>',
    '\t\t\t<ToolTip/>',
    '\t\t\t<Picture/>',
    '\t\t\t<Category>NavigationPanel</Category>',
  ];
}

function buildStyleItemProperties(): string[] {
  return [
    '\t\t\t<Type>Color</Type>',
    '\t\t\t<Value xsi:type="v8ui:Color">#000000</Value>',
  ];
}

function buildCommonPictureProperties(): string[] {
  return [
    '\t\t\t<AvailabilityForChoice>false</AvailabilityForChoice>',
    '\t\t\t<AvailabilityForAppearance>false</AvailabilityForAppearance>',
  ];
}

function buildBotProperties(): string[] {
  return [
    '\t\t\t<Predefined>false</Predefined>',
    '\t\t\t<Picture/>',
  ];
}

function buildLanguageProperties(): string[] {
  return [
    '\t\t\t<LanguageCode/>',
  ];
}
