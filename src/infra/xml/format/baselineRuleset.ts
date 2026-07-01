import type { MetaKind } from '../../../domain/MetaTypes';
import { buildTypedFieldPropertyBlocks, type TypeAwarePropertyOwnerKind } from '../TypedFieldPropertyRules';
import type { FormatRuleset, GeneratedTypeDef, GeneratedTypeRef } from './FormatRuleset';

/**
 * Таблица сгенерированных типов (`xr:GeneratedType`) текущего формата.
 * Перенесена сюда из `MetadataXmlCreator` без изменений: это формат-зависимые
 * данные, и их место — в ruleset.
 */
const BASELINE_GENERATED_TYPES: Partial<Record<MetaKind, readonly GeneratedTypeDef[]>> = {
  Catalog: [
    { prefix: 'CatalogObject', category: 'Object' },
    { prefix: 'CatalogRef', category: 'Ref' },
    { prefix: 'CatalogSelection', category: 'Selection' },
    { prefix: 'CatalogList', category: 'List' },
    { prefix: 'CatalogManager', category: 'Manager' },
  ],
  Document: [
    { prefix: 'DocumentObject', category: 'Object' },
    { prefix: 'DocumentRef', category: 'Ref' },
    { prefix: 'DocumentSelection', category: 'Selection' },
    { prefix: 'DocumentList', category: 'List' },
    { prefix: 'DocumentManager', category: 'Manager' },
  ],
  Enum: [
    { prefix: 'EnumRef', category: 'Ref' },
    { prefix: 'EnumManager', category: 'Manager' },
    { prefix: 'EnumList', category: 'List' },
  ],
  Constant: [
    { prefix: 'ConstantManager', category: 'Manager' },
    { prefix: 'ConstantValueManager', category: 'ValueManager' },
    { prefix: 'ConstantValueKey', category: 'ValueKey' },
  ],
  InformationRegister: [
    { prefix: 'InformationRegisterRecord', category: 'Record' },
    { prefix: 'InformationRegisterManager', category: 'Manager' },
    { prefix: 'InformationRegisterSelection', category: 'Selection' },
    { prefix: 'InformationRegisterList', category: 'List' },
    { prefix: 'InformationRegisterRecordSet', category: 'RecordSet' },
    { prefix: 'InformationRegisterRecordKey', category: 'RecordKey' },
    { prefix: 'InformationRegisterRecordManager', category: 'RecordManager' },
  ],
  AccumulationRegister: [
    { prefix: 'AccumulationRegisterRecord', category: 'Record' },
    { prefix: 'AccumulationRegisterManager', category: 'Manager' },
    { prefix: 'AccumulationRegisterSelection', category: 'Selection' },
    { prefix: 'AccumulationRegisterList', category: 'List' },
    { prefix: 'AccumulationRegisterRecordSet', category: 'RecordSet' },
    { prefix: 'AccumulationRegisterRecordKey', category: 'RecordKey' },
  ],
  AccountingRegister: [
    { prefix: 'AccountingRegisterRecord', category: 'Record' },
    { prefix: 'AccountingRegisterExtDimensions', category: 'ExtDimensions' },
    { prefix: 'AccountingRegisterRecordSet', category: 'RecordSet' },
    { prefix: 'AccountingRegisterRecordKey', category: 'RecordKey' },
    { prefix: 'AccountingRegisterSelection', category: 'Selection' },
    { prefix: 'AccountingRegisterList', category: 'List' },
    { prefix: 'AccountingRegisterManager', category: 'Manager' },
  ],
  CalculationRegister: [
    { prefix: 'CalculationRegisterRecord', category: 'Record' },
    { prefix: 'CalculationRegisterManager', category: 'Manager' },
    { prefix: 'CalculationRegisterSelection', category: 'Selection' },
    { prefix: 'CalculationRegisterList', category: 'List' },
    { prefix: 'CalculationRegisterRecordSet', category: 'RecordSet' },
    { prefix: 'CalculationRegisterRecordKey', category: 'RecordKey' },
    { prefix: 'RecalculationsManager', category: 'Recalcs' },
  ],
  ChartOfAccounts: [
    { prefix: 'ChartOfAccountsObject', category: 'Object' },
    { prefix: 'ChartOfAccountsRef', category: 'Ref' },
    { prefix: 'ChartOfAccountsSelection', category: 'Selection' },
    { prefix: 'ChartOfAccountsList', category: 'List' },
    { prefix: 'ChartOfAccountsManager', category: 'Manager' },
    { prefix: 'ChartOfAccountsExtDimensionTypes', category: 'ExtDimensionTypes' },
    { prefix: 'ChartOfAccountsExtDimensionTypesRow', category: 'ExtDimensionTypesRow' },
  ],
  ChartOfCharacteristicTypes: [
    { prefix: 'ChartOfCharacteristicTypesObject', category: 'Object' },
    { prefix: 'ChartOfCharacteristicTypesRef', category: 'Ref' },
    { prefix: 'ChartOfCharacteristicTypesSelection', category: 'Selection' },
    { prefix: 'ChartOfCharacteristicTypesList', category: 'List' },
    { prefix: 'ChartOfCharacteristicTypesCharacteristic', category: 'Characteristic' },
    { prefix: 'ChartOfCharacteristicTypesManager', category: 'Manager' },
  ],
  ChartOfCalculationTypes: [
    { prefix: 'ChartOfCalculationTypesObject', category: 'Object' },
    { prefix: 'ChartOfCalculationTypesRef', category: 'Ref' },
    { prefix: 'ChartOfCalculationTypesSelection', category: 'Selection' },
    { prefix: 'ChartOfCalculationTypesList', category: 'List' },
    { prefix: 'ChartOfCalculationTypesManager', category: 'Manager' },
    { prefix: 'DisplacingCalculationTypes', category: 'DisplacingCalculationTypes' },
    { prefix: 'DisplacingCalculationTypesRow', category: 'DisplacingCalculationTypesRow' },
    { prefix: 'BaseCalculationTypes', category: 'BaseCalculationTypes' },
    { prefix: 'BaseCalculationTypesRow', category: 'BaseCalculationTypesRow' },
    { prefix: 'LeadingCalculationTypes', category: 'LeadingCalculationTypes' },
    { prefix: 'LeadingCalculationTypesRow', category: 'LeadingCalculationTypesRow' },
  ],
  BusinessProcess: [
    { prefix: 'BusinessProcessObject', category: 'Object' },
    { prefix: 'BusinessProcessRef', category: 'Ref' },
    { prefix: 'BusinessProcessSelection', category: 'Selection' },
    { prefix: 'BusinessProcessList', category: 'List' },
    { prefix: 'BusinessProcessManager', category: 'Manager' },
    { prefix: 'BusinessProcessRoutePointRef', category: 'RoutePointRef' },
  ],
  Task: [
    { prefix: 'TaskObject', category: 'Object' },
    { prefix: 'TaskRef', category: 'Ref' },
    { prefix: 'TaskSelection', category: 'Selection' },
    { prefix: 'TaskList', category: 'List' },
    { prefix: 'TaskManager', category: 'Manager' },
  ],
  ExchangePlan: [
    { prefix: 'ExchangePlanObject', category: 'Object' },
    { prefix: 'ExchangePlanRef', category: 'Ref' },
    { prefix: 'ExchangePlanSelection', category: 'Selection' },
    { prefix: 'ExchangePlanList', category: 'List' },
    { prefix: 'ExchangePlanManager', category: 'Manager' },
  ],
  DefinedType: [
    { prefix: 'DefinedType', category: 'DefinedType' },
  ],
  DocumentJournal: [
    { prefix: 'DocumentJournalSelection', category: 'Selection' },
    { prefix: 'DocumentJournalList', category: 'List' },
    { prefix: 'DocumentJournalManager', category: 'Manager' },
  ],
  Report: [
    { prefix: 'ReportObject', category: 'Object' },
    { prefix: 'ReportManager', category: 'Manager' },
  ],
  DataProcessor: [
    { prefix: 'DataProcessorObject', category: 'Object' },
    { prefix: 'DataProcessorManager', category: 'Manager' },
  ],
};

/**
 * Базовый ruleset — текущее поведение генерации, на которое ссылаются все
 * поддерживаемые сейчас версии формата. Значения перенесены из
 * `MetadataXmlCreator` дословно, поэтому вывод побайтово совпадает с прежним.
 */
export const BASELINE_RULESET: FormatRuleset = {
  id: 'baseline',
  // Полный набор пространств имён формата 2.21 — 1С пишет его одинаковым для
  // всех корневых `MetaDataObject` независимо от того, какие префиксы реально
  // используются в файле. Снято с донора UNFEVOLC (src/cf).
  metaDataObjectXmlns:
    'xmlns="http://v8.1c.ru/8.3/MDClasses" xmlns:app="http://v8.1c.ru/8.2/managed-application/core" xmlns:cfg="http://v8.1c.ru/8.1/data/enterprise/current-config" xmlns:cmi="http://v8.1c.ru/8.2/managed-application/cmi" xmlns:ent="http://v8.1c.ru/8.1/data/enterprise" xmlns:lf="http://v8.1c.ru/8.2/managed-application/logform" xmlns:pal="http://v8.1c.ru/8.1/data/ui/colors/palette" xmlns:style="http://v8.1c.ru/8.1/data/ui/style" xmlns:sys="http://v8.1c.ru/8.1/data/ui/fonts/system" xmlns:v8="http://v8.1c.ru/8.1/data/core" xmlns:v8ui="http://v8.1c.ru/8.1/data/ui" xmlns:web="http://v8.1c.ru/8.1/data/ui/colors/web" xmlns:win="http://v8.1c.ru/8.1/data/ui/colors/windows" xmlns:xen="http://v8.1c.ru/8.3/xcf/enums" xmlns:xpr="http://v8.1c.ru/8.3/xcf/predef" xmlns:xr="http://v8.1c.ru/8.3/xcf/readable" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
  generatedTypes: BASELINE_GENERATED_TYPES,

  buildDefaultTypeBlock(indent: string): string {
    return [
      `${indent}<Type>`,
      `${indent}\t<v8:Type>xs:string</v8:Type>`,
      `${indent}\t<v8:StringQualifiers>`,
      `${indent}\t\t<v8:Length>10</v8:Length>`,
      `${indent}\t\t<v8:AllowedLength>Variable</v8:AllowedLength>`,
      `${indent}\t</v8:StringQualifiers>`,
      `${indent}</Type>`,
    ].join('\n');
  },

  // Наборы и порядок свойств типизированных полей — общий алгоритм для
  // генерации и для перестроения после смены типа. Таблицы живут в
  // TypedFieldPropertyRules (используются и путём правки), ruleset владеет
  // привязкой, чтобы будущий формат мог их переопределить.
  buildTypedFieldProperties(kind: TypeAwarePropertyOwnerKind, typeInnerXml: string, indent: string): readonly string[] {
    return buildTypedFieldPropertyBlocks(kind, typeInnerXml, indent);
  },

  tabularSectionGeneratedTypes(ownerKind: string, ownerName: string, sectionName: string): readonly GeneratedTypeRef[] {
    const suffix = `${ownerName}.${sectionName}`;
    return [
      { name: `${ownerKind}TabularSection.${suffix}`, category: 'TabularSection' },
      { name: `${ownerKind}TabularSectionRow.${suffix}`, category: 'TabularSectionRow' },
    ];
  },
};
