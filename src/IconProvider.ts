import * as vscode from 'vscode';
import { NodeKind } from './MetadataNode';

/**
 * Маппинг NodeKind → имя файла иконки (без расширения) из zerobig/vscode-1c-metadata-viewer.
 * Для каждой иконки существуют варианты:
 *   src/icons/light/<name>.svg        — для светлой темы
 *   src/icons/dark/<name>.svg         — для тёмной темы
 *   src/icons/light/<name>-borrowed.svg — заимствованный объект, светлая тема
 *   src/icons/dark/<name>-borrowed.svg  — заимствованный объект, тёмная тема
 */
const ICON_MAP: Record<NodeKind, string> = {
  // Корневые — configuration = набор настроек, extension = объект с правками
  configuration:                   'common',
  extension:                       'editObject',
  // Группы
  'group-common':                  'common',
  'group-type':                    'folder',
  // Объекты конфигурации
  Subsystem:                       'subsystem',
  CommonModule:                    'commonModule',
  SessionParameter:                'sessionParameter',
  Role:                            'role',
  CommonForm:                      'form',
  CommonCommand:                   'command',
  CommonPicture:                   'picture',
  StyleItem:                       'style',
  DefinedType:                     'attribute',
  Constant:                        'constant',
  Catalog:                         'catalog',
  Document:                        'document',
  Enum:                            'enum',
  InformationRegister:             'informationRegister',
  AccumulationRegister:            'accumulationRegister',
  AccountingRegister:              'accountingRegister',
  CalculationRegister:             'calculationRegister',
  Report:                          'report',
  DataProcessor:                   'dataProcessor',
  BusinessProcess:                 'businessProcess',
  Task:                            'task',
  ExchangePlan:                    'exchangePlan',
  ChartOfCharacteristicTypes:      'chartsOfCharacteristicType',
  ChartOfAccounts:                 'chartsOfAccount',
  ChartOfCalculationTypes:         'chartsOfCalculationType',
  DocumentJournal:                 'documentJournal',
  ScheduledJob:                    'scheduledJob',
  EventSubscription:               'eventSubscription',
  HTTPService:                     'http',
  WebService:                      'ws',
  FilterCriterion:                 'filterCriteria',
  Sequence:                        'sequence',
  FunctionalOption:                'attribute',
  Language:                        'attribute',
  // Дочерние элементы
  Attribute:                       'attribute',
  TabularSection:                  'tabularSection',
  Column:                          'column',
  Form:                            'form',
  Command:                         'command',
  Template:                        'template',
  Dimension:                       'dimension',
  Resource:                        'resource',
  EnumValue:                       'attribute',
};

/**
 * Возвращает пару { light, dark } путей к SVG-иконке.
 * Для заимствованных объектов расширения (ownershipTag === 'BORROWED')
 * используется вариант *-borrowed.svg с жёлтой точкой.
 */
export function getIconPath(
  nodeKind: NodeKind,
  ownershipTag: 'OWN' | 'BORROWED' | undefined,
  extensionUri: vscode.Uri
): { light: vscode.Uri; dark: vscode.Uri } {
  const base = ICON_MAP[nodeKind] ?? 'attribute';
  const name = ownershipTag === 'BORROWED' ? `${base}-borrowed` : base;

  return {
    light: vscode.Uri.joinPath(extensionUri, 'src', 'icons', 'light', `${name}.svg`),
    dark:  vscode.Uri.joinPath(extensionUri, 'src', 'icons', 'dark',  `${name}.svg`),
  };
}
