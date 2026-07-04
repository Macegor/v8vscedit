import * as fs from 'fs';
import * as path from 'path';
import { XMLValidator } from 'fast-xml-parser';
import {
  escapeRegExp,
  escapeXmlText,
  findDirectElementRanges,
  findNestingAwareElementRange,
  unescapeXml,
  writeTextFilePreservingBomAndEol,
} from './XmlUtils';

const SCHEMA_NS = 'http://v8.1c.ru/8.1/data-composition-system/schema';

export type SkdInfoMode = 'overview' | 'query' | 'fields' | 'calculated' | 'resources' | 'params' | 'variant' | 'full';

export interface SkdCompileOptions {
  readonly outputPath: string;
  readonly definition: SkdDefinition;
}

export interface SkdDefinition {
  readonly dataSources?: readonly { readonly name: string; readonly type?: string }[];
  readonly dataSets?: readonly SkdDataSetDefinition[];
  readonly calculatedFields?: readonly (string | SkdCalculatedFieldDefinition)[];
  readonly totalFields?: readonly string[];
  readonly parameters?: readonly (string | SkdParameterDefinition)[];
  readonly settingsVariants?: readonly SkdSettingsVariantDefinition[];
}

export interface SkdDataSetDefinition {
  readonly name: string;
  readonly query?: string;
  readonly source?: string;
  readonly fields?: readonly (string | SkdFieldDefinition)[];
}

export interface SkdFieldDefinition {
  readonly field?: string;
  readonly dataPath?: string;
  readonly title?: string;
  readonly type?: string;
  readonly role?: string;
  readonly restrict?: readonly string[];
}

export interface SkdCalculatedFieldDefinition {
  readonly name?: string;
  readonly dataPath?: string;
  readonly title?: string;
  readonly expression?: string;
  readonly type?: string;
  readonly restrict?: readonly string[] | string;
}

export interface SkdParameterDefinition {
  readonly name: string;
  readonly title?: string;
  readonly type?: string;
  readonly value?: string | number | boolean;
  readonly hidden?: boolean;
  readonly valueListAllowed?: boolean;
  readonly use?: string;
  readonly denyIncompleteValues?: boolean;
}

export interface SkdSettingsVariantDefinition {
  readonly name: string;
  readonly title?: string;
  readonly selection?: readonly string[];
  readonly filter?: readonly string[];
  readonly order?: readonly string[];
  readonly dataParameters?: readonly string[] | 'auto';
  readonly structure?: string | readonly SkdStructureItemDefinition[];
}

export interface SkdStructureItemDefinition {
  readonly name?: string;
  readonly groupFields?: readonly string[];
  readonly groupBy?: readonly string[];
  readonly selection?: readonly string[];
  readonly children?: readonly SkdStructureItemDefinition[];
}

export interface SkdCompileResult {
  readonly templatePath: string;
  readonly changedFiles: readonly string[];
  readonly dataSets: readonly string[];
  readonly parameters: readonly string[];
}

export interface SkdInfoOptions {
  readonly templatePath: string;
  readonly mode?: SkdInfoMode;
  readonly name?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface SkdInfoResult {
  readonly templatePath: string;
  readonly dataSets: readonly SkdDataSetInfo[];
  readonly calculatedFields: readonly SkdCalculatedFieldInfo[];
  readonly totalFields: readonly { readonly dataPath: string; readonly expression: string }[];
  readonly parameters: readonly SkdParameterInfo[];
  readonly variants: readonly SkdVariantInfo[];
  readonly lines: readonly string[];
}

export interface SkdDataSetInfo {
  readonly name: string;
  readonly type: 'Query' | 'Object' | 'Union' | 'Unknown';
  readonly query: string;
  readonly fields: readonly SkdFieldInfo[];
}

export interface SkdFieldInfo {
  readonly dataPath: string;
  readonly field: string;
  readonly title: string;
  readonly type: string;
}

export interface SkdCalculatedFieldInfo {
  readonly dataPath: string;
  readonly expression: string;
  readonly title: string;
  readonly type: string;
}

export interface SkdParameterInfo {
  readonly name: string;
  readonly title: string;
  readonly type: string;
  readonly hidden: boolean;
}

export interface SkdVariantInfo {
  readonly name: string;
  readonly title: string;
  readonly selection: readonly string[];
  readonly filters: readonly string[];
  readonly order: readonly string[];
}

export interface SkdEditOptions {
  readonly templatePath: string;
  readonly operation: SkdEditOperation;
  readonly value: string;
  readonly dataSet?: string;
  readonly variant?: string;
  readonly noSelection?: boolean;
}

export type SkdEditOperation =
  | 'add-field'
  | 'add-total'
  | 'add-calculated-field'
  | 'add-parameter'
  | 'add-filter'
  | 'add-dataParameter'
  | 'add-order'
  | 'add-selection'
  | 'add-dataSet'
  | 'add-dataSetLink'
  | 'add-variant'
  | 'add-conditionalAppearance'
  | 'add-drilldown'
  | 'set-query'
  | 'patch-query'
  | 'set-outputParameter'
  | 'set-structure'
  | 'modify-field'
  | 'modify-filter'
  | 'modify-dataParameter'
  | 'modify-parameter'
  | 'rename-parameter'
  | 'reorder-parameters'
  | 'clear-selection'
  | 'clear-order'
  | 'clear-filter'
  | 'remove-field'
  | 'remove-total'
  | 'remove-calculated-field'
  | 'remove-parameter'
  | 'remove-filter';

export interface SkdEditResult {
  readonly templatePath: string;
  readonly changedFiles: readonly string[];
  readonly warnings: readonly string[];
  readonly lines: readonly string[];
}

export interface SkdValidationOptions {
  readonly templatePath: string;
  readonly detailed?: boolean;
  readonly maxErrors?: number;
}

export interface SkdValidationIssue {
  readonly severity: 'error' | 'warning' | 'ok';
  readonly message: string;
}

export interface SkdValidationResult {
  readonly templatePath: string;
  readonly errors: number;
  readonly warnings: number;
  readonly checks: number;
  readonly issues: readonly SkdValidationIssue[];
  readonly lines: readonly string[];
}

export class DataCompositionSchemaService {
  compile(options: SkdCompileOptions): SkdCompileResult {
    const templatePath = path.resolve(options.outputPath);
    const xml = buildSchemaXml(options.definition);
    fs.mkdirSync(path.dirname(templatePath), { recursive: true });
    const previous = fs.existsSync(templatePath) ? fs.readFileSync(templatePath, 'utf-8') : '';
    if (previous) {
      writeTextFilePreservingBomAndEol(templatePath, previous, xml);
    } else {
      fs.writeFileSync(templatePath, xml, 'utf-8');
    }
    const info = this.info({ templatePath });
    return {
      templatePath,
      changedFiles: [templatePath],
      dataSets: info.dataSets.map((dataSet) => dataSet.name),
      parameters: info.parameters.map((parameter) => parameter.name),
    };
  }

  info(options: SkdInfoOptions): SkdInfoResult {
    const templatePath = resolveTemplateContentPath(options.templatePath);
    const xml = fs.readFileSync(templatePath, 'utf-8');
    const parsed = parseSchema(xml);
    return {
      templatePath,
      ...parsed,
      lines: paginate(buildInfoLines(parsed, options.mode ?? 'overview', options.name), options.limit, options.offset),
    };
  }

  edit(options: SkdEditOptions): SkdEditResult {
    const templatePath = resolveTemplateContentPath(options.templatePath);
    const original = fs.readFileSync(templatePath, 'utf-8');
    let xml = original;
    const warnings: string[] = [];
    const lines: string[] = [];
    const values = splitBatch(options.value, options.operation);

    for (const value of values) {
      const before = xml;
      xml = applyEdit(xml, options.operation, value, options, warnings);
      if (xml !== before) {
        lines.push(`${options.operation}: ${value}`);
      }
    }

    if (xml !== original) {
      writeTextFilePreservingBomAndEol(templatePath, original, xml);
    }
    return {
      templatePath,
      changedFiles: xml === original ? [] : [templatePath],
      warnings,
      lines,
    };
  }

  validate(options: SkdValidationOptions): SkdValidationResult {
    const templatePath = resolveTemplateContentPath(options.templatePath);
    const xml = fs.readFileSync(templatePath, 'utf-8');
    const maxErrors = options.maxErrors ?? 20;
    const issues: SkdValidationIssue[] = [];
    const push = (severity: SkdValidationIssue['severity'], message: string) => {
      if (severity !== 'ok' || options.detailed) {
        issues.push({ severity, message });
      }
    };
    const syntax = XMLValidator.validate(xml);
    if (syntax !== true) {
      push('error', `XML не разобран: ${syntax.err.msg}`);
      return buildValidationResult(templatePath, issues, maxErrors);
    }
    push('ok', 'XML корректно разобран.');
    if (!/<DataCompositionSchema\b/.test(xml) || !xml.includes(`xmlns="${SCHEMA_NS}"`)) {
      push('error', `Ожидается DataCompositionSchema в пространстве имён ${SCHEMA_NS}.`);
    }
    const info = parseSchema(xml);
    const dataSetNames = info.dataSets.map((dataSet) => dataSet.name);
    pushDuplicates('Набор данных', dataSetNames, issues);
    for (const dataSet of info.dataSets) {
      if (!dataSet.name) {
        push('error', 'Набор данных без имени.');
      }
      if (dataSet.type === 'Query' && !dataSet.query.trim()) {
        push('warning', `Набор данных ${dataSet.name} содержит пустой запрос.`);
      }
      pushDuplicates(`Поля набора ${dataSet.name}`, dataSet.fields.map((field) => field.dataPath), issues);
    }
    pushDuplicates('Параметр', info.parameters.map((parameter) => parameter.name), issues);
    pushDuplicates('Вычисляемое поле', info.calculatedFields.map((field) => field.dataPath), issues);
    pushDuplicates('Вариант настроек', info.variants.map((variant) => variant.name), issues);
    return buildValidationResult(templatePath, issues, maxErrors);
  }
}

function resolveTemplateContentPath(inputPath: string): string {
  let target = path.resolve(inputPath);
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
    target = path.join(target, 'Ext', 'Template.xml');
  }
  if (!fs.existsSync(target) && path.basename(target) === 'Template.xml') {
    const ext = path.join(path.dirname(target), 'Ext', 'Template.xml');
    if (fs.existsSync(ext)) {
      target = ext;
    }
  }
  if (!fs.existsSync(target) && target.endsWith('.xml')) {
    const stem = path.basename(target, '.xml');
    const nested = path.join(path.dirname(target), stem, 'Ext', 'Template.xml');
    if (fs.existsSync(nested)) {
      target = nested;
    }
  }
  if (!fs.existsSync(target)) {
    throw new Error(`Template.xml СКД не найден: ${target}`);
  }
  return target;
}

function buildSchemaXml(definition: SkdDefinition): string {
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

function buildDataSourceXml(name: string, type: string): string {
  return ['\t<dataSource>', `\t\t<name>${escapeXmlText(name)}</name>`, `\t\t<dataSourceType>${escapeXmlText(type)}</dataSourceType>`, '\t</dataSource>'].join('\n');
}

function buildDataSetXml(dataSet: SkdDataSetDefinition, defaultSource: string): string {
  return [
    '\t<dataSet xsi:type="DataSetQuery">',
    `\t\t<name>${escapeXmlText(dataSet.name)}</name>`,
    ...(dataSet.fields ?? []).map((field) => buildFieldXml(field, '\t\t')),
    `\t\t<dataSource>${escapeXmlText(dataSet.source ?? defaultSource)}</dataSource>`,
    `\t\t<query>${escapeXmlText(dataSet.query ?? '')}</query>`,
    '\t</dataSet>',
  ].join('\n');
}

function buildFieldXml(field: string | SkdFieldDefinition, indent: string): string {
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

function buildCalculatedFieldXml(field: string | SkdCalculatedFieldDefinition): string {
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

function buildTotalFieldXml(value: string): string {
  // split возвращает string[], но второй элемент может быть undefined.
  const parts = value.split(':');
  const dataPath = parts[0].trim();
  const rawExpression = parts[1] as string | undefined;
  const trimmedExpression = (rawExpression ?? '').trim();
  const expression = trimmedExpression.includes('(') ? trimmedExpression : `${trimmedExpression || 'Сумма'}(${dataPath})`;
  return ['\t<totalField>', `\t\t<dataPath>${escapeXmlText(dataPath)}</dataPath>`, `\t\t<expression>${escapeXmlText(expression)}</expression>`, '\t</totalField>'].join('\n');
}

function buildParameterXmlWithAutoDates(parameter: string | SkdParameterDefinition): string[] {
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

function buildParameterXml(parameter: SkdParameterDefinition): string {
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

function buildVariantXml(variant: SkdSettingsVariantDefinition, parameters: readonly (string | SkdParameterDefinition)[]): string {
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

function buildSelectionXml(selection: readonly string[], indent: string): string {
  return [`${indent}<selection>`, ...selection.map((item) => item === 'Auto'
    ? `${indent}\t<item xsi:type="dcsset:SelectedItemAuto"/>`
    : `${indent}\t<item xsi:type="dcsset:SelectedItemField"><field>${escapeXmlText(item)}</field></item>`), `${indent}</selection>`].join('\n');
}

function buildFilterXml(value: string, indent: string): string {
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

function buildOrderXml(value: string, indent: string): string {
  const trimmed = value.trim();
  if (trimmed === 'Auto') {
    return `${indent}<order><item xsi:type="dcsset:OrderItemAuto"/></order>`;
  }
  const desc = /\s+desc$/i.test(trimmed);
  const field = trimmed.replace(/\s+desc$/i, '');
  return `${indent}<order><item><field>${escapeXmlText(field)}</field><orderType>${desc ? 'Desc' : 'Asc'}</orderType></item></order>`;
}

function buildDataParametersXml(value: readonly string[] | 'auto' | undefined, parameters: readonly (string | SkdParameterDefinition)[], indent: string): string[] {
  const items = value === 'auto'
    ? parameters.map((parameter) => typeof parameter === 'string' ? parseParameter(parameter).name : parameter.name)
    : value ?? [];
  if (items.length === 0) {
    return [];
  }
  return [`${indent}<dataParameters>`, ...items.map((item) => `${indent}\t<item><parameter>${escapeXmlText(item.replace(/\s*=.*/, '').trim())}</parameter><userSettingID>${escapeXmlText(item.replace(/\s*=.*/, '').trim())}</userSettingID></item>`), `${indent}</dataParameters>`];
}

function buildStructureXml(structure: string | readonly SkdStructureItemDefinition[], indent: string): string {
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

function buildStructureItemXml(item: SkdStructureItemDefinition, indent: string): string {
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

function applyEdit(xml: string, operation: SkdEditOperation, value: string, options: SkdEditOptions, warnings: string[]): string {
  switch (operation) {
    case 'add-field':
      return editFirstDataSet(xml, options.dataSet, (block) => insertBeforeClose(block, 'dataSet', buildFieldXml(value, '\t\t')));
    case 'add-total':
      return insertBeforeClose(xml, 'DataCompositionSchema', buildTotalFieldXml(value));
    case 'add-calculated-field':
      return insertBeforeClose(xml, 'DataCompositionSchema', buildCalculatedFieldXml(value));
    case 'add-parameter':
      return insertBeforeClose(xml, 'DataCompositionSchema', buildParameterXmlWithAutoDates(value).join('\n'));
    case 'add-dataSet': {
      const [name, query] = value.includes(':') ? value.split(/:(.+)/) : [`НаборДанных${String(countTags(xml, 'dataSet') + 1)}`, value];
      return insertBeforeClose(xml, 'DataCompositionSchema', buildDataSetXml({ name: name.trim(), query: query.trim(), fields: [] }, readText(matchBlocks(xml, 'dataSource')[0] ?? '', 'name') || 'ИсточникДанных1'));
    }
    case 'add-variant':
      return insertBeforeClose(xml, 'DataCompositionSchema', buildVariantXml(parseVariant(value), []));
    case 'add-dataSetLink':
      return insertBeforeClose(xml, 'DataCompositionSchema', buildDataSetLinkXml(value));
    case 'add-conditionalAppearance':
      return editFirstVariantSettings(xml, options.variant, (settings) => appendIntoSection(settings, 'conditionalAppearance', buildConditionalAppearanceItemXml(value)));
    case 'add-drilldown':
      return insertBeforeClose(xml, 'DataCompositionSchema', buildDrilldownTemplateXml(value));
    case 'set-query':
      return editFirstDataSet(xml, options.dataSet, (block) => replaceOrInsert(block, 'query', escapeXmlText(value), 'dataSet'));
    case 'patch-query':
      return editFirstDataSet(xml, options.dataSet, (block) => block.replace('</query>', `${escapeXmlText(value)}\n</query>`));
    case 'set-outputParameter':
      return editFirstVariantSettings(xml, options.variant, (settings) => appendIntoSection(settings, 'outputParameters', buildOutputParameterItemXml(value)));
    case 'set-structure':
      return editFirstVariantSettings(xml, options.variant, (settings) => replaceOrInsert(settings, 'structure', extractBlock(buildStructureXml(value, ''), 'structure') ?? '', 'settings'));
    case 'modify-field':
      return editFirstDataSet(xml, options.dataSet, (block) => replaceFieldBlock(block, value, warnings));
    case 'modify-parameter':
      return replaceParameterBlock(xml, value, warnings);
    case 'modify-filter':
      return editFirstVariantSettings(xml, options.variant, (settings) => modifyFirstItemInSection(settings, 'filter', buildFilterXml(value, '')));
    case 'modify-dataParameter':
      return editFirstVariantSettings(xml, options.variant, (settings) => appendIntoSection(settings, 'dataParameters', `<item><parameter>${escapeXmlText(value.replace(/\s*=.*/, '').trim())}</parameter></item>`));
    case 'rename-parameter': {
      const match = /^(.+?)\s*=>\s*(.+)$/.exec(value);
      if (!match) {
        warnings.push('rename-parameter ожидает формат OldName => NewName.');
        return xml;
      }
      return renameParameter(xml, match[1].trim(), match[2].trim());
    }
    case 'remove-field':
      return editFirstDataSet(xml, options.dataSet, (block) => removeElementByChildText(block, 'field', 'dataPath', value.trim()));
    case 'remove-total':
      return removeElementByChildText(xml, 'totalField', 'dataPath', value.trim());
    case 'remove-calculated-field':
      return removeElementByChildText(xml, 'calculatedField', 'dataPath', value.trim());
    case 'remove-parameter':
      return removeElementByChildText(xml, 'parameter', 'name', value.trim());
    case 'remove-filter':
      return editFirstVariantSettings(xml, options.variant, (settings) => removeSectionItemByText(settings, 'filter', 'left', value.trim()));
    case 'add-selection':
      return editFirstVariantSettings(xml, options.variant, (settings) => appendIntoSection(settings, 'selection', value === 'Auto' ? '<item xsi:type="dcsset:SelectedItemAuto"/>' : `<item xsi:type="dcsset:SelectedItemField"><field>${escapeXmlText(value)}</field></item>`));
    case 'add-filter':
      return editFirstVariantSettings(xml, options.variant, (settings) => appendIntoSection(settings, 'filter', extractBlock(buildFilterXml(value, ''), 'filter') ?? ''));
    case 'add-order':
      return editFirstVariantSettings(xml, options.variant, (settings) => appendIntoSection(settings, 'order', extractBlock(buildOrderXml(value, ''), 'order') ?? ''));
    case 'clear-selection':
      return editFirstVariantSettings(xml, options.variant, (settings) => replaceOrInsert(settings, 'selection', '', 'settings'));
    case 'clear-filter':
      return editFirstVariantSettings(xml, options.variant, (settings) => replaceOrInsert(settings, 'filter', '', 'settings'));
    case 'clear-order':
      return editFirstVariantSettings(xml, options.variant, (settings) => replaceOrInsert(settings, 'order', '', 'settings'));
    case 'add-dataParameter':
      return editFirstVariantSettings(xml, options.variant, (settings) => appendIntoSection(settings, 'dataParameters', `<item><parameter>${escapeXmlText(value.replace(/\s*=.*/, '').trim())}</parameter><userSettingID>${escapeXmlText(value.replace(/\s*=.*/, '').trim())}</userSettingID></item>`));
    case 'reorder-parameters':
      return reorderParameters(xml, value, warnings);
  }
}

function buildDataSetLinkXml(value: string): string {
  const match = /^(.+?)\s*>\s*(.+?)\s+on\s+(.+?)\s*=\s*(.+?)(?:\s*\[param\s+([^\]]+)])?$/.exec(value.trim());
  if (!match) {
    throw new Error('add-dataSetLink ожидает формат: Источник > Приёмник on Поле1 = Поле2 [param Имя].');
  }
  return [
    '\t<dataSetLink>',
    `\t\t<sourceDataSet>${escapeXmlText(match[1].trim())}</sourceDataSet>`,
    `\t\t<destinationDataSet>${escapeXmlText(match[2].trim())}</destinationDataSet>`,
    '\t\t<field>',
    `\t\t\t<sourceExpression>${escapeXmlText(match[3].trim())}</sourceExpression>`,
    `\t\t\t<destinationExpression>${escapeXmlText(match[4].trim())}</destinationExpression>`,
    match[5] ? `\t\t\t<parameter>${escapeXmlText(match[5].trim())}</parameter>` : '',
    '\t\t</field>',
    '\t</dataSetLink>',
  ].filter(Boolean).join('\n');
}

function buildConditionalAppearanceItemXml(value: string): string {
  const match = /^(.+?)\s*=\s*(.+?)(?:\s+when\s+(.+?))?(?:\s+for\s+(.+))?$/.exec(value.trim());
  if (!match) {
    throw new Error('add-conditionalAppearance ожидает формат: Параметр = значение [when условие] [for Поле1, Поле2].');
  }
  // Опциональная группа регулярки фактически может быть undefined, тип RegExpExecArray этого не отражает.
  const rawFields = match[4] as string | undefined;
  const fields = (rawFields ?? '').split(',').map((item) => item.trim()).filter(Boolean);
  return [
    '<item>',
    '<appearance>',
    `<dcscor:item xsi:type="dcsset:SettingsParameterValue"><dcscor:parameter>${escapeXmlText(match[1].trim())}</dcscor:parameter><dcscor:value xsi:type="xs:string">${escapeXmlText(match[2].trim())}</dcscor:value></dcscor:item>`,
    '</appearance>',
    match[3] ? `<filter>${extractBlock(buildFilterXml(match[3], ''), 'filter') ?? ''}</filter>` : '',
    fields.length > 0 ? `<fields>${fields.map((field) => `<item>${escapeXmlText(field)}</item>`).join('')}</fields>` : '',
    '</item>',
  ].filter(Boolean).join('');
}

function buildDrilldownTemplateXml(value: string): string {
  const fields = value.split(',').map((item) => item.trim()).filter(Boolean);
  return [
    '\t<template>',
    '\t\t<name>РасшифровкаРесурсов</name>',
    ...fields.map((field) => `\t\t<field>${escapeXmlText(field)}</field>`),
    '\t</template>',
  ].join('\n');
}

function buildOutputParameterItemXml(value: string): string {
  const [name, rawValue = ''] = value.split(/=(.+)/).map((item) => item.trim());
  return `<item><parameter>${escapeXmlText(name)}</parameter><value xsi:type="xs:string">${escapeXmlText(rawValue)}</value></item>`;
}

function replaceFieldBlock(xml: string, value: string, warnings: string[]): string {
  const field = parseField(value);
  if (!field.dataPath) {
    warnings.push('modify-field ожидает shorthand поля с именем.');
    return xml;
  }
  for (const block of matchBlocks(xml, 'field')) {
    if (readText(block, 'dataPath') === field.dataPath) {
      const fieldXml = buildFieldXml(value, '\t\t');
      return xml.replace(block, () => fieldXml);
    }
  }
  warnings.push(`Поле не найдено, добавлено новое: ${field.dataPath}.`);
  return insertBeforeClose(xml, 'dataSet', buildFieldXml(value, '\t\t'));
}

function replaceParameterBlock(xml: string, value: string, warnings: string[]): string {
  const parsed = parseParameter(value);
  if (!parsed.name) {
    warnings.push('modify-parameter ожидает имя параметра.');
    return xml;
  }
  const replacement = buildParameterXml(parsed);
  for (const block of matchBlocks(xml, 'parameter')) {
    if (readText(block, 'name') === parsed.name) {
      return xml.replace(block, () => replacement);
    }
  }
  warnings.push(`Параметр не найден, добавлен новый: ${parsed.name}.`);
  return insertBeforeClose(xml, 'DataCompositionSchema', replacement);
}

function modifyFirstItemInSection(xml: string, sectionTag: string, sectionXml: string): string {
  const inner = extractBlock(sectionXml, sectionTag) ?? '';
  const section = extractBlock(xml, sectionTag);
  if (section === null) {
    return appendIntoSection(xml, sectionTag, inner);
  }
  const firstItem = matchBlocks(section, 'item')[0];
  return firstItem ? xml.replace(firstItem, () => inner) : appendIntoSection(xml, sectionTag, inner);
}

function removeSectionItemByText(xml: string, sectionTag: string, childTag: string, value: string): string {
  const section = extractBlock(xml, sectionTag);
  if (section === null) {
    return xml;
  }
  let nextSection = section;
  for (const block of matchBlocks(section, 'item')) {
    if (readText(block, childTag) === value) {
      nextSection = nextSection.replace(block, '');
    }
  }
  return xml.replace(section, () => nextSection);
}

function reorderParameters(xml: string, value: string, warnings: string[]): string {
  const order = value.split(',').map((item) => item.trim()).filter(Boolean);
  if (order.length === 0) {
    warnings.push('reorder-parameters получил пустой список.');
    return xml;
  }
  const blocks = matchBlocks(xml, 'parameter');
  const byName = new Map(blocks.map((block) => [readText(block, 'name'), block]));
  const sorted = [
    ...order.map((name) => byName.get(name)).filter((block): block is string => Boolean(block)),
    ...blocks.filter((block) => !order.includes(readText(block, 'name'))),
  ];
  let next = xml;
  for (const block of blocks) {
    next = next.replace(block, '');
  }
  const sortedXml = sorted.join('\n');
  return next.replace('</DataCompositionSchema>', () => `${sortedXml}\n</DataCompositionSchema>`);
}

/**
 * Прицельно переименовывает параметр СКД: меняет ТОЛЬКО `<name>` в целевом
 * `<parameter>`-блоке и текстовые ссылки на параметр (`&amp;Имя` в запросах/выражениях).
 * НЕ трогает `<dataPath>`/`<field>` набора данных и значения фильтров, даже если их
 * текст совпадает с именем параметра (это ссылки на поля результата, а не на параметр).
 */
function renameParameter(xml: string, oldName: string, newName: string): string {
  const escapedNew = escapeXmlText(newName);
  // Параметры лежат прямыми детьми <DataCompositionSchema>. Ищем диапазон корня,
  // затем прямые <parameter> внутри него: это отсекает вложенные <parameter>
  // из dataSetLink/filter, которые не являются определением параметра схемы.
  const rootRange = findNestingAwareElementRange(xml, 'DataCompositionSchema');
  if (!rootRange) {
    return xml;
  }
  const rootInner = xml.slice(rootRange.openEnd, rootRange.closeStart);
  const paramRanges = findDirectElementRanges(rootInner, 'parameter');
  let inner = rootInner;
  // Идём с конца, чтобы подстановка не смещала ранее вычисленные диапазоны.
  for (let i = paramRanges.length - 1; i >= 0; i--) {
    const range = paramRanges[i];
    const block = inner.slice(range.start, range.end);
    const nameRange = findNestingAwareElementRange(block, 'name');
    if (!nameRange) {
      continue;
    }
    if (block.slice(nameRange.openEnd, nameRange.closeStart).trim() !== oldName) {
      continue;
    }
    const nextBlock =
      block.slice(0, nameRange.openEnd) + escapedNew + block.slice(nameRange.closeStart);
    inner = inner.slice(0, range.start) + nextBlock + inner.slice(range.end);
  }
  const result = xml.slice(0, rootRange.openEnd) + inner + xml.slice(rootRange.closeStart);
  // Ссылки на параметр в запросах/выражениях: маркер `&` (в XML — `&amp;`).
  // Границу имени задаём Unicode-aware lookahead'ом: JS `\b` работает по [A-Za-z0-9_]
  // и НЕ распознаёт конец кириллического имени (доминирующий случай 1С), поэтому
  // `&Товар` иначе не переименовывался бы. `(?![\p{L}\p{N}_])` совпадает, когда
  // следующий символ не является буквой/цифрой/подчёркиванием любого алфавита —
  // это не даёт задеть `&ТоварДва` при переименовании `&Товар`.
  return result.replace(
    new RegExp(`&amp;${escapeRegExp(oldName)}(?![\\p{L}\\p{N}_])`, 'gu'),
    () => `&amp;${escapedNew}`
  );
}

function parseSchema(xml: string): Omit<SkdInfoResult, 'templatePath' | 'lines'> {
  return {
    dataSets: matchBlocks(xml, 'dataSet').map((block) => ({
      name: readText(block, 'name'),
      type: block.includes('DataSetQuery') ? 'Query' : block.includes('DataSetObject') ? 'Object' : block.includes('DataSetUnion') ? 'Union' : 'Unknown',
      query: readText(block, 'query'),
      fields: matchBlocks(block, 'field').map((field) => ({
        dataPath: readText(field, 'dataPath'),
        field: readText(field, 'field'),
        title: readMlText(field, 'title'),
        type: readValueType(field),
      })).filter((field) => field.dataPath || field.field),
    })),
    calculatedFields: matchBlocks(xml, 'calculatedField').map((block) => ({
      dataPath: readText(block, 'dataPath'),
      expression: readText(block, 'expression'),
      title: readMlText(block, 'title'),
      type: readValueType(block),
    })),
    totalFields: matchBlocks(xml, 'totalField').map((block) => ({ dataPath: readText(block, 'dataPath'), expression: readText(block, 'expression') })),
    parameters: matchBlocks(xml, 'parameter').map((block) => ({
      name: readText(block, 'name'),
      title: readMlText(block, 'title'),
      type: readValueType(block),
      hidden: readText(block, 'availableAsField') === 'false',
    })),
    variants: matchBlocks(xml, 'settingsVariant').map((block) => ({
      name: readText(block, 'name'),
      title: readMlText(block, 'title'),
      selection: readSectionTexts(block, 'selection', 'field'),
      filters: readSectionTexts(block, 'filter', 'left'),
      order: readSectionTexts(block, 'order', 'field'),
    })),
  };
}

function buildInfoLines(info: Omit<SkdInfoResult, 'templatePath' | 'lines'>, mode: SkdInfoMode, name?: string): string[] {
  const lines: string[] = [];
  if (mode === 'overview' || mode === 'full') {
    lines.push('=== DataCompositionSchema ===');
    lines.push(`Наборы данных: ${String(info.dataSets.length)}`);
    lines.push(`Поля: ${String(info.dataSets.reduce((sum, dataSet) => sum + dataSet.fields.length, 0))}`);
    lines.push(`Вычисляемые поля: ${String(info.calculatedFields.length)}`);
    lines.push(`Итоги: ${String(info.totalFields.length)}`);
    lines.push(`Параметры: ${String(info.parameters.length)}`);
    lines.push(`Варианты: ${String(info.variants.length)}`);
  }
  if (mode === 'query' || mode === 'full') {
    const dataSets = name ? info.dataSets.filter((dataSet) => dataSet.name === name) : info.dataSets;
    for (const dataSet of dataSets) {
      lines.push('', `--- Query: ${dataSet.name} ---`, dataSet.query || '<пусто>');
    }
  }
  if (mode === 'fields' || mode === 'full') {
    lines.push('', '--- Fields ---');
    for (const dataSet of info.dataSets) {
      const fields = name ? dataSet.fields.filter((field) => field.dataPath === name || field.title === name) : dataSet.fields;
      if (fields.length > 0) {
        lines.push(`  ${dataSet.name}: ${fields.map((field) => field.dataPath).join(', ')}`);
      }
    }
  }
  if (mode === 'calculated' || mode === 'full') {
    lines.push('', '--- Calculated ---', ...info.calculatedFields.map((field) => `  ${field.dataPath} = ${field.expression}`));
  }
  if (mode === 'resources' || mode === 'full') {
    lines.push('', '--- Resources ---', ...info.totalFields.map((field) => `  ${field.dataPath}: ${field.expression}`));
  }
  if (mode === 'params' || mode === 'full') {
    lines.push('', '--- Parameters ---', ...info.parameters.map((param) => `  ${param.name}: ${param.type || '<тип не задан>'}${param.hidden ? ' [hidden]' : ''}`));
  }
  if (mode === 'variant' || mode === 'full') {
    const variants = name ? info.variants.filter((variant) => variant.name === name) : info.variants;
    lines.push('', '--- Variants ---', ...variants.map((variant) => `  ${variant.name}: selection=${variant.selection.join(', ') || 'Auto'}`));
  }
  return lines;
}

function parseField(value: string): Required<Pick<SkdFieldDefinition, 'dataPath' | 'field' | 'title' | 'type' | 'role' | 'restrict'>> {
  let text = value;
  const title = /\[([^\]]+)\]/.exec(text)?.[1] ?? '';
  text = text.replace(/\s*\[[^\]]+\]/, '');
  const role = /@(\w+)/.exec(text)?.[1] ?? '';
  text = text.replace(/\s*@\w+/g, '');
  const restrict = [...text.matchAll(/#(\w+)/g)].map((match) => match[1]);
  text = text.replace(/\s*#\w+/g, '');
  const [name, type = ''] = text.split(':');
  const dataPath = name.trim();
  return { dataPath, field: dataPath, title, type: resolveType(type.trim()), role, restrict };
}

function normalizeField(field: SkdFieldDefinition): ReturnType<typeof parseField> {
  const dataPath = field.dataPath ?? field.field ?? '';
  return { dataPath, field: field.field ?? dataPath, title: field.title ?? '', type: resolveType(field.type ?? ''), role: field.role ?? '', restrict: [...(field.restrict ?? [])] };
}

function parseCalculated(value: string): Required<Pick<SkdCalculatedFieldDefinition, 'dataPath' | 'expression' | 'title' | 'type'>> & { restrict: string[] } {
  let text = value;
  const restrict = [...text.matchAll(/#(\w+)/g)].map((match) => match[1]);
  text = text.replace(/\s*#\w+/g, '');
  const [left, expression = ''] = text.split(/=(.+)/);
  const title = /\[([^\]]+)\]/.exec(left)?.[1] ?? '';
  const cleanLeft = left.replace(/\s*\[[^\]]+\]/, '');
  const [dataPath, type = ''] = cleanLeft.split(':');
  return { dataPath: dataPath.trim(), expression: expression.trim(), title, type: resolveType(type.trim()), restrict };
}

function normalizeCalculated(field: SkdCalculatedFieldDefinition): ReturnType<typeof parseCalculated> {
  const rawRestrict = field.restrict ?? [];
  return {
    dataPath: field.dataPath ?? field.name ?? '',
    expression: field.expression ?? '',
    title: field.title ?? '',
    type: resolveType(field.type ?? ''),
    restrict: typeof rawRestrict === 'string' ? rawRestrict.split(/\s+/).map((item) => item.replace(/^#/, '')).filter(Boolean) : [...rawRestrict],
  };
}

function parseParameter(value: string): SkdParameterDefinition {
  let text = value;
  const autoHidden = text.includes('@hidden');
  text = text.replace(/\s*@\w+/g, '');
  const title = /\[([^\]]+)\]/.exec(text)?.[1] ?? '';
  text = text.replace(/\s*\[[^\]]+\]/, '');
  // split возвращает string[], но второй элемент может быть undefined при отсутствии "=".
  const parts = text.split(/=(.+)/);
  const left = parts[0];
  const rawValue = parts[1] as string | undefined;
  const [name, type = ''] = left.split(':');
  return { name: name.trim(), title, type: resolveType(type.trim()), value: rawValue?.trim(), hidden: autoHidden };
}

function parseVariant(value: string): SkdSettingsVariantDefinition {
  const title = /\[([^\]]+)\]/.exec(value)?.[1];
  const name = value.replace(/\s*\[[^\]]+\]/, '').trim();
  return { name, title: title ?? name, selection: ['Auto'], structure: 'details' };
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

function resolveType(type: string): string {
  const aliases: Record<string, string> = { строка: 'string', число: 'decimal', булево: 'boolean', дата: 'date', bool: 'boolean', int: 'decimal', number: 'decimal' };
  return aliases[type.toLowerCase()] ?? type;
}

function emitValueType(type: string, indent: string): string {
  const normalized = resolveType(type);
  if (/^string(?:\((\d+)\))?$/.test(normalized)) {
    const length = /^string\((\d+)\)$/.exec(normalized)?.[1] ?? '0';
    return [`${indent}<v8:Type>xs:string</v8:Type>`, `${indent}<v8:StringQualifiers><v8:Length>${length}</v8:Length><v8:AllowedLength>Variable</v8:AllowedLength></v8:StringQualifiers>`].join('\n');
  }
  const decimal = /^decimal\((\d+),(\d+)\)$/.exec(normalized);
  if (decimal) {
    return [`${indent}<v8:Type>xs:decimal</v8:Type>`, `${indent}<v8:NumberQualifiers><v8:Digits>${decimal[1]}</v8:Digits><v8:FractionDigits>${decimal[2]}</v8:FractionDigits><v8:AllowedSign>Any</v8:AllowedSign></v8:NumberQualifiers>`].join('\n');
  }
  if (normalized === 'decimal') {
    return `${indent}<v8:Type>xs:decimal</v8:Type>`;
  }
  if (normalized === 'boolean') {
    return `${indent}<v8:Type>xs:boolean</v8:Type>`;
  }
  if (normalized === 'date' || normalized === 'dateTime') {
    return `${indent}<v8:Type>xs:dateTime</v8:Type>`;
  }
  if (normalized === 'StandardPeriod') {
    return `${indent}<v8:Type>v8:StandardPeriod</v8:Type>`;
  }
  return normalized.includes('.')
    ? `${indent}<v8:Type xmlns:d5p1="http://v8.1c.ru/8.1/data/enterprise/current-config">d5p1:${escapeXmlText(normalized)}</v8:Type>`
    : `${indent}<v8:Type>${escapeXmlText(normalized)}</v8:Type>`;
}

function buildUseRestriction(restrict: readonly string[], indent: string): string {
  const map: Record<string, string> = { noField: 'field', noFilter: 'condition', noCondition: 'condition', noGroup: 'group', noOrder: 'order' };
  return [`${indent}<useRestriction>`, ...restrict.map((item) => map[item] ? `${indent}\t<${map[item]}>true</${map[item]}>` : '').filter(Boolean), `${indent}</useRestriction>`].join('\n');
}

function buildMlText(tagName: string, value: string, indent: string): string {
  return [`${indent}<${tagName} xsi:type="v8:LocalStringType">`, `${indent}\t<v8:item><v8:lang>ru</v8:lang><v8:content>${escapeXmlText(value)}</v8:content></v8:item>`, `${indent}</${tagName}>`].join('\n');
}

function editFirstDataSet(xml: string, dataSetName: string | undefined, editor: (block: string) => string): string {
  return replaceFirstMatchingBlock(xml, 'dataSet', (block) => !dataSetName || readText(block, 'name') === dataSetName, editor);
}

function editFirstVariantSettings(xml: string, variantName: string | undefined, editor: (block: string) => string): string {
  return replaceFirstMatchingBlock(xml, 'settingsVariant', (block) => !variantName || readText(block, 'name') === variantName, (variantBlock) => {
    const settings = extractBlock(variantBlock, 'settings') ?? '';
    const editedSettings = editor(settings);
    return variantBlock.replace(settings, () => editedSettings);
  });
}

function replaceFirstMatchingBlock(xml: string, tagName: string, predicate: (block: string) => boolean, editor: (block: string) => string): string {
  for (const block of matchBlocks(xml, tagName)) {
    if (predicate(block)) {
      const editedBlock = editor(block);
      return xml.replace(block, () => editedBlock);
    }
  }
  return xml;
}

function insertBeforeClose(xml: string, tagName: string, fragment: string): string {
  return xml.replace(new RegExp(`\\s*</${tagName}>`), () => `\n${fragment}\n</${tagName}>`);
}

function replaceOrInsert(xml: string, tagName: string, inner: string, parentTag: string): string {
  const re = new RegExp(`<${tagName}>[\\s\\S]*?<\\/${tagName}>`);
  if (re.test(xml)) {
    return xml.replace(re, () => `<${tagName}>${inner}</${tagName}>`);
  }
  return insertBeforeClose(xml, parentTag, `<${tagName}>${inner}</${tagName}>`);
}

function appendIntoSection(xml: string, tagName: string, fragment: string): string {
  const re = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`);
  if (re.test(xml)) {
    return xml.replace(new RegExp(`</${tagName}>`), () => `${fragment}</${tagName}>`);
  }
  return insertBeforeClose(xml, 'settings', `<${tagName}>${fragment}</${tagName}>`);
}

function removeElementByChildText(xml: string, tagName: string, childTag: string, value: string): string {
  for (const block of matchBlocks(xml, tagName)) {
    if (readText(block, childTag) === value) {
      return xml.replace(block, '');
    }
  }
  return xml;
}

function buildValidationResult(templatePath: string, issues: readonly SkdValidationIssue[], maxErrors: number): SkdValidationResult {
  const limited = limitErrors(issues, maxErrors);
  const errors = limited.filter((issue) => issue.severity === 'error').length;
  const warnings = limited.filter((issue) => issue.severity === 'warning').length;
  const lines = [`=== Validation: DataCompositionSchema ===`, `Файл: ${templatePath}`, ''];
  for (const issue of limited) {
    const prefix = issue.severity === 'error' ? '[ERROR]' : issue.severity === 'warning' ? '[WARN] ' : '[OK]   ';
    lines.push(`${prefix} ${issue.message}`);
  }
  lines.push('', `=== Result: ${String(errors)} errors, ${String(warnings)} warnings (${String(limited.length)} checks) ===`);
  return { templatePath, errors, warnings, checks: limited.length, issues: limited, lines };
}

function pushDuplicates(label: string, values: readonly string[], issues: SkdValidationIssue[]): void {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const value of values.filter(Boolean)) {
    if (seen.has(value)) {
      dupes.add(value);
    }
    seen.add(value);
  }
  for (const value of dupes) {
    issues.push({ severity: 'error', message: `${label} продублирован: ${value}.` });
  }
}

function splitBatch(value: string, operation: SkdEditOperation): string[] {
  return ['set-query', 'patch-query', 'add-dataSet'].includes(operation)
    ? [value]
    : value.split(';;').map((item) => item.trim()).filter(Boolean);
}

function matchBlocks(xml: string, tagName: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tagName}\\b[^>]*>[\\s\\S]*?<\\/${tagName}>`, 'g'))].map((match) => match[0]);
}

function extractBlock(xml: string, tagName: string): string | null {
  return new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`).exec(xml)?.[1] ?? null;
}

function readText(xml: string, tagName: string): string {
  return unescapeXml(extractBlock(xml, tagName)?.trim() ?? '');
}

function readMlText(xml: string, tagName: string): string {
  const block = extractBlock(xml, tagName) ?? '';
  return unescapeXml(/<v8:content>([\s\S]*?)<\/v8:content>/.exec(block)?.[1]?.trim() ?? '');
}

function readValueType(xml: string): string {
  const raw = /<v8:Type(?:\s[^>]*)?>([\s\S]*?)<\/v8:Type>/.exec(xml)?.[1]?.trim() ?? '';
  return raw.replace(/^[A-Za-z0-9]+:/, '');
}

function readSectionTexts(xml: string, sectionTag: string, childTag: string): string[] {
  const section = extractBlock(xml, sectionTag) ?? '';
  return matchBlocks(section, childTag).map((block) => readText(block, childTag)).filter(Boolean);
}

function countTags(xml: string, tagName: string): number {
  return (xml.match(new RegExp(`<${tagName}\\b`, 'g')) ?? []).length;
}

function paginate(lines: readonly string[], limit?: number, offset?: number): string[] {
  const start = offset ?? 0;
  const sliced = lines.slice(start, limit && limit > 0 ? start + limit : undefined);
  if (limit && limit > 0 && start + limit < lines.length) {
    return [...sliced, '', `[ОБРЕЗАНО] Показано ${String(sliced.length)} из ${String(lines.length)} строк.`];
  }
  return sliced;
}

function limitErrors(issues: readonly SkdValidationIssue[], maxErrors: number): SkdValidationIssue[] {
  const result: SkdValidationIssue[] = [];
  let errors = 0;
  for (const issue of issues) {
    result.push(issue);
    if (issue.severity === 'error') {
      errors += 1;
      if (errors >= maxErrors) {
        break;
      }
    }
  }
  return result;
}
