/**
 * Каноническое именование путей и типов 1С для MCP-инструментов.
 *
 * Единый источник правды по §1-§2 плана `MCP_REFACTORING_PLAN.md`.
 * Все остальные модули, выдающие или парсящие MCP-пути, обязаны читать
 * данные отсюда. Файл — чистый домен: никаких импортов `vscode`/`fs`/`path`.
 *
 * Правила канона (кратко):
 *  - корни — множественное русское CamelCase без пробелов
 *    (`Справочники`, `Документы`, `РегистрыСведений`);
 *  - подсистемы — единственное `Подсистема`, без удвоения сегментов
 *    (`Подсистема.А.Б.В`);
 *  - реквизиты/ТЧ/измерения/ресурсы/значения перечислений — напрямую,
 *    без сегмента-роли;
 *  - стандартные реквизиты/формы/команды/макеты/реквизиты адресации —
 *    с явным сегментом;
 *  - модули — сегмент в хвосте (`…МодульОбъекта`, `…Форма.X.МодульФормы`);
 *  - английские и legacy-формы не поддерживаются.
 */

import type { ChildTag } from './ChildTag';
import { CHILD_TAG_CONFIG } from './ChildTag';
import type { MetaKind } from './MetaTypes';
import { META_TYPES } from './MetaTypes';
import type { ModuleSlot } from './ModuleSlot';

// ─── Прямые vs сегментированные дочерние элементы ────────────────────────

/**
 * Дочерние элементы, которые добавляются в путь напрямую без сегмента-роли.
 * Имена этих элементов уникальны в рамках объекта по правилам платформы 1С,
 * поэтому сегмент не нужен. Применяется только на верхнем уровне объекта.
 */
export const DIRECT_CHILD_TAGS: readonly ChildTag[] = [
  'Attribute', 'TabularSection',
  'Dimension', 'Resource',
  'EnumValue',
] as const;

/**
 * Дочерние элементы, которые ВСЕГДА добавляются с явным сегментом-ролью.
 * Также сегмент возвращается для дочерних элементов внутри `ТабличнаяЧасть`
 * (колонки идут как `Реквизит`).
 */
export const SEGMENTED_CHILD_TAGS: readonly ChildTag[] = [
  'StandardAttribute', 'Form', 'Command', 'Template',
  'AddressingAttribute', 'URLTemplate', 'Method',
] as const;

// ─── Слоты модулей: сегмент пути + файл BSL ──────────────────────────────

/** Описание серверной части пути модуля. */
export interface ModuleSegmentInfo {
  /**
   * Каноничный сегмент пути 1С (`МодульОбъекта`, `МодульМенеджера`, …).
   * Пустая строка означает, что модуль — это сам объект (`ОбщиеМодули.X`).
   */
  readonly segment: string;
  /** Имя файла модуля внутри относительного каталога. */
  readonly fileName: string;
  /** Относительный каталог в дереве объекта (`Ext`, `Ext/Form`, …). */
  readonly relativeDir?: string;
}

/**
 * Маппинг слотов модулей в сегмент канонического пути и файл BSL.
 *
 * Замечания:
 *  - Для `CommonModule` сегмент пустой: модуль — это сам объект
 *    (`ОбщиеМодули.X`), отдельного хвоста нет.
 *  - Для `Service` (Web/HTTP-сервисы) канонический сегмент — `МодульМенеджера`
 *    (по §1.5 плана). Имя файла на диске — `Module.bsl`.
 *  - `ChildForm`/`ChildCommand` — относительные пути добавляются после имени
 *    формы/команды; `relativeDir` здесь — внутренняя часть в каталоге формы.
 */
export const MODULE_SEGMENT_MAP: Readonly<Record<ModuleSlot, ModuleSegmentInfo>> = {
  Object:        { segment: 'МодульОбъекта',          fileName: 'ObjectModule.bsl',         relativeDir: 'Ext' },
  Manager:       { segment: 'МодульМенеджера',        fileName: 'ManagerModule.bsl',        relativeDir: 'Ext' },
  ValueManager:  { segment: 'МодульМенеджераЗначения', fileName: 'ValueManagerModule.bsl',  relativeDir: 'Ext' },
  RecordSet:     { segment: 'МодульНабораЗаписей',    fileName: 'RecordSetModule.bsl',      relativeDir: 'Ext' },
  Service:       { segment: 'МодульМенеджера',        fileName: 'Module.bsl',               relativeDir: 'Ext' },
  CommonModule:  { segment: '',                       fileName: 'Module.bsl',               relativeDir: 'Ext' },
  CommonCommand: { segment: 'МодульКоманды',          fileName: 'CommandModule.bsl',        relativeDir: 'Ext' },
  CommonForm:    { segment: 'МодульФормы',            fileName: 'Module.bsl',               relativeDir: 'Ext/Form' },
  ChildForm:     { segment: 'МодульФормы',            fileName: 'Module.bsl',               relativeDir: 'Ext/Form' },
  ChildCommand:  { segment: 'МодульКоманды',          fileName: 'CommandModule.bsl',        relativeDir: 'Ext' },
};

// ─── Ссылочные производные типы ──────────────────────────────────────────

/** Описание ссылочного производного типа (`СправочникСсылка`/`CatalogRef` и т.п.). */
export interface RefKindInfo {
  /** Базовый тип метаданных, к которому привязан производный тип. */
  readonly metaKind: MetaKind;
  /**
   * Русский суффикс производного типа: `Ссылка`/`Объект`/`Менеджер`/
   * `Выборка`/`Список`/`НаборЗаписей`/`КлючЗаписи`/`МенеджерЗаписи`/
   * `Перерасчет`/`ТочкаМаршрутаСсылка`.
   */
  readonly suffix: string;
  /** Русская база производного типа (`Справочник`, `Документ`, …). */
  readonly russianBase: string;
  /** Канонический английский идентификатор (`CatalogRef`, …). */
  readonly englishCanonical: string;
}

/** Сокращённый конструктор для удобства. */
const ref = (metaKind: MetaKind, suffix: string, russianBase: string, englishCanonical: string): RefKindInfo =>
  ({ metaKind, suffix, russianBase, englishCanonical });

/**
 * Полная таблица ссылочных производных типов по §2.2 плана.
 *
 * Используется для генерации списка типов в `v8vscedit_list_available_types`
 * и для разбора имён типов в `v8vscedit_set_type`.
 */
export const REF_KIND_MAP: readonly RefKindInfo[] = [
  // Справочник
  ref('Catalog', 'Ссылка',  'Справочник', 'CatalogRef'),
  ref('Catalog', 'Объект',  'Справочник', 'CatalogObject'),
  ref('Catalog', 'Менеджер', 'Справочник', 'CatalogManager'),
  ref('Catalog', 'Выборка', 'Справочник', 'CatalogSelection'),
  ref('Catalog', 'Список',  'Справочник', 'CatalogList'),

  // Документ
  ref('Document', 'Ссылка',  'Документ', 'DocumentRef'),
  ref('Document', 'Объект',  'Документ', 'DocumentObject'),
  ref('Document', 'Менеджер', 'Документ', 'DocumentManager'),
  ref('Document', 'Выборка', 'Документ', 'DocumentSelection'),
  ref('Document', 'Список',  'Документ', 'DocumentList'),

  // Перечисление
  ref('Enum', 'Ссылка',  'Перечисление', 'EnumRef'),
  ref('Enum', 'Менеджер', 'Перечисление', 'EnumManager'),
  ref('Enum', 'Список',  'Перечисление', 'EnumList'),

  // План видов характеристик
  ref('ChartOfCharacteristicTypes', 'Ссылка',  'ПланВидовХарактеристик', 'ChartOfCharacteristicTypesRef'),
  ref('ChartOfCharacteristicTypes', 'Объект',  'ПланВидовХарактеристик', 'ChartOfCharacteristicTypesObject'),
  ref('ChartOfCharacteristicTypes', 'Менеджер', 'ПланВидовХарактеристик', 'ChartOfCharacteristicTypesManager'),

  // План счетов
  ref('ChartOfAccounts', 'Ссылка',  'ПланСчетов', 'ChartOfAccountsRef'),
  ref('ChartOfAccounts', 'Объект',  'ПланСчетов', 'ChartOfAccountsObject'),
  ref('ChartOfAccounts', 'Менеджер', 'ПланСчетов', 'ChartOfAccountsManager'),

  // План видов расчёта
  ref('ChartOfCalculationTypes', 'Ссылка',  'ПланВидовРасчета', 'ChartOfCalculationTypesRef'),
  ref('ChartOfCalculationTypes', 'Объект',  'ПланВидовРасчета', 'ChartOfCalculationTypesObject'),
  ref('ChartOfCalculationTypes', 'Менеджер', 'ПланВидовРасчета', 'ChartOfCalculationTypesManager'),

  // План обмена
  ref('ExchangePlan', 'Ссылка',  'ПланОбмена', 'ExchangePlanRef'),
  ref('ExchangePlan', 'Объект',  'ПланОбмена', 'ExchangePlanObject'),
  ref('ExchangePlan', 'Менеджер', 'ПланОбмена', 'ExchangePlanManager'),

  // Бизнес-процесс
  ref('BusinessProcess', 'Ссылка',  'БизнесПроцесс', 'BusinessProcessRef'),
  ref('BusinessProcess', 'Объект',  'БизнесПроцесс', 'BusinessProcessObject'),
  ref('BusinessProcess', 'Менеджер', 'БизнесПроцесс', 'BusinessProcessManager'),
  ref('BusinessProcess', 'ТочкаМаршрутаСсылка', 'БизнесПроцесс', 'BusinessProcessRoutePointRef'),

  // Задача
  ref('Task', 'Ссылка',  'Задача', 'TaskRef'),
  ref('Task', 'Объект',  'Задача', 'TaskObject'),
  ref('Task', 'Менеджер', 'Задача', 'TaskManager'),

  // Регистр сведений (6 видов)
  ref('InformationRegister', 'НаборЗаписей',   'РегистрСведений', 'InformationRegisterRecordSet'),
  ref('InformationRegister', 'КлючЗаписи',     'РегистрСведений', 'InformationRegisterRecordKey'),
  ref('InformationRegister', 'МенеджерЗаписи', 'РегистрСведений', 'InformationRegisterRecordManager'),
  ref('InformationRegister', 'Выборка',        'РегистрСведений', 'InformationRegisterSelection'),
  ref('InformationRegister', 'Список',         'РегистрСведений', 'InformationRegisterList'),
  ref('InformationRegister', 'Менеджер',       'РегистрСведений', 'InformationRegisterManager'),

  // Регистр накопления (6 видов)
  ref('AccumulationRegister', 'НаборЗаписей',   'РегистрНакопления', 'AccumulationRegisterRecordSet'),
  ref('AccumulationRegister', 'КлючЗаписи',     'РегистрНакопления', 'AccumulationRegisterRecordKey'),
  ref('AccumulationRegister', 'МенеджерЗаписи', 'РегистрНакопления', 'AccumulationRegisterRecordManager'),
  ref('AccumulationRegister', 'Выборка',        'РегистрНакопления', 'AccumulationRegisterSelection'),
  ref('AccumulationRegister', 'Список',         'РегистрНакопления', 'AccumulationRegisterList'),
  ref('AccumulationRegister', 'Менеджер',       'РегистрНакопления', 'AccumulationRegisterManager'),

  // Регистр бухгалтерии (6 видов)
  ref('AccountingRegister', 'НаборЗаписей',   'РегистрБухгалтерии', 'AccountingRegisterRecordSet'),
  ref('AccountingRegister', 'КлючЗаписи',     'РегистрБухгалтерии', 'AccountingRegisterRecordKey'),
  ref('AccountingRegister', 'МенеджерЗаписи', 'РегистрБухгалтерии', 'AccountingRegisterRecordManager'),
  ref('AccountingRegister', 'Выборка',        'РегистрБухгалтерии', 'AccountingRegisterSelection'),
  ref('AccountingRegister', 'Список',         'РегистрБухгалтерии', 'AccountingRegisterList'),
  ref('AccountingRegister', 'Менеджер',       'РегистрБухгалтерии', 'AccountingRegisterManager'),

  // Регистр расчёта (6 видов + Перерасчет)
  ref('CalculationRegister', 'НаборЗаписей',   'РегистрРасчета', 'CalculationRegisterRecordSet'),
  ref('CalculationRegister', 'КлючЗаписи',     'РегистрРасчета', 'CalculationRegisterRecordKey'),
  ref('CalculationRegister', 'МенеджерЗаписи', 'РегистрРасчета', 'CalculationRegisterRecordManager'),
  ref('CalculationRegister', 'Выборка',        'РегистрРасчета', 'CalculationRegisterSelection'),
  ref('CalculationRegister', 'Список',         'РегистрРасчета', 'CalculationRegisterList'),
  ref('CalculationRegister', 'Менеджер',       'РегистрРасчета', 'CalculationRegisterManager'),
  ref('CalculationRegister', 'Перерасчет',     'РегистрРасчета', 'CalculationRegisterRecalculation'),

  // Константа
  ref('Constant', 'Менеджер',         'Константа', 'ConstantManager'),
  ref('Constant', 'МенеджерЗначения', 'Константа', 'ConstantValueManager'),

  // Обработка
  ref('DataProcessor', 'Объект',  'Обработка', 'DataProcessorObject'),
  ref('DataProcessor', 'Менеджер', 'Обработка', 'DataProcessorManager'),

  // Отчёт
  ref('Report', 'Объект',  'Отчет', 'ReportObject'),
  ref('Report', 'Менеджер', 'Отчет', 'ReportManager'),

  // Определяемый тип
  ref('DefinedType', '', 'ОпределяемыйТип', 'DefinedType'),

  // Хранилище настроек
  ref('SettingsStorage', 'Менеджер', 'ХранилищеНастроек', 'SettingsStorageManager'),
];

// ─── Базовые платформенные типы ──────────────────────────────────────────

/** Контекст использования базового типа. */
export type BaseTypeContext = 'metadataAttribute' | 'formAttribute';

/** Описание базового платформенного типа (`Строка`, `Число`, `ТаблицаЗначений`…). */
export interface BaseTypeInfo {
  /** Каноничное русское имя типа. */
  readonly russian: string;
  /** Каноничное английское имя типа. */
  readonly english: string;
  /**
   * XML-токен примитивного типа из пространства `xs:`. Отсутствует у типов,
   * не имеющих прямой XSD-сериализации (объектные типы).
   */
  readonly xmlPrimitive?: string;
  /** Контексты, в которых тип допустим. */
  readonly contexts: readonly BaseTypeContext[];
}

/**
 * Реестр базовых типов (без производных по конфигурации).
 *
 * Поле `xmlPrimitive` для `УникальныйИдентификатор` пока не указано — реальный
 * токен XML-сериализации в 1С 8.3 неизвестен и требует эмпирической проверки
 * (см. этап E2 плана). TODO: уточнить и проставить.
 */
export const BASE_TYPES: readonly BaseTypeInfo[] = [
  { russian: 'Строка',                  english: 'String',           xmlPrimitive: 'xs:string',       contexts: ['metadataAttribute', 'formAttribute'] },
  { russian: 'Число',                   english: 'Number',           xmlPrimitive: 'xs:decimal',      contexts: ['metadataAttribute', 'formAttribute'] },
  { russian: 'Булево',                  english: 'Boolean',          xmlPrimitive: 'xs:boolean',      contexts: ['metadataAttribute', 'formAttribute'] },
  { russian: 'Дата',                    english: 'Date',             xmlPrimitive: 'xs:dateTime',     contexts: ['metadataAttribute', 'formAttribute'] },
  { russian: 'ДатаВремя',               english: 'DateTime',         xmlPrimitive: 'xs:dateTime',     contexts: ['metadataAttribute', 'formAttribute'] },
  { russian: 'ХранилищеЗначения',       english: 'ValueStorage',                                      contexts: ['metadataAttribute', 'formAttribute'] },
  { russian: 'УникальныйИдентификатор', english: 'UUID',                                              contexts: ['metadataAttribute', 'formAttribute'] },
  { russian: 'ДвоичныеДанные',          english: 'BinaryData',       xmlPrimitive: 'xs:base64Binary', contexts: ['metadataAttribute', 'formAttribute'] },
  { russian: 'Тип',                     english: 'Type',                                              contexts: ['formAttribute'] },
  { russian: 'ОписаниеТипов',           english: 'TypeDescription',                                   contexts: ['formAttribute'] },
  { russian: 'СписокЗначений',          english: 'ValueList',                                         contexts: ['formAttribute'] },
  { russian: 'ТаблицаЗначений',         english: 'ValueTable',                                        contexts: ['formAttribute'] },
  { russian: 'ДеревоЗначений',          english: 'ValueTree',                                         contexts: ['formAttribute'] },
  { russian: 'Массив',                  english: 'Array',                                             contexts: ['formAttribute'] },
  { russian: 'ФиксированныйМассив',     english: 'FixedArray',                                        contexts: ['formAttribute'] },
  { russian: 'Структура',               english: 'Structure',                                         contexts: ['formAttribute'] },
  { russian: 'ФиксированнаяСтруктура',  english: 'FixedStructure',                                    contexts: ['formAttribute'] },
  { russian: 'ТабличныйДокумент',       english: 'SpreadsheetDocument',                               contexts: ['formAttribute'] },
  { russian: 'Картинка',                english: 'Picture',                                           contexts: ['metadataAttribute', 'formAttribute'] },
  { russian: 'ФорматированнаяСтрока',   english: 'FormattedString',                                   contexts: ['formAttribute'] },
];

// ─── Конфигурационные модули (псевдо-корня `Конфигурация`/`Расширение`) ──

/**
 * Сегмент пути модуля, который принадлежит корню конфигурации/расширения,
 * а не конкретному объекту. По §1.5 плана таких модулей четыре.
 */
export type ConfigurationModuleSegment =
  | 'МодульУправляемогоПриложения'
  | 'МодульСеанса'
  | 'МодульВнешнегоСоединения'
  | 'МодульОбычногоПриложения';

/**
 * Имена файлов BSL для модулей уровня конфигурации (читать из `Ext/`).
 */
export const CONFIGURATION_MODULE_FILES: Readonly<Record<ConfigurationModuleSegment, string>> = {
  'МодульУправляемогоПриложения': 'ManagedApplicationModule.bsl',
  'МодульСеанса':                 'SessionModule.bsl',
  'МодульВнешнегоСоединения':     'ExternalConnectionModule.bsl',
  'МодульОбычногоПриложения':     'OrdinaryApplicationModule.bsl',
};

// ─── Вспомогательные карты ───────────────────────────────────────────────

/** Кэш «сегмент пути → MetaKind» для корневых типов. */
const ROOT_SEGMENT_TO_KIND = new Map<string, MetaKind>();
for (const [kindRaw, def] of Object.entries(META_TYPES)) {
  if (def.pathSegment && def.kind !== 'Subsystem' && def.kind !== 'configuration' && def.kind !== 'extension') {
    ROOT_SEGMENT_TO_KIND.set(def.pathSegment, kindRaw as MetaKind);
  }
}

/** Сегмент `Подсистема` отдельно — он не идёт через `ROOT_SEGMENT_TO_KIND`. */
const SUBSYSTEM_SEGMENT = META_TYPES.Subsystem.pathSegment ?? 'Подсистема';

/** Кэш «сегмент пути → ChildTag» для дочерних элементов. */
const CHILD_SEGMENT_TO_TAG = new Map<string, ChildTag>();
for (const cfg of Object.values(CHILD_TAG_CONFIG)) {
  CHILD_SEGMENT_TO_TAG.set(cfg.pathSegment, cfg.tag);
}

/** Кэш «сегмент модуля → ModuleSlot». */
const MODULE_SEGMENT_TO_SLOT = new Map<string, ModuleSlot>();
for (const [slot, info] of Object.entries(MODULE_SEGMENT_MAP) as readonly [ModuleSlot, ModuleSegmentInfo][]) {
  if (info.segment) {
    if (!MODULE_SEGMENT_TO_SLOT.has(info.segment)) {
      MODULE_SEGMENT_TO_SLOT.set(info.segment, slot);
    }
  }
}

const CONFIGURATION_MODULE_SEGMENTS: readonly ConfigurationModuleSegment[] = [
  'МодульУправляемогоПриложения',
  'МодульСеанса',
  'МодульВнешнегоСоединения',
  'МодульОбычногоПриложения',
];

// ─── Валидация имён ──────────────────────────────────────────────────────

/** Проверяет, что имя объекта 1С не содержит точку и не пустое. */
function assertSimpleName(name: string, context: string): void {
  if (name.length === 0) {
    throw new Error(`Пустое имя в канон-пути (${context})`);
  }
  if (name.includes('.')) {
    throw new Error(`Имя «${name}» содержит точку — недопустимо в канон-пути (${context})`);
  }
}

/** Получает каноничный сегмент пути по MetaKind или падает с понятной ошибкой. */
function requirePathSegment(kind: MetaKind, role: string): string {
  const def = META_TYPES[kind];
  const segment = def.pathSegment;
  if (!segment) {
    throw new Error(`У типа метаданных «${kind}» нет канонического сегмента пути (${role})`);
  }
  return segment;
}

// ─── Построение путей ────────────────────────────────────────────────────

/**
 * Строит каноническую форму пути к корневому объекту.
 *
 * Для `Subsystem` использовать {@link canonicalSubsystemPath}, а не этот метод —
 * у подсистем особое правило именования (без удвоения сегмента).
 */
export function canonicalRootPath(kind: MetaKind, name: string): string {
  if (kind === 'Subsystem') {
    return canonicalSubsystemPath([name]);
  }
  assertSimpleName(name, 'canonicalRootPath');
  const segment = requirePathSegment(kind, 'canonicalRootPath');
  return `${segment}.${name}`;
}

/**
 * Строит путь к подсистеме без удвоения сегмента: `Подсистема.А.Б.В`.
 * `names` — иерархия от корневой подсистемы к листу.
 */
export function canonicalSubsystemPath(names: readonly string[]): string {
  if (names.length === 0) {
    throw new Error('canonicalSubsystemPath: пустой список имён подсистем');
  }
  for (const n of names) {
    assertSimpleName(n, 'canonicalSubsystemPath');
  }
  return [SUBSYSTEM_SEGMENT, ...names].join('.');
}

/**
 * Строит каноническую форму пути к дочернему элементу.
 *
 * Правила:
 *  - для `Attribute`/`TabularSection`/`Dimension`/`Resource`/`EnumValue`
 *    сегмент не добавляется (прямая форма);
 *  - для `StandardAttribute`/`Form`/`Command`/`Template`/`AddressingAttribute`
 *    сегмент обязателен;
 *  - для колонок внутри ТЧ (`tabularSectionName` задан + `childTag === 'Attribute'`)
 *    путь имеет форму `…ТабличнаяЧасть.Имя.Реквизит.Колонка`;
 *  - для методов внутри URL-шаблона (`urlTemplateName` задан + `childTag === 'Method'`)
 *    путь имеет форму `…URLШаблон.Имя.Метод.Имя` (третий уровень вложенности
 *    HTTP-сервиса, тот же контейнерный паттерн, что и ТЧ→Колонка).
 */
export function canonicalChildPath(opts: {
  readonly rootKind: MetaKind;
  readonly rootName: string;
  readonly childTag: ChildTag;
  readonly childName: string;
  readonly tabularSectionName?: string;
  readonly urlTemplateName?: string;
}): string {
  const root = canonicalRootPath(opts.rootKind, opts.rootName);
  assertSimpleName(opts.childName, 'canonicalChildPath/childName');

  const tagCfg = CHILD_TAG_CONFIG[opts.childTag];
  const segment = tagCfg.pathSegment;

  // Контейнерный дочерний элемент (колонка ТЧ или метод URL-шаблона):
  // …<Контейнер>.Имя.<сегмент дочернего>.Имя. Имя контейнера-родителя задаётся
  // отдельным полем (`tabularSectionName`/`urlTemplateName`) — осознанное
  // дублирование слота имени контейнера, а не параллельный реестр типов.
  const container = opts.urlTemplateName !== undefined
    ? { segment: CHILD_TAG_CONFIG.URLTemplate.pathSegment, name: opts.urlTemplateName, ctx: 'canonicalChildPath/urlTemplateName' }
    : opts.tabularSectionName !== undefined
      ? { segment: CHILD_TAG_CONFIG.TabularSection.pathSegment, name: opts.tabularSectionName, ctx: 'canonicalChildPath/tabularSectionName' }
      : undefined;
  if (container) {
    assertSimpleName(container.name, container.ctx);
    return [root, container.segment, container.name, segment, opts.childName].join('.');
  }

  if (DIRECT_CHILD_TAGS.includes(opts.childTag)) {
    return `${root}.${opts.childName}`;
  }
  return `${root}.${segment}.${opts.childName}`;
}

/**
 * Строит путь к модулю объекта. Имя модуля — последний сегмент.
 *
 * Особенности:
 *  - для `CommonModule` модуль = сам объект, поэтому возвращается `ОбщиеМодули.X`
 *    без хвоста (сегмент в `MODULE_SEGMENT_MAP` пустой);
 *  - для модулей форм/команд внутри объекта передаётся `subPath` — имя формы
 *    или команды; собранный путь имеет вид `…Форма.Y.МодульФормы`
 *    или `…Команда.Z.МодульКоманды`.
 */
export function canonicalModulePath(opts: {
  readonly rootKind: MetaKind;
  readonly rootName: string;
  readonly slot: ModuleSlot;
  readonly subPath?: { readonly tag: 'Form' | 'Command'; readonly name: string };
}): string {
  const root = canonicalRootPath(opts.rootKind, opts.rootName);
  const info = MODULE_SEGMENT_MAP[opts.slot];

  if (opts.subPath) {
    if (opts.slot !== 'ChildForm' && opts.slot !== 'ChildCommand') {
      throw new Error(`canonicalModulePath: subPath допустим только для ChildForm/ChildCommand, получено «${opts.slot}»`);
    }
    assertSimpleName(opts.subPath.name, 'canonicalModulePath/subPath');
    const subSegment = CHILD_TAG_CONFIG[opts.subPath.tag].pathSegment;
    return [root, subSegment, opts.subPath.name, info.segment].join('.');
  }

  if (opts.slot === 'ChildForm' || opts.slot === 'ChildCommand') {
    throw new Error(`canonicalModulePath: для слота «${opts.slot}» требуется subPath`);
  }

  if (info.segment === '') {
    // ОбщиеМодули.X — сам объект уже является модулем.
    return root;
  }
  return `${root}.${info.segment}`;
}

/**
 * Строит путь к модулю уровня конфигурации/расширения
 * (`Конфигурация.МодульУправляемогоПриложения` и т.п.).
 */
export function canonicalConfigurationModulePath(
  root: 'configuration' | 'extension',
  segment: ConfigurationModuleSegment,
): string {
  const def = META_TYPES[root];
  const rootSegment = def.pathSegment ?? '';
  if (rootSegment === '') {
    throw new Error(`canonicalConfigurationModulePath: нет pathSegment для «${root}»`);
  }
  return `${rootSegment}.${segment}`;
}

// ─── Парсинг путей ───────────────────────────────────────────────────────

/** Результат разбора канонического пути в структурированную модель. */
export type ParsedCanonicalPath =
  | { readonly kind: 'configuration' | 'extension' }
  | { readonly kind: 'configurationModule'; readonly root: 'configuration' | 'extension'; readonly segment: ConfigurationModuleSegment }
  | { readonly kind: 'root'; readonly metaKind: MetaKind; readonly name: string }
  | { readonly kind: 'subsystem'; readonly names: readonly string[] }
  | {
      readonly kind: 'child';
      readonly rootKind: MetaKind;
      readonly rootName: string;
      readonly childTag: ChildTag;
      readonly childName: string;
      readonly tabularSectionName?: string;
      /** Имя URL-шаблона-контейнера для методов HTTP-сервиса (аналог `tabularSectionName`). */
      readonly urlTemplateName?: string;
    }
  | {
      readonly kind: 'module';
      readonly rootKind: MetaKind;
      readonly rootName: string;
      readonly slot: ModuleSlot;
      readonly subPath?: { readonly tag: 'Form' | 'Command'; readonly name: string };
    };

/**
 * Разбирает канонический путь.
 *
 * Принимает ТОЛЬКО канонические русские формы. Английские (`Catalog.X`),
 * legacy-формы (`Catalogs.X` — латиница) и единственное число для корней
 * с коллекцией (`Справочник.X`) отбиваются с понятным сообщением.
 */
export function parseCanonicalPath(input: string): ParsedCanonicalPath {
  if (typeof input !== 'string' || input.length === 0) {
    throw new Error('parseCanonicalPath: пустой путь');
  }
  const segments = input.split('.');
  for (const seg of segments) {
    if (seg.length === 0) {
      throw new Error(`parseCanonicalPath: пустой сегмент в пути «${input}»`);
    }
  }

  const head = segments[0];

  // Псевдо-корни конфигурации/расширения
  if (head === META_TYPES.configuration.pathSegment || head === META_TYPES.extension.pathSegment) {
    const root: 'configuration' | 'extension' = head === META_TYPES.configuration.pathSegment ? 'configuration' : 'extension';
    if (segments.length === 1) {
      return { kind: root };
    }
    if (segments.length === 2) {
      const tail = segments[1];
      if (isConfigurationModuleSegment(tail)) {
        return { kind: 'configurationModule', root, segment: tail };
      }
      throw new Error(`parseCanonicalPath: неизвестный модуль уровня конфигурации «${tail}» в «${input}»`);
    }
    throw new Error(`parseCanonicalPath: лишние сегменты после «${head}» в «${input}»`);
  }

  // Подсистема
  if (head === SUBSYSTEM_SEGMENT) {
    if (segments.length < 2) {
      throw new Error(`parseCanonicalPath: пустая иерархия подсистемы в «${input}»`);
    }
    const names = segments.slice(1);
    for (const n of names) {
      assertSimpleName(n, 'parseCanonicalPath/subsystem');
    }
    return { kind: 'subsystem', names };
  }

  // Корневые типы (коллекции)
  const rootKind = ROOT_SEGMENT_TO_KIND.get(head);
  if (!rootKind) {
    throw new Error(
      `parseCanonicalPath: неизвестный корневой сегмент «${head}» в «${input}». ` +
      'Поддерживаются только канонические русские формы (например, «Справочники», «Документы»).',
    );
  }

  if (segments.length < 2) {
    throw new Error(`parseCanonicalPath: после корня «${head}» ожидается имя объекта в «${input}»`);
  }
  const rootName = segments[1];
  assertSimpleName(rootName, 'parseCanonicalPath/rootName');

  if (segments.length === 2) {
    return { kind: 'root', metaKind: rootKind, name: rootName };
  }

  // Дочерний элемент или модуль
  const rest = segments.slice(2);
  return parseAfterRoot(input, rootKind, rootName, rest);
}

function isConfigurationModuleSegment(value: string): value is ConfigurationModuleSegment {
  return (CONFIGURATION_MODULE_SEGMENTS as readonly string[]).includes(value);
}

function parseAfterRoot(
  input: string,
  rootKind: MetaKind,
  rootName: string,
  rest: readonly string[],
): ParsedCanonicalPath {
  const first = rest[0];

  // Конфигурация/расширение-уровень модулей сюда не попадают — обработано выше.

  // Прямой модуль объекта (одно-сегментный хвост из MODULE_SEGMENT_MAP).
  if (rest.length === 1) {
    const moduleSlot = MODULE_SEGMENT_TO_SLOT.get(first);
    if (moduleSlot && moduleSlot !== 'ChildForm' && moduleSlot !== 'ChildCommand') {
      return { kind: 'module', rootKind, rootName, slot: moduleSlot };
    }
    // Прямой дочерний элемент без сегмента-роли (Реквизит/ТЧ/Измерение/...).
    return {
      kind: 'child',
      rootKind,
      rootName,
      childTag: 'Attribute',
      childName: first,
      // childTag — это «лучшая догадка» по правилу прямых сегментов: реальная
      // классификация (Реквизит/ТЧ/Измерение/Ресурс/Значение) требует чтения
      // XML объекта; парсер только разбирает строку, тип определяется наверху.
    };
  }

  // Двух- и более-сегментный хвост: сегмент-роль + имя [+ ещё].
  const childTag = CHILD_SEGMENT_TO_TAG.get(first);
  if (!childTag) {
    throw new Error(
      `parseCanonicalPath: после имени объекта ожидается сегмент-роль ` +
      `(Форма/Команда/Макет/СтандартныйРеквизит/РеквизитАдресации/ТабличнаяЧасть/Реквизит) ` +
      `или прямой дочерний элемент, получено «${first}» в «${input}»`,
    );
  }

  if (rest.length === 2) {
    const childName = rest[1];
    assertSimpleName(childName, 'parseCanonicalPath/childName');
    return { kind: 'child', rootKind, rootName, childTag, childName };
  }

  // 3+ сегмента: либо метод URL-шаблона, либо колонка ТЧ, либо модуль формы/команды.
  if (childTag === 'URLTemplate' && rest.length === 4) {
    const templateName = rest[1];
    const innerSegment = rest[2];
    const innerName = rest[3];
    assertSimpleName(templateName, 'parseCanonicalPath/urlTemplateName');
    assertSimpleName(innerName, 'parseCanonicalPath/methodName');
    const innerTag = CHILD_SEGMENT_TO_TAG.get(innerSegment);
    if (innerTag !== 'Method') {
      throw new Error(
        `parseCanonicalPath: внутри URLШаблон.X ожидается сегмент «Метод», ` +
        `получено «${innerSegment}» в «${input}»`,
      );
    }
    return {
      kind: 'child',
      rootKind,
      rootName,
      childTag: 'Method',
      childName: innerName,
      urlTemplateName: templateName,
    };
  }

  if (childTag === 'TabularSection' && rest.length === 4) {
    const tsName = rest[1];
    const innerSegment = rest[2];
    const innerName = rest[3];
    assertSimpleName(tsName, 'parseCanonicalPath/tabularSectionName');
    assertSimpleName(innerName, 'parseCanonicalPath/columnName');
    const innerTag = CHILD_SEGMENT_TO_TAG.get(innerSegment);
    if (innerTag !== 'Attribute') {
      throw new Error(
        `parseCanonicalPath: внутри ТабличнаяЧасть.X ожидается сегмент «Реквизит», ` +
        `получено «${innerSegment}» в «${input}»`,
      );
    }
    return {
      kind: 'child',
      rootKind,
      rootName,
      childTag: 'Attribute',
      childName: innerName,
      tabularSectionName: tsName,
    };
  }

  if ((childTag === 'Form' || childTag === 'Command') && rest.length === 3) {
    const childName = rest[1];
    const moduleSegment = rest[2];
    assertSimpleName(childName, 'parseCanonicalPath/childName');
    // Контекст-зависимая привязка: после Форма.X модуль формы — это ChildForm
    // (то же сегмент МодульФормы используется и в CommonForm, но там нет имени).
    if (childTag === 'Form' && moduleSegment === MODULE_SEGMENT_MAP.ChildForm.segment) {
      return { kind: 'module', rootKind, rootName, slot: 'ChildForm', subPath: { tag: 'Form', name: childName } };
    }
    if (childTag === 'Command' && moduleSegment === MODULE_SEGMENT_MAP.ChildCommand.segment) {
      return { kind: 'module', rootKind, rootName, slot: 'ChildCommand', subPath: { tag: 'Command', name: childName } };
    }
    throw new Error(
      `parseCanonicalPath: для «${first}.${childName}» ожидается модуль ` +
      `«${childTag === 'Form' ? 'МодульФормы' : 'МодульКоманды'}», получено «${moduleSegment}» в «${input}»`,
    );
  }

  throw new Error(`parseCanonicalPath: неподдерживаемая структура пути «${input}»`);
}

// ─── Утилиты выборки ─────────────────────────────────────────────────────

/** Возвращает базовые типы, допустимые в указанном контексте. */
export function getBaseTypesForContext(context: BaseTypeContext): readonly BaseTypeInfo[] {
  return BASE_TYPES.filter((t) => t.contexts.includes(context));
}

/** Возвращает все ссылочные производные типы для указанного `MetaKind`. */
export function getRefKindsFor(kind: MetaKind): readonly RefKindInfo[] {
  return REF_KIND_MAP.filter((r) => r.metaKind === kind);
}
