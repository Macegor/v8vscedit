import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { ChildTag } from '../../domain/ChildTag';
import { getMetaFolder, getMetaType, type MetaKind } from '../../domain/MetaTypes';
import { ConfigurationXmlEditor, type EditResult } from './ConfigurationXmlEditor';
import { getObjectLocationFromXml } from '../fs/MetaPathResolver';
import { DEFAULT_FORMAT_VERSION, resolveFormatRuleset } from './format/formatRegistry';
import type { FormatRuleset } from './format/FormatRuleset';
import {
  escapeXmlAttribute as escapeXml,
  findDirectElementRanges,
  findNestingAwareElementRange,
  hasDirectChildElementNameInBlock,
  writeTextFilePreservingBomAndEol,
} from './XmlUtils';

const DEFAULT_TEMPLATE_TYPE: TemplateType = 'SpreadsheetDocument';

export type TemplateType =
  | 'SpreadsheetDocument'
  | 'TextDocument'
  | 'HTMLDocument'
  | 'BinaryData'
  | 'DataCompositionSchema'
  | 'DataCompositionAppearanceTemplate'
  | 'GraphicalSchema'
  | 'AddIn';

export interface AddRootMetadataOptions {
  configRoot: string;
  kind: MetaKind;
  name: string;
  templateType?: TemplateType;
}

export interface AddChildMetadataOptions {
  ownerObjectXmlPath: string;
  childTag: ChildTag | 'Column';
  name: string;
  tabularSectionName?: string;
  templateType?: TemplateType;
}

/**
 * Создаёт минимально полноценные XML-исходники метаданных внутри выгрузки.
 * Нужен runtime-расширению, чтобы не зависеть от локальных `.codex/skills`.
 */
export class MetadataXmlCreator {
  private readonly configEditor = new ConfigurationXmlEditor();

  addRootObject(options: AddRootMetadataOptions): EditResult {
    const validation = validateMetadataName(options.name);
    if (!validation.success) {
      return validation;
    }

    const folder = getMetaFolder(options.kind);
    if (!folder) {
      return fail(`Тип "${options.kind}" не поддерживает создание файлов.`);
    }

    const typeDir = path.join(options.configRoot, folder);
    const xmlPath = path.join(typeDir, `${options.name}.xml`);
    const objectDir = path.join(typeDir, options.name);
    if (fs.existsSync(xmlPath) || fs.existsSync(objectDir)) {
      return fail(`Объект "${options.kind}.${options.name}" уже существует.`);
    }

    fs.mkdirSync(typeDir, { recursive: true });
    const formatVersion = resolveConfigFormatVersion(options.configRoot);
    const ruleset = resolveFormatRuleset(formatVersion);
    const templateType = options.kind === 'CommonTemplate' ? resolveTemplateType(options.templateType) : undefined;
    fs.writeFileSync(xmlPath, buildRootObjectXml(options.kind, options.name, formatVersion, ruleset, templateType), 'utf-8');

    const changedFiles = [xmlPath];
    if (options.kind === 'CommonTemplate') {
      changedFiles.push(...ensureTemplateContentFiles(objectDir, templateType ?? 'SpreadsheetDocument', formatVersion));
    }
    for (const modulePath of getDefaultModulePaths(options.kind, objectDir)) {
      ensureEmptyFile(modulePath);
      changedFiles.push(modulePath);
    }
    if (options.kind === 'CommonForm') {
      const formXmlPath = path.join(objectDir, 'Ext', 'Form.xml');
      fs.mkdirSync(path.dirname(formXmlPath), { recursive: true });
      fs.writeFileSync(formXmlPath, buildManagedFormXml(formatVersion), 'utf-8');
      changedFiles.push(formXmlPath);
    }

    if (options.kind === 'Role') {
      const rightsPath = path.join(objectDir, 'Ext', 'Rights.xml');
      fs.mkdirSync(path.dirname(rightsPath), { recursive: true });
      fs.writeFileSync(rightsPath, buildEmptyRightsXml(formatVersion), 'utf-8');
      changedFiles.push(rightsPath);
    }

    if (options.kind === 'BusinessProcess') {
      const flowchartPath = path.join(objectDir, 'Ext', 'Flowchart.xml');
      fs.mkdirSync(path.dirname(flowchartPath), { recursive: true });
      fs.writeFileSync(flowchartPath, buildBusinessProcessFlowchartXml(formatVersion), 'utf-8');
      changedFiles.push(flowchartPath);
    }

    const configXmlPath = path.join(options.configRoot, 'Configuration.xml');
    const register = this.configEditor.addChildObject(configXmlPath, `${options.kind}.${options.name}`);
    if (!register.success) {
      return register;
    }

    return ok([...changedFiles, ...register.changedFiles]);
  }

  addChildElement(options: AddChildMetadataOptions): EditResult {
    const validation = validateMetadataName(options.name);
    if (!validation.success) {
      return validation;
    }
    if (!fs.existsSync(options.ownerObjectXmlPath)) {
      return fail(`Не найден XML владельца: ${options.ownerObjectXmlPath}`);
    }

    const formatVersion = resolveObjectFormatVersion(options.ownerObjectXmlPath);
    const ruleset = resolveFormatRuleset(formatVersion);
    const xml = fs.readFileSync(options.ownerObjectXmlPath, 'utf-8');
    const nextXml = addChildToObjectXml(xml, options, ruleset);
    if (!nextXml.changed) {
      return fail(nextXml.error);
    }

    writeTextFilePreservingBomAndEol(options.ownerObjectXmlPath, xml, nextXml.xml);
    const changedFiles = [options.ownerObjectXmlPath];
    changedFiles.push(...ensureAuxiliaryChildFiles(options, formatVersion, ruleset));
    return ok(changedFiles);
  }
}

function addChildToObjectXml(xml: string, options: AddChildMetadataOptions, ruleset: FormatRuleset): { changed: true; xml: string } | { changed: false; error: string } {
  if (options.childTag === 'Column') {
    if (!options.tabularSectionName) {
      return { changed: false, error: 'Не указана табличная часть для добавления колонки.' };
    }
    return addColumnToTabularSectionXml(xml, options.tabularSectionName, options.name, ruleset);
  }

  const ownerKind = extractMetadataObjectKind(xml);
  if (!ownerKind) {
    return { changed: false, error: 'Не найден корневой элемент объекта метаданных.' };
  }
  const childObjects = getChildObjectsBlock(xml);
  if (!childObjects) {
    return { changed: false, error: 'В XML объекта отсутствует блок <ChildObjects>.' };
  }
  if (hasChildName(childObjects.inner, options.childTag, options.name)) {
    return { changed: false, error: `Элемент "${options.name}" уже существует.` };
  }

  const childObjectsInner = removeNestedSimpleChildReference(childObjects.inner, options.childTag, options.name);
  const indent = detectChildIndent(childObjectsInner, '\t\t\t');
  const ownerName = extractObjectName(xml);
  const fragment = buildChildFragment(options.childTag, options.name, indent, ruleset, ownerKind, ownerName);
  const replacement = buildChildObjectsReplacement({ ...childObjects, inner: childObjectsInner }, fragment, indent);
  const nextXml = `${xml.slice(0, childObjects.start)}${replacement}${xml.slice(childObjects.end)}`;
  return {
    changed: true,
    xml: updateMainDataCompositionSchemaIfNeeded(nextXml, ownerKind, ownerName, options),
  };
}

function addColumnToTabularSectionXml(xml: string, tabularSectionName: string, columnName: string, ruleset: FormatRuleset): { changed: true; xml: string } | { changed: false; error: string } {
  const section = findNamedChildBlock(xml, 'TabularSection', tabularSectionName);
  if (!section) {
    return { changed: false, error: `Табличная часть "${tabularSectionName}" не найдена.` };
  }
  const sectionXml = xml.slice(section.start, section.end);
  const childObjects = getChildObjectsBlock(sectionXml);
  if (!childObjects) {
    return { changed: false, error: `В табличной части "${tabularSectionName}" отсутствует <ChildObjects>.` };
  }
  if (hasChildName(childObjects.inner, 'Attribute', columnName)) {
    return { changed: false, error: `Колонка "${columnName}" уже существует.` };
  }

  const indent = detectChildIndent(childObjects.inner, '\t\t\t\t\t');
  // Тег колонки в XML — <Attribute>, но набор свойств у неё «колоночный»
  // (без свойств заполнения), поэтому передаём kind='Column'.
  const fragment = buildTypedFieldFragment('Attribute', columnName, indent, ruleset, 'Column');
  const replacement = buildChildObjectsReplacement(childObjects, fragment, indent);
  const nextSectionXml = `${sectionXml.slice(0, childObjects.start)}${replacement}${sectionXml.slice(childObjects.end)}`;
  return {
    changed: true,
    xml: `${xml.slice(0, section.start)}${nextSectionXml}${xml.slice(section.end)}`,
  };
}

function buildRootObjectXml(kind: MetaKind, name: string, formatVersion: string, ruleset: FormatRuleset, templateType?: TemplateType): string {
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

/** Блок `<StandardAttributes>` вида (или пусто) как элемент массива свойств. */
function saBlock(kind: MetaKind, ruleset: FormatRuleset): string[] {
  const block = ruleset.standardAttributes(kind);
  return block ? [block] : [];
}

/** Блок `<StandardTabularSections>` вида (или пусто) как элемент массива свойств. */
function stsBlock(kind: MetaKind, ruleset: FormatRuleset): string[] {
  const block = ruleset.standardTabularSections(kind);
  return block ? [block] : [];
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

function buildChildFragment(
  tag: ChildTag,
  name: string,
  indent: string,
  ruleset: FormatRuleset,
  ownerKind?: string,
  ownerName?: string
): string {
  if (tag === 'StandardAttribute') {
    throw new Error('Стандартные реквизиты создаются платформой 1С и не добавляются вручную.');
  }
  if (tag === 'Attribute' || tag === 'AddressingAttribute' || tag === 'Dimension' || tag === 'Resource') {
    return buildTypedFieldFragment(tag, name, indent, ruleset);
  }
  if (tag === 'TabularSection') {
    return buildTabularSectionFragment(name, indent, ruleset, ownerKind, ownerName);
  }
  if (tag === 'Form') {
    // Форма в <ChildObjects> — простая ссылка `<Form>Имя</Form>` (как макет).
    // Полное описание формы лежит отдельным файлом `Forms/Имя.xml`
    // (см. ensureAuxiliaryChildFiles). Полный блок с uuid внутри ChildObjects
    // платформа 1С отклоняет.
    return `${indent}<Form>${escapeXml(name)}</Form>`;
  }
  if (tag === 'Command') {
    return buildObjectCommandFragment(name, indent);
  }
  if (tag === 'Template') {
    return `${indent}<Template>${escapeXml(name)}</Template>`;
  }
  return buildSimpleChildFragment(tag, name, indent);
}

function buildTypedFieldFragment(
  tag: 'Attribute' | 'AddressingAttribute' | 'Dimension' | 'Resource',
  name: string,
  indent: string,
  ruleset: FormatRuleset,
  propertyKind: 'Attribute' | 'AddressingAttribute' | 'Dimension' | 'Resource' | 'Column' = tag
): string {
  const typeBlock = ruleset.buildDefaultTypeBlock(`${indent}\t\t`);
  return [
    `${indent}<${tag} uuid="${newUuid()}">`,
    `${indent}\t<Properties>`,
    `${indent}\t\t<Name>${escapeXml(name)}</Name>`,
    buildLocalizedTag(`${indent}\t\t`, 'Synonym', splitCamelCase(name)),
    `${indent}\t\t<Comment/>`,
    typeBlock,
    ...ruleset.buildTypedFieldProperties(propertyKind, typeBlock, `${indent}\t\t`),
    `${indent}\t</Properties>`,
    `${indent}</${tag}>`,
  ].join('\n');
}

function buildTabularSectionFragment(name: string, indent: string, ruleset: FormatRuleset, ownerKind?: string, ownerName?: string): string {
  return [
    `${indent}<TabularSection uuid="${newUuid()}">`,
    ownerKind && ownerName ? buildTabularSectionInternalInfo(ownerKind, ownerName, name, `${indent}\t`, ruleset) : '',
    `${indent}\t<Properties>`,
    `${indent}\t\t<Name>${escapeXml(name)}</Name>`,
    buildLocalizedTag(`${indent}\t\t`, 'Synonym', splitCamelCase(name)),
    `${indent}\t\t<Comment/>`,
    `${indent}\t</Properties>`,
    `${indent}\t<ChildObjects/>`,
    `${indent}</TabularSection>`,
  ].filter((item) => item.length > 0).join('\n');
}

function buildInternalInfo(kind: MetaKind, objectName: string, indent: string, ruleset: FormatRuleset): string {
  const types = ruleset.generatedTypes[kind];
  if (!types?.length) {
    return '';
  }
  const lines = [`${indent}<InternalInfo>`];
  if (kind === 'ExchangePlan') {
    lines.push(`${indent}\t<xr:ThisNode>${newUuid()}</xr:ThisNode>`);
  }
  for (const generatedType of types) {
    lines.push(...buildGeneratedTypeLines(
      `${generatedType.prefix}.${objectName}`,
      generatedType.category,
      `${indent}\t`
    ));
  }
  lines.push(`${indent}</InternalInfo>`);
  return lines.join('\n');
}

function buildTabularSectionInternalInfo(ownerKind: string, ownerName: string, sectionName: string, indent: string, ruleset: FormatRuleset): string {
  const generatedTypeLines = ruleset
    .tabularSectionGeneratedTypes(ownerKind, ownerName, sectionName)
    .flatMap((ref) => buildGeneratedTypeLines(ref.name, ref.category, `${indent}\t`));
  return [
    `${indent}<InternalInfo>`,
    ...generatedTypeLines,
    `${indent}</InternalInfo>`,
  ].join('\n');
}

function buildGeneratedTypeLines(name: string, category: string, indent: string): string[] {
  return [
    `${indent}<xr:GeneratedType name="${escapeXml(name)}" category="${escapeXml(category)}">`,
    `${indent}\t<xr:TypeId>${newUuid()}</xr:TypeId>`,
    `${indent}\t<xr:ValueId>${newUuid()}</xr:ValueId>`,
    `${indent}</xr:GeneratedType>`,
  ];
}

function buildSimpleChildFragment(tag: 'EnumValue', name: string, indent: string): string {
  return [
    `${indent}<${tag} uuid="${newUuid()}">`,
    `${indent}\t<Properties>`,
    `${indent}\t\t<Name>${escapeXml(name)}</Name>`,
    buildLocalizedTag(`${indent}\t\t`, 'Synonym', splitCamelCase(name)),
    `${indent}\t\t<Comment/>`,
    `${indent}\t</Properties>`,
    `${indent}</${tag}>`,
  ].join('\n');
}

/**
 * Полный блок команды объекта внутри `<ChildObjects>`. В отличие от формы/макета
 * команда сериализуется целиком (uuid + свойства), а не ссылкой. Набор и порядок
 * свойств — как в эталонной выгрузке 2.20 (пустой объект): без них платформа 1С
 * отклоняет команду.
 */
function buildObjectCommandFragment(name: string, indent: string): string {
  return [
    `${indent}<Command uuid="${newUuid()}">`,
    `${indent}\t<Properties>`,
    `${indent}\t\t<Name>${escapeXml(name)}</Name>`,
    buildLocalizedTag(`${indent}\t\t`, 'Synonym', splitCamelCase(name)),
    `${indent}\t\t<Comment/>`,
    // Объектной команде обязательна непустая группа командного интерфейса —
    // иначе платформа: «Не указана группа, в которую входит команда по умолчанию».
    `${indent}\t\t<Group>FormCommandBarImportant</Group>`,
    `${indent}\t\t<CommandParameterType/>`,
    `${indent}\t\t<ParameterUseMode>Single</ParameterUseMode>`,
    `${indent}\t\t<ModifiesData>false</ModifiesData>`,
    `${indent}\t\t<Representation>Auto</Representation>`,
    `${indent}\t\t<ToolTip/>`,
    `${indent}\t\t<Picture/>`,
    `${indent}\t\t<Shortcut/>`,
    `${indent}\t\t<OnMainServerUnavalableBehavior>Auto</OnMainServerUnavalableBehavior>`,
    `${indent}\t</Properties>`,
    `${indent}</Command>`,
  ].join('\n');
}

function getChildObjectsBlock(xml: string): { inner: string; start: number; end: number; selfClosing: boolean } | null {
  const range = findNestingAwareElementRange(xml, 'ChildObjects');
  if (!range) {
    return null;
  }
  const openTag = xml.slice(range.start, range.openEnd);
  const selfClosing = /\/>\s*$/.test(openTag);
  if (selfClosing) {
    return { inner: '', start: range.start, end: range.end, selfClosing: true };
  }
  return {
    inner: xml.slice(range.openEnd, range.closeStart),
    start: range.openEnd,
    end: range.closeStart,
    selfClosing: false,
  };
}

function buildChildObjectsReplacement(
  block: { inner: string; selfClosing: boolean },
  fragment: string,
  indent: string
): string {
  const parentIndent = indent.length > 0 ? indent.slice(0, -1) : '';
  if (block.selfClosing) {
    return `<ChildObjects>\n${fragment}\n${parentIndent}</ChildObjects>`;
  }
  return insertChildFragment(block.inner, fragment, indent);
}

function insertChildFragment(inner: string, fragment: string, indent: string): string {
  const parentIndent = indent.length > 0 ? indent.slice(0, -1) : '';
  if (!inner.trim()) {
    return `\n${fragment}\n${parentIndent}`;
  }
  const trimmedRight = inner.replace(/\s+$/, '');
  return `${trimmedRight}\n${fragment}\n${parentIndent}`;
}

function findNamedChildBlock(xml: string, tag: string, name: string): { start: number; end: number } | null {
  const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<Name>${escapeRegExp(name)}<\\/Name>[\\s\\S]*?<\\/${tag}>`, 'g');
  const match = re.exec(xml);
  return match ? { start: match.index, end: match.index + match[0].length } : null;
}

function hasChildName(inner: string, tag: string, name: string): boolean {
  return hasDirectChildElementNameInBlock(inner, tag, name);
}

function removeNestedSimpleChildReference(inner: string, tag: ChildTag, name: string): string {
  if (tag !== 'Form' && tag !== 'Command' && tag !== 'Template') {
    return inner;
  }
  const directRanges = findDirectElementRanges(inner, tag);
  const re = new RegExp(`\\n?\\s*<${tag}>\\s*${escapeRegExp(name)}\\s*<\\/${tag}>`, 'g');
  return inner.replace(re, (match, offset: number) => {
    const tagOffset = match.indexOf(`<${tag}>`);
    const tagStart = tagOffset >= 0 ? offset + tagOffset : offset;
    const isDirect = directRanges.some((range) => tagStart >= range.start && tagStart < range.end);
    return isDirect ? match : '';
  });
}

function extractObjectName(xml: string): string | undefined {
  return /<Properties>[\s\S]*?<Name>([^<]+)<\/Name>/.exec(xml)?.[1];
}

function extractMetadataObjectKind(xml: string): string | undefined {
  return /<MetaDataObject\b[^>]*>\s*<([A-Za-z][A-Za-z0-9]*)\b/.exec(xml)?.[1];
}

function updateMainDataCompositionSchemaIfNeeded(
  xml: string,
  ownerKind: string,
  ownerName: string | undefined,
  options: AddChildMetadataOptions
): string {
  if (options.childTag !== 'Template' || resolveTemplateType(options.templateType) !== 'DataCompositionSchema') {
    return xml;
  }
  if (ownerKind !== 'Report' && ownerKind !== 'ExternalReport') {
    return xml;
  }
  if (!ownerName) {
    return xml;
  }
  const value = `${ownerKind}.${ownerName}.Template.${options.name}`;
  const emptyTag = /<MainDataCompositionSchema\s*\/>/;
  if (emptyTag.test(xml)) {
    return xml.replace(emptyTag, `<MainDataCompositionSchema>${escapeXml(value)}</MainDataCompositionSchema>`);
  }
  const openClose = /<MainDataCompositionSchema>([\s\S]*?)<\/MainDataCompositionSchema>/;
  const match = openClose.exec(xml);
  if (!match || match[1].trim()) {
    return xml;
  }
  return xml.replace(openClose, `<MainDataCompositionSchema>${escapeXml(value)}</MainDataCompositionSchema>`);
}

function ensureAuxiliaryChildFiles(options: AddChildMetadataOptions, formatVersion: string, ruleset: FormatRuleset): string[] {
  const loc = getObjectLocationFromXml(options.ownerObjectXmlPath);
  if (options.childTag === 'Command') {
    const commandModule = path.join(loc.objectDir, 'Commands', options.name, 'Ext', 'CommandModule.bsl');
    ensureEmptyFile(commandModule);
    return [commandModule];
  }
  if (options.childTag === 'Form') {
    const descriptorXml = path.join(loc.objectDir, 'Forms', `${options.name}.xml`);
    const formModule = path.join(loc.objectDir, 'Forms', options.name, 'Ext', 'Form', 'Module.bsl');
    const formXml = path.join(loc.objectDir, 'Forms', options.name, 'Ext', 'Form.xml');
    fs.mkdirSync(path.dirname(formXml), { recursive: true });
    fs.writeFileSync(descriptorXml, buildFormDescriptorXml(options.name, formatVersion, ruleset), 'utf-8');
    fs.writeFileSync(formXml, buildManagedFormXml(formatVersion), 'utf-8');
    ensureEmptyFile(formModule);
    return [descriptorXml, formXml, formModule];
  }
  if (options.childTag === 'Template') {
    const templateXml = path.join(loc.objectDir, 'Templates', `${options.name}.xml`);
    const templateDir = path.join(loc.objectDir, 'Templates', options.name);
    const templateType = resolveTemplateType(options.templateType);
    const changedFiles: string[] = [];
    fs.mkdirSync(path.dirname(templateXml), { recursive: true });
    if (!fs.existsSync(templateXml)) {
      fs.writeFileSync(templateXml, buildTemplateXml(options.name, formatVersion, templateType, ruleset), 'utf-8');
      changedFiles.push(templateXml);
    }
    changedFiles.push(...ensureTemplateContentFiles(templateDir, templateType, formatVersion));
    return changedFiles;
  }
  return [];
}

function ensureTemplateContentFiles(templateDir: string, templateType: TemplateType, formatVersion: string): string[] {
  const extDir = path.join(templateDir, 'Ext');
  fs.mkdirSync(extDir, { recursive: true });
  switch (templateType) {
    case 'TextDocument': {
      const filePath = path.join(extDir, 'Template.txt');
      return writeTextFile(filePath, '') ? [filePath] : [];
    }
    case 'HTMLDocument': {
      const descriptorPath = path.join(extDir, 'Template.xml');
      const htmlPath = path.join(extDir, 'Template', 'ru.html');
      return [
        writeTextFile(descriptorPath, buildHtmlTemplateDescriptorXml(formatVersion)) ? descriptorPath : undefined,
        writeTextFile(htmlPath, buildHtmlDocumentTemplate()) ? htmlPath : undefined,
      ].filter((item): item is string => Boolean(item));
    }
    case 'BinaryData':
    case 'AddIn': {
      const filePath = path.join(extDir, 'Template.bin');
      if (fs.existsSync(filePath)) {
        return [];
      }
      fs.writeFileSync(filePath, Buffer.alloc(0));
      return [filePath];
    }
    case 'DataCompositionSchema': {
      const filePath = path.join(extDir, 'Template.xml');
      return writeTextFile(filePath, buildDataCompositionSchemaTemplateXml()) ? [filePath] : [];
    }
    case 'DataCompositionAppearanceTemplate': {
      const filePath = path.join(extDir, 'Template.xml');
      return writeTextFile(filePath, buildDataCompositionAppearanceTemplateXml()) ? [filePath] : [];
    }
    case 'GraphicalSchema': {
      const filePath = path.join(extDir, 'Template.xml');
      return writeTextFile(filePath, buildGraphicalSchemaTemplateXml(formatVersion)) ? [filePath] : [];
    }
    case 'SpreadsheetDocument':
    default: {
      const filePath = path.join(extDir, 'Template.xml');
      return writeTextFile(filePath, buildSpreadsheetDocumentTemplateXml()) ? [filePath] : [];
    }
  }
}

function getDefaultModulePaths(kind: MetaKind, objectDir: string): string[] {
  const ext = path.join(objectDir, 'Ext');
  const result: string[] = [];
  if (['Catalog', 'Document', 'Report', 'DataProcessor', 'ExchangePlan', 'ChartOfAccounts', 'ChartOfCharacteristicTypes', 'ChartOfCalculationTypes', 'BusinessProcess', 'Task'].includes(kind)) {
    result.push(path.join(ext, 'ObjectModule.bsl'));
  }
  if (['Report', 'DataProcessor', 'Constant', 'Enum'].includes(kind)) {
    result.push(path.join(ext, 'ManagerModule.bsl'));
  }
  if (kind === 'Constant') {
    result.push(path.join(ext, 'ValueManagerModule.bsl'));
  }
  if (['InformationRegister', 'AccumulationRegister', 'AccountingRegister', 'CalculationRegister'].includes(kind)) {
    result.push(path.join(ext, 'RecordSetModule.bsl'));
  }
  if (['CommonModule', 'HTTPService', 'WebService'].includes(kind)) {
    result.push(path.join(ext, 'Module.bsl'));
  }
  if (kind === 'CommonCommand') {
    result.push(path.join(ext, 'CommandModule.bsl'));
  }
  if (kind === 'CommonForm') {
    result.push(path.join(ext, 'Form', 'Module.bsl'));
  }
  return result;
}

/**
 * Решение «нужен ли блок <ChildObjects/>» — на основе декларации в META_TYPES.
 * Объекты без дочерних тегов (SessionParameter, Constant, DefinedType,
 * Style, StyleItem, CommonPicture, Language, FunctionalOption, ...) ломают
 * платформенную загрузку при наличии лишнего <ChildObjects/>:
 *   «ошибка формата документа — читаемое свойство не соответствует ожидаемому».
 */
function needsChildObjects(kind: MetaKind): boolean {
  // Ряд видов содержит контейнер <ChildObjects> в схеме, даже если в реестре
  // META_TYPES у них не объявлены дочерние теги: подсистема (вложенные
  // подсистемы), критерий отбора и хранилище настроек (формы). В эталонной
  // выгрузке 2.20 у них присутствует пустой <ChildObjects/>; без него платформа
  // 1С не загружает объект ("ожидаемое ChildObjects").
  if (
    kind === 'Subsystem' ||
    kind === 'FilterCriterion' ||
    kind === 'SettingsStorage' ||
    kind === 'HTTPService' ||
    kind === 'WebService'
  ) {
    return true;
  }
  const def = getMetaType(kind);
  return Array.isArray(def.childTags) && def.childTags.length > 0;
}

function ensureEmptyFile(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, '', 'utf-8');
  }
}

function buildLocalizedTag(indent: string, tag: string, text: string): string {
  if (!text) {
    return `${indent}<${tag}/>`;
  }
  return [
    `${indent}<${tag}>`,
    `${indent}\t<v8:item>`,
    `${indent}\t\t<v8:lang>ru</v8:lang>`,
    `${indent}\t\t<v8:content>${escapeXml(text)}</v8:content>`,
    `${indent}\t</v8:item>`,
    `${indent}</${tag}>`,
  ].join('\n');
}

function buildEmptyRightsXml(formatVersion: string): string {
  // Пустой Rights.xml роли без явно выданных прав. Использует тот же неймспейс
  // и атрибут version, что и `RoleRightsXml.serializeRightsXml`, чтобы платформа
  // 1С приняла файл как роль формата, совпадающего с Configuration.xml. Без
  // явной версии 1С трактует файл как 2.18 и отказывается загружать вместе
  // с конфигурацией других версий.
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<Rights xmlns="http://v8.1c.ru/8.2/roles" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="Rights" version="${formatVersion}">`,
    '\t<setForNewObjects>false</setForNewObjects>',
    '\t<setForAttributesByDefault>true</setForAttributesByDefault>',
    '\t<independentRightsOfChildObjects>false</independentRightsOfChildObjects>',
    '</Rights>',
    '',
  ].join('\n');
}

function buildBusinessProcessFlowchartXml(formatVersion: string): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<Flowchart xmlns="http://v8.1c.ru/8.3/MDClasses" version="${formatVersion}"/>`,
    '',
  ].join('\n');
}

/**
 * Дескриптор формы `Forms/<Имя>.xml` — отдельный `MetaDataObject` с описанием
 * формы (uuid + свойства). На него ссылается `<Form>Имя</Form>` в ChildObjects
 * владельца, а содержимое формы лежит в `Forms/<Имя>/Ext/Form.xml`. Минимальный
 * набор свойств снят с эталона 2.20 (пустая форма объекта): без FormType и
 * UsePurposes платформа 1С форму не принимает.
 */
function buildFormDescriptorXml(name: string, formatVersion: string, ruleset: FormatRuleset): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<MetaDataObject ${ruleset.metaDataObjectXmlns} version="${formatVersion}">`,
    `\t<Form uuid="${newUuid()}">`,
    '\t\t<Properties>',
    `\t\t\t<Name>${escapeXml(name)}</Name>`,
    buildLocalizedTag('\t\t\t', 'Synonym', splitCamelCase(name)),
    '\t\t\t<Comment/>',
    '\t\t\t<FormType>Managed</FormType>',
    '\t\t\t<IncludeHelpInContents>false</IncludeHelpInContents>',
    '\t\t\t<UsePurposes>',
    '\t\t\t\t<v8:Value xsi:type="app:ApplicationUsePurpose">PlatformApplication</v8:Value>',
    '\t\t\t</UsePurposes>',
    '\t\t</Properties>',
    '\t</Form>',
    '</MetaDataObject>',
    '',
  ].join('\n');
}

function buildManagedFormXml(formatVersion: string): string {
  // Минимальный каркас пустой управляемой формы (namespace `xcf/logform`).
  // Ровно как в эталоне 2.20: только AutoCommandBar + пустые Attributes, без
  // WindowOpeningMode/Group и без префикса pal. Ранее лишний корневой
  // `<Group>` и pal вызывали XDTO-исключение при чтении формы платформой 2.20.
  // Набор префиксов и порядок элементов совпадают с реальными формами донора.
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:app="http://v8.1c.ru/8.2/managed-application/core" xmlns:cfg="http://v8.1c.ru/8.1/data/enterprise/current-config" xmlns:dcscor="http://v8.1c.ru/8.1/data-composition-system/core" xmlns:dcssch="http://v8.1c.ru/8.1/data-composition-system/schema" xmlns:dcsset="http://v8.1c.ru/8.1/data-composition-system/settings" xmlns:ent="http://v8.1c.ru/8.1/data/enterprise" xmlns:lf="http://v8.1c.ru/8.2/managed-application/logform" xmlns:style="http://v8.1c.ru/8.1/data/ui/style" xmlns:sys="http://v8.1c.ru/8.1/data/ui/fonts/system" xmlns:v8="http://v8.1c.ru/8.1/data/core" xmlns:v8ui="http://v8.1c.ru/8.1/data/ui" xmlns:web="http://v8.1c.ru/8.1/data/ui/colors/web" xmlns:win="http://v8.1c.ru/8.1/data/ui/colors/windows" xmlns:xr="http://v8.1c.ru/8.3/xcf/readable" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" version="${formatVersion}">`,
    '\t<AutoCommandBar name="ФормаКоманднаяПанель" id="-1"/>',
    '\t<Attributes/>',
    '</Form>',
    '',
  ].join('\n');
}

function buildTemplateXml(name: string, formatVersion: string, templateType: TemplateType, ruleset: FormatRuleset): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<MetaDataObject ${ruleset.metaDataObjectXmlns} version="${formatVersion}">`,
    `\t<Template uuid="${newUuid()}">`,
    '\t\t<Properties>',
    `\t\t\t<Name>${escapeXml(name)}</Name>`,
    buildLocalizedTag('\t\t\t', 'Synonym', splitCamelCase(name)),
    '\t\t\t<Comment/>',
    `\t\t\t<TemplateType>${escapeXml(templateType)}</TemplateType>`,
    '\t\t</Properties>',
    '\t</Template>',
    '</MetaDataObject>',
    '',
  ].join('\n');
}

function buildSpreadsheetDocumentTemplateXml(): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<document xmlns="http://v8.1c.ru/8.2/data/spreadsheet" xmlns:style="http://v8.1c.ru/8.1/data/ui/style" xmlns:v8="http://v8.1c.ru/8.1/data/core" xmlns:v8ui="http://v8.1c.ru/8.1/data/ui" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    '\t<languageSettings>',
    '\t\t<currentLanguage>ru</currentLanguage>',
    '\t\t<defaultLanguage>ru</defaultLanguage>',
    '\t\t<languageInfo>',
    '\t\t\t<id>ru</id>',
    '\t\t\t<code>Русский</code>',
    '\t\t\t<description>Русский</description>',
    '\t\t</languageInfo>',
    '\t</languageSettings>',
    '\t<columns>',
    '\t\t<size>0</size>',
    '\t</columns>',
    '</document>',
    '',
  ].join('\n');
}

function buildDataCompositionSchemaTemplateXml(): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<DataCompositionSchema xmlns="http://v8.1c.ru/8.1/data-composition-system/schema"',
    '\t\txmlns:dcscom="http://v8.1c.ru/8.1/data-composition-system/common"',
    '\t\txmlns:dcscor="http://v8.1c.ru/8.1/data-composition-system/core"',
    '\t\txmlns:dcsset="http://v8.1c.ru/8.1/data-composition-system/settings"',
    '\t\txmlns:v8="http://v8.1c.ru/8.1/data/core"',
    '\t\txmlns:v8ui="http://v8.1c.ru/8.1/data/ui"',
    '\t\txmlns:xs="http://www.w3.org/2001/XMLSchema"',
    '\t\txmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    '\t<dataSource>',
    '\t\t<name>ИсточникДанных1</name>',
    '\t\t<dataSourceType>Local</dataSourceType>',
    '\t</dataSource>',
    '</DataCompositionSchema>',
    '',
  ].join('\n');
}

function buildHtmlTemplateDescriptorXml(formatVersion: string): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<Help xmlns="http://v8.1c.ru/8.3/xcf/extrnprops" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" version="${formatVersion}">`,
    '\t<Page>ru</Page>',
    '</Help>',
    '',
  ].join('\n');
}

function buildHtmlDocumentTemplate(): string {
  return [
    '<!DOCTYPE html>',
    '<html>',
    '<head>',
    '\t<meta charset="UTF-8">',
    '\t<title></title>',
    '</head>',
    '<body>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

function buildDataCompositionAppearanceTemplateXml(): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<AppearanceTemplate xmlns="http://v8.1c.ru/8.1/data-composition-system/appearance-template" xmlns:dcscor="http://v8.1c.ru/8.1/data-composition-system/core" xmlns:pal="http://v8.1c.ru/8.1/data/ui/colors/palette" xmlns:style="http://v8.1c.ru/8.1/data/ui/style" xmlns:sys="http://v8.1c.ru/8.1/data/ui/fonts/system" xmlns:v8ui="http://v8.1c.ru/8.1/data/ui" xmlns:web="http://v8.1c.ru/8.1/data/ui/colors/web" xmlns:win="http://v8.1c.ru/8.1/data/ui/colors/windows" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    '</AppearanceTemplate>',
    '',
  ].join('\n');
}

function buildGraphicalSchemaTemplateXml(formatVersion: string): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<GraphicalSchema xmlns="http://v8.1c.ru/8.3/xcf/scheme" xmlns:pal="http://v8.1c.ru/8.1/data/ui/colors/palette" xmlns:sch="http://v8.1c.ru/8.2/data/graphscheme" xmlns:style="http://v8.1c.ru/8.1/data/ui/style" xmlns:v8="http://v8.1c.ru/8.1/data/core" xmlns:v8ui="http://v8.1c.ru/8.1/data/ui" xmlns:web="http://v8.1c.ru/8.1/data/ui/colors/web" xmlns:win="http://v8.1c.ru/8.1/data/ui/colors/windows" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" version="${formatVersion}">`,
    '\t<BackColor>style:FieldBackColor</BackColor>',
    '\t<GridEnabled>false</GridEnabled>',
    '\t<DrawGridMode>None</DrawGridMode>',
    '\t<GridHorizontalStep>20</GridHorizontalStep>',
    '\t<GridVerticalStep>20</GridVerticalStep>',
    '\t<PrintParameters>',
    '\t\t<TopMargin>10</TopMargin>',
    '\t\t<LeftMargin>10</LeftMargin>',
    '\t\t<BottomMargin>10</BottomMargin>',
    '\t\t<RightMargin>10</RightMargin>',
    '\t\t<BlackAndWhite>false</BlackAndWhite>',
    '\t\t<FitPageMode>Auto</FitPageMode>',
    '\t</PrintParameters>',
    '\t<Items/>',
    '</GraphicalSchema>',
    '',
  ].join('\n');
}

function writeTextFile(filePath: string, content: string): boolean {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (fs.existsSync(filePath)) {
    return false;
  }
  fs.writeFileSync(filePath, content, 'utf-8');
  return true;
}

function resolveTemplateType(templateType: TemplateType | undefined): TemplateType {
  return templateType ?? DEFAULT_TEMPLATE_TYPE;
}

function resolveObjectFormatVersion(xmlPath: string): string {
  const configRoot = getObjectLocationFromXml(xmlPath).configRoot;
  return detectConfigFormatVersion(configRoot)
    ?? readFormatVersionFromFile(xmlPath)
    ?? DEFAULT_FORMAT_VERSION;
}

function resolveConfigFormatVersion(configRoot: string): string {
  return detectConfigFormatVersion(configRoot)
    ?? DEFAULT_FORMAT_VERSION;
}

function detectConfigFormatVersion(configRoot: string): string | null {
  return readFormatVersionFromFile(path.join(configRoot, 'ConfigDumpInfo.xml'))
    ?? readFormatVersionFromFile(path.join(configRoot, 'Configuration.xml'));
}

function readFormatVersionFromFile(filePath: string): string | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const head = fs.readFileSync(filePath, 'utf-8').slice(0, 4000);
  return /<(?!\?xml\b)[A-Za-z_:][\w:.-]*\b[^>]*\bversion="([\d.]+)"/.exec(head)?.[1] ?? null;
}

function detectChildIndent(inner: string, fallback: string): string {
  return /\n([ \t]+)</.exec(inner)?.[1] ?? fallback;
}

function splitCamelCase(name: string): string {
  const withSpaces = name
    .replace(/([а-яё])([А-ЯЁ])/g, '$1 $2')
    .replace(/([a-z])([A-Z])/g, '$1 $2');
  return withSpaces.length > 1 ? withSpaces[0] + withSpaces.slice(1).toLocaleLowerCase('ru-RU') : withSpaces;
}

function validateMetadataName(value: string): EditResult {
  return /^[\p{L}][\p{L}\p{Nd}_]*$/u.test(value)
    ? ok([])
    : fail('Имя должно начинаться с буквы и содержать только буквы, цифры и подчёркивание.');
}

function newUuid(): string {
  return crypto.randomUUID();
}

function ok(changedFiles: string[]): EditResult {
  return { success: true, changed: changedFiles.length > 0, changedFiles, warnings: [], errors: [] };
}

function fail(message: string): EditResult {
  return { success: false, changed: false, changedFiles: [], warnings: [], errors: [message] };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
