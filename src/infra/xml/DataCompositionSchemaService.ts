import * as fs from 'fs';
import * as path from 'path';
import { XMLValidator } from 'fast-xml-parser';
import { writeTextFilePreservingBomAndEol } from './XmlUtils';
import { resolveTemplateContentPath } from './dcs/dcsShared';
import { buildSchemaXml } from './dcs/schemaBuilders';
import { applyEdit } from './dcs/editOperations';
import { buildInfoLines, parseSchema } from './dcs/schemaParse';

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
