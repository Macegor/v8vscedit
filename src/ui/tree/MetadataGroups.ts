import { NodeKind } from './TreeNode';

/** Описание группы объектов верхнего уровня */
export interface MetaGroup {
  label: string;
  types: string[];
  kind: NodeKind;
  isCommon?: boolean;
  /**
   * Несколько типов ChildObjects в одной ветке дерева (порядок в `types` сохраняется),
   * например нумераторы и последовательности внутри «Документы».
   */
  mergeTypes?: boolean;
}

/** Типы в группе «Общие» (порядок как в конфигураторе 1С) */
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
  'Bot',
  'FunctionalOption',
  'FunctionalOptionsParameter',
  'DefinedType',
  'SettingsStorage',
  'CommonCommand',
  'CommandGroup',
  'CommonForm',
  'CommonTemplate',
  'CommonPicture',
  'XDTOPackage',
  'WebService',
  'HTTPService',
  'WSReference',
  'WebSocketClient',
  'IntegrationService',
  'PaletteColor',
  'StyleItem',
  'Style',
  'Language',
];

/** Порядок групп верхнего уровня (без «Общие») — как в дереве метаданных конфигуратора */
export const TOP_GROUPS: MetaGroup[] = [
  { label: 'Константы', types: ['Constant'], kind: 'Constant' },
  { label: 'Справочники', types: ['Catalog'], kind: 'Catalog' },
  {
    label: 'Документы',
    types: ['DocumentNumerator', 'Sequence', 'Document'],
    kind: 'Document',
    mergeTypes: true,
  },
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
  { label: 'Внешние источники данных', types: ['ExternalDataSource'], kind: 'ExternalDataSource' },
];

/** Подгруппы внутри «Общие» — порядок как в дереве метаданных конфигуратора */
export const COMMON_SUBGROUPS: MetaGroup[] = [
  { label: 'Подсистемы', types: ['Subsystem'], kind: 'Subsystem' },
  { label: 'Общие модули', types: ['CommonModule'], kind: 'CommonModule' },
  { label: 'Параметры сеанса', types: ['SessionParameter'], kind: 'SessionParameter' },
  { label: 'Роли', types: ['Role'], kind: 'Role' },
  { label: 'Общие реквизиты', types: ['CommonAttribute'], kind: 'CommonAttribute' },
  { label: 'Планы обмена', types: ['ExchangePlan'], kind: 'ExchangePlan' },
  { label: 'Критерии отбора', types: ['FilterCriterion'], kind: 'FilterCriterion' },
  { label: 'Подписки на события', types: ['EventSubscription'], kind: 'EventSubscription' },
  { label: 'Регламентные задания', types: ['ScheduledJob'], kind: 'ScheduledJob' },
  { label: 'Боты', types: ['Bot'], kind: 'Bot' },
  { label: 'Функциональные опции', types: ['FunctionalOption'], kind: 'FunctionalOption' },
  {
    label: 'Параметры функциональных опций',
    types: ['FunctionalOptionsParameter'],
    kind: 'FunctionalOptionsParameter',
  },
  { label: 'Определяемые типы', types: ['DefinedType'], kind: 'DefinedType' },
  { label: 'Хранилища настроек', types: ['SettingsStorage'], kind: 'SettingsStorage' },
  { label: 'Общие команды', types: ['CommonCommand'], kind: 'CommonCommand' },
  { label: 'Группы команд', types: ['CommandGroup'], kind: 'CommandGroup' },
  { label: 'Общие формы', types: ['CommonForm'], kind: 'CommonForm' },
  { label: 'Общие макеты', types: ['CommonTemplate'], kind: 'CommonTemplate' },
  { label: 'Общие картинки', types: ['CommonPicture'], kind: 'CommonPicture' },
  { label: 'XDTO-пакеты', types: ['XDTOPackage'], kind: 'XDTOPackage' },
  { label: 'Web-сервисы', types: ['WebService'], kind: 'WebService' },
  { label: 'HTTP-сервисы', types: ['HTTPService'], kind: 'HTTPService' },
  { label: 'WS-ссылки', types: ['WSReference'], kind: 'WSReference' },
  { label: 'WebSocket-клиенты', types: ['WebSocketClient'], kind: 'WebSocketClient' },
  { label: 'Сервисы интеграции', types: ['IntegrationService'], kind: 'IntegrationService' },
  { label: 'Цвета палитры', types: ['PaletteColor'], kind: 'PaletteColor' },
  { label: 'Элементы стиля', types: ['StyleItem'], kind: 'StyleItem' },
  { label: 'Стили', types: ['Style'], kind: 'Style' },
  { label: 'Языки', types: ['Language'], kind: 'Language' },
];
