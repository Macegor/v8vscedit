/**
 * Сборка корневого `Form.xml` из DSL-определения: нормализация определения
 * (синонимы, извлечение главной авто-командной панели, вывод главного
 * реквизита, эвристика DynamicList→table) и последовательный обход всех
 * секций. Целиком детерминированная функция — id берутся из IdAllocator.
 */
import { buildLocalizedTag, createIdAllocator } from '../FormShared';
import type { FormAttributeDefinition, FormDefinition, FormElementDefinition } from '../types';
import {
  emitType,
  escapeXml,
  FORM_XMLNS,
  isPlainObject,
  KNOWN_FORM_EVENTS,
  warn,
  xmlStr,
} from './formBuilderShared';
import { emitAttributes } from './formAttributes';
import { emitCommands } from './formCommands';
import {
  emitElement,
  emitMainAutoCommandBar,
  type NormalizedDefinition,
} from './formElements';

const PROP_MAP: Record<string, string> = {
  autoTitle: 'AutoTitle',
  windowOpeningMode: 'WindowOpeningMode',
  commandBarLocation: 'CommandBarLocation',
  saveDataInSettings: 'SaveDataInSettings',
  autoSaveDataInSettings: 'AutoSaveDataInSettings',
  autoTime: 'AutoTime',
  usePostingMode: 'UsePostingMode',
  repostOnWrite: 'RepostOnWrite',
  autoURL: 'AutoURL',
  autoFillCheck: 'AutoFillCheck',
  customizable: 'Customizable',
  enterKeyBehavior: 'EnterKeyBehavior',
  verticalScroll: 'VerticalScroll',
  scalingMode: 'ScalingMode',
  useForFoldersAndItems: 'UseForFoldersAndItems',
  reportResult: 'ReportResult',
  detailsData: 'DetailsData',
  reportFormType: 'ReportFormType',
  autoShowState: 'AutoShowState',
  width: 'Width',
  height: 'Height',
  group: 'Group',
};

export function buildFormXmlFromDefinition(definition: FormDefinition, formatVersion: string): string {
  const defn = normalizeDefinition(definition);
  const id = createIdAllocator('');
  const lines: string[] = [];

  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(`<Form ${FORM_XMLNS} version="${formatVersion}">`);

  // Title
  const props = defn.properties ?? {};
  let title = defn.title;
  if (!title && typeof props.title === 'string') {
    title = props.title;
  }
  if (title) {
    lines.push(buildLocalizedTag('\t', 'Title', title));
  }

  // Properties (skip 'title' — handled above)
  const propsClone: Record<string, unknown> = {};
  if (title && !('autoTitle' in props)) {
    propsClone.autoTitle = false;
  }
  for (const [k, v] of Object.entries(props)) {
    if (k !== 'title') {
      propsClone[k] = v;
    }
  }
  emitProperties(lines, propsClone, '\t');

  // CommandSet (excluded commands)
  if (defn.excludedCommands?.length) {
    lines.push('\t<CommandSet>');
    for (const cmd of defn.excludedCommands) {
      lines.push(`\t\t<ExcludedCommand>${escapeXml(cmd)}</ExcludedCommand>`);
    }
    lines.push('\t</CommandSet>');
  }

  // AutoCommandBar (всегда присутствует, id=-1)
  emitMainAutoCommandBar(lines, defn, id);

  // Events
  if (defn.events && Object.keys(defn.events).length > 0) {
    for (const evtName of Object.keys(defn.events)) {
      if (!KNOWN_FORM_EVENTS.includes(evtName)) {
        warn(`[WARN] Unknown form event '${evtName}'. Known: ${KNOWN_FORM_EVENTS.join(', ')}`);
      }
    }
    lines.push('\t<Events>');
    for (const [name, handler] of Object.entries(defn.events)) {
      lines.push(`\t\t<Event name="${escapeXml(name)}">${escapeXml(handler)}</Event>`);
    }
    lines.push('\t</Events>');
  }

  // ChildItems
  if (defn.elements?.length) {
    lines.push('\t<ChildItems>');
    for (const el of defn.elements) {
      emitElement(lines, el, '\t\t', id);
    }
    lines.push('\t</ChildItems>');
  }

  // Attributes
  emitAttributes(lines, defn.attributes, '\t', id);

  // Parameters
  emitParameters(lines, defn.parameters, '\t');

  // Commands
  emitCommands(lines, defn.commands, '\t', id);

  lines.push('</Form>');
  return lines.join('\n') + '\n';
}

function normalizeDefinition(definition: FormDefinition): NormalizedDefinition {
  // copy + mutate-safe
  const defn: NormalizedDefinition & { elements?: FormElementDefinition[]; attributes?: FormAttributeDefinition[] } = {
    ...definition,
    elements: definition.elements ? [...definition.elements] : undefined,
    attributes: definition.attributes ? definition.attributes.map((a) => ({ ...a })) : undefined,
  };

  // 1b.1 Recursive synonym normalization
  if (Array.isArray(defn.elements)) {
    for (const el of defn.elements) {
      normalizeSynonyms(el);
    }
  }

  // 1b.2 Extract autoCmdBar
  let mainAcb: FormElementDefinition | undefined;
  if (Array.isArray(defn.elements)) {
    const autoBars = defn.elements.filter((el) => isPlainObject(el) && (el as Record<string, unknown>).autoCmdBar !== undefined);
    if (autoBars.length > 1) {
      throw new Error(`form-compile: more than one autoCmdBar in def.elements (found ${String(autoBars.length)}); only one allowed.`);
    }
    if (autoBars.length === 1) {
      mainAcb = autoBars[0];
      defn.elements = defn.elements.filter((el) => el !== mainAcb);
    }
  }
  (defn as { mainAutoCmdBar?: FormElementDefinition }).mainAutoCmdBar = mainAcb;

  // 1b.3 Infer main attribute
  if (Array.isArray(defn.attributes)) {
    const hasExplicitMain = defn.attributes.some((a) => a.main === true);
    if (!hasExplicitMain) {
      const candidates = defn.attributes.filter((a) => (a as { main?: unknown }).main !== false && isObjectLikeType(a.type ?? ''));
      if (candidates.length === 1) {
        (candidates[0] as { main?: boolean }).main = true;
        warn(`[INFO] Inferred main attribute: ${candidates[0].name} (${candidates[0].type ?? ''})`);
      } else if (candidates.length > 1) {
        warn(`[WARN] Multiple main-attribute candidates: ${candidates.map((c) => c.name).join(', ')}; specify "main": true explicitly`);
      }
    }
  }

  // 1b.4 DynamicList → table heuristic
  if (Array.isArray(defn.attributes) && Array.isArray(defn.elements)) {
    const mainAttr = defn.attributes.find((a) => a.main === true);
    if (mainAttr && (mainAttr.type ?? '') === 'DynamicList') {
      const settings = (mainAttr.settings ?? {});
      const hasMt = Boolean(settings.mainTable);
      for (const el of defn.elements) {
        applyDlistTableHeuristic(el, mainAttr.name, hasMt);
      }
    }
  }

  return defn;
}

function normalizeSynonyms(el: unknown): void {
  if (!isPlainObject(el)) {
    return;
  }
  if ('commandBar' in el && !('cmdBar' in el)) {
    el.cmdBar = el.commandBar;
    delete el.commandBar;
  }
  if ('autoCommandBar' in el && !('autoCmdBar' in el)) {
    el.autoCmdBar = el.autoCommandBar;
    delete el.autoCommandBar;
  }
  if (Array.isArray(el.children)) {
    for (const child of el.children) {
      normalizeSynonyms(child);
    }
  }
  if (Array.isArray(el.columns)) {
    for (const child of el.columns) {
      normalizeSynonyms(child);
    }
  }
}

function applyDlistTableHeuristic(el: unknown, listName: string, hasMainTable: boolean): void {
  if (!isPlainObject(el)) {
    return;
  }
  if (el.table !== undefined && xmlStr(el.path) === listName) {
    if (!('tableAutofill' in el)) {
      el.tableAutofill = false;
    }
    if (!('commandBarLocation' in el)) {
      el.commandBarLocation = 'None';
    }
    if (hasMainTable && !el.rowPictureDataPath) {
      el.rowPictureDataPath = `${listName}.DefaultPicture`;
    }
  }
  if (Array.isArray(el.children)) {
    for (const child of el.children) {
      applyDlistTableHeuristic(child, listName, hasMainTable);
    }
  }
}

function isObjectLikeType(t: string): boolean {
  if (!t) {return false;}
  if (t === 'DynamicList' || t === 'ConstantsSet') {return true;}
  const objectSuffixes = [
    'CatalogObject', 'DocumentObject', 'DataProcessorObject', 'ReportObject',
    'ExternalDataProcessorObject', 'ExternalReportObject', 'BusinessProcessObject',
    'TaskObject', 'ChartOfAccountsObject', 'ChartOfCharacteristicTypesObject',
    'ChartOfCalculationTypesObject', 'ExchangePlanObject',
  ];
  const recordSetPrefixes = [
    'InformationRegisterRecordSet', 'AccumulationRegisterRecordSet',
    'AccountingRegisterRecordSet', 'CalculationRegisterRecordSet',
    'InformationRegisterRecordManager',
  ];
  return objectSuffixes.some((s) => t.startsWith(s + '.')) || recordSetPrefixes.some((s) => t.startsWith(s + '.'));
}

function emitParameters(lines: string[], params: readonly Record<string, unknown>[] | undefined, indent: string): void {
  if (!params || params.length === 0) {return;}
  lines.push(`${indent}<Parameters>`);
  for (const param of params) {
    lines.push(`${indent}\t<Parameter name="${escapeXml(xmlStr(param.name))}">`);
    const inner = `${indent}\t\t`;
    emitType(lines, xmlStr(param.type), inner);
    if (param.key === true) {
      lines.push(`${inner}<KeyParameter>true</KeyParameter>`);
    }
    lines.push(`${indent}\t</Parameter>`);
  }
  lines.push(`${indent}</Parameters>`);
}

function emitProperties(lines: string[], props: Record<string, unknown>, indent: string): void {
  if (Object.keys(props).length === 0) {return;}
  for (const [pName, pValue] of Object.entries(props)) {
    const xmlName = pName in PROP_MAP ? PROP_MAP[pName] : `${pName.charAt(0).toUpperCase()}${pName.slice(1)}`;
    const val = typeof pValue === 'boolean' ? (pValue ? 'true' : 'false') : xmlStr(pValue);
    lines.push(`${indent}<${xmlName}>${escapeXml(val)}</${xmlName}>`);
  }
}
