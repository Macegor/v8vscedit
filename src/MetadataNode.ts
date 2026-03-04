import * as vscode from 'vscode';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Типы узлов
// ---------------------------------------------------------------------------

export type NodeKind =
  // Корневые
  | 'configuration'
  | 'extension'
  // Группы верхнего уровня
  | 'group-common'
  | 'group-type'
  // Типы объектов (группа + иконка)
  | 'Subsystem'
  | 'CommonModule'
  | 'Role'
  | 'CommonForm'
  | 'CommonCommand'
  | 'CommonPicture'
  | 'StyleItem'
  | 'DefinedType'
  | 'Constant'
  | 'Catalog'
  | 'Document'
  | 'Enum'
  | 'InformationRegister'
  | 'AccumulationRegister'
  | 'AccountingRegister'
  | 'CalculationRegister'
  | 'Report'
  | 'DataProcessor'
  | 'BusinessProcess'
  | 'Task'
  | 'ExchangePlan'
  | 'ChartOfCharacteristicTypes'
  | 'ChartOfAccounts'
  | 'ChartOfCalculationTypes'
  | 'DocumentJournal'
  | 'ScheduledJob'
  | 'EventSubscription'
  | 'HTTPService'
  | 'WebService'
  | 'FilterCriterion'
  | 'Sequence'
  | 'SessionParameter'
  | 'FunctionalOption'
  | 'Language'
  // Дочерние элементы
  | 'Attribute'
  | 'TabularSection'
  | 'Column'
  | 'Form'
  | 'Command'
  | 'Template'
  | 'Dimension'
  | 'Resource'
  | 'EnumValue';

/** Узел дерева метаданных */
export class MetadataNode extends vscode.TreeItem {
  constructor(
    /** Отображаемая метка */
    public readonly label: string,
    /** Тип узла */
    public readonly nodeKind: NodeKind,
    /** Состояние раскрытия */
    collapsibleState: vscode.TreeItemCollapsibleState,
    /** Путь к XML-файлу (для открытия по клику) */
    public readonly xmlPath?: string,
    /** Функция ленивой загрузки дочерних узлов */
    public readonly childrenLoader?: () => MetadataNode[],
    /** Тег объекта расширения: [OWN] / [BORROWED] */
    public readonly ownershipTag?: 'OWN' | 'BORROWED'
  ) {
    super(label, collapsibleState);
    // Суффикс -hasXml позволяет фильтровать пункты контекстного меню
    this.contextValue = xmlPath ? `${nodeKind}-hasXml` : nodeKind;

    if (ownershipTag) {
      this.description = ownershipTag === 'OWN' ? '[свой]' : '[заим.]';
    }
  }
}

// ---------------------------------------------------------------------------
// Иконки
// ---------------------------------------------------------------------------

/** Возвращает путь к SVG-иконке для заданного типа узла */
export function getIconPath(
  nodeKind: NodeKind,
  extensionUri: vscode.Uri
): vscode.Uri {
  const iconMap: Partial<Record<NodeKind, string>> = {
    configuration: 'configuration.svg',
    extension: 'extension.svg',
    'group-common': 'folder-common.svg',
    'group-type': 'folder-type.svg',
    Subsystem: 'subsystem.svg',
    CommonModule: 'common-module.svg',
    Role: 'role.svg',
    CommonForm: 'common-form.svg',
    CommonCommand: 'common-command.svg',
    CommonPicture: 'common-picture.svg',
    StyleItem: 'style-item.svg',
    DefinedType: 'defined-type.svg',
    Constant: 'constant.svg',
    Catalog: 'catalog.svg',
    Document: 'document.svg',
    Enum: 'enum.svg',
    InformationRegister: 'information-register.svg',
    AccumulationRegister: 'accumulation-register.svg',
    AccountingRegister: 'accounting-register.svg',
    CalculationRegister: 'calculation-register.svg',
    Report: 'report.svg',
    DataProcessor: 'data-processor.svg',
    BusinessProcess: 'business-process.svg',
    Task: 'task.svg',
    ExchangePlan: 'exchange-plan.svg',
    ChartOfCharacteristicTypes: 'chart-of-characteristic-types.svg',
    ChartOfAccounts: 'chart-of-accounts.svg',
    ChartOfCalculationTypes: 'chart-of-calculation-types.svg',
    DocumentJournal: 'document-journal.svg',
    ScheduledJob: 'scheduled-job.svg',
    EventSubscription: 'event-subscription.svg',
    HTTPService: 'http-service.svg',
    WebService: 'web-service.svg',
    FilterCriterion: 'filter-criterion.svg',
    Sequence: 'sequence.svg',
    SessionParameter: 'session-parameter.svg',
    FunctionalOption: 'functional-option.svg',
    Language: 'language.svg',
    Attribute: 'attribute.svg',
    TabularSection: 'tabular-section.svg',
    Column: 'attribute.svg',
    Form: 'form.svg',
    Command: 'command.svg',
    Template: 'template.svg',
    Dimension: 'dimension.svg',
    Resource: 'resource.svg',
    EnumValue: 'enum-value.svg',
  };

  const fileName = iconMap[nodeKind] ?? 'attribute.svg';
  return vscode.Uri.joinPath(extensionUri, 'src', 'icons', fileName);
}
