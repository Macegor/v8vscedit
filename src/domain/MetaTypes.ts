/**
 * Единый реестр типов метаданных 1С — центральный источник правды.
 *
 * Здесь описаны ВСЕ типы объектов, поддерживаемые расширением:
 *  - отображение (иконка, лейблы, группа дерева, порядок);
 *  - выгрузка (папка в структуре XML, дочерние теги);
 *  - поведение (слоты BSL-модулей, команда одиночного клика, ключ схемы свойств).
 *
 * Правило: добавление нового типа метаданных — ОДНА запись в этом объекте.
 * Любое расширение функциональности должно читать данные отсюда, а не
 * заводить параллельные словари.
 */
import { ChildTag } from './ChildTag';
import { OpenModuleCommandId } from './ModuleSlot';

/** Группа дерева, в которую попадает тип */
export type MetaGroup =
  /** Корневые виды (сама конфигурация/расширение) */
  | 'root'
  /** Группа «Общие» (подсистемы, общие модули, …) */
  | 'common'
  /** Группа верхнего уровня (справочники, документы, отчёты, …) */
  | 'top'
  /** Подветка группы «Документы» (нумераторы, последовательности) */
  | 'documents-branch'
  /** Служебные группы и дочерние элементы — в дереве формируются контекстно */
  | 'child'
  | 'service';

/** Описание типа метаданных */
export interface MetaTypeDef {
  /** Имя типа в XML-выгрузке (совпадает с тегом в `<ChildObjects>`) */
  kind: MetaKind;
  /** Подпись типа в единственном числе — для заголовка панели свойств */
  label: string;
  /** Подпись во множественном числе — для группы в дереве */
  pluralLabel: string;
  /** Каталог в структуре выгрузки 1С (например `Catalogs`). Отсутствует у служебных типов */
  folder?: string;
  /** Имя SVG без расширения (в `src/icons/{light,dark}/<icon>.svg`) */
  icon: string;
  /** Группа дерева */
  group: MetaGroup;
  /** Порядок в группе (меньше — выше) */
  groupOrder: number;
  /** Дочерние теги, ожидаемые внутри объекта (реквизиты, ТЧ, формы и т.п.) */
  childTags?: readonly ChildTag[];
  /** Команда по одиночному клику по узлу этого типа */
  singleClickCommand?: OpenModuleCommandId;
  /** Ключ схемы свойств в `infra/xml/PropertySchema.ts` */
  propertySchema?: string;
}

/** Все допустимые идентификаторы типов (строковая литералная сумма) */
export type MetaKind =
  // корни
  | 'configuration'
  | 'extension'
  // служебные группы дерева
  | 'group-common'
  | 'group-type'
  | 'NumeratorsBranch'
  | 'SequencesBranch'
  // общие
  | 'Subsystem'
  | 'CommonModule'
  | 'SessionParameter'
  | 'CommonAttribute'
  | 'Role'
  | 'CommonForm'
  | 'CommonCommand'
  | 'CommandGroup'
  | 'CommonPicture'
  | 'CommonTemplate'
  | 'XDTOPackage'
  | 'StyleItem'
  | 'DefinedType'
  | 'FunctionalOption'
  | 'FunctionalOptionsParameter'
  | 'SettingsStorage'
  | 'Style'
  | 'WSReference'
  | 'WebSocketClient'
  | 'IntegrationService'
  | 'Bot'
  | 'Interface'
  | 'PaletteColor'
  | 'Language'
  | 'HTTPService'
  | 'WebService'
  // верхний уровень
  | 'Constant'
  | 'Catalog'
  | 'Document'
  | 'DocumentNumerator'
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
  | 'FilterCriterion'
  | 'Sequence'
  | 'ExternalDataSource'
  // дочерние
  | 'Attribute'
  | 'AddressingAttribute'
  | 'TabularSection'
  | 'Column'
  | 'Form'
  | 'Command'
  | 'Template'
  | 'Dimension'
  | 'Resource'
  | 'EnumValue';

/** Сокращённый конструктор записи для ReadOnly Record */
const def = (d: MetaTypeDef): MetaTypeDef => d;

/**
 * Центральный реестр. Не менять структуру без обновления `AGENTS.md`.
 */
export const META_TYPES: Readonly<Record<MetaKind, MetaTypeDef>> = {
  // ── Корни ─────────────────────────────────────────────────────────────
  configuration: def({
    kind: 'configuration', label: 'Конфигурация', pluralLabel: 'Конфигурации',
    icon: 'common', group: 'root', groupOrder: 0,
  }),
  extension: def({
    kind: 'extension', label: 'Расширение', pluralLabel: 'Расширения',
    icon: 'editObject', group: 'root', groupOrder: 0,
  }),

  // ── Служебные группы ──────────────────────────────────────────────────
  'group-common': def({
    kind: 'group-common', label: 'Группа "Общие"', pluralLabel: 'Общие',
    icon: 'common', group: 'service', groupOrder: 0,
  }),
  'group-type': def({
    kind: 'group-type', label: 'Группа объектов', pluralLabel: 'Группы объектов',
    icon: 'folder', group: 'service', groupOrder: 0,
  }),
  NumeratorsBranch: def({
    kind: 'NumeratorsBranch', label: 'Нумераторы', pluralLabel: 'Нумераторы',
    icon: 'documentNumerator', group: 'documents-branch', groupOrder: 0,
  }),
  SequencesBranch: def({
    kind: 'SequencesBranch', label: 'Последовательности', pluralLabel: 'Последовательности',
    icon: 'sequence', group: 'documents-branch', groupOrder: 1,
  }),

  // ── Общие (порядок как в конфигураторе) ───────────────────────────────
  Subsystem: def({ kind: 'Subsystem', label: 'Подсистема', pluralLabel: 'Подсистемы',
    folder: 'Subsystems', icon: 'subsystem', group: 'common', groupOrder: 10 }),
  CommonModule: def({ kind: 'CommonModule', label: 'Общий модуль', pluralLabel: 'Общие модули',
    folder: 'CommonModules', icon: 'commonModule', group: 'common', groupOrder: 20,
    singleClickCommand: 'openCommonModuleCode' }),
  SessionParameter: def({ kind: 'SessionParameter', label: 'Параметр сеанса', pluralLabel: 'Параметры сеанса',
    folder: 'SessionParameters', icon: 'sessionParameter', group: 'common', groupOrder: 30,
    propertySchema: 'sessionParameter' }),
  Role: def({ kind: 'Role', label: 'Роль', pluralLabel: 'Роли',
    folder: 'Roles', icon: 'role', group: 'common', groupOrder: 40 }),
  CommonAttribute: def({ kind: 'CommonAttribute', label: 'Общий реквизит', pluralLabel: 'Общие реквизиты',
    folder: 'CommonAttributes', icon: 'attribute', group: 'common', groupOrder: 50,
    propertySchema: 'commonAttribute' }),
  ExchangePlan: def({ kind: 'ExchangePlan', label: 'План обмена', pluralLabel: 'Планы обмена',
    folder: 'ExchangePlans', icon: 'exchangePlan', group: 'common', groupOrder: 60,
    childTags: ['Attribute', 'TabularSection', 'Form', 'Command', 'Template'],
    propertySchema: 'exchangePlan' }),
  FilterCriterion: def({ kind: 'FilterCriterion', label: 'Критерий отбора', pluralLabel: 'Критерии отбора',
    folder: 'FilterCriteria', icon: 'filterCriteria', group: 'common', groupOrder: 70 }),
  EventSubscription: def({ kind: 'EventSubscription', label: 'Подписка на события', pluralLabel: 'Подписки на события',
    folder: 'EventSubscriptions', icon: 'eventSubscription', group: 'common', groupOrder: 80 }),
  ScheduledJob: def({ kind: 'ScheduledJob', label: 'Регламентное задание', pluralLabel: 'Регламентные задания',
    folder: 'ScheduledJobs', icon: 'scheduledJob', group: 'common', groupOrder: 90 }),
  Bot: def({ kind: 'Bot', label: 'Бот', pluralLabel: 'Боты',
    folder: 'Bots', icon: 'attribute', group: 'common', groupOrder: 100 }),
  FunctionalOption: def({ kind: 'FunctionalOption', label: 'Функциональная опция', pluralLabel: 'Функциональные опции',
    folder: 'FunctionalOptions', icon: 'attribute', group: 'common', groupOrder: 110 }),
  FunctionalOptionsParameter: def({ kind: 'FunctionalOptionsParameter', label: 'Параметр функциональной опции',
    pluralLabel: 'Параметры функциональных опций',
    folder: 'FunctionalOptionsParameters', icon: 'attribute', group: 'common', groupOrder: 120 }),
  DefinedType: def({ kind: 'DefinedType', label: 'Определяемый тип', pluralLabel: 'Определяемые типы',
    folder: 'DefinedTypes', icon: 'attribute', group: 'common', groupOrder: 130 }),
  SettingsStorage: def({ kind: 'SettingsStorage', label: 'Хранилище настроек', pluralLabel: 'Хранилища настроек',
    folder: 'SettingsStorages', icon: 'attribute', group: 'common', groupOrder: 140 }),
  CommonCommand: def({ kind: 'CommonCommand', label: 'Общая команда', pluralLabel: 'Общие команды',
    folder: 'CommonCommands', icon: 'command', group: 'common', groupOrder: 150,
    singleClickCommand: 'openCommandModule' }),
  CommandGroup: def({ kind: 'CommandGroup', label: 'Группа команд', pluralLabel: 'Группы команд',
    folder: 'CommandGroups', icon: 'command', group: 'common', groupOrder: 160 }),
  CommonForm: def({ kind: 'CommonForm', label: 'Общая форма', pluralLabel: 'Общие формы',
    folder: 'CommonForms', icon: 'form', group: 'common', groupOrder: 170,
    singleClickCommand: 'openFormModule' }),
  CommonTemplate: def({ kind: 'CommonTemplate', label: 'Общий макет', pluralLabel: 'Общие макеты',
    folder: 'CommonTemplates', icon: 'template', group: 'common', groupOrder: 180 }),
  CommonPicture: def({ kind: 'CommonPicture', label: 'Общая картинка', pluralLabel: 'Общие картинки',
    folder: 'CommonPictures', icon: 'picture', group: 'common', groupOrder: 190 }),
  XDTOPackage: def({ kind: 'XDTOPackage', label: 'XDTO-пакет', pluralLabel: 'XDTO-пакеты',
    folder: 'XDTOPackages', icon: 'attribute', group: 'common', groupOrder: 200 }),
  WebService: def({ kind: 'WebService', label: 'Web-сервис', pluralLabel: 'Web-сервисы',
    folder: 'WebServices', icon: 'ws', group: 'common', groupOrder: 210,
    singleClickCommand: 'openServiceModule' }),
  HTTPService: def({ kind: 'HTTPService', label: 'HTTP-сервис', pluralLabel: 'HTTP-сервисы',
    folder: 'HTTPServices', icon: 'http', group: 'common', groupOrder: 220,
    singleClickCommand: 'openServiceModule' }),
  WSReference: def({ kind: 'WSReference', label: 'WS-ссылка', pluralLabel: 'WS-ссылки',
    folder: 'WSReferences', icon: 'attribute', group: 'common', groupOrder: 230 }),
  WebSocketClient: def({ kind: 'WebSocketClient', label: 'WebSocket-клиент', pluralLabel: 'WebSocket-клиенты',
    folder: 'WebSocketClients', icon: 'attribute', group: 'common', groupOrder: 240 }),
  IntegrationService: def({ kind: 'IntegrationService', label: 'Сервис интеграции', pluralLabel: 'Сервисы интеграции',
    folder: 'IntegrationServices', icon: 'attribute', group: 'common', groupOrder: 250 }),
  PaletteColor: def({ kind: 'PaletteColor', label: 'Цвет палитры', pluralLabel: 'Цвета палитры',
    icon: 'attribute', group: 'common', groupOrder: 260 }),
  StyleItem: def({ kind: 'StyleItem', label: 'Элемент стиля', pluralLabel: 'Элементы стиля',
    folder: 'StyleItems', icon: 'style', group: 'common', groupOrder: 270 }),
  Style: def({ kind: 'Style', label: 'Стиль', pluralLabel: 'Стили',
    folder: 'Styles', icon: 'style', group: 'common', groupOrder: 280 }),
  Language: def({ kind: 'Language', label: 'Язык', pluralLabel: 'Языки',
    folder: 'Languages', icon: 'attribute', group: 'common', groupOrder: 290 }),
  Interface: def({ kind: 'Interface', label: 'Интерфейс', pluralLabel: 'Интерфейсы',
    folder: 'Interfaces', icon: 'attribute', group: 'common', groupOrder: 300 }),

  // ── Верхний уровень ───────────────────────────────────────────────────
  Constant: def({ kind: 'Constant', label: 'Константа', pluralLabel: 'Константы',
    folder: 'Constants', icon: 'constant', group: 'top', groupOrder: 10,
    propertySchema: 'constant' }),
  Catalog: def({ kind: 'Catalog', label: 'Справочник', pluralLabel: 'Справочники',
    folder: 'Catalogs', icon: 'catalog', group: 'top', groupOrder: 20,
    childTags: ['Attribute', 'TabularSection', 'Form', 'Command', 'Template'],
    propertySchema: 'catalog' }),
  Document: def({ kind: 'Document', label: 'Документ', pluralLabel: 'Документы',
    folder: 'Documents', icon: 'document', group: 'top', groupOrder: 30,
    childTags: ['Attribute', 'TabularSection', 'Form', 'Command', 'Template'],
    propertySchema: 'document' }),
  DocumentNumerator: def({ kind: 'DocumentNumerator', label: 'Нумератор документов', pluralLabel: 'Нумераторы',
    folder: 'DocumentNumerators', icon: 'documentNumerator', group: 'top', groupOrder: 31 }),
  Sequence: def({ kind: 'Sequence', label: 'Последовательность', pluralLabel: 'Последовательности',
    folder: 'Sequences', icon: 'sequence', group: 'top', groupOrder: 32 }),
  DocumentJournal: def({ kind: 'DocumentJournal', label: 'Журнал документов', pluralLabel: 'Журналы документов',
    folder: 'DocumentJournals', icon: 'documentJournal', group: 'top', groupOrder: 40 }),
  Enum: def({ kind: 'Enum', label: 'Перечисление', pluralLabel: 'Перечисления',
    folder: 'Enums', icon: 'enum', group: 'top', groupOrder: 50,
    childTags: ['EnumValue', 'Form', 'Command', 'Template'] }),
  Report: def({ kind: 'Report', label: 'Отчёт', pluralLabel: 'Отчёты',
    folder: 'Reports', icon: 'report', group: 'top', groupOrder: 60,
    childTags: ['Attribute', 'TabularSection', 'Form', 'Command', 'Template'] }),
  DataProcessor: def({ kind: 'DataProcessor', label: 'Обработка', pluralLabel: 'Обработки',
    folder: 'DataProcessors', icon: 'dataProcessor', group: 'top', groupOrder: 70,
    childTags: ['Attribute', 'TabularSection', 'Form', 'Command', 'Template'] }),
  ChartOfCharacteristicTypes: def({ kind: 'ChartOfCharacteristicTypes', label: 'План видов характеристик',
    pluralLabel: 'Планы видов характеристик',
    folder: 'ChartsOfCharacteristicTypes', icon: 'chartsOfCharacteristicType', group: 'top', groupOrder: 80,
    childTags: ['Attribute', 'TabularSection', 'Form', 'Command'] }),
  ChartOfAccounts: def({ kind: 'ChartOfAccounts', label: 'План счетов', pluralLabel: 'Планы счетов',
    folder: 'ChartsOfAccounts', icon: 'chartsOfAccount', group: 'top', groupOrder: 90,
    childTags: ['Attribute', 'TabularSection', 'Form', 'Command'] }),
  ChartOfCalculationTypes: def({ kind: 'ChartOfCalculationTypes', label: 'План видов расчёта',
    pluralLabel: 'Планы видов расчёта',
    folder: 'ChartsOfCalculationTypes', icon: 'chartsOfCalculationType', group: 'top', groupOrder: 100,
    childTags: ['Attribute', 'TabularSection', 'Form', 'Command'] }),
  InformationRegister: def({ kind: 'InformationRegister', label: 'Регистр сведений', pluralLabel: 'Регистры сведений',
    folder: 'InformationRegisters', icon: 'informationRegister', group: 'top', groupOrder: 110,
    childTags: ['Dimension', 'Resource', 'Form', 'Command'] }),
  AccumulationRegister: def({ kind: 'AccumulationRegister', label: 'Регистр накопления', pluralLabel: 'Регистры накопления',
    folder: 'AccumulationRegisters', icon: 'accumulationRegister', group: 'top', groupOrder: 120,
    childTags: ['Dimension', 'Resource', 'Form', 'Command'] }),
  AccountingRegister: def({ kind: 'AccountingRegister', label: 'Регистр бухгалтерии', pluralLabel: 'Регистры бухгалтерии',
    folder: 'AccountingRegisters', icon: 'accountingRegister', group: 'top', groupOrder: 130,
    childTags: ['Dimension', 'Resource', 'Form', 'Command'] }),
  CalculationRegister: def({ kind: 'CalculationRegister', label: 'Регистр расчёта', pluralLabel: 'Регистры расчёта',
    folder: 'CalculationRegisters', icon: 'calculationRegister', group: 'top', groupOrder: 140,
    childTags: ['Dimension', 'Resource', 'Form', 'Command'] }),
  BusinessProcess: def({ kind: 'BusinessProcess', label: 'Бизнес-процесс', pluralLabel: 'Бизнес-процессы',
    folder: 'BusinessProcesses', icon: 'businessProcess', group: 'top', groupOrder: 150,
    childTags: ['Attribute', 'TabularSection', 'Form', 'Command'] }),
  Task: def({ kind: 'Task', label: 'Задача', pluralLabel: 'Задачи',
    folder: 'Tasks', icon: 'task', group: 'top', groupOrder: 160,
    childTags: ['Attribute', 'AddressingAttribute', 'TabularSection', 'Form', 'Command'] }),
  ExternalDataSource: def({ kind: 'ExternalDataSource', label: 'Внешний источник данных', pluralLabel: 'Внешние источники данных',
    folder: 'ExternalDataSources', icon: 'attribute', group: 'top', groupOrder: 170 }),

  // ── Дочерние элементы объектов ────────────────────────────────────────
  Attribute: def({ kind: 'Attribute', label: 'Реквизит', pluralLabel: 'Реквизиты',
    icon: 'attribute', group: 'child', groupOrder: 0, propertySchema: 'typedField' }),
  AddressingAttribute: def({ kind: 'AddressingAttribute', label: 'Реквизит адресации', pluralLabel: 'Реквизиты адресации',
    icon: 'attribute', group: 'child', groupOrder: 0, propertySchema: 'typedField' }),
  TabularSection: def({ kind: 'TabularSection', label: 'Табличная часть', pluralLabel: 'Табличные части',
    icon: 'tabularSection', group: 'child', groupOrder: 0, propertySchema: 'tabularSection' }),
  Column: def({ kind: 'Column', label: 'Колонка', pluralLabel: 'Колонки',
    icon: 'attribute', group: 'child', groupOrder: 0, propertySchema: 'typedField' }),
  Form: def({ kind: 'Form', label: 'Форма', pluralLabel: 'Формы',
    icon: 'form', group: 'child', groupOrder: 0,
    singleClickCommand: 'openFormModule', propertySchema: 'form' }),
  Command: def({ kind: 'Command', label: 'Команда', pluralLabel: 'Команды',
    icon: 'command', group: 'child', groupOrder: 0,
    singleClickCommand: 'openCommandModule', propertySchema: 'command' }),
  Template: def({ kind: 'Template', label: 'Макет', pluralLabel: 'Макеты',
    icon: 'template', group: 'child', groupOrder: 0, propertySchema: 'template' }),
  Dimension: def({ kind: 'Dimension', label: 'Измерение', pluralLabel: 'Измерения',
    icon: 'dimension', group: 'child', groupOrder: 0, propertySchema: 'typedField' }),
  Resource: def({ kind: 'Resource', label: 'Ресурс', pluralLabel: 'Ресурсы',
    icon: 'resource', group: 'child', groupOrder: 0, propertySchema: 'typedField' }),
  EnumValue: def({ kind: 'EnumValue', label: 'Значение перечисления', pluralLabel: 'Значения',
    icon: 'enumValue', group: 'child', groupOrder: 0, propertySchema: 'enumValue' }),
};

// ── Доступ к реестру ────────────────────────────────────────────────────

/** Возвращает описание типа по идентификатору; выбрасывает исключение, если тип неизвестен */
export function getMetaType(kind: MetaKind): MetaTypeDef {
  const def = META_TYPES[kind];
  if (!def) {
    throw new Error(`Неизвестный тип метаданных: ${kind}`);
  }
  return def;
}

/** Короткое имя типа (label) */
export function getMetaLabel(kind: MetaKind): string {
  return META_TYPES[kind]?.label ?? kind;
}

/** Имя иконки для типа (без пути и расширения) */
export function getMetaIcon(kind: MetaKind): string {
  return META_TYPES[kind]?.icon ?? 'attribute';
}

/** Возвращает все типы указанной группы, отсортированные по `groupOrder` */
export function getMetaTypesByGroup(group: MetaGroup): MetaTypeDef[] {
  return Object.values(META_TYPES)
    .filter((def) => def.group === group)
    .sort((a, b) => a.groupOrder - b.groupOrder);
}

/** Возвращает папку выгрузки по типу или `null`, если у типа нет файлов на диске */
export function getMetaFolder(kind: MetaKind): string | null {
  return META_TYPES[kind]?.folder ?? null;
}
