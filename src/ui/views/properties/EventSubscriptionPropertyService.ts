import * as fs from 'fs';
import * as path from 'path';
import { parseConfigXml } from '../../../infra/xml';
import { getPropertyTitle } from './PropertyPresentationRegistry';
import {
  extractFirstBalancedBlock,
  extractTopLevelPropertiesChildren,
  parseLocalizedStringSection,
} from './MetadataXmlPropertiesService';
import { buildMetadataTypeItem, parseMetadataType } from './MetadataTypeService';
import type {
  EnumPropertyOption,
  EnumPropertyValue,
  MetadataTypeItem,
  MetadataTypeValue,
  ObjectPropertiesCollection,
} from './_types';

type EventSourceKind =
  | 'CatalogObject'
  | 'CatalogManager'
  | 'DocumentObject'
  | 'DocumentManager'
  | 'ConstantValueManager'
  | 'ExchangePlanObject'
  | 'BusinessProcessObject'
  | 'BusinessProcessManager'
  | 'TaskObject'
  | 'ChartOfAccountsObject'
  | 'ChartOfCalculationTypesObject'
  | 'ChartOfCharacteristicTypesObject'
  | 'InformationRegisterRecordSet'
  | 'InformationRegisterManager'
  | 'AccumulationRegisterRecordSet'
  | 'AccountingRegisterRecordSet'
  | 'CalculationRegisterRecordSet'
  | 'SequenceRecordSet'
  | 'RecalculationRecordSet'
  | 'ReportManager'
  | 'DataProcessorManager';

const EVENT_LABELS: Record<string, string> = {
  BeforeWrite: 'Перед записью',
  OnWrite: 'При записи',
  BeforeDelete: 'Перед удалением',
  OnCopy: 'При копировании',
  Filling: 'Обработка заполнения',
  FillCheckProcessing: 'Обработка проверки заполнения',
  OnSetNewCode: 'При установке нового кода',
  OnSetNewNumber: 'При установке нового номера',
  Posting: 'Обработка проведения',
  UndoPosting: 'Обработка отмены проведения',
  FormGetProcessing: 'Обработка получения формы',
  PresentationGetProcessing: 'Обработка получения представления',
  PresentationFieldsGetProcessing: 'Обработка получения полей представления',
  ChoiceDataGetProcessing: 'Обработка получения данных выбора',
  OnSendDataToMaster: 'При отправке данных главному',
  OnSendDataToSlave: 'При отправке данных подчиненному',
  OnSendNodeDataToSlave: 'При отправке данных узла подчиненному',
  OnReceiveDataFromMaster: 'При получении данных от главного',
  OnReceiveDataFromSlave: 'При получении данных от подчиненного',
};

const EVENT_ORDER = Object.keys(EVENT_LABELS);
const EVENT_SUBSCRIPTION_PROPERTY_TITLES: Record<string, string> = {
  Name: 'Имя',
  Synonym: 'Синоним',
  Comment: 'Комментарий',
  Source: 'Источник',
  Event: 'Событие',
  Handler: 'Обработчик',
  ProcedureName: 'Имя процедуры',
  SuppressObject: 'Не выполнять обработчик объекта',
};

const SOURCE_EVENTS: Record<EventSourceKind, readonly string[]> = {
  CatalogObject: ['BeforeWrite', 'OnWrite', 'BeforeDelete', 'OnCopy', 'Filling', 'FillCheckProcessing', 'OnSetNewCode'],
  CatalogManager: ['FormGetProcessing', 'ChoiceDataGetProcessing'],
  DocumentObject: ['BeforeWrite', 'OnWrite', 'BeforeDelete', 'OnCopy', 'Filling', 'FillCheckProcessing', 'OnSetNewNumber', 'Posting', 'UndoPosting'],
  DocumentManager: ['FormGetProcessing', 'PresentationGetProcessing', 'PresentationFieldsGetProcessing'],
  ConstantValueManager: ['BeforeWrite', 'OnWrite', 'FillCheckProcessing'],
  ExchangePlanObject: [
    'BeforeWrite',
    'OnWrite',
    'BeforeDelete',
    'OnSendDataToMaster',
    'OnSendDataToSlave',
    'OnSendNodeDataToSlave',
    'OnReceiveDataFromMaster',
    'OnReceiveDataFromSlave',
  ],
  BusinessProcessObject: ['BeforeWrite', 'OnWrite', 'BeforeDelete', 'FillCheckProcessing'],
  BusinessProcessManager: ['PresentationGetProcessing', 'PresentationFieldsGetProcessing'],
  TaskObject: ['BeforeWrite', 'BeforeDelete', 'FillCheckProcessing'],
  ChartOfAccountsObject: ['BeforeWrite', 'BeforeDelete'],
  ChartOfCalculationTypesObject: ['BeforeWrite', 'OnWrite', 'BeforeDelete'],
  ChartOfCharacteristicTypesObject: ['BeforeWrite', 'OnWrite', 'BeforeDelete', 'FillCheckProcessing'],
  InformationRegisterRecordSet: ['BeforeWrite', 'OnWrite', 'FillCheckProcessing'],
  InformationRegisterManager: ['FormGetProcessing'],
  AccumulationRegisterRecordSet: ['BeforeWrite', 'OnWrite'],
  AccountingRegisterRecordSet: ['BeforeWrite'],
  CalculationRegisterRecordSet: ['BeforeWrite'],
  SequenceRecordSet: ['BeforeWrite'],
  RecalculationRecordSet: ['BeforeWrite'],
  ReportManager: ['FormGetProcessing'],
  DataProcessorManager: ['FormGetProcessing'],
};

/** Строит свойства подписки на событие: источник как состав типов, событие как зависимый список. */
export class EventSubscriptionPropertyService {
  buildProperties(fullObjectXml: string, sourceXmlPath: string | undefined): ObjectPropertiesCollection {
    return buildEventSubscriptionProperties(fullObjectXml, sourceXmlPath);
  }

  getEventOptionsForSource(sourceValue: MetadataTypeValue, sourceXmlPath: string | undefined): EnumPropertyOption[] {
    return getEventOptionsForSource(sourceValue, sourceXmlPath);
  }
}

/** Строит свойства подписки на событие без состояния, чтобы builder дерева не создавал сервисы. */
export function buildEventSubscriptionProperties(
  fullObjectXml: string,
  sourceXmlPath: string | undefined
): ObjectPropertiesCollection {
  const propertiesInner = extractFirstBalancedBlock(fullObjectXml, 'Properties');
  if (propertiesInner === null) {
    return [];
  }

  const childrenByTag = new Map(
    extractTopLevelPropertiesChildren(`<Properties>${propertiesInner}</Properties>`).map((child) => [child.tag, child.inner])
  );
  const sourceType = parseMetadataType(childrenByTag.get('Source') ?? '');
  const event = stripXmlText(childrenByTag.get('Event') ?? '');
  const handler = stripXmlText(childrenByTag.get('Handler') ?? childrenByTag.get('ProcedureName') ?? '');
  const result: ObjectPropertiesCollection = [];

  const name = stripXmlText(childrenByTag.get('Name') ?? '');
  if (name || childrenByTag.has('Name')) {
    result.push({
      key: 'Name',
      title: propertyTitle('Name'),
      kind: 'string',
      value: name,
    });
  }

  if (childrenByTag.has('Synonym')) {
    const synonym = parseLocalizedStringSection(childrenByTag.get('Synonym') ?? '');
    if (synonym.presentation || synonym.values.length > 0) {
      result.push({
        key: 'Synonym',
        title: propertyTitle('Synonym'),
        kind: 'localizedString',
        value: synonym,
      });
    }
  }

  if (childrenByTag.has('Comment')) {
    const comment = parseLocalizedStringSection(childrenByTag.get('Comment') ?? '');
    if (comment.presentation || comment.values.length > 0) {
      result.push({
        key: 'Comment',
        title: propertyTitle('Comment'),
        kind: 'localizedString',
        value: comment,
      });
    }
  }

  if (childrenByTag.has('Source')) {
    result.push({
      key: 'Source',
      title: 'Источник',
      kind: 'metadataType',
      value: sourceType,
    });
  }

  if (childrenByTag.has('Event')) {
    result.push({
      key: 'Event',
      title: propertyTitle('Event'),
      kind: 'enum',
      value: buildEventValue(event, getEventOptionsForSource(sourceType, sourceXmlPath)),
    });
  }

  if (childrenByTag.has('Handler') || childrenByTag.has('ProcedureName')) {
    result.push({
      key: childrenByTag.has('Handler') ? 'Handler' : 'ProcedureName',
      title: propertyTitle(childrenByTag.has('Handler') ? 'Handler' : 'ProcedureName'),
      kind: 'string',
      value: handler,
    });
  }

  if (childrenByTag.has('SuppressObject')) {
    const suppressObject = stripXmlText(childrenByTag.get('SuppressObject') ?? '');
    result.push({
      key: 'SuppressObject',
      title: propertyTitle('SuppressObject'),
      kind: suppressObject.toLowerCase() === 'true' || suppressObject.toLowerCase() === 'false' ? 'boolean' : 'string',
      value: suppressObject.toLowerCase() === 'true' || suppressObject.toLowerCase() === 'false'
        ? suppressObject.toLowerCase() === 'true'
        : suppressObject,
    });
  }

  return result;
}

export function getEventOptionsForSource(sourceValue: MetadataTypeValue, sourceXmlPath: string | undefined): EnumPropertyOption[] {
  const expandedKinds = expandSourceKinds(sourceValue, sourceXmlPath, new Set<string>());
  if (expandedKinds.length === 0) {
    return EVENT_ORDER.map(toEventOption);
  }

  let intersection: Set<string> | null = null;
  for (const kind of expandedKinds) {
    const events = SOURCE_EVENTS[kind];
    const current = new Set<string>(events);
    if (intersection === null) {
      intersection = current;
    } else {
      const previous: Set<string> = intersection;
      intersection = new Set<string>(Array.from(previous).filter((event) => current.has(event)));
    }
  }

  const values = intersection ? [...intersection] : [];
  return EVENT_ORDER.filter((event) => values.includes(event)).map(toEventOption);
}

/** Формирует внутренность блока `<Source>` для подписки на событие. */
export function buildEventSourceInnerXml(typeValue: MetadataTypeValue): string {
  return typeValue.items
    .map((item) => {
      if (item.canonical.startsWith('DefinedType.') || isGenericEventSource(item.canonical)) {
        return `<v8:TypeSet>cfg:${item.canonical}</v8:TypeSet>`;
      }
      return `<v8:Type>cfg:${item.canonical}</v8:Type>`;
    })
    .join('\n');
}

export function getEventSourceKind(canonical: string): EventSourceKind | null {
  const kind = canonical.includes('.') ? canonical.slice(0, canonical.indexOf('.')) : canonical;
  return isEventSourceKind(kind) ? kind : null;
}

export function isGenericEventSource(canonical: string): boolean {
  return !canonical.includes('.') && isEventSourceKind(canonical);
}

function buildEventValue(current: string, options: EnumPropertyOption[]): EnumPropertyValue {
  const completeOptions = options.some((option) => option.value === current) || !current
    ? options
    : [...options, toEventOption(current)];
  const opt = completeOptions.find((option) => option.value === current);
  return {
    current,
    currentLabel: opt?.label ?? current,
    allowedValues: completeOptions,
  };
}

function expandSourceKinds(
  sourceValue: MetadataTypeValue,
  sourceXmlPath: string | undefined,
  seenDefinedTypes: Set<string>
): EventSourceKind[] {
  const result: EventSourceKind[] = [];
  for (const item of sourceValue.items) {
    if (item.canonical.startsWith('DefinedType.')) {
      const definedTypeName = item.canonical.slice('DefinedType.'.length);
      const nested = readDefinedTypeSourceValue(definedTypeName, sourceXmlPath, seenDefinedTypes);
      if (nested) {
        result.push(...expandSourceKinds(nested, sourceXmlPath, seenDefinedTypes));
      }
      continue;
    }
    const kind = getEventSourceKind(item.canonical);
    if (kind) {
      result.push(kind);
    }
  }
  return result;
}

function readDefinedTypeSourceValue(
  name: string,
  sourceXmlPath: string | undefined,
  seenDefinedTypes: Set<string>
): MetadataTypeValue | null {
  if (seenDefinedTypes.has(name)) {
    return null;
  }
  seenDefinedTypes.add(name);

  const configXml = resolveConfigurationXml(sourceXmlPath);
  if (!configXml) {
    return null;
  }
  const definedTypeXmlPath = path.join(path.dirname(configXml), 'DefinedTypes', `${name}.xml`);
  if (!fs.existsSync(definedTypeXmlPath)) {
    return null;
  }
  try {
    const xml = fs.readFileSync(definedTypeXmlPath, 'utf-8');
    return parseMetadataType(extractFirstBalancedBlock(xml, 'Type') ?? '');
  } catch {
    return null;
  }
}

function resolveConfigurationXml(sourceXmlPath: string | undefined): string | null {
  if (!sourceXmlPath) {
    return null;
  }
  let current = path.dirname(sourceXmlPath);
  for (;;) {
    const cfg = path.join(current, 'Configuration.xml');
    if (fs.existsSync(cfg)) {
      return cfg;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function stripXmlText(inner: string): string {
  return inner.replace(/<[^>]+>/g, '').trim();
}

function toEventOption(value: string): EnumPropertyOption {
  return { value, label: EVENT_LABELS[value] ?? value };
}

function propertyTitle(key: string): string {
  return getPropertyTitle(key, EVENT_SUBSCRIPTION_PROPERTY_TITLES);
}

function isEventSourceKind(kind: string): kind is EventSourceKind {
  return Object.prototype.hasOwnProperty.call(SOURCE_EVENTS, kind);
}

/**
 * Возвращает конкретные источники из Configuration.xml для заполнения списка выбора.
 * Функция живет рядом с правилами подписок, потому что набор Object/Manager/RecordSet
 * специфичен именно для свойства Source.
 */
export function buildEventSourceItemsFromConfiguration(sourceXmlPath: string | undefined): {
  id: string;
  title: string;
  items: MetadataTypeItem[];
}[] {
  const configXml = resolveConfigurationXml(sourceXmlPath);
  if (!configXml || !fs.existsSync(configXml)) {
    return [];
  }
  try {
    const cfg = parseConfigXml(configXml);
    const groups: {
      id: string;
      title: string;
      sourceKinds: { childObjectKey: string; sourcePrefix: EventSourceKind }[];
    }[] = [
      { id: 'Catalog', title: 'Справочники', sourceKinds: [{ childObjectKey: 'Catalog', sourcePrefix: 'CatalogObject' }, { childObjectKey: 'Catalog', sourcePrefix: 'CatalogManager' }] },
      { id: 'Document', title: 'Документы', sourceKinds: [{ childObjectKey: 'Document', sourcePrefix: 'DocumentObject' }, { childObjectKey: 'Document', sourcePrefix: 'DocumentManager' }] },
      { id: 'Constant', title: 'Константы', sourceKinds: [{ childObjectKey: 'Constant', sourcePrefix: 'ConstantValueManager' }] },
      { id: 'ExchangePlan', title: 'Планы обмена', sourceKinds: [{ childObjectKey: 'ExchangePlan', sourcePrefix: 'ExchangePlanObject' }] },
      { id: 'BusinessProcess', title: 'Бизнес-процессы', sourceKinds: [{ childObjectKey: 'BusinessProcess', sourcePrefix: 'BusinessProcessObject' }, { childObjectKey: 'BusinessProcess', sourcePrefix: 'BusinessProcessManager' }] },
      { id: 'Task', title: 'Задачи', sourceKinds: [{ childObjectKey: 'Task', sourcePrefix: 'TaskObject' }] },
      { id: 'ChartOfAccounts', title: 'Планы счетов', sourceKinds: [{ childObjectKey: 'ChartOfAccounts', sourcePrefix: 'ChartOfAccountsObject' }] },
      { id: 'ChartOfCalculationTypes', title: 'Планы видов расчета', sourceKinds: [{ childObjectKey: 'ChartOfCalculationTypes', sourcePrefix: 'ChartOfCalculationTypesObject' }] },
      { id: 'ChartOfCharacteristicTypes', title: 'Планы видов характеристик', sourceKinds: [{ childObjectKey: 'ChartOfCharacteristicTypes', sourcePrefix: 'ChartOfCharacteristicTypesObject' }] },
      { id: 'InformationRegister', title: 'Регистры сведений', sourceKinds: [{ childObjectKey: 'InformationRegister', sourcePrefix: 'InformationRegisterRecordSet' }, { childObjectKey: 'InformationRegister', sourcePrefix: 'InformationRegisterManager' }] },
      { id: 'AccumulationRegister', title: 'Регистры накопления', sourceKinds: [{ childObjectKey: 'AccumulationRegister', sourcePrefix: 'AccumulationRegisterRecordSet' }] },
      { id: 'AccountingRegister', title: 'Регистры бухгалтерии', sourceKinds: [{ childObjectKey: 'AccountingRegister', sourcePrefix: 'AccountingRegisterRecordSet' }] },
      { id: 'CalculationRegister', title: 'Регистры расчета', sourceKinds: [{ childObjectKey: 'CalculationRegister', sourcePrefix: 'CalculationRegisterRecordSet' }] },
      { id: 'Sequence', title: 'Последовательности', sourceKinds: [{ childObjectKey: 'Sequence', sourcePrefix: 'SequenceRecordSet' }] },
      { id: 'Report', title: 'Отчеты', sourceKinds: [{ childObjectKey: 'Report', sourcePrefix: 'ReportManager' }] },
      { id: 'DataProcessor', title: 'Обработки', sourceKinds: [{ childObjectKey: 'DataProcessor', sourcePrefix: 'DataProcessorManager' }] },
      { id: 'DefinedType', title: 'Определяемые типы', sourceKinds: [] },
    ];

    return groups
      .map((group) => {
        if (group.id === 'DefinedType') {
          const names = cfg.childObjects.get('DefinedType') ?? [];
          return {
            id: group.id,
            title: group.title,
            items: names.map((name) => buildMetadataTypeItem(`DefinedType.${name}`)),
          };
        }
        const items = group.sourceKinds.flatMap((source) => {
          const names = cfg.childObjects.get(source.childObjectKey) ?? [];
          return names.map((name) => buildMetadataTypeItem(`${source.sourcePrefix}.${name}`));
        });
        return { id: group.id, title: group.title, items };
      })
      .filter((group) => group.items.length > 0);
  } catch {
    return [];
  }
}
