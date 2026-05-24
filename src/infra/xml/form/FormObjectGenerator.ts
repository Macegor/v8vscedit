/**
 * Упрощённый порт `from-object` режима `.claude/skills/form-compile/scripts/form-compile.py`
 * (функции `generate_catalog_dsl` / `generate_document_dsl` /
 * `generate_information_register_dsl` / `generate_accumulation_register_dsl`).
 *
 * Используется при `addForm` и `compile(fromObject=true)` чтобы получить форму
 * с полезным начальным наполнением (header + tabular sections), а не пустой каркас.
 */
import * as fs from 'fs';
import * as path from 'path';
import { ObjectXmlReader } from '../ObjectXmlReader';
import { resolveObjectLocation } from './FormShared';
import type {
  FormAttributeDefinition,
  FormDefinition,
  FormElementDefinition,
  FormPurpose,
} from './types';

interface ObjectMeta {
  kind: string;
  name: string;
  synonym: string;
  attributes: AttrMeta[];
  tabularSections: { name: string; columns: AttrMeta[] }[];
  hasCode: boolean;
  hasDescription: boolean;
  hierarchical: boolean;
  ownersCount: number;
  periodicity?: string;
  writeMode?: string;
  dimensions: AttrMeta[];
  resources: AttrMeta[];
}

interface AttrMeta {
  name: string;
  type: string;
}

const reader = new ObjectXmlReader();

/**
 * Генерирует DSL формы для объекта согласно назначению.
 * Возвращает `undefined` если тип объекта не поддерживается генератором.
 */
export function generateFormDefinitionForObject(
  objectXmlPath: string,
  purpose: FormPurpose,
  options: { title?: string } = {},
): FormDefinition | undefined {
  const meta = parseObjectMeta(objectXmlPath);
  if (!meta) return undefined;
  const supported = SUPPORT_MATRIX[meta.kind];
  if (!supported || !supported.includes(purpose)) {
    return undefined;
  }
  const title = options.title ?? meta.synonym;
  switch (meta.kind) {
    case 'Catalog':
    case 'ChartOfCharacteristicTypes':
    case 'ExchangePlan':
    case 'ChartOfAccounts':
    case 'BusinessProcess':
    case 'Task':
      return generateCatalogLikeDsl(meta, purpose, title);
    case 'Document':
      return generateDocumentDsl(meta, purpose, title);
    case 'InformationRegister':
      return generateInfoRegisterDsl(meta, purpose, title);
    case 'AccumulationRegister':
    case 'AccountingRegister':
    case 'CalculationRegister':
      return generateAccumRegisterDsl(meta, purpose, title);
    default:
      return undefined;
  }
}

const SUPPORT_MATRIX: Record<string, readonly FormPurpose[]> = {
  Catalog: ['Object', 'List', 'Choice'],
  Document: ['Object', 'List', 'Choice'],
  ChartOfCharacteristicTypes: ['Object', 'List', 'Choice'],
  ExchangePlan: ['Object', 'List', 'Choice'],
  ChartOfAccounts: ['Object', 'List', 'Choice'],
  BusinessProcess: ['Object', 'List', 'Choice'],
  Task: ['Object', 'List', 'Choice'],
  InformationRegister: ['Record', 'List'],
  AccumulationRegister: ['List'],
  AccountingRegister: ['List'],
  CalculationRegister: ['List'],
};

// ─── Object metadata parsing ────────────────────────────────────────────────

function parseObjectMeta(objectXmlPath: string): ObjectMeta | undefined {
  if (!fs.existsSync(objectXmlPath)) return undefined;
  const loc = resolveObjectLocation(objectXmlPath);
  const obj = reader.read(loc.xmlPath);
  if (!obj) return undefined;
  const xml = fs.readFileSync(loc.xmlPath, 'utf-8');
  const propsBlock = extractInnerBlock(xml, 'Properties') ?? '';
  const childObjects = extractInnerBlock(xml, 'ChildObjects') ?? '';

  const attributes = extractFields(childObjects, 'Attribute');
  const tabularSections: { name: string; columns: AttrMeta[] }[] = [];
  for (const ts of extractTabularSections(childObjects)) {
    tabularSections.push(ts);
  }
  const dimensions = extractFields(childObjects, 'Dimension');
  const resources = extractFields(childObjects, 'Resource');

  const codeLength = parseInt(extractTagText(propsBlock, 'CodeLength') ?? '0', 10) || 0;
  const descLength = parseInt(extractTagText(propsBlock, 'DescriptionLength') ?? '0', 10) || 0;
  const hierarchical = (extractTagText(propsBlock, 'Hierarchical') ?? '') === 'true';
  const ownersCount = (extractInnerBlock(propsBlock, 'Owners')?.match(/<xr:Item>/g) ?? []).length;

  return {
    kind: loc.kind,
    name: loc.name,
    synonym: extractSynonym(propsBlock) ?? loc.name,
    attributes,
    tabularSections,
    hasCode: codeLength > 0,
    hasDescription: descLength > 0,
    hierarchical,
    ownersCount,
    periodicity: extractTagText(propsBlock, 'InformationRegisterPeriodicity'),
    writeMode: extractTagText(propsBlock, 'WriteMode'),
    dimensions,
    resources,
  };
}

function extractFields(childObjects: string, tag: string): AttrMeta[] {
  const result: AttrMeta[] = [];
  // ChildObjects содержит блоки <Attribute>...<Properties><Name>X</Name>...<Type>...</Type></Properties>...</Attribute>
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(childObjects)) !== null) {
    const body = m[1];
    const props = extractInnerBlock(body, 'Properties') ?? body;
    const name = extractTagText(props, 'Name');
    if (!name) continue;
    const typeBlock = extractInnerBlock(props, 'Type') ?? '';
    const types = [...typeBlock.matchAll(/<v8:Type>([^<]+)<\/v8:Type>/g)].map((t) => t[1]);
    result.push({ name, type: types.join(' | ') });
  }
  return result;
}

function extractTabularSections(childObjects: string): { name: string; columns: AttrMeta[] }[] {
  const result: { name: string; columns: AttrMeta[] }[] = [];
  const re = /<TabularSection\b[^>]*>([\s\S]*?)<\/TabularSection>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(childObjects)) !== null) {
    const body = m[1];
    const props = extractInnerBlock(body, 'Properties') ?? '';
    const name = extractTagText(props, 'Name');
    if (!name) continue;
    const tsChildren = extractInnerBlock(body, 'ChildObjects') ?? '';
    const columns = extractFields(tsChildren, 'Attribute');
    result.push({ name, columns });
  }
  return result;
}

function extractInnerBlock(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`);
  return re.exec(xml)?.[1] ?? null;
}

function extractTagText(xml: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`);
  return re.exec(xml)?.[1]?.trim();
}

function extractSynonym(propsBlock: string): string | undefined {
  const synBlock = extractInnerBlock(propsBlock, 'Synonym');
  if (!synBlock) return undefined;
  return /<v8:content>([\s\S]*?)<\/v8:content>/.exec(synBlock)?.[1]?.trim();
}

// ─── Generators ─────────────────────────────────────────────────────────────

const NON_DISPLAYABLE_TYPES = ['ValueStorage', 'v8:ValueStorage', 'ХранилищеЗначения'];

function isDisplayable(t: string): boolean {
  return !NON_DISPLAYABLE_TYPES.some((nd) => t.includes(nd));
}

function isBooleanType(t: string): boolean {
  return /xs:boolean|Boolean/i.test(t);
}

function isRefType(t: string): boolean {
  return /Ref\./.test(t);
}

function fieldElement(attrName: string, dataPath: string, type: string): FormElementDefinition {
  if (isBooleanType(type)) {
    return { check: attrName, path: dataPath };
  }
  const el: Record<string, unknown> = { input: attrName, path: dataPath };
  if (isRefType(type)) {
    el.choiceButton = true;
  }
  return el as FormElementDefinition;
}

function columnElement(attrName: string, dataPath: string, type: string): FormElementDefinition {
  if (isBooleanType(type)) {
    return { check: attrName, path: dataPath };
  }
  return { labelField: attrName, path: dataPath };
}

const ATTR_TYPE_MAP: Record<string, string> = {
  Document: 'DocumentObject', Catalog: 'CatalogObject',
  ChartOfAccounts: 'ChartOfAccountsObject',
  ChartOfCharacteristicTypes: 'ChartOfCharacteristicTypesObject',
  ChartOfCalculationTypes: 'ChartOfCalculationTypesObject',
  ExchangePlan: 'ExchangePlanObject',
  BusinessProcess: 'BusinessProcessObject',
  Task: 'TaskObject',
  InformationRegister: 'InformationRegisterRecordManager',
};

function mainObjectAttribute(meta: ObjectMeta): FormAttributeDefinition {
  const prefix = ATTR_TYPE_MAP[meta.kind] ?? `${meta.kind}Object`;
  return { name: 'Объект', type: `${prefix}.${meta.name}`, main: true };
}

function mainListAttribute(meta: ObjectMeta): FormAttributeDefinition {
  return {
    name: 'Список', type: 'DynamicList', main: true,
    settings: { mainTable: `${meta.kind}.${meta.name}`, dynamicDataRead: true },
  };
}

function mainRecordAttribute(meta: ObjectMeta): FormAttributeDefinition {
  return { name: 'Запись', type: `InformationRegisterRecordManager.${meta.name}`, main: true, savedData: true };
}

// ── Catalog-like (Catalog/CCT/ExchangePlan/ChartOfAccounts/BusinessProcess/Task) ──

function generateCatalogLikeDsl(meta: ObjectMeta, purpose: FormPurpose, title: string): FormDefinition {
  if (purpose === 'List' || purpose === 'Choice') {
    return generateListDsl(meta, purpose, title, true);
  }
  // Object (Item / Folder)
  const headerChildren: FormElementDefinition[] = [];
  if (meta.ownersCount > 0) {
    headerChildren.push({ input: 'Владелец', path: 'Объект.Owner', readOnly: true });
  }
  // Code + Description (горизонтально)
  if (meta.hasCode && meta.hasDescription) {
    headerChildren.push({
      group: 'horizontal', name: 'ГруппаКодНаименование', showTitle: false, representation: 'none',
      children: [
        { input: 'Наименование', path: 'Объект.Description' },
        { input: 'Код', path: 'Объект.Code' },
      ],
    });
  } else if (meta.hasDescription) {
    headerChildren.push({ input: 'Наименование', path: 'Объект.Description' });
  } else if (meta.hasCode) {
    headerChildren.push({ input: 'Код', path: 'Объект.Code' });
  }
  // Parent (если иерархический)
  if (meta.hierarchical) {
    headerChildren.push({ input: 'Родитель', path: 'Объект.Parent', title: 'Входит в группу' });
  }
  // Custom attributes
  for (const a of meta.attributes) {
    if (!isDisplayable(a.type)) continue;
    headerChildren.push(fieldElement(a.name, `Объект.${a.name}`, a.type));
  }

  const rootElements: FormElementDefinition[] = [];
  rootElements.push({
    group: 'vertical', name: 'ГруппаШапка', showTitle: false, representation: 'none',
    children: headerChildren,
  });

  // Tabular sections inline
  const skipTs = new Set(['ДополнительныеРеквизиты', 'Представления']);
  for (const ts of meta.tabularSections) {
    if (skipTs.has(ts.name)) continue;
    const cols: FormElementDefinition[] = [
      { labelField: `${ts.name}НомерСтроки`, path: `Объект.${ts.name}.LineNumber` },
    ];
    for (const col of ts.columns) {
      if (!isDisplayable(col.type)) continue;
      cols.push(columnElement(`${ts.name}${col.name}`, `Объект.${ts.name}.${col.name}`, col.type));
    }
    rootElements.push({ table: ts.name, path: `Объект.${ts.name}`, columns: cols });
  }

  return {
    title,
    properties: {},
    events: { OnCreateAtServer: 'ПриСозданииНаСервере' },
    elements: rootElements,
    attributes: [mainObjectAttribute(meta)],
  };
}

// ── Document ─────────────────────────────────────────────────────────────────

function generateDocumentDsl(meta: ObjectMeta, purpose: FormPurpose, title: string): FormDefinition {
  if (purpose === 'List' || purpose === 'Choice') {
    return generateDocumentListDsl(meta, purpose, title);
  }
  // Object (Item)
  const numDate: FormElementDefinition = {
    group: 'horizontal', name: 'ГруппаНомерДата', showTitle: false,
    children: [
      { input: 'Номер', path: 'Объект.Number', autoMaxWidth: false, width: 9 },
      { input: 'Дата', path: 'Объект.Date', title: 'от' },
    ],
  };
  const headerChildren: FormElementDefinition[] = [numDate];
  for (const a of meta.attributes) {
    if (!isDisplayable(a.type)) continue;
    headerChildren.push(fieldElement(a.name, `Объект.${a.name}`, a.type));
  }
  const headerGroup: FormElementDefinition = {
    group: 'horizontal', name: 'ГруппаШапка', showTitle: false, representation: 'none',
    children: [
      { group: 'vertical', name: 'ГруппаШапкаЛево', showTitle: false, children: headerChildren },
    ],
  };

  const skipTs = new Set(['ДополнительныеРеквизиты']);
  const visibleTs = meta.tabularSections.filter((ts) => !skipTs.has(ts.name));

  const rootElements: FormElementDefinition[] = [];
  if (visibleTs.length === 0) {
    rootElements.push(headerGroup);
  } else {
    const pages: FormElementDefinition[] = [
      { page: 'ГруппаОсновное', title: 'Основное', children: [headerGroup] },
    ];
    for (const ts of visibleTs) {
      const cols: FormElementDefinition[] = [
        { labelField: `${ts.name}НомерСтроки`, path: `Объект.${ts.name}.LineNumber` },
      ];
      for (const col of ts.columns) {
        if (!isDisplayable(col.type)) continue;
        cols.push(columnElement(`${ts.name}${col.name}`, `Объект.${ts.name}.${col.name}`, col.type));
      }
      pages.push({
        page: `Группа${ts.name}`, title: ts.name,
        children: [{ table: ts.name, path: `Объект.${ts.name}`, columns: cols }],
      });
    }
    rootElements.push({ pages: 'ГруппаСтраницы', children: pages });
  }

  return {
    title,
    properties: { autoTitle: false },
    events: { OnCreateAtServer: 'ПриСозданииНаСервере' },
    elements: rootElements,
    attributes: [mainObjectAttribute(meta)],
  };
}

function generateDocumentListDsl(meta: ObjectMeta, purpose: FormPurpose, title: string): FormDefinition {
  const columns: FormElementDefinition[] = [
    { labelField: 'Номер', path: 'Список.Number' },
    { labelField: 'Дата', path: 'Список.Date' },
  ];
  for (const a of meta.attributes) {
    if (!isDisplayable(a.type)) continue;
    columns.push({ labelField: a.name, path: `Список.${a.name}` });
  }
  columns.push({ labelField: 'Ссылка', path: 'Список.Ref', userVisible: false });
  const table: FormElementDefinition = {
    table: 'Список', path: 'Список',
    rowPictureDataPath: 'Список.DefaultPicture',
    commandBarLocation: 'None',
    tableAutofill: false,
    columns,
  };
  const props: Record<string, unknown> = {};
  if (purpose === 'Choice') {
    props.windowOpeningMode = 'LockOwnerWindow';
    (table as Record<string, unknown>).choiceMode = true;
  }
  return {
    title,
    properties: props,
    elements: [table],
    attributes: [{
      name: 'Список', type: 'DynamicList', main: true,
      settings: { mainTable: `Document.${meta.name}`, dynamicDataRead: true },
    }],
  };
}

// ── Common list for Catalog-like ─────────────────────────────────────────────

function generateListDsl(meta: ObjectMeta, purpose: FormPurpose, title: string, hierarchical: boolean): FormDefinition {
  const columns: FormElementDefinition[] = [];
  if (meta.hasDescription) {
    columns.push({ labelField: 'Наименование', path: 'Список.Description' });
  }
  if (meta.hasCode) {
    columns.push({ labelField: 'Код', path: 'Список.Code' });
  }
  for (const a of meta.attributes) {
    if (!isDisplayable(a.type)) continue;
    columns.push({ labelField: a.name, path: `Список.${a.name}` });
  }
  columns.push({ labelField: 'Ссылка', path: 'Список.Ref', userVisible: false });
  const table: Record<string, unknown> = {
    table: 'Список', path: 'Список',
    rowPictureDataPath: 'Список.DefaultPicture',
    commandBarLocation: 'None',
    tableAutofill: false,
    columns,
  };
  if (hierarchical && meta.hierarchical) {
    table.initialTreeView = 'ExpandTopLevel';
    table.enableStartDrag = true;
    table.enableDrag = true;
  }
  const props: Record<string, unknown> = {};
  if (purpose === 'Choice') {
    props.windowOpeningMode = 'LockOwnerWindow';
    table.choiceMode = true;
  }
  return {
    title,
    properties: props,
    elements: [table as FormElementDefinition],
    attributes: [mainListAttribute(meta)],
  };
}

// ── Registers ────────────────────────────────────────────────────────────────

function generateInfoRegisterDsl(meta: ObjectMeta, purpose: FormPurpose, title: string): FormDefinition {
  if (purpose === 'List') {
    return generateRegisterListDsl(meta, title, /*hasRecorder*/ meta.writeMode === 'RecorderSubordinate', /*hasPeriod*/ meta.periodicity != null && meta.periodicity !== 'Nonperiodical', meta.kind);
  }
  // Record
  const elements: FormElementDefinition[] = [];
  const isPeriodic = meta.periodicity != null && meta.periodicity !== 'Nonperiodical';
  if (isPeriodic) {
    elements.push({ input: 'Период', path: 'Запись.Period' });
  }
  for (const dim of meta.dimensions) {
    if (!isDisplayable(dim.type)) continue;
    elements.push(fieldElement(dim.name, `Запись.${dim.name}`, dim.type));
  }
  for (const res of meta.resources) {
    if (!isDisplayable(res.type)) continue;
    elements.push(fieldElement(res.name, `Запись.${res.name}`, res.type));
  }
  for (const a of meta.attributes) {
    if (!isDisplayable(a.type)) continue;
    elements.push(fieldElement(a.name, `Запись.${a.name}`, a.type));
  }
  return {
    title,
    properties: { windowOpeningMode: 'LockOwnerWindow' },
    events: { OnCreateAtServer: 'ПриСозданииНаСервере' },
    elements,
    attributes: [mainRecordAttribute(meta)],
  };
}

function generateAccumRegisterDsl(meta: ObjectMeta, _purpose: FormPurpose, title: string): FormDefinition {
  return generateRegisterListDsl(meta, title, /*hasRecorder*/ true, /*hasPeriod*/ true, meta.kind);
}

function generateRegisterListDsl(meta: ObjectMeta, title: string, hasRecorder: boolean, hasPeriod: boolean, kind: string): FormDefinition {
  const columns: FormElementDefinition[] = [];
  if (hasPeriod) columns.push({ labelField: 'Период', path: 'Список.Period' });
  if (hasRecorder) {
    columns.push({ labelField: 'Регистратор', path: 'Список.Recorder' });
    columns.push({ labelField: 'НомерСтроки', path: 'Список.LineNumber' });
  }
  for (const dim of meta.dimensions) {
    if (!isDisplayable(dim.type)) continue;
    columns.push({ labelField: dim.name, path: `Список.${dim.name}` });
  }
  for (const res of meta.resources) {
    if (!isDisplayable(res.type)) continue;
    columns.push(columnElement(res.name, `Список.${res.name}`, res.type));
  }
  for (const a of meta.attributes) {
    if (!isDisplayable(a.type)) continue;
    columns.push(columnElement(a.name, `Список.${a.name}`, a.type));
  }
  const table: FormElementDefinition = {
    table: 'Список', path: 'Список',
    rowPictureDataPath: 'Список.DefaultPicture',
    commandBarLocation: 'None',
    tableAutofill: false,
    columns,
  };
  return {
    title,
    elements: [table],
    attributes: [{
      name: 'Список', type: 'DynamicList', main: true,
      settings: { mainTable: `${kind}.${meta.name}`, dynamicDataRead: true },
    }],
  };
}

void path; // path импортирован для расширения — оставлен на будущее
