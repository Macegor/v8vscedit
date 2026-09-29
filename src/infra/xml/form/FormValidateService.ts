/**
 * Аналог `.claude/skills/form-validate/scripts/form-validate.py`.
 * Проверяет Form.xml: версия, AutoCommandBar, уникальность ID,
 * companion-элементы, DataPath → реквизит, CommandName → команда,
 * обработчики событий, callType, типы (cfg-префиксы), MainAttribute,
 * Title, и расширения (BaseForm + ID >= 1000000).
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  attr,
  escapeRegExp,
  extractBlock,
  isFormRootXml,
  isMetaDataObjectRootXml,
  resolveFormXmlPath,
  VALID_CALL_TYPES,
} from './FormShared';
import {
  collectAttributes,
  collectCommands,
  collectElements,
} from './FormInfoService';
import {
  collectIdSpaces,
  countCheckedEntries,
  findDuplicateIds,
  splitBaseForm,
  type FormIdDuplicate,
  type FormIdSpace,
  type IdSpaceKind,
} from './FormIdSpaces';
import type {
  FormAttributeInfo,
  FormCommandInfo,
  FormElementInfo,
  FormValidationResult,
  ValidateFormOptions,
} from './types';

const KNOWN_INVALID_TYPES = new Set([
  'FormDataStructure', 'FormDataCollection', 'FormDataTree',
  'FormDataTreeItem', 'FormDataCollectionItem',
  'FormGroup', 'FormField', 'FormButton', 'FormDecoration', 'FormTable',
]);

const VALID_CLOSED_TYPES = new Set([
  'xs:boolean', 'xs:string', 'xs:decimal', 'xs:dateTime', 'xs:binary',
  'v8:FillChecking', 'v8:Null', 'v8:StandardPeriod', 'v8:StandardBeginningDate', 'v8:Type',
  'v8:TypeDescription', 'v8:UUID', 'v8:ValueStorage', 'v8:ValueListType', 'v8:ValueTable', 'v8:ValueTree',
  'v8:Universal', 'v8:Array', 'v8:FixedArray', 'v8:Structure', 'v8:FixedStructure',
  'v8ui:Color', 'v8ui:Font', 'v8ui:FormattedString', 'v8ui:HorizontalAlign',
  'v8ui:Picture', 'v8ui:SizeChangeMode', 'v8ui:VerticalAlign',
  'dcsset:DataCompositionComparisonType', 'dcsset:DataCompositionFieldPlacement',
  'dcsset:Filter', 'dcsset:SettingsComposer', 'dcsset:DataCompositionSettings',
  'dcssch:DataCompositionSchema',
  'dcscor:DataCompositionComparisonType', 'dcscor:DataCompositionGroupType',
  'dcscor:DataCompositionPeriodAdditionType', 'dcscor:DataCompositionSortDirection', 'dcscor:Field',
  'ent:AccountType', 'ent:AccumulationRecordType', 'ent:AccountingRecordType',
]);

const VALID_CFG_PREFIXES = new Set([
  'AccountingRegisterRecordSet', 'AccumulationRegisterRecordSet',
  'BusinessProcessObject', 'BusinessProcessRef',
  'CatalogObject', 'CatalogRef',
  'ChartOfAccountsObject', 'ChartOfAccountsRef',
  'ChartOfCalculationTypesObject', 'ChartOfCalculationTypesRef',
  'ChartOfCharacteristicTypesObject', 'ChartOfCharacteristicTypesRef',
  'ConstantsSet', 'DataProcessorObject', 'DocumentObject', 'DocumentRef',
  'DynamicList', 'EnumRef', 'ExchangePlanObject', 'ExchangePlanRef',
  'ExternalDataProcessorObject', 'ExternalReportObject',
  'InformationRegisterRecordManager', 'InformationRegisterRecordSet',
  'ReportObject', 'TaskObject', 'TaskRef',
]);

const COMPANION_RULES: Record<string, readonly string[]> = {
  InputField: ['ContextMenu', 'ExtendedTooltip'],
  CheckBoxField: ['ContextMenu', 'ExtendedTooltip'],
  RadioButtonField: ['ContextMenu', 'ExtendedTooltip'],
  LabelDecoration: ['ContextMenu', 'ExtendedTooltip'],
  LabelField: ['ContextMenu', 'ExtendedTooltip'],
  PictureDecoration: ['ContextMenu', 'ExtendedTooltip'],
  PictureField: ['ContextMenu', 'ExtendedTooltip'],
  CalendarField: ['ContextMenu', 'ExtendedTooltip'],
  UsualGroup: ['ExtendedTooltip'],
  Pages: ['ExtendedTooltip'],
  Page: ['ExtendedTooltip'],
  Button: ['ExtendedTooltip'],
  Table: ['ContextMenu', 'AutoCommandBar', 'SearchStringAddition', 'ViewStatusAddition', 'SearchControlAddition'],
};

const SKIP_DATAPATH_TAGS = new Set([
  'ContextMenu', 'ExtendedTooltip', 'AutoCommandBar',
  'SearchStringAddition', 'ViewStatusAddition', 'SearchControlAddition',
]);

export class FormValidateService {
  validate(options: ValidateFormOptions): FormValidationResult {
    const formPath = resolveFormXmlPath(options.formPath);
    const formName = resolveFormName(formPath);
    const lines: string[] = [`=== Validation: Form.${formName} ===`, ''];
    const report = new ValidationReport(lines, options.maxErrors ?? 30, options.detailed === true);
    const reportOk = (msg: string) => { report.ok(msg); };
    const reportWarn = (msg: string) => { report.warn(msg); };
    const reportError = (msg: string) => { report.error(msg); };

    let xml: string;
    try {
      xml = fs.readFileSync(formPath, 'utf-8');
    } catch (err) {
      reportError(`Cannot read file: ${String(err)}`);
      return finalize(formPath, report, lines);
    }

    const isConfigContext = detectConfigContext(formPath);

    // 1. Root element
    // Критерий — ПЕРВЫЙ элемент документа (isFormRootXml), а не подстрока `<Form`:
    // в XML справочника есть <Form>ФормаСписка</Form> внутри <ChildObjects>, и такой
    // файл проходил проверку, после чего сыпалась пачка ложных ошибок про форму.
    // validate read-only, поэтому это отчёт об ошибке, а не исключение.
    if (!isFormRootXml(xml)) {
      const hint = isMetaDataObjectRootXml(xml)
        ? ' Это XML объекта метаданных; тело формы лежит в <Объект>/Forms/<Имя>/Ext/Form.xml.'
        : '';
      reportError(`Root element is not Form: ${formPath}.${hint}`);
      return finalize(formPath, report, lines);
    }
    const versionM = /<Form\b[^>]*\bversion="([^"]+)"/.exec(xml);
    if (versionM) {
      const v = versionM[1];
      if (v === '2.17' || v === '2.20') {
        reportOk(`Root element: Form version=${v}`);
      } else {
        reportWarn(`Form version='${v}' (expected 2.17 or 2.20)`);
      }
    } else {
      reportWarn('Form version attribute missing');
    }

    const hasBaseForm = /<BaseForm\b/.test(xml);

    // 2. AutoCommandBar
    // Единственная ошибка секции 1 («Root element is not Form.») завершает
    // проверку немедленным return выше, поэтому досюда `stopped` дойти не может —
    // guard'а здесь намеренно нет.
    const acb = /<AutoCommandBar\b([^>]*?)(\/?)>/.exec(xml);
    if (!acb) {
      reportError('AutoCommandBar element missing');
    } else {
      const acbId = attr(acb[1], 'id') ?? '';
      const acbName = attr(acb[1], 'name') ?? '';
      if (acbId === '-1') {
        reportOk(`AutoCommandBar: name='${acbName}', id=${acbId}`);
      } else {
        reportError(`AutoCommandBar id='${acbId}', expected '-1'`);
      }
    }

    const elements = collectElements(xml);
    const attributes = collectAttributes(xml);
    const commands = collectCommands(xml);

    // 3. Пространства нумерации id: element / attribute / command / колонки.
    // Регион <BaseForm> — копия базовой формы, её id живут отдельно и с
    // собственными id расширения не пересекаются (см. FormIdSpaces).
    // Внешнего guard'а нет: проверка пространств сама уважает `stopped`.
    validateIdSpaces(collectIdSpaces(splitBaseForm(xml).own), report);

    // 4. Companion elements
    if (!report.stopped) {
      validateCompanions(xml, elements, reportError, reportOk);
    }

    // 5. DataPath → attribute
    if (!report.stopped) {
      validateDataPaths(xml, elements, attributes, hasBaseForm, reportError, reportWarn, reportOk);
    }

    // 6. Command references
    if (!report.stopped) {
      validateCommandRefs(elements, commands, reportError, reportOk);
    }

    // 7. Event handlers non-empty
    if (!report.stopped) {
      validateEventHandlers(xml, reportError, reportOk);
    }

    // 8. Command actions present
    if (!report.stopped) {
      validateCommandActions(xml, commands, reportError, reportOk);
    }

    // 9. MainAttribute count
    if (!report.stopped) {
      const mainCount = attributes.filter((a) => a.main).length;
      if (mainCount > 1) {
        reportError(`Multiple MainAttribute=true (${String(mainCount)} found, expected 0 or 1)`);
      } else {
        reportOk(`MainAttribute: ${mainCount === 1 ? '1 main attribute' : 'no main attribute'}`);
      }
    }

    // 10. Title must be multilingual
    if (!report.stopped) {
      validateTitle(xml, reportError, reportOk);
    }

    // 11. Extension validations + callType
    if (!report.stopped) {
      validateCallTypesAndExtension(xml, attributes, commands, hasBaseForm, reportError, reportWarn, reportOk);
    }

    // 12. Type validation
    if (!report.stopped) {
      validateTypes(xml, isConfigContext, reportError, reportWarn, reportOk);
    }

    return finalize(formPath, report, lines);
  }
}

/**
 * Единый счётчик отчёта: ошибки/предупреждения/OK и признак останова живут в
 * одном месте, поэтому проверки сами ничего не считают. Как только достигнут
 * лимит `maxErrors`, ошибки перестают приниматься — число ошибок в результате
 * никогда не превышает лимит, даже если проверка внутри себя нашла больше.
 */
class ValidationReport {
  private errorCount = 0;
  private warningCount = 0;
  private okCount = 0;
  private limitReached = false;

  constructor(
    private readonly lines: string[],
    private readonly maxErrors: number,
    private readonly detailed: boolean,
  ) {}

  get errors(): number { return this.errorCount; }
  get warnings(): number { return this.warningCount; }
  get okChecks(): number { return this.okCount; }
  get stopped(): boolean { return this.limitReached; }

  error(msg: string): void {
    if (this.limitReached) {
      return;
    }
    this.errorCount++;
    this.lines.push(`[ERROR] ${msg}`);
    if (this.errorCount >= this.maxErrors) {
      this.limitReached = true;
    }
  }

  warn(msg: string): void {
    this.warningCount++;
    this.lines.push(`[WARN]  ${msg}`);
  }

  ok(msg: string): void {
    this.okCount++;
    if (this.detailed) {
      this.lines.push(`[OK]    ${msg}`);
    }
  }
}

/** Единица измерения OK-строки по виду пространства. */
const OK_UNIT: Record<Exclude<IdSpaceKind, 'column'>, string> = {
  element: 'elements',
  attribute: 'entries',
  command: 'entries',
};

/**
 * Проверяет пространства в фиксированном порядке (element → attribute →
 * command → колоночные контейнеры). OK-строка пространства печатается ТОЛЬКО
 * при нуле дублей в нём, иначе отчёт «0 ошибок, уникальных id: N» снова стал бы
 * ложным. Колонки суммируются в одну строку по всем контейнерам.
 */
function validateIdSpaces(spaces: readonly FormIdSpace[], report: ValidationReport): void {
  let columnEntries = 0;
  let columnContainers = 0;
  let columnsClean = true;
  for (const space of spaces) {
    if (report.stopped) {
      return;
    }
    const duplicates = findDuplicateIds(space);
    for (const duplicate of duplicates) {
      report.error(formatDuplicate(space, duplicate));
    }
    const kind = space.kind;
    if (kind === 'column') {
      columnContainers++;
      columnEntries += countCheckedEntries(space);
      columnsClean = columnsClean && duplicates.length === 0;
      continue;
    }
    if (duplicates.length === 0) {
      report.ok(`Unique ${kind} IDs: ${String(countCheckedEntries(space))} ${OK_UNIT[kind]}`);
    }
  }
  if (columnContainers > 0 && columnsClean) {
    report.ok(`Unique column IDs: ${String(columnEntries)} columns in ${String(columnContainers)} containers`);
  }
}

function formatDuplicate(space: FormIdSpace, duplicate: FormIdDuplicate): string {
  const current = quoteName(duplicate.current.name);
  const previous = quoteName(duplicate.previous.name);
  if (space.kind === 'element') {
    return `Duplicate element id=${duplicate.id}: ${current} <${duplicate.current.tag}> and ${previous} <${duplicate.previous.tag}>`;
  }
  if (space.kind === 'column') {
    return `Duplicate column id=${duplicate.id} in ${space.label}: ${current} and ${previous}`;
  }
  return `Duplicate ${space.kind} id=${duplicate.id}: ${current} and ${previous}`;
}

function quoteName(name: string): string {
  return `'${name || '(unnamed)'}'`;
}

function resolveFormName(formPath: string): string {
  const fnDir = path.dirname(formPath);
  if (path.basename(fnDir) === 'Ext') {
    return path.basename(path.dirname(fnDir));
  }
  return path.basename(formPath, '.xml');
}

function detectConfigContext(formPath: string): boolean {
  let walkDir = path.dirname(path.resolve(formPath));
  for (let i = 0; i < 15; i++) {
    const parent = path.dirname(walkDir);
    if (parent === walkDir) {break;}
    if (fs.existsSync(path.join(walkDir, 'Configuration.xml'))) {
      return true;
    }
    walkDir = parent;
  }
  return false;
}

function validateCompanions(xml: string, elements: readonly FormElementInfo[], reportError: (msg: string) => void, reportOk: (msg: string) => void): void {
  let checked = 0;
  let bad = 0;
  for (const el of elements) {
    if (!(el.tag in COMPANION_RULES)) {continue;}
    const required = COMPANION_RULES[el.tag];
    checked++;
    // Найти XML тела элемента по name + id
    const re = new RegExp(`<${el.tag}\\b[^>]*name="${escapeRegExp(el.name)}"[^>]*\\bid="${escapeRegExp(el.id)}"[^>]*>([\\s\\S]*?)<\\/${el.tag}>`);
    const body = re.exec(xml)?.[1] ?? '';
    for (const comp of required) {
      const compRe = new RegExp(`<${comp}\\b`);
      if (!compRe.test(body)) {
        reportError(`[${el.tag}] '${el.name}': missing companion <${comp}>`);
        bad++;
      }
    }
  }
  if (bad === 0 && checked > 0) {
    reportOk(`Companion elements: ${String(checked)} elements checked`);
  }
}

function validateDataPaths(
  xml: string,
  elements: readonly FormElementInfo[],
  attributes: readonly FormAttributeInfo[],
  hasBaseForm: boolean,
  reportError: (msg: string) => void,
  reportWarn: (msg: string) => void,
  reportOk: (msg: string) => void,
): void {
  void xml;
  const attrNames = new Set(attributes.map((a) => a.name));
  let checked = 0;
  let baseSkipped = 0;
  let bad = 0;
  for (const el of elements) {
    if (SKIP_DATAPATH_TAGS.has(el.tag)) {continue;}
    if (hasBaseForm && el.id) {
      const intId = parseInt(el.id, 10);
      if (Number.isFinite(intId) && intId < 1000000) {
        baseSkipped++;
        continue;
      }
    }
    const dataPath = el.dataPath?.trim();
    if (!dataPath) {continue;}
    if (/^\d+$/.test(dataPath) || /^\d+\/\d+:[0-9a-fA-F-]+$/.test(dataPath)) {continue;}
    checked++;
    let clean = dataPath.replace(/\[\d+\]/g, '');
    if (clean.startsWith('~')) {clean = clean.slice(1);}
    const segments = clean.split('.');
    let rootAttr = segments[0];

    if (rootAttr === 'Items') {
      if (segments.length < 3 || segments[2] !== 'CurrentData') {
        reportWarn(`[${el.tag}] '${el.name}': DataPath='${dataPath}' — unknown Items.* shape, expected Items.<Table>.CurrentData.*`);
        continue;
      }
      const tableName = segments[1];
      const tableEl = elements.find((e) => e.tag === 'Table' && e.name === tableName);
      if (!tableEl) {
        reportError(`[${el.tag}] '${el.name}': DataPath='${dataPath}' — table element '${tableName}' not found`);
        bad++;
        continue;
      }
      const tablePath = tableEl.dataPath?.trim();
      if (!tablePath) {continue;}
      let tableClean = tablePath.replace(/\[\d+\]/g, '');
      if (tableClean.startsWith('~')) {tableClean = tableClean.slice(1);}
      rootAttr = tableClean.split('.')[0];
    }
    if (!attrNames.has(rootAttr)) {
      reportError(`[${el.tag}] '${el.name}': DataPath='${dataPath}' — attribute '${rootAttr}' not found`);
      bad++;
    }
  }
  if (bad === 0) {
    const parts: string[] = [];
    if (checked > 0) {parts.push(`${String(checked)} paths checked`);}
    if (baseSkipped > 0) {parts.push(`${String(baseSkipped)} base skipped`);}
    if (parts.length > 0) {
      reportOk(`DataPath references: ${parts.join(', ')}`);
    }
  }
}

function validateCommandRefs(elements: readonly FormElementInfo[], commands: readonly FormCommandInfo[], reportError: (msg: string) => void, reportOk: (msg: string) => void): void {
  const commandNames = new Set(commands.map((c) => c.name));
  let checked = 0;
  let bad = 0;
  for (const el of elements) {
    if (el.tag !== 'Button') {continue;}
    if (!el.commandName) {continue;}
    const m = /^Form\.Command\.(.+)$/.exec(el.commandName);
    if (!m) {continue;}
    checked++;
    if (!commandNames.has(m[1])) {
      reportError(`[Button] '${el.name}': CommandName='${el.commandName}' — command '${m[1]}' not found in Commands`);
      bad++;
    }
  }
  if (bad === 0 && checked > 0) {
    reportOk(`Command references: ${String(checked)} buttons checked`);
  }
}

function validateEventHandlers(xml: string, reportError: (msg: string) => void, reportOk: (msg: string) => void): void {
  let checked = 0;
  let bad = 0;
  for (const m of xml.matchAll(/<Event\b([^>]*)>([^<]*)<\/Event>/g)) {
    checked++;
    const handler = m[2].trim();
    if (!handler) {
      const name = attr(m[1], 'name') ?? '';
      reportError(`Event '${name}': empty handler name`);
      bad++;
    }
  }
  if (bad === 0 && checked > 0) {
    reportOk(`Event handlers: ${String(checked)} events checked`);
  }
}

function validateCommandActions(xml: string, commands: readonly FormCommandInfo[], reportError: (msg: string) => void, reportOk: (msg: string) => void): void {
  if (commands.length === 0) {return;}
  const cmdsBlock = extractBlock(xml, 'Commands') ?? '';
  let bad = 0;
  for (const cmd of commands) {
    const re = new RegExp(`<Command\\b[^>]*name="${escapeRegExp(cmd.name)}"[^>]*>([\\s\\S]*?)<\\/Command>`);
    const body = re.exec(cmdsBlock)?.[1] ?? '';
    const actionM = /<Action\b[^>]*>([^<]*)<\/Action>/.exec(body);
    if (!actionM?.[1].trim()) {
      reportError(`Command '${cmd.name}': missing or empty Action`);
      bad++;
    }
  }
  if (bad === 0) {
    reportOk(`Command actions: ${String(commands.length)} commands checked`);
  }
}

function validateTitle(xml: string, reportError: (msg: string) => void, reportOk: (msg: string) => void): void {
  // Найти Title верхнего уровня формы
  const formMatch = /<Form\b[^>]*>([\s\S]*)<\/Form>/.exec(xml);
  if (!formMatch) {return;}
  const inside = formMatch[1];
  const re = /<Title\b[^>]*>([\s\S]*?)<\/Title>|<Title\b[^/>]*\/>/;
  let titleBlock: string | null = null;
  // Найти Title который не вложен в ChildItems
  const titleRe = /<Title\b[^>]*>([\s\S]*?)<\/Title>/g;
  let m: RegExpExecArray | null;
  while ((m = titleRe.exec(inside)) !== null) {
    const before = inside.slice(0, m.index);
    const openCount = (before.match(/<ChildItems>/g) ?? []).length;
    const closeCount = (before.match(/<\/ChildItems>/g) ?? []).length;
    if (openCount === closeCount) {
      titleBlock = m[1];
      break;
    }
  }
  if (titleBlock === null) {
    // self-closing or absent
    if (re.test(inside)) {
      // Title self-closing — OK
    }
    return;
  }
  if (/<v8:item\b/.test(titleBlock)) {
    reportOk('Title: multilingual XML');
  } else if (titleBlock.trim()) {
    reportError(`Form Title is plain text ('${titleBlock.trim()}') — must be multilingual XML (<v8:item>). Use top-level 'title' key in form-compile DSL.`);
  }
}

function validateCallTypesAndExtension(
  xml: string,
  attributes: readonly FormAttributeInfo[],
  commands: readonly FormCommandInfo[],
  hasBaseForm: boolean,
  reportError: (msg: string) => void,
  reportWarn: (msg: string) => void,
  reportOk: (msg: string) => void,
): void {
  if (hasBaseForm) {
    const versionM = /<BaseForm\b[^>]*\bversion="([^"]+)"/.exec(xml);
    if (versionM) {
      reportOk(`BaseForm: version=${versionM[1]}`);
    } else {
      reportWarn('BaseForm: version attribute missing');
    }
  }

  let ctChecked = 0;
  let ctBad = 0;
  for (const m of xml.matchAll(/\bcallType="([^"]+)"/g)) {
    ctChecked++;
    if (!VALID_CALL_TYPES.has(m[1])) {
      reportError(`Invalid callType='${m[1]}'`);
      ctBad++;
    }
  }
  if (ctChecked > 0) {
    if (!hasBaseForm) {
      reportWarn('callType attributes found but no BaseForm — possible incorrect structure');
    } else if (ctBad === 0) {
      reportOk(`callType values: ${String(ctChecked)} checked`);
    }
  }

  if (!hasBaseForm) {return;}

  // Extension ID ranges
  const baseFormBlockM = /<BaseForm\b[^>]*>([\s\S]*?)<\/BaseForm>/.exec(xml);
  const baseAttrNames = new Set<string>();
  const baseCmdNames = new Set<string>();
  if (baseFormBlockM) {
    const baseAttrs = extractBlock(baseFormBlockM[1], 'Attributes') ?? '';
    for (const am of baseAttrs.matchAll(/<Attribute\b([^>]*)>/g)) {
      const n = attr(am[1], 'name');
      if (n) {baseAttrNames.add(n);}
    }
    const baseCmds = extractBlock(baseFormBlockM[1], 'Commands') ?? '';
    for (const cm of baseCmds.matchAll(/<Command\b([^>]*)>/g)) {
      const n = attr(cm[1], 'name');
      if (n) {baseCmdNames.add(n);}
    }
  }
  let idWarn = 0;
  let extAttr = 0;
  let extCmd = 0;
  for (const a of attributes) {
    if (!a.name || baseAttrNames.has(a.name)) {continue;}
    extAttr++;
    const intId = parseInt(a.id, 10);
    if (Number.isFinite(intId) && intId < 1000000) {
      reportWarn(`Attribute '${a.name}' (id=${a.id}): extension-added attribute has id < 1000000`);
      idWarn++;
    }
  }
  for (const c of commands) {
    if (!c.name || baseCmdNames.has(c.name)) {continue;}
    extCmd++;
    const intId = parseInt(c.id, 10);
    if (Number.isFinite(intId) && intId < 1000000) {
      reportWarn(`Command '${c.name}' (id=${c.id}): extension-added command has id < 1000000`);
      idWarn++;
    }
  }
  if (idWarn === 0 && (extAttr + extCmd) > 0) {
    reportOk(`Extension ID ranges: ${String(extAttr)} attr(s), ${String(extCmd)} cmd(s) — all >= 1000000`);
  }
}

function validateTypes(
  xml: string,
  isConfigContext: boolean,
  reportError: (msg: string) => void,
  reportWarn: (msg: string) => void,
  reportOk: (msg: string) => void,
): void {
  const values = [...xml.matchAll(/<v8:Type>([^<]+)<\/v8:Type>/g)].map((m) => m[1].trim()).filter(Boolean);
  let bad = 0;
  let warn = 0;
  for (const tv of values) {
    if (KNOWN_INVALID_TYPES.has(tv)) {
      reportError(`12. Type "${tv}": invalid runtime/UI type (not valid in XDTO schema)`);
      bad++;
      continue;
    }
    if (VALID_CLOSED_TYPES.has(tv)) {continue;}
    if (tv.startsWith('cfg:')) {
      const suffix = tv.slice(4);
      const prefix = suffix.split('.')[0];
      if (VALID_CFG_PREFIXES.has(prefix) || suffix === 'DynamicList') {
        if (isConfigContext && (prefix === 'ExternalDataProcessorObject' || prefix === 'ExternalReportObject')) {
          reportError(`12. Type "${tv}": External* type in configuration context (use DataProcessorObject/ReportObject instead)`);
          bad++;
        }
      } else {
        reportWarn(`12. Type "${tv}": unrecognized cfg prefix`);
        warn++;
      }
      continue;
    }
    if (tv.includes(':')) {continue;}
    reportWarn(`12. Type "${tv}": bare type without namespace prefix`);
    warn++;
  }
  if (bad === 0 && warn === 0) {
    reportOk(values.length > 0 ? `12. Types: ${String(values.length)} values, all valid` : '12. Types: no type values to check');
  }
}

function finalize(formPath: string, report: ValidationReport, lines: string[]): FormValidationResult {
  const errors = report.errors;
  const warnings = report.warnings;
  const checks = errors + warnings + report.okChecks;
  if (errors === 0 && warnings === 0 && lines.length <= 2) {
    lines.push(`=== Validation OK: ${path.basename(formPath)} (${String(checks)} checks) ===`);
  } else {
    lines.push('');
    lines.push(`=== Result: ${String(errors)} errors, ${String(warnings)} warnings (${String(checks)} checks) ===`);
  }
  return { formPath, errors, warnings, checks, lines };
}
