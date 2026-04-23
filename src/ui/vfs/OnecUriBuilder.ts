import * as path from 'path';
import * as vscode from 'vscode';
import { getObjectLocationFromXml } from '../../infra/fs/MetaPathResolver';
import { ONEC_SCHEME } from './OnecFileSystemProvider';

/** Русские названия папок объектов метаданных */
const FOLDER_RU: Record<string, string> = {
  CommonModules: 'Общие модули',
  Catalogs: 'Справочники',
  Documents: 'Документы',
  DataProcessors: 'Обработки',
  Reports: 'Отчёты',
  InformationRegisters: 'Регистры сведений',
  AccumulationRegisters: 'Регистры накопления',
  AccountingRegisters: 'Регистры бухгалтерии',
  CalculationRegisters: 'Регистры расчёта',
  BusinessProcesses: 'Бизнес-процессы',
  Tasks: 'Задачи',
  ExchangePlans: 'Планы обмена',
  ChartsOfCharacteristicTypes: 'Планы видов характеристик',
  ChartsOfAccounts: 'Планы счетов',
  ChartsOfCalculationTypes: 'Планы видов расчёта',
  CommonForms: 'Общие формы',
  CommonCommands: 'Общие команды',
  Constants: 'Константы',
  Enums: 'Перечисления',
  DocumentJournals: 'Журналы документов',
  HTTPServices: 'HTTP-сервисы',
  WebServices: 'Web-сервисы',
};

/** Тип модуля для формирования читаемого имени файла */
export type ModuleType =
  | 'module'
  | 'objectModule'
  | 'managerModule'
  | 'valueManagerModule'
  | 'commandModule';

const MODULE_LABEL: Record<ModuleType, string> = {
  module: 'Модуль',
  objectModule: 'Модуль объекта',
  managerModule: 'Модуль менеджера',
  valueManagerModule: 'Модуль менеджера значения',
  commandModule: 'Модуль команды',
};

/**
 * Типы, для которых объект имеет единственный модуль —
 * финальный сегмент типа в URI не нужен, объект идентифицируется по имени.
 */
const UNIQUE_MODULE_TYPES = new Set<ModuleType>(['module', 'valueManagerModule', 'commandModule']);

/**
 * Строит виртуальный URI для BSL-модуля объекта метаданных.
 *
 * Результирующий путь:
 *   onec://<папкаКонфига>/<КатегорияRu>/<ИмяОбъекта>/<МодульRu>.bsl
 *
 * Хлебные крошки покажут:
 *   <папкаКонфига> > <КатегорияRu> > <ИмяОбъекта> > <МодульRu>
 */
export function buildVirtualUri(xmlPath: string, moduleType: ModuleType): vscode.Uri {
  const loc = getObjectLocationFromXml(xmlPath);
  const configName = path.basename(loc.configRoot);
  const categoryRu = FOLDER_RU[loc.folderName] ?? loc.folderName;
  const moduleLabel = MODULE_LABEL[moduleType];

  // Для уникальных типов модулей объект идентифицируется по имени — тип в пути лишний
  const pathSuffix = UNIQUE_MODULE_TYPES.has(moduleType)
    ? `/${categoryRu}/${loc.objectName}`
    : `/${categoryRu}/${loc.objectName}/${moduleLabel}`;

  return vscode.Uri.from({
    scheme: ONEC_SCHEME,
    authority: configName,
    path: pathSuffix,
  });
}

/**
 * Строит виртуальный URI для модуля формы объекта метаданных.
 *
 * Результирующий путь:
 *   onec://<папкаКонфига>/<КатегорияRu>/<ИмяОбъекта>/<ИмяФормы>/Модуль
 */
export function buildFormModuleVirtualUri(xmlPath: string, formName: string): vscode.Uri {
  const loc = getObjectLocationFromXml(xmlPath);
  const configName = path.basename(loc.configRoot);
  const categoryRu = FOLDER_RU[loc.folderName] ?? loc.folderName;

  return vscode.Uri.from({
    scheme: ONEC_SCHEME,
    authority: configName,
    path: `/${categoryRu}/${loc.objectName}/${formName}/Модуль`,
  });
}
