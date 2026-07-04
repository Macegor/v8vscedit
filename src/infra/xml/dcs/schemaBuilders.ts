import type {
  SkdCalculatedFieldDefinition,
  SkdDataSetDefinition,
  SkdDefinition,
  SkdFieldDefinition,
  SkdParameterDefinition,
  SkdSettingsVariantDefinition,
  SkdStructureItemDefinition,
} from '../DataCompositionSchemaService';
import { escapeXmlText } from '../XmlUtils';
import { buildMlText, buildUseRestriction, emitValueType } from './dcsShared';
import { normalizeCalculated, normalizeField, parseCalculated, parseField, parseParameter } from './schemaParse';

export function buildSchemaXml(definition: SkdDefinition): string {
  const dataSources = definition.dataSources?.length ? definition.dataSources : [{ name: 'ИсточникДанных1', type: 'Local' }];
  const defaultSource = dataSources[0].name;
  const dataSets = definition.dataSets?.length ? definition.dataSets : [{ name: 'НаборДанных1', query: 'ВЫБРАТЬ 1 КАК Поле1', fields: ['Поле1: decimal(15,0)'] }];
  const parameters = definition.parameters ?? [];
  const variants = definition.settingsVariants?.length
    ? definition.settingsVariants
    : [{ name: 'Основной', title: 'Основной', selection: ['Auto'], structure: 'details', dataParameters: 'auto' as const }];

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<DataCompositionSchema xmlns="http://v8.1c.ru/8.1/data-composition-system/schema"',
    '\txmlns:dcscom="http://v8.1c.ru/8.1/data-composition-system/common"',
    '\txmlns:dcscor="http://v8.1c.ru/8.1/data-composition-system/core"',
    '\txmlns:dcsset="http://v8.1c.ru/8.1/data-composition-system/settings"',
    '\txmlns:v8="http://v8.1c.ru/8.1/data/core"',
    '\txmlns:v8ui="http://v8.1c.ru/8.1/data/ui"',
    '\txmlns:xs="http://www.w3.org/2001/XMLSchema"',
    '\txmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    ...dataSources.map((source) => buildDataSourceXml(source.name, source.type ?? 'Local')),
    ...dataSets.map((dataSet) => buildDataSetXml(dataSet, defaultSource)),
    ...(definition.calculatedFields ?? []).map(buildCalculatedFieldXml),
    ...(definition.totalFields ?? []).map(buildTotalFieldXml),
    ...parameters.flatMap(buildParameterXmlWithAutoDates),
    ...variants.map((variant) => buildVariantXml(variant, parameters)),
    '</DataCompositionSchema>',
    '',
  ].join('\n');
}

export function buildDataSourceXml(name: string, type: string): string {
  return ['\t<dataSource>', `\t\t<name>${escapeXmlText(name)}</name>`, `\t\t<dataSourceType>${escapeXmlText(type)}</dataSourceType>`, '\t</dataSource>'].join('\n');
}

export function buildDataSetXml(dataSet: SkdDataSetDefinition, defaultSource: string): string {
  return [
    '\t<dataSet xsi:type="DataSetQuery">',
    `\t\t<name>${escapeXmlText(dataSet.name)}</name>`,
    ...(dataSet.fields ?? []).map((field) => buildFieldXml(field, '\t\t')),
    `\t\t<dataSource>${escapeXmlText(dataSet.source ?? defaultSource)}</dataSource>`,
    `\t\t<query>${escapeXmlText(dataSet.query ?? '')}</query>`,
    '\t</dataSet>',
  ].join('\n');
}

export function buildFieldXml(field: string | SkdFieldDefinition, indent: string): string {
  const parsed = typeof field === 'string' ? parseField(field) : normalizeField(field);
  return [
    `${indent}<field xsi:type="DataSetFieldField">`,
    `${indent}\t<dataPath>${escapeXmlText(parsed.dataPath)}</dataPath>`,
    `${indent}\t<field>${escapeXmlText(parsed.field)}</field>`,
    parsed.title ? buildMlText('title', parsed.title, `${indent}\t`) : '',
    parsed.restrict.length > 0 ? buildUseRestriction(parsed.restrict, `${indent}\t`) : '',
    parsed.role ? `${indent}\t<role><dcscom:${escapeXmlText(parsed.role)}>true</dcscom:${escapeXmlText(parsed.role)}></role>` : '',
    parsed.type ? `${indent}\t<valueType>\n${emitValueType(parsed.type, `${indent}\t\t`)}\n${indent}\t</valueType>` : '',
    `${indent}</field>`,
  ].filter(Boolean).join('\n');
}

export function buildCalculatedFieldXml(field: string | SkdCalculatedFieldDefinition): string {
  const parsed = typeof field === 'string' ? parseCalculated(field) : normalizeCalculated(field);
  return [
    '\t<calculatedField>',
    `\t\t<dataPath>${escapeXmlText(parsed.dataPath)}</dataPath>`,
    `\t\t<expression>${escapeXmlText(parsed.expression)}</expression>`,
    parsed.title ? buildMlText('title', parsed.title, '\t\t') : '',
    parsed.restrict.length > 0 ? buildUseRestriction(parsed.restrict, '\t\t') : '',
    parsed.type ? `\t\t<valueType>\n${emitValueType(parsed.type, '\t\t\t')}\n\t\t</valueType>` : '',
    '\t</calculatedField>',
  ].filter(Boolean).join('\n');
}

export function buildTotalFieldXml(value: string): string {
  // split возвращает string[], но второй элемент может быть undefined.
  const parts = value.split(':');
  const dataPath = parts[0].trim();
  const rawExpression = parts[1] as string | undefined;
  const trimmedExpression = (rawExpression ?? '').trim();
  const expression = trimmedExpression.includes('(') ? trimmedExpression : `${trimmedExpression || 'Сумма'}(${dataPath})`;
  return ['\t<totalField>', `\t\t<dataPath>${escapeXmlText(dataPath)}</dataPath>`, `\t\t<expression>${escapeXmlText(expression)}</expression>`, '\t</totalField>'].join('\n');
}

export function buildParameterXmlWithAutoDates(parameter: string | SkdParameterDefinition): string[] {
  const parsed = typeof parameter === 'string' ? parseParameter(parameter) : parameter;
  const own = buildParameterXml(parsed);
  if (typeof parameter === 'string' && parameter.includes('@autoDates')) {
    return [
      own,
      buildParameterXml({ name: 'НачалоПериода', type: 'dateTime', hidden: true }),
      buildParameterXml({ name: 'КонецПериода', type: 'dateTime', hidden: true }),
    ];
  }
  return [own];
}

export function buildParameterXml(parameter: SkdParameterDefinition): string {
  return [
    '\t<parameter>',
    `\t\t<name>${escapeXmlText(parameter.name)}</name>`,
    parameter.title ? buildMlText('title', parameter.title, '\t\t') : '',
    parameter.type ? `\t\t<valueType>\n${emitValueType(parameter.type, '\t\t\t')}\n\t\t</valueType>` : '',
    parameter.hidden ? '\t\t<availableAsField>false</availableAsField>' : '',
    parameter.valueListAllowed ? '\t\t<valueListAllowed>true</valueListAllowed>' : '',
    parameter.use ? `\t\t<use>${escapeXmlText(parameter.use)}</use>` : '',
    parameter.denyIncompleteValues ? '\t\t<denyIncompleteValues>true</denyIncompleteValues>' : '',
    parameter.value !== undefined ? `\t\t<value>${escapeXmlText(String(parameter.value))}</value>` : '',
    '\t</parameter>',
  ].filter(Boolean).join('\n');
}

export function buildVariantXml(variant: SkdSettingsVariantDefinition, parameters: readonly (string | SkdParameterDefinition)[]): string {
  const selection = variant.selection?.length ? variant.selection : ['Auto'];
  return [
    '\t<settingsVariant>',
    `\t\t<name>${escapeXmlText(variant.name)}</name>`,
    buildMlText('title', variant.title ?? variant.name, '\t\t'),
    '\t\t<settings>',
    buildSelectionXml(selection, '\t\t\t'),
    ...(variant.filter ?? []).map((item) => buildFilterXml(item, '\t\t\t')),
    ...(variant.order ?? []).map((item) => buildOrderXml(item, '\t\t\t')),
    ...buildDataParametersXml(variant.dataParameters, parameters, '\t\t\t'),
    buildStructureXml(variant.structure ?? 'details', '\t\t\t'),
    '\t\t</settings>',
    '\t</settingsVariant>',
  ].join('\n');
}

export function buildSelectionXml(selection: readonly string[], indent: string): string {
  return [`${indent}<selection>`, ...selection.map((item) => item === 'Auto'
    ? `${indent}\t<item xsi:type="dcsset:SelectedItemAuto"/>`
    : `${indent}\t<item xsi:type="dcsset:SelectedItemField"><field>${escapeXmlText(item)}</field></item>`), `${indent}</selection>`].join('\n');
}

export function buildFilterXml(value: string, indent: string): string {
  const filter = parseFilter(value);
  return [
    `${indent}<filter>`,
    `${indent}\t<item xsi:type="dcsset:FilterItemComparison">`,
    !filter.use ? `${indent}\t\t<use>false</use>` : '',
    `${indent}\t\t<left>${escapeXmlText(filter.field)}</left>`,
    `${indent}\t\t<comparisonType>${escapeXmlText(filter.op)}</comparisonType>`,
    filter.value ? `${indent}\t\t<right>${escapeXmlText(filter.value)}</right>` : '',
    filter.user ? `${indent}\t\t<userSettingID>${escapeXmlText(filter.field)}</userSettingID>` : '',
    `${indent}\t</item>`,
    `${indent}</filter>`,
  ].filter(Boolean).join('\n');
}

export function buildOrderXml(value: string, indent: string): string {
  const trimmed = value.trim();
  if (trimmed === 'Auto') {
    return `${indent}<order><item xsi:type="dcsset:OrderItemAuto"/></order>`;
  }
  const desc = /\s+desc$/i.test(trimmed);
  const field = trimmed.replace(/\s+desc$/i, '');
  return `${indent}<order><item><field>${escapeXmlText(field)}</field><orderType>${desc ? 'Desc' : 'Asc'}</orderType></item></order>`;
}

export function buildDataParametersXml(value: readonly string[] | 'auto' | undefined, parameters: readonly (string | SkdParameterDefinition)[], indent: string): string[] {
  const items = value === 'auto'
    ? parameters.map((parameter) => typeof parameter === 'string' ? parseParameter(parameter).name : parameter.name)
    : value ?? [];
  if (items.length === 0) {
    return [];
  }
  return [`${indent}<dataParameters>`, ...items.map((item) => `${indent}\t<item><parameter>${escapeXmlText(item.replace(/\s*=.*/, '').trim())}</parameter><userSettingID>${escapeXmlText(item.replace(/\s*=.*/, '').trim())}</userSettingID></item>`), `${indent}</dataParameters>`];
}

export function buildStructureXml(structure: string | readonly SkdStructureItemDefinition[], indent: string): string {
  if (typeof structure !== 'string') {
    return [`${indent}<structure>`, ...structure.map((item) => buildStructureItemXml(item, `${indent}\t`)), `${indent}</structure>`].join('\n');
  }
  const parts = structure.split('>').map((part) => part.trim()).filter(Boolean);
  const item = parts.reduceRight<SkdStructureItemDefinition | null>((child, part) => ({
    groupFields: part === 'details' || part === 'детали' ? [] : [part],
    children: child ? [child] : [],
  }), null);
  return [`${indent}<structure>`, item ? buildStructureItemXml(item, `${indent}\t`) : buildStructureItemXml({ groupFields: [] }, `${indent}\t`), `${indent}</structure>`].join('\n');
}

export function buildStructureItemXml(item: SkdStructureItemDefinition, indent: string): string {
  const fields = item.groupFields ?? item.groupBy ?? [];
  return [
    `${indent}<item xsi:type="dcsset:StructureItemGroup">`,
    item.name ? `${indent}\t<name>${escapeXmlText(item.name)}</name>` : '',
    fields.length > 0 ? `${indent}\t<groupItems>${fields.map((field) => `<item><field>${escapeXmlText(field)}</field><groupType>Items</groupType></item>`).join('')}</groupItems>` : '',
    item.selection ? buildSelectionXml(item.selection, `${indent}\t`) : buildSelectionXml(['Auto'], `${indent}\t`),
    ...(item.children ?? []).map((child) => buildStructureItemXml(child, `${indent}\t`)),
    `${indent}</item>`,
  ].filter(Boolean).join('\n');
}

function parseFilter(value: string): { field: string; op: string; value: string; use: boolean; user: boolean } {
  const user = value.includes('@user');
  const use = !value.includes('@off');
  const clean = value.replace(/\s*@\w+/g, '').trim();
  const match = /^(.+?)\s*(<>|>=|<=|=|>|<|filled|notFilled)\s*(.*)$/.exec(clean);
  const opMap: Record<string, string> = { '=': 'Equal', '<>': 'NotEqual', '>': 'Greater', '>=': 'GreaterOrEqual', '<': 'Less', '<=': 'LessOrEqual', filled: 'Filled', notFilled: 'NotFilled' };
  return {
    field: match?.[1]?.trim() ?? clean,
    op: opMap[match?.[2] ?? '='] ?? 'Equal',
    value: match?.[3]?.trim() === '_' ? '' : match?.[3]?.trim() ?? '',
    use,
    user,
  };
}
