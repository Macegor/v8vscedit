import { NodeKind } from './MetadataNode';

/** Описание группы объектов верхнего уровня */
export interface MetaGroup {
  label: string;
  types: string[];
  kind: NodeKind;
  isCommon?: boolean;
}

/** Типы в группе "Общие" */
export const COMMON_TYPES: string[] = [
  'Subsystem',
  'CommonModule',
  'SessionParameter',
  'Role',
  'CommonAttribute',
  'ExchangePlan',
  'FilterCriterion',
  'EventSubscription',
  'ScheduledJob',
  'FunctionalOption',
  'FunctionalOptionsParameter',
  'DefinedType',
  'CommonCommand',
  'CommandGroup',
  'CommonForm',
  'CommonTemplate',
  'CommonPicture',
  'StyleItem',
  'Language',
  'XDTOPackage',
  'Interface',
  'WSReference',
  'WebService',
  'HTTPService',
];

/** Порядок групп верхнего уровня (без группы Общие) */
export const TOP_GROUPS: MetaGroup[] = [
  { label: 'Константы', types: ['Constant'], kind: 'Constant' },
  { label: 'Критерии отбора', types: ['FilterCriterion'], kind: 'FilterCriterion' },
  { label: 'Подписки на события', types: ['EventSubscription'], kind: 'EventSubscription' },
  { label: 'Регламентные задания', types: ['ScheduledJob'], kind: 'ScheduledJob' },
  { label: 'Последовательности', types: ['Sequence'], kind: 'Sequence' },
  { label: 'Справочники', types: ['Catalog'], kind: 'Catalog' },
  { label: 'Документы', types: ['Document'], kind: 'Document' },
  { label: 'Журналы документов', types: ['DocumentJournal'], kind: 'DocumentJournal' },
  { label: 'Перечисления', types: ['Enum'], kind: 'Enum' },
  { label: 'Отчёты', types: ['Report'], kind: 'Report' },
  { label: 'Обработки', types: ['DataProcessor'], kind: 'DataProcessor' },
  {
    label: 'Планы видов характеристик',
    types: ['ChartOfCharacteristicTypes'],
    kind: 'ChartOfCharacteristicTypes',
  },
  { label: 'Планы счетов', types: ['ChartOfAccounts'], kind: 'ChartOfAccounts' },
  { label: 'Планы видов расчёта', types: ['ChartOfCalculationTypes'], kind: 'ChartOfCalculationTypes' },
  { label: 'Регистры сведений', types: ['InformationRegister'], kind: 'InformationRegister' },
  { label: 'Регистры накопления', types: ['AccumulationRegister'], kind: 'AccumulationRegister' },
  { label: 'Регистры бухгалтерии', types: ['AccountingRegister'], kind: 'AccountingRegister' },
  { label: 'Регистры расчёта', types: ['CalculationRegister'], kind: 'CalculationRegister' },
  { label: 'Бизнес-процессы', types: ['BusinessProcess'], kind: 'BusinessProcess' },
  { label: 'Задачи', types: ['Task'], kind: 'Task' },
  { label: 'Планы обмена', types: ['ExchangePlan'], kind: 'ExchangePlan' },
];

/** Подгруппы внутри "Общие" */
export const COMMON_SUBGROUPS: MetaGroup[] = [
  { label: 'Подсистемы', types: ['Subsystem'], kind: 'Subsystem' },
  { label: 'Общие модули', types: ['CommonModule'], kind: 'CommonModule' },
  { label: 'Параметры сеанса', types: ['SessionParameter'], kind: 'SessionParameter' },
  { label: 'Роли', types: ['Role'], kind: 'Role' },
  { label: 'Общие реквизиты', types: ['CommonAttribute'], kind: 'CommonAttribute' },
  { label: 'Определяемые типы', types: ['DefinedType'], kind: 'DefinedType' },
  { label: 'Общие команды', types: ['CommonCommand'], kind: 'CommonCommand' },
  { label: 'Группы команд', types: ['CommandGroup'], kind: 'CommonCommand' },
  { label: 'Общие формы', types: ['CommonForm'], kind: 'CommonForm' },
  { label: 'Общие макеты', types: ['CommonTemplate'], kind: 'Template' },
  { label: 'Общие картинки', types: ['CommonPicture'], kind: 'CommonPicture' },
  { label: 'Стилевые оформления', types: ['StyleItem'], kind: 'StyleItem' },
  { label: 'Языки', types: ['Language'], kind: 'Language' },
  { label: 'Пакеты XDTO', types: ['XDTOPackage'], kind: 'CommonModule' },
  { label: 'Web-сервисы', types: ['WebService'], kind: 'WebService' },
  { label: 'HTTP-сервисы', types: ['HTTPService'], kind: 'HTTPService' },
  { label: 'Внешние источники данных', types: ['ExternalDataSource'], kind: 'CommonModule' },
];

