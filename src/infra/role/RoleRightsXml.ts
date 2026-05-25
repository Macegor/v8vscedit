import * as fs from 'fs';
import * as path from 'path';
import { XMLParser } from 'fast-xml-parser';
import { extractSimpleTag, extractSynonym } from '../xml/XmlUtils';

export const RIGHTS_NS = 'http://v8.1c.ru/8.2/roles';
export const DEFAULT_FORMAT_VERSION = '2.18';

export const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: false,
  processEntities: false,
});

export interface RightsXmlRoot {
  readonly '@_xmlns'?: string;
  readonly '@_version'?: string;
  readonly setForNewObjects?: string;
  readonly setForAttributesByDefault?: string;
  readonly independentRightsOfChildObjects?: string;
  readonly object?: RightsXmlObject | readonly RightsXmlObject[];
  readonly restrictionTemplate?: RightsXmlTemplate | readonly RightsXmlTemplate[];
}

export interface RightsXmlObject {
  readonly name?: string;
  readonly right?: RightsXmlRight | readonly RightsXmlRight[];
}

export interface RightsXmlRight {
  readonly name?: string;
  readonly value?: string;
  readonly restrictionByCondition?: { readonly condition?: string };
}

export interface RightsXmlTemplate {
  readonly name?: string;
  readonly condition?: string;
}

export interface ParsedRoleRights {
  readonly rightsPath: string;
  readonly metadataPath?: string;
  readonly roleFolderName: string;
  readonly metadataName: string;
  readonly synonym: string;
  readonly root: RightsXmlRoot;
}

export const TYPE_ALIASES: Readonly<Record<string, string>> = {
  Справочник: 'Catalog',
  Документ: 'Document',
  РегистрСведений: 'InformationRegister',
  РегистрНакопления: 'AccumulationRegister',
  РегистрБухгалтерии: 'AccountingRegister',
  РегистрРасчета: 'CalculationRegister',
  Константа: 'Constant',
  ПланСчетов: 'ChartOfAccounts',
  ПланВидовХарактеристик: 'ChartOfCharacteristicTypes',
  ПланВидовРасчета: 'ChartOfCalculationTypes',
  ПланОбмена: 'ExchangePlan',
  БизнесПроцесс: 'BusinessProcess',
  Задача: 'Task',
  Обработка: 'DataProcessor',
  Отчет: 'Report',
  ОбщаяФорма: 'CommonForm',
  ОбщаяКоманда: 'CommonCommand',
  Подсистема: 'Subsystem',
  КритерийОтбора: 'FilterCriterion',
  ЖурналДокументов: 'DocumentJournal',
  Последовательность: 'Sequence',
  ВебСервис: 'WebService',
  HTTPСервис: 'HTTPService',
  СервисИнтеграции: 'IntegrationService',
  ПараметрСеанса: 'SessionParameter',
  ОбщийРеквизит: 'CommonAttribute',
  Конфигурация: 'Configuration',
  Перечисление: 'Enum',
  Реквизит: 'Attribute',
  СтандартныйРеквизит: 'StandardAttribute',
  ТабличнаяЧасть: 'TabularSection',
  Измерение: 'Dimension',
  Ресурс: 'Resource',
  Команда: 'Command',
  РеквизитАдресации: 'AddressingAttribute',
};

export const RIGHT_ALIASES: Readonly<Record<string, string>> = {
  Чтение: 'Read',
  Добавление: 'Insert',
  Изменение: 'Update',
  Удаление: 'Delete',
  Просмотр: 'View',
  Редактирование: 'Edit',
  ВводПоСтроке: 'InputByString',
  Проведение: 'Posting',
  ОтменаПроведения: 'UndoPosting',
  Использование: 'Use',
  Получение: 'Get',
  Установка: 'Set',
  Старт: 'Start',
  Выполнение: 'Execute',
  УправлениеИтогами: 'TotalsControl',
  Администрирование: 'Administration',
  ТонкийКлиент: 'ThinClient',
  ВебКлиент: 'WebClient',
  ТолстыйКлиент: 'ThickClient',
  Вывод: 'Output',
  СохранениеДанныхПользователя: 'SaveUserData',
};

export const KNOWN_RIGHTS: Readonly<Partial<Record<string, readonly string[]>>> = {
  Configuration: [
    'Administration', 'DataAdministration', 'UpdateDataBaseConfiguration', 'ConfigurationExtensionsAdministration',
    'ActiveUsers', 'EventLog', 'ExclusiveMode', 'ThinClient', 'ThickClient', 'WebClient', 'MobileClient',
    'ExternalConnection', 'Automation', 'Output', 'SaveUserData', 'TechnicalSpecialistMode',
    'InteractiveOpenExtDataProcessors', 'InteractiveOpenExtReports', 'AnalyticsSystemClient',
    'CollaborationSystemInfoBaseRegistration', 'MainWindowModeNormal', 'MainWindowModeWorkplace',
    'MainWindowModeEmbeddedWorkplace', 'MainWindowModeFullscreenWorkplace', 'MainWindowModeKiosk',
  ],
  Catalog: [
    'Read', 'Insert', 'Update', 'Delete', 'View', 'Edit', 'InputByString', 'InteractiveInsert',
    'InteractiveSetDeletionMark', 'InteractiveClearDeletionMark', 'InteractiveDelete', 'InteractiveDeleteMarked',
    'InteractiveDeletePredefinedData', 'InteractiveSetDeletionMarkPredefinedData',
    'InteractiveClearDeletionMarkPredefinedData', 'InteractiveDeleteMarkedPredefinedData',
    'ReadDataHistory', 'ViewDataHistory', 'UpdateDataHistory', 'UpdateDataHistoryOfMissingData',
    'ReadDataHistoryOfMissingData', 'UpdateDataHistorySettings', 'UpdateDataHistoryVersionComment',
    'EditDataHistoryVersionComment', 'SwitchToDataHistoryVersion',
  ],
  Document: [
    'Read', 'Insert', 'Update', 'Delete', 'View', 'Edit', 'InputByString', 'Posting', 'UndoPosting',
    'InteractiveInsert', 'InteractiveSetDeletionMark', 'InteractiveClearDeletionMark', 'InteractiveDelete',
    'InteractiveDeleteMarked', 'InteractivePosting', 'InteractivePostingRegular', 'InteractiveUndoPosting',
    'InteractiveChangeOfPosted', 'ReadDataHistory', 'ViewDataHistory', 'UpdateDataHistory',
    'UpdateDataHistoryOfMissingData', 'ReadDataHistoryOfMissingData', 'UpdateDataHistorySettings',
    'UpdateDataHistoryVersionComment', 'EditDataHistoryVersionComment', 'SwitchToDataHistoryVersion',
  ],
  InformationRegister: ['Read', 'Update', 'View', 'Edit', 'TotalsControl', 'ReadDataHistory', 'ViewDataHistory', 'UpdateDataHistory', 'UpdateDataHistoryOfMissingData', 'ReadDataHistoryOfMissingData', 'UpdateDataHistorySettings', 'UpdateDataHistoryVersionComment', 'EditDataHistoryVersionComment', 'SwitchToDataHistoryVersion'],
  AccumulationRegister: ['Read', 'Update', 'View', 'Edit', 'TotalsControl'],
  AccountingRegister: ['Read', 'Update', 'View', 'Edit', 'TotalsControl'],
  CalculationRegister: ['Read', 'View'],
  Constant: ['Read', 'Update', 'View', 'Edit', 'ReadDataHistory', 'ViewDataHistory', 'UpdateDataHistory', 'UpdateDataHistorySettings', 'UpdateDataHistoryVersionComment', 'EditDataHistoryVersionComment', 'SwitchToDataHistoryVersion'],
  ChartOfAccounts: ['Read', 'Insert', 'Update', 'Delete', 'View', 'Edit', 'InputByString', 'InteractiveInsert', 'InteractiveSetDeletionMark', 'InteractiveClearDeletionMark', 'InteractiveDelete', 'InteractiveDeletePredefinedData', 'InteractiveSetDeletionMarkPredefinedData', 'InteractiveClearDeletionMarkPredefinedData', 'InteractiveDeleteMarkedPredefinedData', 'ReadDataHistory', 'ReadDataHistoryOfMissingData', 'UpdateDataHistory', 'UpdateDataHistoryOfMissingData', 'UpdateDataHistorySettings', 'UpdateDataHistoryVersionComment'],
  ChartOfCharacteristicTypes: ['Read', 'Insert', 'Update', 'Delete', 'View', 'Edit', 'InputByString', 'InteractiveInsert', 'InteractiveSetDeletionMark', 'InteractiveClearDeletionMark', 'InteractiveDelete', 'InteractiveDeleteMarked', 'InteractiveDeletePredefinedData', 'InteractiveSetDeletionMarkPredefinedData', 'InteractiveClearDeletionMarkPredefinedData', 'InteractiveDeleteMarkedPredefinedData', 'ReadDataHistory', 'ViewDataHistory', 'UpdateDataHistory', 'ReadDataHistoryOfMissingData', 'UpdateDataHistoryOfMissingData', 'UpdateDataHistorySettings', 'UpdateDataHistoryVersionComment', 'EditDataHistoryVersionComment', 'SwitchToDataHistoryVersion'],
  ChartOfCalculationTypes: ['Read', 'Insert', 'Update', 'Delete', 'View', 'Edit', 'InputByString', 'InteractiveInsert', 'InteractiveSetDeletionMark', 'InteractiveClearDeletionMark', 'InteractiveDelete', 'InteractiveDeletePredefinedData', 'InteractiveSetDeletionMarkPredefinedData', 'InteractiveClearDeletionMarkPredefinedData', 'InteractiveDeleteMarkedPredefinedData'],
  ExchangePlan: ['Read', 'Insert', 'Update', 'Delete', 'View', 'Edit', 'InputByString', 'InteractiveInsert', 'InteractiveSetDeletionMark', 'InteractiveClearDeletionMark', 'InteractiveDelete', 'InteractiveDeleteMarked', 'ReadDataHistory', 'ViewDataHistory', 'UpdateDataHistory', 'ReadDataHistoryOfMissingData', 'UpdateDataHistoryOfMissingData', 'UpdateDataHistorySettings', 'UpdateDataHistoryVersionComment', 'EditDataHistoryVersionComment', 'SwitchToDataHistoryVersion'],
  BusinessProcess: ['Read', 'Insert', 'Update', 'Delete', 'View', 'Edit', 'InputByString', 'Start', 'InteractiveInsert', 'InteractiveSetDeletionMark', 'InteractiveClearDeletionMark', 'InteractiveDelete', 'InteractiveActivate', 'InteractiveStart'],
  Task: ['Read', 'Insert', 'Update', 'Delete', 'View', 'Edit', 'InputByString', 'Execute', 'InteractiveInsert', 'InteractiveSetDeletionMark', 'InteractiveClearDeletionMark', 'InteractiveDelete', 'InteractiveActivate', 'InteractiveExecute'],
  DataProcessor: ['Use', 'View'],
  Report: ['Use', 'View'],
  CommonForm: ['View'],
  CommonCommand: ['View'],
  Subsystem: ['View'],
  FilterCriterion: ['View'],
  DocumentJournal: ['Read', 'View'],
  Sequence: ['Read', 'Update'],
  WebService: ['Use'],
  HTTPService: ['Use'],
  IntegrationService: ['Use'],
  SessionParameter: ['Get', 'Set'],
  CommonAttribute: ['View', 'Edit'],
};

export const NESTED_RIGHTS = ['View', 'Edit'] as const;
export const COMMAND_RIGHTS = ['View'] as const;
export const CHANNEL_RIGHTS = ['Use'] as const;

export const PRESETS: Readonly<Partial<Record<string, Readonly<Partial<Record<string, readonly string[]>>>>>> = {
  view: {
    Catalog: ['Read', 'View', 'InputByString'],
    ExchangePlan: ['Read', 'View', 'InputByString'],
    Document: ['Read', 'View', 'InputByString'],
    ChartOfAccounts: ['Read', 'View', 'InputByString'],
    ChartOfCharacteristicTypes: ['Read', 'View', 'InputByString'],
    ChartOfCalculationTypes: ['Read', 'View', 'InputByString'],
    BusinessProcess: ['Read', 'View', 'InputByString'],
    Task: ['Read', 'View', 'InputByString'],
    InformationRegister: ['Read', 'View'],
    AccumulationRegister: ['Read', 'View'],
    AccountingRegister: ['Read', 'View'],
    CalculationRegister: ['Read', 'View'],
    Constant: ['Read', 'View'],
    DocumentJournal: ['Read', 'View'],
    Sequence: ['Read'],
    CommonForm: ['View'],
    CommonCommand: ['View'],
    Subsystem: ['View'],
    FilterCriterion: ['View'],
    SessionParameter: ['Get'],
    CommonAttribute: ['View'],
    DataProcessor: ['Use', 'View'],
    Report: ['Use', 'View'],
    Configuration: ['ThinClient', 'WebClient', 'Output', 'SaveUserData', 'MainWindowModeNormal'],
  },
  edit: {
    Catalog: ['Read', 'Insert', 'Update', 'Delete', 'View', 'Edit', 'InputByString', 'InteractiveInsert', 'InteractiveSetDeletionMark', 'InteractiveClearDeletionMark'],
    ExchangePlan: ['Read', 'Insert', 'Update', 'Delete', 'View', 'Edit', 'InputByString', 'InteractiveInsert', 'InteractiveSetDeletionMark', 'InteractiveClearDeletionMark'],
    Document: ['Read', 'Insert', 'Update', 'Delete', 'View', 'Edit', 'InputByString', 'Posting', 'UndoPosting', 'InteractiveInsert', 'InteractiveSetDeletionMark', 'InteractiveClearDeletionMark', 'InteractivePosting', 'InteractivePostingRegular', 'InteractiveUndoPosting', 'InteractiveChangeOfPosted'],
    ChartOfAccounts: ['Read', 'Insert', 'Update', 'Delete', 'View', 'Edit', 'InputByString', 'InteractiveInsert', 'InteractiveSetDeletionMark', 'InteractiveClearDeletionMark'],
    ChartOfCharacteristicTypes: ['Read', 'Insert', 'Update', 'Delete', 'View', 'Edit', 'InputByString', 'InteractiveInsert', 'InteractiveSetDeletionMark', 'InteractiveClearDeletionMark'],
    ChartOfCalculationTypes: ['Read', 'Insert', 'Update', 'Delete', 'View', 'Edit', 'InputByString', 'InteractiveInsert', 'InteractiveSetDeletionMark', 'InteractiveClearDeletionMark'],
    BusinessProcess: ['Read', 'Insert', 'Update', 'Delete', 'View', 'Edit', 'InputByString', 'Start', 'InteractiveInsert', 'InteractiveSetDeletionMark', 'InteractiveClearDeletionMark', 'InteractiveActivate', 'InteractiveStart'],
    Task: ['Read', 'Insert', 'Update', 'Delete', 'View', 'Edit', 'InputByString', 'Execute', 'InteractiveInsert', 'InteractiveSetDeletionMark', 'InteractiveClearDeletionMark', 'InteractiveActivate', 'InteractiveExecute'],
    InformationRegister: ['Read', 'Update', 'View', 'Edit'],
    AccumulationRegister: ['Read', 'Update', 'View', 'Edit'],
    AccountingRegister: ['Read', 'Update', 'View', 'Edit'],
    Constant: ['Read', 'Update', 'View', 'Edit'],
    DocumentJournal: ['Read', 'View'],
    Sequence: ['Read', 'Update'],
    SessionParameter: ['Get', 'Set'],
    CommonAttribute: ['View', 'Edit'],
  },
};

export function parseRightsRoot(xml: string): RightsXmlRoot | null {
  const parsed = parser.parse(xml) as { Rights?: RightsXmlRoot };
  return parsed.Rights ?? null;
}

export function readRole(inputPath: string): ParsedRoleRights {
  const rightsPath = resolveRightsXmlPath(inputPath);
  if (!rightsPath) {
    throw new Error(`Rights.xml не найден: ${inputPath}`);
  }
  const raw = fs.readFileSync(rightsPath, 'utf-8');
  const root = parseRightsRoot(raw);
  if (!root) {
    throw new Error(`Файл не похож на Rights.xml: ${rightsPath}`);
  }
  const metadataPath = resolveRoleMetadataPath(rightsPath);
  const metadata = metadataPath ? readRoleMetadata(metadataPath) : { name: '', synonym: '' };
  return {
    rightsPath,
    metadataPath,
    roleFolderName: inferRoleFolderName(rightsPath),
    metadataName: metadata.name,
    synonym: metadata.synonym,
    root,
  };
}

export function resolveRightsXmlPath(inputPath: string): string | null {
  const resolved = path.resolve(inputPath);
  if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
    if (path.basename(resolved) === 'Rights.xml') {
      return resolved;
    }
    if (path.basename(path.dirname(resolved)) === 'Roles') {
      const roleName = path.basename(resolved, '.xml');
      const candidate = path.join(path.dirname(resolved), roleName, 'Ext', 'Rights.xml');
      return fs.existsSync(candidate) ? candidate : null;
    }
  }
  if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
    const direct = path.join(resolved, 'Ext', 'Rights.xml');
    if (fs.existsSync(direct)) {
      return direct;
    }
    const nested = path.join(resolved, path.basename(resolved), 'Ext', 'Rights.xml');
    if (fs.existsSync(nested)) {
      return nested;
    }
  }
  if (path.basename(resolved) === 'Rights.xml') {
    const candidate = path.join(path.dirname(resolved), 'Ext', 'Rights.xml');
    return fs.existsSync(candidate) ? candidate : null;
  }
  return null;
}

export function resolveRoleMetadataPath(rightsPath: string): string | undefined {
  const roleDir = path.dirname(path.dirname(rightsPath));
  const candidate = path.join(path.dirname(roleDir), `${path.basename(roleDir)}.xml`);
  return fs.existsSync(candidate) ? candidate : undefined;
}

export function readRoleMetadata(metadataPath: string): { name: string; synonym: string } {
  const xml = fs.readFileSync(metadataPath, 'utf-8');
  return {
    name: extractSimpleTag(xml, 'Name') ?? path.basename(metadataPath, '.xml'),
    synonym: extractSynonym(xml),
  };
}

export function inferRoleFolderName(rightsPath: string): string {
  return path.basename(path.dirname(path.dirname(rightsPath)));
}

export function translateObjectName(name: string): string {
  return name.split('.').map((part) => TYPE_ALIASES[part] ?? part).join('.');
}

export function translateRightName(name: string): string {
  return RIGHT_ALIASES[name] ?? name;
}

export function getObjectType(objectName: string): string {
  return objectName.split('.')[0] ?? objectName;
}

export function isNestedObject(objectName: string): boolean {
  return objectName.split('.').length >= 3;
}

export function asArray<T>(value: T | readonly T[] | undefined): readonly T[] {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value as readonly T[] : [value as T];
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function escapeXmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeTextSearch(value: string): string {
  return escapeXmlText(value);
}

export function detectFormatVersion(configDir: string): string {
  const configXmlPath = path.join(configDir, 'Configuration.xml');
  if (!fs.existsSync(configXmlPath)) {
    return DEFAULT_FORMAT_VERSION;
  }
  const version = /<MetaDataObject\b[^>]*version="([^"]+)"/.exec(fs.readFileSync(configXmlPath, 'utf-8'))?.[1];
  return version ?? DEFAULT_FORMAT_VERSION;
}

export interface SerializableRoleRight {
  readonly name: string;
  readonly value: 'true' | 'false';
  readonly condition?: string;
}

export interface SerializableRoleObject {
  readonly name: string;
  readonly rights: readonly SerializableRoleRight[];
}

export interface SerializableRoleTemplate {
  readonly name: string;
  readonly condition: string;
}

export interface SerializableRoleRights {
  readonly setForNewObjects: boolean;
  readonly setForAttributesByDefault: boolean;
  readonly independentRightsOfChildObjects: boolean;
  readonly objects: readonly SerializableRoleObject[];
  readonly templates: readonly SerializableRoleTemplate[];
  readonly formatVersion: string;
}

export function serializeRightsXml(rights: SerializableRoleRights): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<Rights xmlns="${RIGHTS_NS}" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="Rights" version="${escapeXml(rights.formatVersion)}">`,
    `\t<setForNewObjects>${String(rights.setForNewObjects)}</setForNewObjects>`,
    `\t<setForAttributesByDefault>${String(rights.setForAttributesByDefault)}</setForAttributesByDefault>`,
    `\t<independentRightsOfChildObjects>${String(rights.independentRightsOfChildObjects)}</independentRightsOfChildObjects>`,
  ];
  for (const object of rights.objects) {
    lines.push('\t<object>', `\t\t<name>${escapeXmlText(object.name)}</name>`);
    for (const right of object.rights) {
      lines.push('\t\t<right>', `\t\t\t<name>${escapeXmlText(right.name)}</name>`, `\t\t\t<value>${right.value}</value>`);
      if (right.condition) {
        lines.push('\t\t\t<restrictionByCondition>', `\t\t\t\t<condition>${escapeXmlText(right.condition)}</condition>`, '\t\t\t</restrictionByCondition>');
      }
      lines.push('\t\t</right>');
    }
    lines.push('\t</object>');
  }
  for (const template of rights.templates) {
    lines.push(
      '\t<restrictionTemplate>',
      `\t\t<name>${escapeXmlText(template.name)}</name>`,
      `\t\t<condition>${escapeXmlText(template.condition)}</condition>`,
      '\t</restrictionTemplate>'
    );
  }
  lines.push('</Rights>', '');
  return lines.join('\n');
}

export function paginate(lines: readonly string[], offset = 0, limit = 150): string[] {
  const normalizedOffset = Math.max(0, offset);
  const normalizedLimit = Math.max(0, limit);
  let result = lines.slice(normalizedOffset);
  if (normalizedLimit > 0 && result.length > normalizedLimit) {
    result = [
      ...result.slice(0, normalizedLimit),
      '',
      `[TRUNCATED] Shown ${String(normalizedLimit)} of ${String(lines.length)} lines. Use offset ${String(normalizedOffset + normalizedLimit)} to continue.`,
    ];
  }
  return result;
}
