import * as path from 'path';
import * as fs from 'fs';
import { MetadataNode, NodeKind } from './MetadataNode';

interface NodeContext {
  nodeKind: NodeKind | string | undefined;
  xmlPath: string;
  label: string;
}

function toContext(node: MetadataNode | { xmlPath?: string; nodeKind?: string; label?: string }): NodeContext | null {
  if (!node || !('xmlPath' in node) || !node.xmlPath) {
    return null;
  }

  const rawKind = 'nodeKind' in node ? (node as any).nodeKind : undefined;
  const rawLabel = 'label' in node ? String((node as any).label) : '';

  return {
    nodeKind: rawKind,
    xmlPath: node.xmlPath,
    label: rawLabel,
  };
}

interface ObjectLocation {
  configRoot: string;
  folderName: string;
  objectName: string;
  objectDir: string;
}

/**
 * Возвращает путь к XML-файлу объекта по каталогу конфигурации, типу и имени.
 * Например: Documents/ев_Заказ/ев_Заказ.xml или Documents/ев_Заказ.xml
 */
export function resolveObjectXmlPath(
  configRoot: string,
  objectType: string,
  objectName: string
): string | null {
  const typeToFolder: Record<string, string> = {
    Catalog: 'Catalogs',
    Document: 'Documents',
    DocumentNumerator: 'DocumentNumerators',
    Enum: 'Enums',
    InformationRegister: 'InformationRegisters',
    AccumulationRegister: 'AccumulationRegisters',
    AccountingRegister: 'AccountingRegisters',
    CalculationRegister: 'CalculationRegisters',
    Report: 'Reports',
    DataProcessor: 'DataProcessors',
    BusinessProcess: 'BusinessProcesses',
    Task: 'Tasks',
    ExchangePlan: 'ExchangePlans',
    ChartOfCharacteristicTypes: 'ChartsOfCharacteristicTypes',
    ChartOfAccounts: 'ChartsOfAccounts',
    ChartOfCalculationTypes: 'ChartsOfCalculationTypes',
    DocumentJournal: 'DocumentJournals',
    Constant: 'Constants',
    CommonModule: 'CommonModules',
    Role: 'Roles',
    CommonForm: 'CommonForms',
    CommonCommand: 'CommonCommands',
    CommandGroup: 'CommandGroups',
    CommonPicture: 'CommonPictures',
    CommonTemplate: 'CommonTemplates',
    StyleItem: 'StyleItems',
    DefinedType: 'DefinedTypes',
    Subsystem: 'Subsystems',
    ScheduledJob: 'ScheduledJobs',
    EventSubscription: 'EventSubscriptions',
    HTTPService: 'HTTPServices',
    WebService: 'WebServices',
    Language: 'Languages',
    FilterCriterion: 'FilterCriteria',
    Sequence: 'Sequences',
    SessionParameter: 'SessionParameters',
    CommonAttribute: 'CommonAttributes',
    FunctionalOption: 'FunctionalOptions',
    FunctionalOptionsParameter: 'FunctionalOptionsParameters',
    XDTOPackage: 'XDTOPackages',
    Interface: 'Interfaces',
    ExternalDataSource: 'ExternalDataSources',
    SettingsStorage: 'SettingsStorages',
    Style: 'Styles',
    WSReference: 'WSReferences',
    WebSocketClient: 'WebSocketClients',
    IntegrationService: 'IntegrationServices',
    Bot: 'Bots',
  };

  const folder = typeToFolder[objectType];
  if (!folder) {
    return null;
  }

  const deepPath = path.join(configRoot, folder, objectName, `${objectName}.xml`);
  if (fs.existsSync(deepPath)) {
    return deepPath;
  }

  const flatPath = path.join(configRoot, folder, `${objectName}.xml`);
  if (fs.existsSync(flatPath)) {
    return flatPath;
  }

  return null;
}

/** Возвращает корень конфигурации, имя папки, имя объекта и каталог объекта по пути XML */
export function getObjectLocationFromXml(xmlPath: string): ObjectLocation {
  const normalized = path.normalize(xmlPath);
  const fileName = path.basename(normalized, '.xml');
  const xmlDir = path.dirname(normalized);
  const parentName = path.basename(xmlDir);

  // Глубокая структура: <Root>/<Folder>/<Name>/<Name>.xml
  const isDeep = parentName === fileName;

  if (isDeep) {
    const folderDir = path.dirname(xmlDir);
    const configRoot = path.dirname(folderDir);
    const folderName = path.basename(folderDir);
    const objectDir = xmlDir;

    return {
      configRoot,
      folderName,
      objectName: fileName,
      objectDir,
    };
  }

  // Плоская структура: <Root>/<Folder>/<Name>.xml
  const folderDir = xmlDir;
  const configRoot = path.dirname(folderDir);
  const folderName = path.basename(folderDir);
  const objectDir = path.join(folderDir, fileName);

  return {
    configRoot,
    folderName,
    objectName: fileName,
    objectDir,
  };
}

function firstExisting(candidates: string[]): string | null {
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return null;
}

export function getObjectModulePath(node: MetadataNode | { xmlPath?: string; nodeKind?: string; label?: string }): string | null {
  const ctx = toContext(node);
  if (!ctx) {
    return null;
  }

  const location = getObjectLocationFromXml(ctx.xmlPath);
  const extDir = path.join(location.objectDir, 'Ext');
  const candidates = [path.join(extDir, 'ObjectModule.bsl')];

  return firstExisting(candidates);
}

export function getManagerModulePath(node: MetadataNode | { xmlPath?: string; nodeKind?: string; label?: string }): string | null {
  const ctx = toContext(node);
  if (!ctx) {
    return null;
  }

  const location = getObjectLocationFromXml(ctx.xmlPath);
  const extDir = path.join(location.objectDir, 'Ext');
  const candidates = [path.join(extDir, 'ManagerModule.bsl')];

  return firstExisting(candidates);
}

export function getConstantModulePath(node: MetadataNode | { xmlPath?: string; nodeKind?: string; label?: string }): string | null {
  const ctx = toContext(node);
  if (!ctx) {
    return null;
  }

  const location = getObjectLocationFromXml(ctx.xmlPath);
  const extDir = path.join(location.objectDir, 'Ext');
  const candidates = [path.join(extDir, 'ValueManagerModule.bsl')];

  return firstExisting(candidates);
}

export function getServiceModulePath(node: MetadataNode | { xmlPath?: string; nodeKind?: string; label?: string }): string | null {
  const ctx = toContext(node);
  if (!ctx) {
    return null;
  }

  const location = getObjectLocationFromXml(ctx.xmlPath);
  const extDir = path.join(location.objectDir, 'Ext');
  const candidates = [path.join(extDir, 'Module.bsl')];

  return firstExisting(candidates);
}

export function getCommonFormModulePath(node: MetadataNode | { xmlPath?: string; nodeKind?: string; label?: string }): string | null {
  const ctx = toContext(node);
  if (!ctx) {
    return null;
  }

  const location = getObjectLocationFromXml(ctx.xmlPath);
  const extDir = path.join(location.objectDir, 'Ext');
  const candidates = [path.join(extDir, 'Form', 'Module.bsl')];

  return firstExisting(candidates);
}

export function getCommonCommandModulePath(node: MetadataNode | { xmlPath?: string; nodeKind?: string; label?: string }): string | null {
  const ctx = toContext(node);
  if (!ctx) {
    return null;
  }

  const location = getObjectLocationFromXml(ctx.xmlPath);
  const extDir = path.join(location.objectDir, 'Ext');
  const candidates = [path.join(extDir, 'CommandModule.bsl')];

  return firstExisting(candidates);
}

export function getFormModulePathForChild(node: MetadataNode | { xmlPath?: string; nodeKind?: string; label?: string }): string | null {
  const ctx = toContext(node);
  if (!ctx) {
    return null;
  }

  const location = getObjectLocationFromXml(ctx.xmlPath);
  const objectDir = location.objectDir;
  const formName = ctx.label;

  if (!formName) {
    return null;
  }

  const candidates = [
    path.join(objectDir, 'Forms', formName, 'Ext', 'Form', 'Module.bsl'),
    path.join(objectDir, 'Forms', formName, 'Ext', 'Module.bsl'),
  ];

  return firstExisting(candidates);
}

export function getCommandModulePathForChild(node: MetadataNode | { xmlPath?: string; nodeKind?: string; label?: string }): string | null {
  const ctx = toContext(node);
  if (!ctx) {
    return null;
  }

  const location = getObjectLocationFromXml(ctx.xmlPath);
  const objectDir = location.objectDir;
  const commandName = ctx.label;

  if (!commandName) {
    return null;
  }

  const candidates = [
    path.join(objectDir, 'Commands', commandName, 'Ext', 'CommandModule.bsl'),
    path.join(objectDir, 'Commands', commandName, 'Ext', 'Module.bsl'),
  ];

  return firstExisting(candidates);
}

export function getCommonModuleCodePath(node: MetadataNode | { xmlPath?: string; nodeKind?: string; label?: string }): string | null {
  const ctx = toContext(node);
  if (!ctx) {
    return null;
  }

  const location = getObjectLocationFromXml(ctx.xmlPath);
  const extDir = path.join(location.objectDir, 'Ext');
  const candidates = [path.join(extDir, 'Module.bsl')];

  return firstExisting(candidates);
}

/**
 * Возвращает путь к модулю общего модуля и создает его при отсутствии.
 * Используется для сценария, когда после создания объекта есть только XML.
 */
export function ensureCommonModuleCodePath(
  node: MetadataNode | { xmlPath?: string; nodeKind?: string; label?: string }
): string | null {
  const existingPath = getCommonModuleCodePath(node);
  if (existingPath) {
    return existingPath;
  }

  const ctx = toContext(node);
  if (!ctx || !ctx.xmlPath) {
    return null;
  }

  const location = getObjectLocationFromXml(ctx.xmlPath);
  const modulePath = path.join(location.objectDir, 'Ext', 'Module.bsl');

  fs.mkdirSync(path.dirname(modulePath), { recursive: true });
  if (!fs.existsSync(modulePath)) {
    fs.writeFileSync(modulePath, '', { encoding: 'utf-8' });
  }

  return modulePath;
}


