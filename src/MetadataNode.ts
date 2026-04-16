import * as vscode from 'vscode';

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

/** Человекочитаемые названия типов узлов для UI */
const NODE_KIND_LABELS: Record<NodeKind, string> = {
  configuration: 'Конфигурация',
  extension: 'Расширение',
  'group-common': 'Группа "Общие"',
  'group-type': 'Группа объектов',
  Subsystem: 'Подсистема',
  CommonModule: 'Общий модуль',
  Role: 'Роль',
  CommonForm: 'Общая форма',
  CommonCommand: 'Общая команда',
  CommonPicture: 'Общая картинка',
  StyleItem: 'Стилевое оформление',
  DefinedType: 'Определяемый тип',
  Constant: 'Константа',
  Catalog: 'Справочник',
  Document: 'Документ',
  Enum: 'Перечисление',
  InformationRegister: 'Регистр сведений',
  AccumulationRegister: 'Регистр накопления',
  AccountingRegister: 'Регистр бухгалтерии',
  CalculationRegister: 'Регистр расчета',
  Report: 'Отчет',
  DataProcessor: 'Обработка',
  BusinessProcess: 'Бизнес-процесс',
  Task: 'Задача',
  ExchangePlan: 'План обмена',
  ChartOfCharacteristicTypes: 'План видов характеристик',
  ChartOfAccounts: 'План счетов',
  ChartOfCalculationTypes: 'План видов расчета',
  DocumentJournal: 'Журнал документов',
  ScheduledJob: 'Регламентное задание',
  EventSubscription: 'Подписка на события',
  HTTPService: 'HTTP-сервис',
  WebService: 'Web-сервис',
  FilterCriterion: 'Критерий отбора',
  Sequence: 'Последовательность',
  SessionParameter: 'Параметр сеанса',
  FunctionalOption: 'Функциональная опция',
  Language: 'Язык',
  Attribute: 'Реквизит',
  TabularSection: 'Табличная часть',
  Column: 'Колонка',
  Form: 'Форма',
  Command: 'Команда',
  Template: 'Макет',
  Dimension: 'Измерение',
  Resource: 'Ресурс',
  EnumValue: 'Значение перечисления',
};

/** Возвращает человекочитаемое имя типа узла */
export function getNodeKindLabel(nodeKind: NodeKind): string {
  return NODE_KIND_LABELS[nodeKind] ?? nodeKind;
}

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
    public readonly ownershipTag?: 'OWN' | 'BORROWED',
    /** Скрывать ли команду "Свойства" в контекстном меню */
    public readonly hidePropertiesCommand?: boolean
  ) {
    super(label, collapsibleState);
    // Суффикс -hasXml позволяет фильтровать пункты контекстного меню
    const baseContextValue = xmlPath ? `${nodeKind}-hasXml` : nodeKind;
    this.contextValue = hidePropertiesCommand
      ? `${baseContextValue}-propertiesHidden`
      : baseContextValue;

    if (ownershipTag) {
      this.description = ownershipTag === 'OWN' ? '[свой]' : '[заим.]';
    }
  }
}
