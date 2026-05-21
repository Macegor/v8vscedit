import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { ConfigurationXmlEditor } from '../xml/ConfigurationXmlEditor';
import { extractSimpleTag, extractSynonym } from '../xml/XmlUtils';

const RIGHTS_NS = 'http://v8.1c.ru/8.2/roles';
const DEFAULT_FORMAT_VERSION = '2.18';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: false,
  processEntities: false,
});

export interface RoleInfoOptions {
  readonly rightsPath: string;
  readonly showDenied?: boolean;
  readonly limit?: number;
  readonly offset?: number;
}

export interface RoleValidationOptions {
  readonly rightsPath: string;
  readonly detailed?: boolean;
  readonly maxErrors?: number;
}

export interface RoleCompileOptions {
  readonly outputDir: string;
  readonly definition: RoleDefinition;
}

export interface RoleDefinition {
  readonly name: string;
  readonly synonym?: string;
  readonly comment?: string;
  readonly setForNewObjects?: boolean;
  readonly setForAttributesByDefault?: boolean;
  readonly independentRightsOfChildObjects?: boolean;
  readonly objects?: readonly RoleObjectDefinition[];
  readonly rights?: readonly RoleObjectDefinition[];
  readonly templates?: readonly RoleRestrictionTemplateDefinition[];
}

export type RoleObjectDefinition = string | {
  readonly name?: string;
  readonly preset?: string;
  readonly rights?: readonly string[] | Record<string, boolean>;
  readonly rls?: Record<string, string>;
};

export interface RoleRestrictionTemplateDefinition {
  readonly name: string;
  readonly condition: string;
}

export interface RoleInfoResult {
  readonly rightsPath: string;
  readonly metadataPath?: string;
  readonly name: string;
  readonly synonym: string;
  readonly properties: RoleGlobalFlags;
  readonly allowed: readonly RoleObjectRightsGroup[];
  readonly denied: readonly RoleObjectRightsGroup[];
  readonly templates: readonly string[];
  readonly rls: readonly string[];
  readonly totalAllowed: number;
  readonly totalDenied: number;
  readonly lines: readonly string[];
}

export interface RoleObjectRightsGroup {
  readonly type: string;
  readonly objects: readonly RoleObjectRights[];
}

export interface RoleObjectRights {
  readonly name: string;
  readonly rights: readonly string[];
}

export interface RoleValidationIssue {
  readonly severity: 'error' | 'warning' | 'ok';
  readonly message: string;
}

export interface RoleValidationResult {
  readonly rightsPath: string;
  readonly metadataPath?: string;
  readonly name: string;
  readonly errors: number;
  readonly warnings: number;
  readonly checks: number;
  readonly issues: readonly RoleValidationIssue[];
  readonly lines: readonly string[];
}

export interface RoleCompileResult {
  readonly name: string;
  readonly metadataPath: string;
  readonly rightsPath: string;
  readonly changedFiles: readonly string[];
  readonly warnings: readonly string[];
}

interface RoleGlobalFlags {
  readonly setForNewObjects: string;
  readonly setForAttributesByDefault: string;
  readonly independentRightsOfChildObjects: string;
}

interface ParsedRoleRights {
  readonly rightsPath: string;
  readonly metadataPath?: string;
  readonly roleFolderName: string;
  readonly metadataName: string;
  readonly synonym: string;
  readonly root: RightsXmlRoot;
}

interface RightsXmlRoot {
  readonly '@_xmlns'?: string;
  readonly '@_version'?: string;
  readonly setForNewObjects?: string;
  readonly setForAttributesByDefault?: string;
  readonly independentRightsOfChildObjects?: string;
  readonly object?: RightsXmlObject | readonly RightsXmlObject[];
  readonly restrictionTemplate?: RightsXmlTemplate | readonly RightsXmlTemplate[];
}

interface RightsXmlObject {
  readonly name?: string;
  readonly right?: RightsXmlRight | readonly RightsXmlRight[];
}

interface RightsXmlRight {
  readonly name?: string;
  readonly value?: string;
  readonly restrictionByCondition?: { readonly condition?: string };
}

interface RightsXmlTemplate {
  readonly name?: string;
  readonly condition?: string;
}

interface ParsedObjectDefinition {
  readonly name: string;
  readonly rights: readonly ParsedRightDefinition[];
}

interface ParsedRightDefinition {
  readonly name: string;
  readonly value: 'true' | 'false';
  readonly condition?: string;
}

const TYPE_ALIASES: Readonly<Record<string, string>> = {
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

const RIGHT_ALIASES: Readonly<Record<string, string>> = {
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

const KNOWN_RIGHTS: Readonly<Record<string, readonly string[]>> = {
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

const NESTED_RIGHTS = ['View', 'Edit'] as const;
const COMMAND_RIGHTS = ['View'] as const;
const CHANNEL_RIGHTS = ['Use'] as const;

const PRESETS: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
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

export class RoleRightsService {
  private readonly configEditor = new ConfigurationXmlEditor();

  info(options: RoleInfoOptions): RoleInfoResult {
    const parsed = readRole(options.rightsPath);
    const grouped = groupRights(parsed.root);
    const lines = paginate(buildInfoLines(parsed, grouped, Boolean(options.showDenied)), options.offset, options.limit);
    return {
      rightsPath: parsed.rightsPath,
      metadataPath: parsed.metadataPath,
      name: parsed.metadataName || parsed.roleFolderName,
      synonym: parsed.synonym,
      properties: readFlags(parsed.root),
      allowed: grouped.allowed,
      denied: grouped.denied,
      templates: grouped.templates,
      rls: grouped.rls,
      totalAllowed: grouped.totalAllowed,
      totalDenied: grouped.totalDenied,
      lines,
    };
  }

  validate(options: RoleValidationOptions): RoleValidationResult {
    const rightsPath = resolveRightsXmlPath(options.rightsPath);
    const issues: RoleValidationIssue[] = [];
    let errors = 0;
    let warnings = 0;
    let okCount = 0;
    const maxErrors = Math.max(1, options.maxErrors ?? 30);
    const ok = (message: string) => {
      okCount += 1;
      if (options.detailed) {
        issues.push({ severity: 'ok', message });
      }
    };
    const warn = (message: string) => {
      warnings += 1;
      issues.push({ severity: 'warning', message });
    };
    const error = (message: string) => {
      if (errors >= maxErrors) {
        return;
      }
      errors += 1;
      issues.push({ severity: 'error', message });
    };

    if (!rightsPath) {
      error(`Rights.xml не найден: ${options.rightsPath}`);
      return buildValidationResult(options.rightsPath, undefined, '', issues, errors, warnings, okCount);
    }

    const metadataPath = resolveRoleMetadataPath(rightsPath);
    const roleName = metadataPath ? readRoleMetadata(metadataPath).name : inferRoleFolderName(rightsPath);
    const raw = fs.readFileSync(rightsPath, 'utf-8');
    const validation = XMLValidator.validate(raw);
    if (validation !== true) {
      error(`XML parse error: ${validation.err.msg}`);
      return buildValidationResult(rightsPath, metadataPath, roleName, issues, errors, warnings, okCount);
    }
    ok('XML well-formed');

    const root = parseRightsRoot(raw);
    if (!root) {
      error('Корневой элемент Rights не найден.');
      return buildValidationResult(rightsPath, metadataPath, roleName, issues, errors, warnings, okCount);
    }
    if (root['@_xmlns'] && root['@_xmlns'] !== RIGHTS_NS) {
      warn(`Namespace "${root['@_xmlns']}", ожидается "${RIGHTS_NS}".`);
    } else {
      ok('Root element: <Rights>');
    }

    for (const flag of ['setForNewObjects', 'setForAttributesByDefault', 'independentRightsOfChildObjects'] as const) {
      const value = root[flag];
      if (value === undefined) {
        warn(`Отсутствует глобальный флаг ${flag}.`);
      } else if (value !== 'true' && value !== 'false') {
        warn(`${flag} = "${value}", ожидается true/false.`);
      }
    }

    let rightCount = 0;
    let rlsCount = 0;
    for (const object of asArray(root.object)) {
      const objectName = object.name ?? '';
      if (!objectName) {
        error('object без name.');
        continue;
      }
      const objectType = getObjectType(objectName);
      const nested = isNestedObject(objectName);
      if (!nested && !KNOWN_RIGHTS[objectType]) {
        warn(`${objectName}: неизвестный тип объекта "${objectType}".`);
      }
      for (const right of asArray(object.right)) {
        const rightName = right.name ?? '';
        const value = right.value ?? '';
        if (!rightName) {
          error(`${objectName}: right без name.`);
          continue;
        }
        if (value !== 'true' && value !== 'false') {
          error(`${objectName}: право "${rightName}" имеет значение "${value}", ожидается true/false.`);
          continue;
        }
        rightCount += 1;
        validateRightName(objectName, rightName, warn);
        if (right.restrictionByCondition) {
          rlsCount += 1;
          if (!right.restrictionByCondition.condition) {
            warn(`${objectName}: пустое RLS-условие для "${rightName}".`);
          }
        }
      }
    }
    ok(`${String(asArray(root.object).length)} objects, ${String(rightCount)} rights`);
    if (rlsCount > 0) {
      ok(`${String(rlsCount)} RLS restrictions`);
    }

    for (const template of asArray(root.restrictionTemplate)) {
      if (!template.name) {
        warn('Шаблон ограничения без name.');
      }
      if (!template.condition) {
        warn(`Шаблон "${template.name ?? ''}": пустое condition.`);
      }
    }

    if (metadataPath && fs.existsSync(metadataPath)) {
      validateRoleMetadata(metadataPath, ok, warn, error);
      validateConfigurationRegistration(metadataPath, roleName, ok, warn);
    }
    return buildValidationResult(rightsPath, metadataPath, roleName, issues, errors, warnings, okCount);
  }

  compile(options: RoleCompileOptions): RoleCompileResult {
    const definition = options.definition;
    const name = definition.name?.trim();
    if (!name || !/^[\p{L}_][\p{L}\p{Nd}_]*$/u.test(name)) {
      throw new Error('JSON роли должен содержать корректное поле name.');
    }
    const outputDir = path.resolve(options.outputDir);
    const rolesDir = path.basename(outputDir) === 'Roles' ? outputDir : path.join(outputDir, 'Roles');
    const configDir = path.basename(outputDir) === 'Roles' ? path.dirname(outputDir) : outputDir;
    const metadataPath = path.join(rolesDir, `${name}.xml`);
    const rightsPath = path.join(rolesDir, name, 'Ext', 'Rights.xml');
    if (fs.existsSync(metadataPath) || fs.existsSync(rightsPath)) {
      throw new Error(`Роль "${name}" уже существует.`);
    }

    const formatVersion = detectFormatVersion(configDir);
    const warnings: string[] = [];
    const objects = parseRoleObjects(definition.objects ?? definition.rights ?? [], warnings);
    fs.mkdirSync(path.dirname(rightsPath), { recursive: true });
    fs.mkdirSync(rolesDir, { recursive: true });
    fs.writeFileSync(metadataPath, buildRoleMetadataXml(definition, formatVersion), 'utf-8');
    fs.writeFileSync(rightsPath, buildRightsXml(definition, objects, formatVersion), 'utf-8');
    const changedFiles = [metadataPath, rightsPath];

    const configXmlPath = path.join(configDir, 'Configuration.xml');
    if (fs.existsSync(configXmlPath)) {
      const registration = this.configEditor.addChildObject(configXmlPath, `Role.${name}`);
      if (registration.success || registration.changed) {
        changedFiles.push(...registration.changedFiles);
      }
      warnings.push(...registration.warnings);
      if (registration.errors.length > 0) {
        throw new Error(registration.errors.join('\n'));
      }
    } else {
      warnings.push(`Configuration.xml не найден, роль не зарегистрирована: ${configXmlPath}`);
    }

    return { name, metadataPath, rightsPath, changedFiles, warnings };
  }

  resolveRightsPath(inputPath: string): string | null {
    return resolveRightsXmlPath(inputPath);
  }
}

function readRole(inputPath: string): ParsedRoleRights {
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

function parseRightsRoot(xml: string): RightsXmlRoot | null {
  const parsed = parser.parse(xml) as { Rights?: RightsXmlRoot };
  return parsed.Rights ?? null;
}

function resolveRightsXmlPath(inputPath: string): string | null {
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

function resolveRoleMetadataPath(rightsPath: string): string | undefined {
  const roleDir = path.dirname(path.dirname(rightsPath));
  const candidate = path.join(path.dirname(roleDir), `${path.basename(roleDir)}.xml`);
  return fs.existsSync(candidate) ? candidate : undefined;
}

function readRoleMetadata(metadataPath: string): { name: string; synonym: string } {
  const xml = fs.readFileSync(metadataPath, 'utf-8');
  return {
    name: extractSimpleTag(xml, 'Name') ?? path.basename(metadataPath, '.xml'),
    synonym: extractSynonym(xml),
  };
}

function inferRoleFolderName(rightsPath: string): string {
  return path.basename(path.dirname(path.dirname(rightsPath)));
}

function readFlags(root: RightsXmlRoot): RoleGlobalFlags {
  return {
    setForNewObjects: root.setForNewObjects ?? '',
    setForAttributesByDefault: root.setForAttributesByDefault ?? '',
    independentRightsOfChildObjects: root.independentRightsOfChildObjects ?? '',
  };
}

function groupRights(root: RightsXmlRoot): {
  allowed: RoleObjectRightsGroup[];
  denied: RoleObjectRightsGroup[];
  templates: string[];
  rls: string[];
  totalAllowed: number;
  totalDenied: number;
} {
  const allowed = new Map<string, Map<string, string[]>>();
  const denied = new Map<string, Map<string, string[]>>();
  const rls: string[] = [];
  let totalAllowed = 0;
  let totalDenied = 0;
  for (const object of asArray(root.object)) {
    const objectName = object.name ?? '';
    const [type, shortName] = splitObjectName(objectName);
    if (!type || !shortName) {
      continue;
    }
    for (const right of asArray(object.right)) {
      if (!right.name || !right.value) {
        continue;
      }
      const target = right.value === 'true' ? allowed : denied;
      if (right.value === 'true') {
        totalAllowed += 1;
      } else {
        totalDenied += 1;
      }
      const typed = target.get(type) ?? new Map<string, string[]>();
      const rights = typed.get(shortName) ?? [];
      rights.push(right.restrictionByCondition ? `${right.name} [RLS]` : right.name);
      typed.set(shortName, rights);
      target.set(type, typed);
      if (right.restrictionByCondition && right.value === 'true') {
        rls.push(`${type}.${shortName} (${right.name})`);
      }
    }
  }
  return {
    allowed: toGroups(allowed),
    denied: toGroups(denied),
    templates: asArray(root.restrictionTemplate).map((item) => (item.name ?? '').replace(/\(.*/, '')).filter(Boolean),
    rls,
    totalAllowed,
    totalDenied,
  };
}

function splitObjectName(objectName: string): [string, string] {
  const index = objectName.indexOf('.');
  return index === -1 ? ['', ''] : [objectName.slice(0, index), objectName.slice(index + 1)];
}

function toGroups(source: Map<string, Map<string, string[]>>): RoleObjectRightsGroup[] {
  return [...source.entries()].map(([type, objects]) => ({
    type,
    objects: [...objects.entries()].map(([name, rights]) => ({ name, rights })),
  }));
}

function buildInfoLines(
  parsed: ParsedRoleRights,
  grouped: ReturnType<typeof groupRights>,
  showDenied: boolean
): string[] {
  const flags = readFlags(parsed.root);
  const roleName = parsed.metadataName || parsed.roleFolderName;
  const lines = [
    `=== Role: ${roleName}${parsed.synonym ? ` — "${parsed.synonym}"` : ''} ===`,
    '',
    `Properties: setForNewObjects=${flags.setForNewObjects}, setForAttributesByDefault=${flags.setForAttributesByDefault}, independentRightsOfChildObjects=${flags.independentRightsOfChildObjects}`,
    '',
  ];
  if (grouped.allowed.length > 0) {
    lines.push('Allowed rights:', '');
    appendGroups(lines, grouped.allowed, false);
  } else {
    lines.push('(no allowed rights)', '');
  }
  if (showDenied && grouped.denied.length > 0) {
    lines.push('Denied rights:', '');
    appendGroups(lines, grouped.denied, true);
  } else if (grouped.totalDenied > 0) {
    lines.push(`Denied: ${String(grouped.totalDenied)} rights`, '');
  }
  if (grouped.rls.length > 0) {
    lines.push(`RLS: ${String(grouped.rls.length)} restrictions`);
  }
  if (grouped.templates.length > 0) {
    lines.push(`Templates: ${grouped.templates.join(', ')}`);
  }
  lines.push('', '---', `Total: ${String(grouped.totalAllowed)} allowed, ${String(grouped.totalDenied)} denied`);
  return lines;
}

function appendGroups(lines: string[], groups: readonly RoleObjectRightsGroup[], denied: boolean): void {
  for (const group of groups) {
    lines.push(`  ${group.type} (${String(group.objects.length)}):`);
    for (const object of group.objects) {
      const rights = denied ? object.rights.map((item) => `-${item}`).join(', ') : object.rights.join(', ');
      lines.push(`    ${object.name}: ${rights}`);
    }
    lines.push('');
  }
}

function paginate(lines: readonly string[], offset = 0, limit = 150): string[] {
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

function buildValidationResult(
  rightsPath: string,
  metadataPath: string | undefined,
  name: string,
  issues: readonly RoleValidationIssue[],
  errors: number,
  warnings: number,
  okCount: number
): RoleValidationResult {
  const roleName = name || inferRoleNameFromPath(rightsPath);
  const lines = errors === 0 && warnings === 0 && issues.every((issue) => issue.severity === 'ok')
    ? [`=== Validation OK: Role.${roleName} (${String(okCount + errors + warnings)} checks) ===`]
    : [
        `=== Validation: Role.${roleName} ===`,
        ...issues.map((issue) => `[${issue.severity.toUpperCase()}] ${issue.message}`),
        '',
        `=== Result: ${String(errors)} errors, ${String(warnings)} warnings (${String(okCount + errors + warnings)} checks) ===`,
      ];
  return {
    rightsPath,
    metadataPath,
    name: roleName,
    errors,
    warnings,
    checks: okCount + errors + warnings,
    issues,
    lines,
  };
}

function inferRoleNameFromPath(inputPath: string): string {
  return path.basename(path.dirname(path.dirname(inputPath)));
}

function validateRightName(objectName: string, rightName: string, warn: (message: string) => void): void {
  const objectType = getObjectType(objectName);
  if (isNestedObject(objectName)) {
    if (objectName.includes('.Command.') && !COMMAND_RIGHTS.includes(rightName as 'View')) {
      warn(`${objectName}: "${rightName}" не является правом команды.`);
    } else if (objectName.includes('.IntegrationServiceChannel.') && !CHANNEL_RIGHTS.includes(rightName as 'Use')) {
      warn(`${objectName}: "${rightName}" не является правом канала сервиса интеграции.`);
    } else if (!objectName.includes('.Command.') && !objectName.includes('.IntegrationServiceChannel.') && !NESTED_RIGHTS.includes(rightName as 'View' | 'Edit')) {
      warn(`${objectName}: "${rightName}" не является правом дочернего объекта.`);
    }
    return;
  }
  const valid = KNOWN_RIGHTS[objectType];
  if (valid && !valid.includes(rightName)) {
    const similar = valid.filter((item) => item.includes(rightName) || rightName.includes(item)).slice(0, 3);
    warn(`${objectName}: неизвестное право "${rightName}".${similar.length > 0 ? ` Возможно: ${similar.join(', ')}.` : ''}`);
  }
}

function validateRoleMetadata(
  metadataPath: string,
  ok: (message: string) => void,
  warn: (message: string) => void,
  error: (message: string) => void
): void {
  const xml = fs.readFileSync(metadataPath, 'utf-8');
  const uuid = /<Role\b[^>]*uuid="([^"]+)"/.exec(xml)?.[1] ?? '';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) {
    ok(`Metadata: UUID valid (${uuid})`);
  } else {
    error(`Metadata: invalid UUID "${uuid}"`);
  }
  const name = extractSimpleTag(xml, 'Name');
  if (name) {
    ok(`Metadata: Name = ${name}`);
  } else {
    error('Metadata: Name не задан.');
  }
  if (extractSynonym(xml)) {
    ok('Metadata: Synonym present');
  } else {
    warn('Metadata: Synonym пустой.');
  }
}

function validateConfigurationRegistration(
  metadataPath: string,
  roleName: string,
  ok: (message: string) => void,
  warn: (message: string) => void
): void {
  const configXmlPath = path.join(path.dirname(path.dirname(metadataPath)), 'Configuration.xml');
  if (!fs.existsSync(configXmlPath)) {
    return;
  }
  const xml = fs.readFileSync(configXmlPath, 'utf-8');
  if (xml.includes(`<Role>${escapeTextSearch(roleName)}</Role>`)) {
    ok(`Configuration.xml: Role.${roleName} зарегистрирована`);
  } else {
    warn(`Configuration.xml: <Role>${roleName}</Role> не найден.`);
  }
}

function parseRoleObjects(entries: readonly RoleObjectDefinition[], warnings: string[]): ParsedObjectDefinition[] {
  return entries
    .map((entry) => parseRoleObject(entry, warnings))
    .filter((item): item is ParsedObjectDefinition => Boolean(item));
}

function parseRoleObject(entry: RoleObjectDefinition, warnings: string[]): ParsedObjectDefinition | null {
  if (typeof entry === 'string') {
    const index = entry.indexOf(':');
    if (index === -1) {
      warnings.push(`Некорректная строка прав: ${entry}`);
      return null;
    }
    const objectName = translateObjectName(entry.slice(0, index).trim());
    const rightsText = entry.slice(index + 1).trim();
    const rightNames = rightsText.startsWith('@')
      ? resolvePreset(getObjectType(objectName), rightsText, warnings)
      : rightsText.split(',').map((item) => translateRightName(item.trim())).filter(Boolean);
    return {
      name: objectName,
      rights: rightNames.map((name) => ({ name, value: 'true' })),
    };
  }
  const objectName = translateObjectName(String(entry.name ?? '').trim());
  if (!objectName) {
    warnings.push('Объект прав без поля name пропущен.');
    return null;
  }
  const rights = new Map<string, ParsedRightDefinition>();
  for (const presetRight of entry.preset ? resolvePreset(getObjectType(objectName), entry.preset, warnings) : []) {
    rights.set(presetRight, { name: presetRight, value: 'true' });
  }
  if (Array.isArray(entry.rights)) {
    for (const item of entry.rights) {
      const rightName = translateRightName(item);
      rights.set(rightName, { name: rightName, value: 'true' });
    }
  } else if (entry.rights) {
    for (const [rawName, value] of Object.entries(entry.rights)) {
      const rightName = translateRightName(rawName);
      rights.set(rightName, { name: rightName, value: value ? 'true' : 'false' });
    }
  }
  for (const [rawName, condition] of Object.entries(entry.rls ?? {})) {
    const rightName = translateRightName(rawName);
    const existing = rights.get(rightName);
    if (!existing) {
      warnings.push(`${objectName}: RLS задано для отсутствующего права ${rightName}.`);
      continue;
    }
    rights.set(rightName, { ...existing, condition });
  }
  return { name: objectName, rights: [...rights.values()] };
}

function resolvePreset(objectType: string, rawPreset: string, warnings: string[]): string[] {
  const preset = rawPreset.replace(/^@/, '');
  const rights = PRESETS[preset]?.[objectType];
  if (!rights) {
    warnings.push(`Пресет @${preset} не определён для типа ${objectType}.`);
    return [];
  }
  return [...rights];
}

function translateObjectName(name: string): string {
  return name.split('.').map((part) => TYPE_ALIASES[part] ?? part).join('.');
}

function translateRightName(name: string): string {
  return RIGHT_ALIASES[name] ?? name;
}

function getObjectType(objectName: string): string {
  return objectName.split('.')[0] ?? objectName;
}

function isNestedObject(objectName: string): boolean {
  return objectName.split('.').length >= 3;
}

function buildRoleMetadataXml(definition: RoleDefinition, formatVersion: string): string {
  const synonym = definition.synonym || definition.name;
  const comment = definition.comment ?? '';
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" xmlns:v8="http://v8.1c.ru/8.1/data/core" xmlns:xr="http://v8.1c.ru/8.3/xcf/readable" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" version="' + escapeXml(formatVersion) + '">',
    `\t<Role uuid="${crypto.randomUUID()}">`,
    '\t\t<Properties>',
    `\t\t\t<Name>${escapeXml(definition.name)}</Name>`,
    '\t\t\t<Synonym>',
    '\t\t\t\t<v8:item>',
    '\t\t\t\t\t<v8:lang>ru</v8:lang>',
    `\t\t\t\t\t<v8:content>${escapeXml(synonym)}</v8:content>`,
    '\t\t\t\t</v8:item>',
    '\t\t\t</Synonym>',
    comment ? `\t\t\t<Comment>${escapeXml(comment)}</Comment>` : '\t\t\t<Comment/>',
    '\t\t</Properties>',
    '\t</Role>',
    '</MetaDataObject>',
    '',
  ].join('\n');
}

function buildRightsXml(
  definition: RoleDefinition,
  objects: readonly ParsedObjectDefinition[],
  formatVersion: string
): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<Rights xmlns="${RIGHTS_NS}" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="Rights" version="${escapeXml(formatVersion)}">`,
    `\t<setForNewObjects>${String(definition.setForNewObjects ?? false)}</setForNewObjects>`,
    `\t<setForAttributesByDefault>${String(definition.setForAttributesByDefault ?? true)}</setForAttributesByDefault>`,
    `\t<independentRightsOfChildObjects>${String(definition.independentRightsOfChildObjects ?? false)}</independentRightsOfChildObjects>`,
  ];
  for (const object of objects) {
    lines.push('\t<object>', `\t\t<name>${escapeXml(object.name)}</name>`);
    for (const right of object.rights) {
      lines.push('\t\t<right>', `\t\t\t<name>${escapeXml(right.name)}</name>`, `\t\t\t<value>${right.value}</value>`);
      if (right.condition) {
        lines.push('\t\t\t<restrictionByCondition>', `\t\t\t\t<condition>${escapeXml(right.condition)}</condition>`, '\t\t\t</restrictionByCondition>');
      }
      lines.push('\t\t</right>');
    }
    lines.push('\t</object>');
  }
  for (const template of definition.templates ?? []) {
    lines.push(
      '\t<restrictionTemplate>',
      `\t\t<name>${escapeXml(template.name)}</name>`,
      `\t\t<condition>${escapeXml(template.condition)}</condition>`,
      '\t</restrictionTemplate>'
    );
  }
  lines.push('</Rights>', '');
  return lines.join('\n');
}

function detectFormatVersion(configDir: string): string {
  const configXmlPath = path.join(configDir, 'Configuration.xml');
  if (!fs.existsSync(configXmlPath)) {
    return DEFAULT_FORMAT_VERSION;
  }
  const version = /<MetaDataObject\b[^>]*version="([^"]+)"/.exec(fs.readFileSync(configXmlPath, 'utf-8'))?.[1];
  return version ?? DEFAULT_FORMAT_VERSION;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeTextSearch(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function asArray<T>(value: T | readonly T[] | undefined): readonly T[] {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value as readonly T[] : [value as T];
}
