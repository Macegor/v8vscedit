/**
 * XML-генераторы для DSL формы. Порт логики из
 * `.claude/skills/form-compile/scripts/form-compile.py` (функции `emit_*`).
 * Целиком детерминированные функции — состояния нет, ID берутся из IdAllocator.
 */
import {
  appendBoolean,
  appendScalar,
  buildLocalizedTag,
  createIdAllocator,
  escapeXml,
  FORM_XMLNS,
  type IdAllocator,
  validateName,
} from './FormShared';
import type {
  ElementEventPatch,
  FormAttributeDefinition,
  FormCommandDefinition,
  FormDefinition,
  FormElementDefinition,
  FormEventPatch,
} from './types';

// Силентная замена: модель часто пишет XML-имя или русское имя — приводим к DSL-ключу
const ELEMENT_TYPE_SYNONYMS: Record<string, string> = {
  commandBar: 'cmdBar',
  autoCommandBar: 'autoCmdBar',
  КоманднаяПанель: 'cmdBar',
  InputField: 'input',
  ПолеВвода: 'input',
  CheckBoxField: 'check',
  ПолеФлажка: 'check',
  RadioButtonField: 'radio',
  ПолеПереключателя: 'radio',
  radioButton: 'radio',
  PictureField: 'picField',
  ПолеКартинки: 'picField',
  LabelField: 'labelField',
  ПолеНадписи: 'labelField',
  CalendarField: 'calendar',
  ПолеКалендаря: 'calendar',
  LabelDecoration: 'label',
  Надпись: 'label',
  PictureDecoration: 'picture',
  Картинка: 'picture',
  UsualGroup: 'group',
  Группа: 'group',
  ОбычнаяГруппа: 'group',
  ColumnGroup: 'columnGroup',
  ГруппаКолонок: 'columnGroup',
  Pages: 'pages',
  ГруппаСтраниц: 'pages',
  Page: 'page',
  Страница: 'page',
  Table: 'table',
  Таблица: 'table',
  Button: 'button',
  Кнопка: 'button',
  Popup: 'popup',
  ВсплывающееМеню: 'popup',
};

const TYPE_KEYS = [
  'columnGroup', 'group', 'input', 'check', 'radio', 'label', 'labelField',
  'table', 'pages', 'page', 'button', 'picture', 'picField', 'calendar',
  'cmdBar', 'popup',
] as const;

const EVENT_SUFFIX_MAP: Record<string, string> = {
  OnChange: 'ПриИзменении',
  StartChoice: 'НачалоВыбора',
  ChoiceProcessing: 'ОбработкаВыбора',
  AutoComplete: 'АвтоПодбор',
  Clearing: 'Очистка',
  Opening: 'Открытие',
  Click: 'Нажатие',
  OnActivateRow: 'ПриАктивизацииСтроки',
  BeforeAddRow: 'ПередНачаломДобавления',
  BeforeDeleteRow: 'ПередУдалением',
  BeforeRowChange: 'ПередНачаломИзменения',
  OnStartEdit: 'ПриНачалеРедактирования',
  OnEndEdit: 'ПриОкончанииРедактирования',
  Selection: 'ВыборСтроки',
  OnCurrentPageChange: 'ПриСменеСтраницы',
  TextEditEnd: 'ОкончаниеВводаТекста',
  URLProcessing: 'ОбработкаНавигационнойСсылки',
  DragStart: 'НачалоПеретаскивания',
  Drag: 'Перетаскивание',
  DragCheck: 'ПроверкаПеретаскивания',
  Drop: 'Помещение',
  AfterDeleteRow: 'ПослеУдаления',
};

const KNOWN_EVENTS: Record<string, readonly string[]> = {
  input: ['OnChange', 'StartChoice', 'ChoiceProcessing', 'AutoComplete', 'TextEditEnd', 'Clearing', 'Creating', 'EditTextChange'],
  check: ['OnChange'],
  radio: ['OnChange'],
  label: ['Click', 'URLProcessing'],
  labelField: ['OnChange', 'StartChoice', 'ChoiceProcessing', 'Click', 'URLProcessing', 'Clearing'],
  table: ['Selection', 'BeforeAddRow', 'AfterDeleteRow', 'BeforeDeleteRow', 'OnActivateRow', 'OnEditEnd', 'OnStartEdit', 'BeforeRowChange', 'BeforeEditEnd', 'ValueChoice', 'OnActivateCell', 'OnActivateField', 'Drag', 'DragStart', 'DragCheck', 'DragEnd', 'OnGetDataAtServer', 'BeforeLoadUserSettingsAtServer', 'OnUpdateUserSettingSetAtServer', 'OnChange'],
  pages: ['OnCurrentPageChange'],
  page: ['OnCurrentPageChange'],
  button: ['Click'],
  picField: ['OnChange', 'StartChoice', 'ChoiceProcessing', 'Click', 'Clearing'],
  calendar: ['OnChange', 'OnActivate'],
  picture: ['Click'],
  cmdBar: [],
  popup: [],
  group: [],
};

export const KNOWN_FORM_EVENTS: readonly string[] = [
  'OnCreateAtServer', 'OnOpen', 'BeforeClose', 'OnClose', 'NotificationProcessing',
  'ChoiceProcessing', 'OnReadAtServer', 'AfterWriteAtServer', 'BeforeWriteAtServer',
  'AfterWrite', 'BeforeWrite', 'OnWriteAtServer', 'FillCheckProcessingAtServer',
  'OnLoadDataFromSettingsAtServer', 'BeforeLoadDataFromSettingsAtServer',
  'OnSaveDataInSettingsAtServer', 'ExternalEvent', 'OnReopen', 'Opening',
];

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

const V8_TYPES: Record<string, string> = {
  ValueTable: 'v8:ValueTable',
  ValueTree: 'v8:ValueTree',
  ValueList: 'v8:ValueListType',
  TypeDescription: 'v8:TypeDescription',
  Universal: 'v8:Universal',
  FixedArray: 'v8:FixedArray',
  FixedStructure: 'v8:FixedStructure',
  UUID: 'v8:UUID',
};

const UI_TYPES: Record<string, string> = {
  FormattedString: 'v8ui:FormattedString',
  Picture: 'v8ui:Picture',
  Color: 'v8ui:Color',
  Font: 'v8ui:Font',
};

const DCS_MAP: Record<string, string> = {
  DataCompositionSettings: 'dcsset:DataCompositionSettings',
  DataCompositionSchema: 'dcssch:DataCompositionSchema',
  DataCompositionComparisonType: 'dcscor:DataCompositionComparisonType',
};

const CFG_REF_PATTERN = /^(CatalogRef|CatalogObject|DocumentRef|DocumentObject|EnumRef|ChartOfAccountsRef|ChartOfAccountsObject|ChartOfCharacteristicTypesRef|ChartOfCharacteristicTypesObject|ChartOfCalculationTypesRef|ChartOfCalculationTypesObject|ExchangePlanRef|ExchangePlanObject|BusinessProcessRef|BusinessProcessObject|TaskRef|TaskObject|InformationRegisterRecordSet|InformationRegisterRecordManager|AccumulationRegisterRecordSet|AccountingRegisterRecordSet|ConstantsSet|DataProcessorObject|ReportObject)\./;

const KNOWN_INVALID_TYPES: Record<string, string> = {
  FormDataStructure: 'Runtime type. Use object type without cfg: prefix (e.g. CatalogObject.Контрагенты, DocumentObject.Приход)',
  FormDataCollection: 'Runtime type. Use ValueTable',
  FormDataTree: 'Runtime type. Use ValueTree',
  FormDataTreeItem: 'Runtime type, not valid in XML',
  FormDataCollectionItem: 'Runtime type, not valid in XML',
  FormGroup: 'UI element type, not a data type',
  FormField: 'UI element type, not a data type',
  FormButton: 'UI element type, not a data type',
  FormDecoration: 'UI element type, not a data type',
  FormTable: 'UI element type, not a data type',
};

const FORM_TYPE_SYNONYMS: Record<string, string> = {
  строка: 'string',
  число: 'decimal',
  булево: 'boolean',
  дата: 'date',
  датавремя: 'dateTime',
  number: 'decimal',
  bool: 'boolean',
  справочникссылка: 'CatalogRef',
  справочникобъект: 'CatalogObject',
  документссылка: 'DocumentRef',
  документобъект: 'DocumentObject',
  перечислениессылка: 'EnumRef',
  плансчетовссылка: 'ChartOfAccountsRef',
  планвидовхарактеристикссылка: 'ChartOfCharacteristicTypesRef',
  планвидоврасчётассылка: 'ChartOfCalculationTypesRef',
  планвидоврасчетассылка: 'ChartOfCalculationTypesRef',
  планобменассылка: 'ExchangePlanRef',
  бизнеспроцессссылка: 'BusinessProcessRef',
  задачассылка: 'TaskRef',
  определяемыйтип: 'DefinedType',
};

const REF_ROOT_SYNONYMS: Record<string, string> = {
  Перечисление: 'Enum',
  Справочник: 'Catalog',
  Документ: 'Document',
  ПланСчетов: 'ChartOfAccounts',
  ПланВидовХарактеристик: 'ChartOfCharacteristicTypes',
  ПланВидовРасчета: 'ChartOfCalculationTypes',
  ПланВидовРасчёта: 'ChartOfCalculationTypes',
  ПланОбмена: 'ExchangePlan',
  БизнесПроцесс: 'BusinessProcess',
  Задача: 'Task',
  РегистрСведений: 'InformationRegister',
  РегистрНакопления: 'AccumulationRegister',
  РегистрБухгалтерии: 'AccountingRegister',
  РегистрРасчета: 'CalculationRegister',
  РегистрРасчёта: 'CalculationRegister',
};
const ENUM_VALUE_SYNONYMS = new Set(['EnumValue', 'ЗначениеПеречисления']);

const WARN_SINK: { warnings: string[] | null } = { warnings: null };

function warn(message: string): void {
  if (WARN_SINK.warnings) {
    WARN_SINK.warnings.push(message);
  }
}

/** Соберёт массив предупреждений вместо вывода в stderr. */
export function withCollectedWarnings<T>(fn: () => T): { result: T; warnings: string[] } {
  const previous = WARN_SINK.warnings;
  const collected: string[] = [];
  WARN_SINK.warnings = collected;
  try {
    const result = fn();
    return { result, warnings: collected };
  } finally {
    WARN_SINK.warnings = previous;
  }
}

// ─── Сборка Form.xml ────────────────────────────────────────────────────────

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

interface NormalizedDefinition extends FormDefinition {
  readonly mainAutoCmdBar?: FormElementDefinition;
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

function hasCmdBarRecursive(el: unknown): boolean {
  if (!isPlainObject(el)) {
    return false;
  }
  if (el.cmdBar !== undefined) {
    return true;
  }
  if (Array.isArray(el.children) && el.children.some(hasCmdBarRecursive)) {
    return true;
  }
  if (Array.isArray(el.columns) && el.columns.some(hasCmdBarRecursive)) {
    return true;
  }
  return false;
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

function emitMainAutoCommandBar(lines: string[], defn: NormalizedDefinition, id: IdAllocator): void {
  const main = defn.mainAutoCmdBar;
  let acbName = 'ФормаКоманднаяПанель';
  let acbHorizontalAlign: string | undefined;
  let acbAutofill = true;

  if (main) {
    const autoCmdBarValue = (main as Record<string, unknown>).autoCmdBar;
    if (autoCmdBarValue) {
      acbName = xmlStr(autoCmdBarValue);
    }
    const mainName = (main as Record<string, unknown>).name;
    if (typeof mainName === 'string') {
      acbName = mainName;
    }
    const horizontalAlign = (main as Record<string, unknown>).horizontalAlign;
    if (typeof horizontalAlign === 'string') {
      acbHorizontalAlign = horizontalAlign;
    }
    if ('autofill' in main) {
      acbAutofill = Boolean((main as Record<string, unknown>).autofill);
    }
  } else if (Array.isArray(defn.elements) && defn.elements.some(hasCmdBarRecursive)) {
    acbAutofill = false;
  }

  const children = main && Array.isArray((main as Record<string, unknown>).children)
    ? (main as { children: unknown[] }).children
    : [];
  const hasInner = Boolean(acbHorizontalAlign) || !acbAutofill || children.length > 0;
  if (!hasInner) {
    lines.push(`\t<AutoCommandBar name="${escapeXml(acbName)}" id="-1"/>`);
    return;
  }
  lines.push(`\t<AutoCommandBar name="${escapeXml(acbName)}" id="-1">`);
  if (acbHorizontalAlign) {
    lines.push(`\t\t<HorizontalAlign>${escapeXml(acbHorizontalAlign)}</HorizontalAlign>`);
  }
  if (!acbAutofill) {
    lines.push('\t\t<Autofill>false</Autofill>');
  }
  if (children.length > 0) {
    lines.push('\t\t<ChildItems>');
    for (const child of children) {
      emitElement(lines, child as FormElementDefinition, '\t\t\t', id, { inCmdBar: true });
    }
    lines.push('\t\t</ChildItems>');
  }
  lines.push('\t</AutoCommandBar>');
}

// ─── Element dispatch ───────────────────────────────────────────────────────

interface EmitContext {
  readonly inCmdBar?: boolean;
}

export function emitElement(lines: string[], raw: FormElementDefinition, indent: string, id: IdAllocator, ctx: EmitContext = {}): void {
  if (!isPlainObject(raw)) {
    return;
  }
  // Перестраиваем объект, переименовывая ключи-синонимы: динамический delete
  // запрещён линтером, поэтому собираем новый объект из исходных пар.
  const rawObj = raw as Record<string, unknown>;
  const el: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rawObj)) {
    if (key in ELEMENT_TYPE_SYNONYMS) {
      const dst = ELEMENT_TYPE_SYNONYMS[key];
      if (!(dst in rawObj)) {
        el[dst] = value;
        continue;
      }
    }
    el[key] = value;
  }

  let typeKey: string | undefined;
  for (const key of TYPE_KEYS) {
    if (el[key] !== undefined && el[key] !== null) {
      typeKey = key;
      break;
    }
  }
  if (!typeKey) {
    warn('[WARN] Unknown element type, skipping');
    return;
  }

  const name = xmlStr(el.name ?? el[typeKey]);
  const eid = id.nextElement();
  switch (typeKey) {
    case 'group': emitGroup(lines, el, name, eid, indent, id); break;
    case 'columnGroup': emitColumnGroup(lines, el, name, eid, indent, id); break;
    case 'input': emitInput(lines, el, name, eid, indent, id); break;
    case 'check': emitCheck(lines, el, name, eid, indent, id); break;
    case 'radio': emitRadioButtonField(lines, el, name, eid, indent, id); break;
    case 'label': emitLabel(lines, el, name, eid, indent, id); break;
    case 'labelField': emitLabelField(lines, el, name, eid, indent, id); break;
    case 'table': emitTable(lines, el, name, eid, indent, id); break;
    case 'pages': emitPages(lines, el, name, eid, indent, id); break;
    case 'page': emitPage(lines, el, name, eid, indent, id); break;
    case 'button': emitButton(lines, el, name, eid, indent, id, ctx.inCmdBar === true); break;
    case 'picture': emitPictureDecoration(lines, el, name, eid, indent, id); break;
    case 'picField': emitPictureField(lines, el, name, eid, indent, id); break;
    case 'calendar': emitCalendar(lines, el, name, eid, indent, id); break;
    case 'cmdBar': emitCommandBar(lines, el, name, eid, indent, id); break;
    case 'popup': emitPopup(lines, el, name, eid, indent, id); break;
  }
}

// ─── Element emitters ───────────────────────────────────────────────────────

function emitGroup(lines: string[], el: Record<string, unknown>, name: string, eid: number, indent: string, id: IdAllocator): void {
  lines.push(`${indent}<UsualGroup name="${escapeXml(name)}" id="${String(eid)}">`);
  const inner = `${indent}\t`;
  emitTitle(lines, el, name, inner);
  const groupVal = xmlStr(el.group ?? '');
  const orientationMap: Record<string, string> = { horizontal: 'Horizontal', vertical: 'Vertical', alwaysHorizontal: 'AlwaysHorizontal', alwaysVertical: 'AlwaysVertical' };
  const orientation = orientationMap[groupVal];
  if (orientation) {
    lines.push(`${inner}<Group>${orientation}</Group>`);
  }
  if (groupVal === 'collapsible') {
    lines.push(`${inner}<Group>Vertical</Group>`);
    lines.push(`${inner}<Behavior>Collapsible</Behavior>`);
    if (el.collapsed === true) {
      lines.push(`${inner}<Collapsed>true</Collapsed>`);
    }
  }
  if (el.representation) {
    const reprMap: Record<string, string> = { none: 'None', normal: 'NormalSeparation', weak: 'WeakSeparation', strong: 'StrongSeparation' };
    const reprVal = reprMap[xmlStr(el.representation)] ?? xmlStr(el.representation);
    lines.push(`${inner}<Representation>${escapeXml(reprVal)}</Representation>`);
  }
  if (el.showTitle === false) {
    lines.push(`${inner}<ShowTitle>false</ShowTitle>`);
  }
  if (el.united === false) {
    lines.push(`${inner}<United>false</United>`);
  }
  emitCommonFlags(lines, el, inner);
  emitCompanion(lines, 'ExtendedTooltip', `${name}РасширеннаяПодсказка`, inner, id);
  if (Array.isArray(el.children) && el.children.length > 0) {
    lines.push(`${inner}<ChildItems>`);
    for (const child of el.children) {
      emitElement(lines, child as FormElementDefinition, `${inner}\t`, id);
    }
    lines.push(`${inner}</ChildItems>`);
  }
  lines.push(`${indent}</UsualGroup>`);
}

function emitColumnGroup(lines: string[], el: Record<string, unknown>, name: string, eid: number, indent: string, id: IdAllocator): void {
  lines.push(`${indent}<ColumnGroup name="${escapeXml(name)}" id="${String(eid)}">`);
  const inner = `${indent}\t`;
  emitTitle(lines, el, name, inner);
  const groupVal = xmlStr(el.columnGroup ?? '');
  const orientationMap: Record<string, string> = { horizontal: 'Horizontal', vertical: 'Vertical', inCell: 'InCell' };
  const orientation = orientationMap[groupVal];
  if (orientation) {
    lines.push(`${inner}<Group>${orientation}</Group>`);
  }
  if (el.showTitle === false) {
    lines.push(`${inner}<ShowTitle>false</ShowTitle>`);
  }
  if (el.showInHeader !== undefined && el.showInHeader !== null) {
    lines.push(`${inner}<ShowInHeader>${el.showInHeader === true ? 'true' : 'false'}</ShowInHeader>`);
  }
  if (el.width) {
    lines.push(`${inner}<Width>${escapeXml(xmlStr(el.width))}</Width>`);
  }
  emitCommonFlags(lines, el, inner);
  emitCompanion(lines, 'ExtendedTooltip', `${name}РасширеннаяПодсказка`, inner, id);
  if (Array.isArray(el.children) && el.children.length > 0) {
    lines.push(`${inner}<ChildItems>`);
    for (const child of el.children) {
      emitElement(lines, child as FormElementDefinition, `${inner}\t`, id);
    }
    lines.push(`${inner}</ChildItems>`);
  }
  lines.push(`${indent}</ColumnGroup>`);
}

function emitInput(lines: string[], el: Record<string, unknown>, name: string, eid: number, indent: string, id: IdAllocator): void {
  lines.push(`${indent}<InputField name="${escapeXml(name)}" id="${String(eid)}">`);
  const inner = `${indent}\t`;
  if (el.path) {
    lines.push(`${inner}<DataPath>${escapeXml(xmlStr(el.path))}</DataPath>`);
  }
  emitTitle(lines, el, name, inner, !el.path);
  emitCommonFlags(lines, el, inner);
  if (el.titleLocation) {
    const locMap: Record<string, string> = { none: 'None', left: 'Left', right: 'Right', top: 'Top', bottom: 'Bottom' };
    lines.push(`${inner}<TitleLocation>${escapeXml(locMap[xmlStr(el.titleLocation)] ?? xmlStr(el.titleLocation))}</TitleLocation>`);
  }
  if (el.multiLine === true) {lines.push(`${inner}<MultiLine>true</MultiLine>`);}
  if (el.passwordMode === true) {lines.push(`${inner}<PasswordMode>true</PasswordMode>`);}
  if (el.choiceButton === false) {lines.push(`${inner}<ChoiceButton>false</ChoiceButton>`);}
  if (el.clearButton === true) {lines.push(`${inner}<ClearButton>true</ClearButton>`);}
  if (el.spinButton === true) {lines.push(`${inner}<SpinButton>true</SpinButton>`);}
  if (el.dropListButton === true) {lines.push(`${inner}<DropListButton>true</DropListButton>`);}
  if (el.markIncomplete === true) {lines.push(`${inner}<AutoMarkIncomplete>true</AutoMarkIncomplete>`);}
  if (el.textEdit === false) {lines.push(`${inner}<TextEdit>false</TextEdit>`);}
  if (el.skipOnInput === true) {lines.push(`${inner}<SkipOnInput>true</SkipOnInput>`);}
  if ('autoMaxWidth' in el) {
    if (el.autoMaxWidth === false) {lines.push(`${inner}<AutoMaxWidth>false</AutoMaxWidth>`);}
  } else if (el.multiLine === true) {
    lines.push(`${inner}<AutoMaxWidth>false</AutoMaxWidth>`);
  }
  if (el.maxWidth !== undefined && el.maxWidth !== null) {lines.push(`${inner}<MaxWidth>${escapeXml(xmlStr(el.maxWidth))}</MaxWidth>`);}
  if (el.autoMaxHeight === false) {lines.push(`${inner}<AutoMaxHeight>false</AutoMaxHeight>`);}
  if (el.maxHeight !== undefined && el.maxHeight !== null) {lines.push(`${inner}<MaxHeight>${escapeXml(xmlStr(el.maxHeight))}</MaxHeight>`);}
  if (el.width) {lines.push(`${inner}<Width>${escapeXml(xmlStr(el.width))}</Width>`);}
  if (el.height) {lines.push(`${inner}<Height>${escapeXml(xmlStr(el.height))}</Height>`);}
  if (el.horizontalStretch === true) {lines.push(`${inner}<HorizontalStretch>true</HorizontalStretch>`);}
  if (el.verticalStretch === true) {lines.push(`${inner}<VerticalStretch>true</VerticalStretch>`);}
  if (el.inputHint) {
    lines.push(...buildLocalizedTag(inner, 'InputHint', xmlStr(el.inputHint)).split('\n'));
  }
  emitCompanion(lines, 'ContextMenu', `${name}КонтекстноеМеню`, inner, id);
  emitCompanion(lines, 'ExtendedTooltip', `${name}РасширеннаяПодсказка`, inner, id);
  emitEvents(lines, el, name, inner, 'input');
  lines.push(`${indent}</InputField>`);
}

function emitCheck(lines: string[], el: Record<string, unknown>, name: string, eid: number, indent: string, id: IdAllocator): void {
  lines.push(`${indent}<CheckBoxField name="${escapeXml(name)}" id="${String(eid)}">`);
  const inner = `${indent}\t`;
  if (el.path) {
    lines.push(`${inner}<DataPath>${escapeXml(xmlStr(el.path))}</DataPath>`);
  }
  emitTitle(lines, el, name, inner, !el.path);
  emitCommonFlags(lines, el, inner);
  const tl = el.titleLocation ? xmlStr(el.titleLocation) : 'Right';
  lines.push(`${inner}<TitleLocation>${escapeXml(tl)}</TitleLocation>`);
  emitCompanion(lines, 'ContextMenu', `${name}КонтекстноеМеню`, inner, id);
  emitCompanion(lines, 'ExtendedTooltip', `${name}РасширеннаяПодсказка`, inner, id);
  emitEvents(lines, el, name, inner, 'check');
  lines.push(`${indent}</CheckBoxField>`);
}

function emitRadioButtonField(lines: string[], el: Record<string, unknown>, name: string, eid: number, indent: string, id: IdAllocator): void {
  lines.push(`${indent}<RadioButtonField name="${escapeXml(name)}" id="${String(eid)}">`);
  const inner = `${indent}\t`;
  if (el.path) {
    lines.push(`${inner}<DataPath>${escapeXml(xmlStr(el.path))}</DataPath>`);
  }
  emitTitle(lines, el, name, inner, !el.path);
  emitCommonFlags(lines, el, inner);
  let tl: string;
  if (el.titleLocation) {
    const locMap: Record<string, string> = { none: 'None', left: 'Left', right: 'Right', top: 'Top', bottom: 'Bottom' };
    tl = locMap[xmlStr(el.titleLocation)] ?? xmlStr(el.titleLocation);
  } else {
    tl = 'None';
  }
  lines.push(`${inner}<TitleLocation>${escapeXml(tl)}</TitleLocation>`);
  lines.push(`${inner}<RadioButtonType>${escapeXml(normalizeRadioButtonType(el.radioButtonType))}</RadioButtonType>`);
  if (el.columnsCount !== undefined && el.columnsCount !== null) {
    lines.push(`${inner}<ColumnsCount>${escapeXml(xmlStr(el.columnsCount))}</ColumnsCount>`);
  }
  const choiceList = Array.isArray(el.choiceList) ? el.choiceList : [];
  if (choiceList.length > 0) {
    lines.push(`${inner}<ChoiceList>`);
    const itemIndent = `${inner}\t`;
    for (const item of choiceList) {
      if (!isPlainObject(item)) {continue;}
      const valRaw = item.value ?? item['значение'];
      const hasPres = 'presentation' in item || 'представление' in item || 'title' in item;
      let presRaw: unknown = item.presentation ?? item['представление'] ?? item.title;
      const norm = normalizeChoiceValue(valRaw);
      if (!hasPres) {
        if (norm.xsiType === 'xr:DesignTimeRef') {
          const tail = norm.text.split('.').pop() ?? norm.text;
          presRaw = titleFromName(tail);
        } else {
          presRaw = norm.text;
        }
      }
      lines.push(`${itemIndent}<xr:Item>`);
      const valIndent = `${itemIndent}\t`;
      lines.push(`${valIndent}<xr:Presentation/>`);
      lines.push(`${valIndent}<xr:CheckState>0</xr:CheckState>`);
      lines.push(`${valIndent}<xr:Value xsi:type="FormChoiceListDesTimeValue">`);
      emitChoicePresentation(lines, presRaw, `${valIndent}\t`);
      lines.push(`${valIndent}\t<Value xsi:type="${norm.xsiType}">${escapeXml(norm.text)}</Value>`);
      lines.push(`${valIndent}</xr:Value>`);
      lines.push(`${itemIndent}</xr:Item>`);
    }
    lines.push(`${inner}</ChoiceList>`);
  }
  emitCompanion(lines, 'ContextMenu', `${name}КонтекстноеМеню`, inner, id);
  emitCompanion(lines, 'ExtendedTooltip', `${name}РасширеннаяПодсказка`, inner, id);
  emitEvents(lines, el, name, inner, 'radio');
  lines.push(`${indent}</RadioButtonField>`);
}

function emitLabel(lines: string[], el: Record<string, unknown>, name: string, eid: number, indent: string, id: IdAllocator): void {
  lines.push(`${indent}<LabelDecoration name="${escapeXml(name)}" id="${String(eid)}">`);
  const inner = `${indent}\t`;
  const labelTitle = xmlStr(el.title ?? titleFromName(name));
  if (labelTitle.length > 0) {
    const formatted = el.hyperlink === true ? 'true' : 'false';
    lines.push(`${inner}<Title formatted="${formatted}">`);
    lines.push(`${inner}\t<v8:item>`);
    lines.push(`${inner}\t\t<v8:lang>ru</v8:lang>`);
    lines.push(`${inner}\t\t<v8:content>${escapeXml(labelTitle)}</v8:content>`);
    lines.push(`${inner}\t</v8:item>`);
    lines.push(`${inner}</Title>`);
  }
  emitCommonFlags(lines, el, inner);
  if (el.hyperlink === true) {lines.push(`${inner}<Hyperlink>true</Hyperlink>`);}
  if (el.autoMaxWidth === false) {lines.push(`${inner}<AutoMaxWidth>false</AutoMaxWidth>`);}
  if (el.maxWidth !== undefined && el.maxWidth !== null) {lines.push(`${inner}<MaxWidth>${escapeXml(xmlStr(el.maxWidth))}</MaxWidth>`);}
  if (el.autoMaxHeight === false) {lines.push(`${inner}<AutoMaxHeight>false</AutoMaxHeight>`);}
  if (el.maxHeight !== undefined && el.maxHeight !== null) {lines.push(`${inner}<MaxHeight>${escapeXml(xmlStr(el.maxHeight))}</MaxHeight>`);}
  if (el.width) {lines.push(`${inner}<Width>${escapeXml(xmlStr(el.width))}</Width>`);}
  if (el.height) {lines.push(`${inner}<Height>${escapeXml(xmlStr(el.height))}</Height>`);}
  emitCompanion(lines, 'ContextMenu', `${name}КонтекстноеМеню`, inner, id);
  emitCompanion(lines, 'ExtendedTooltip', `${name}РасширеннаяПодсказка`, inner, id);
  emitEvents(lines, el, name, inner, 'label');
  lines.push(`${indent}</LabelDecoration>`);
}

function emitLabelField(lines: string[], el: Record<string, unknown>, name: string, eid: number, indent: string, id: IdAllocator): void {
  lines.push(`${indent}<LabelField name="${escapeXml(name)}" id="${String(eid)}">`);
  const inner = `${indent}\t`;
  if (el.path) {
    lines.push(`${inner}<DataPath>${escapeXml(xmlStr(el.path))}</DataPath>`);
  }
  emitTitle(lines, el, name, inner, !el.path);
  emitCommonFlags(lines, el, inner);
  if (el.hyperlink === true) {lines.push(`${inner}<Hyperlink>true</Hyperlink>`);}
  emitCompanion(lines, 'ContextMenu', `${name}КонтекстноеМеню`, inner, id);
  emitCompanion(lines, 'ExtendedTooltip', `${name}РасширеннаяПодсказка`, inner, id);
  emitEvents(lines, el, name, inner, 'labelField');
  lines.push(`${indent}</LabelField>`);
}

function emitTable(lines: string[], el: Record<string, unknown>, name: string, eid: number, indent: string, id: IdAllocator): void {
  lines.push(`${indent}<Table name="${escapeXml(name)}" id="${String(eid)}">`);
  const inner = `${indent}\t`;
  if (el.path) {
    lines.push(`${inner}<DataPath>${escapeXml(xmlStr(el.path))}</DataPath>`);
  }
  emitTitle(lines, el, name, inner, !el.path);
  emitCommonFlags(lines, el, inner);
  if (el.representation) {lines.push(`${inner}<Representation>${escapeXml(xmlStr(el.representation))}</Representation>`);}
  if (el.changeRowSet === true) {lines.push(`${inner}<ChangeRowSet>true</ChangeRowSet>`);}
  if (el.changeRowOrder === true) {lines.push(`${inner}<ChangeRowOrder>true</ChangeRowOrder>`);}
  if (el.height) {lines.push(`${inner}<HeightInTableRows>${escapeXml(xmlStr(el.height))}</HeightInTableRows>`);}
  if (el.header === false) {lines.push(`${inner}<Header>false</Header>`);}
  if (el.footer === true) {lines.push(`${inner}<Footer>true</Footer>`);}
  if (el.commandBarLocation) {lines.push(`${inner}<CommandBarLocation>${escapeXml(xmlStr(el.commandBarLocation))}</CommandBarLocation>`);}
  if (el.searchStringLocation) {lines.push(`${inner}<SearchStringLocation>${escapeXml(xmlStr(el.searchStringLocation))}</SearchStringLocation>`);}
  if (el.choiceMode === true) {lines.push(`${inner}<ChoiceMode>true</ChoiceMode>`);}
  if (el.initialTreeView) {lines.push(`${inner}<InitialTreeView>${escapeXml(xmlStr(el.initialTreeView))}</InitialTreeView>`);}
  if (el.enableStartDrag === true) {lines.push(`${inner}<EnableStartDrag>true</EnableStartDrag>`);}
  if (el.enableDrag === true) {lines.push(`${inner}<EnableDrag>true</EnableDrag>`);}
  if (el.rowPictureDataPath) {lines.push(`${inner}<RowPictureDataPath>${escapeXml(xmlStr(el.rowPictureDataPath))}</RowPictureDataPath>`);}

  emitCompanion(lines, 'ContextMenu', `${name}КонтекстноеМеню`, inner, id);
  if (el.tableAutofill !== undefined && el.tableAutofill !== null) {
    const acbId = id.nextElement();
    const acbName = `${name}КоманднаяПанель`;
    const afVal = el.tableAutofill === true ? 'true' : 'false';
    lines.push(`${inner}<AutoCommandBar name="${escapeXml(acbName)}" id="${String(acbId)}">`);
    lines.push(`${inner}\t<Autofill>${afVal}</Autofill>`);
    lines.push(`${inner}</AutoCommandBar>`);
  } else {
    emitCompanion(lines, 'AutoCommandBar', `${name}КоманднаяПанель`, inner, id);
  }
  emitCompanion(lines, 'SearchStringAddition', `${name}СтрокаПоиска`, inner, id);
  emitCompanion(lines, 'ViewStatusAddition', `${name}СостояниеПросмотра`, inner, id);
  emitCompanion(lines, 'SearchControlAddition', `${name}УправлениеПоиском`, inner, id);

  if (Array.isArray(el.columns) && el.columns.length > 0) {
    lines.push(`${inner}<ChildItems>`);
    for (const col of el.columns) {
      emitElement(lines, col as FormElementDefinition, `${inner}\t`, id);
    }
    lines.push(`${inner}</ChildItems>`);
  }
  emitEvents(lines, el, name, inner, 'table');
  lines.push(`${indent}</Table>`);
}

function emitPages(lines: string[], el: Record<string, unknown>, name: string, eid: number, indent: string, id: IdAllocator): void {
  lines.push(`${indent}<Pages name="${escapeXml(name)}" id="${String(eid)}">`);
  const inner = `${indent}\t`;
  if (el.pagesRepresentation) {
    lines.push(`${inner}<PagesRepresentation>${escapeXml(xmlStr(el.pagesRepresentation))}</PagesRepresentation>`);
  }
  emitCommonFlags(lines, el, inner);
  emitCompanion(lines, 'ExtendedTooltip', `${name}РасширеннаяПодсказка`, inner, id);
  emitEvents(lines, el, name, inner, 'pages');
  if (Array.isArray(el.children) && el.children.length > 0) {
    lines.push(`${inner}<ChildItems>`);
    for (const child of el.children) {
      emitElement(lines, child as FormElementDefinition, `${inner}\t`, id);
    }
    lines.push(`${inner}</ChildItems>`);
  }
  lines.push(`${indent}</Pages>`);
}

function emitPage(lines: string[], el: Record<string, unknown>, name: string, eid: number, indent: string, id: IdAllocator): void {
  lines.push(`${indent}<Page name="${escapeXml(name)}" id="${String(eid)}">`);
  const inner = `${indent}\t`;
  emitTitle(lines, el, name, inner, true);
  emitCommonFlags(lines, el, inner);
  if (el.group) {
    const orientationMap: Record<string, string> = { horizontal: 'Horizontal', vertical: 'Vertical', alwaysHorizontal: 'AlwaysHorizontal', alwaysVertical: 'AlwaysVertical' };
    const orientation = orientationMap[xmlStr(el.group)];
    if (orientation) {
      lines.push(`${inner}<Group>${orientation}</Group>`);
    }
  }
  emitCompanion(lines, 'ExtendedTooltip', `${name}РасширеннаяПодсказка`, inner, id);
  if (Array.isArray(el.children) && el.children.length > 0) {
    lines.push(`${inner}<ChildItems>`);
    for (const child of el.children) {
      emitElement(lines, child as FormElementDefinition, `${inner}\t`, id);
    }
    lines.push(`${inner}</ChildItems>`);
  }
  lines.push(`${indent}</Page>`);
}

function emitButton(lines: string[], el: Record<string, unknown>, name: string, eid: number, indent: string, id: IdAllocator, inCmdBar: boolean): void {
  lines.push(`${indent}<Button name="${escapeXml(name)}" id="${String(eid)}">`);
  const inner = `${indent}\t`;
  let btnType: string | undefined;
  if (el.type) {
    const raw = xmlStr(el.type);
    if (inCmdBar) {
      const cmdBarMap: Record<string, string> = {
        usual: 'CommandBarButton', UsualButton: 'CommandBarButton',
        commandBar: 'CommandBarButton', CommandBarButton: 'CommandBarButton',
        hyperlink: 'CommandBarHyperlink', Hyperlink: 'CommandBarHyperlink',
        CommandBarHyperlink: 'CommandBarHyperlink',
      };
      btnType = cmdBarMap[raw] ?? raw;
    } else {
      const normalMap: Record<string, string> = {
        usual: 'UsualButton', UsualButton: 'UsualButton',
        commandBar: 'UsualButton', CommandBarButton: 'UsualButton',
        hyperlink: 'Hyperlink', Hyperlink: 'Hyperlink',
        CommandBarHyperlink: 'Hyperlink',
      };
      btnType = normalMap[raw] ?? raw;
    }
  } else if (inCmdBar) {
    btnType = 'CommandBarButton';
  }
  if (btnType) {
    lines.push(`${inner}<Type>${escapeXml(btnType)}</Type>`);
  }

  if (el.command) {
    lines.push(`${inner}<CommandName>Form.Command.${escapeXml(xmlStr(el.command))}</CommandName>`);
  }
  if (el.stdCommand) {
    const sc = xmlStr(el.stdCommand);
    const m = /^(.+)\.(.+)$/.exec(sc);
    if (m) {
      lines.push(`${inner}<CommandName>Form.Item.${escapeXml(m[1])}.StandardCommand.${escapeXml(m[2])}</CommandName>`);
    } else {
      lines.push(`${inner}<CommandName>Form.StandardCommand.${escapeXml(sc)}</CommandName>`);
    }
  }
  emitTitle(lines, el, name, inner, !(el.command ?? el.stdCommand));
  emitCommonFlags(lines, el, inner);
  if (el.defaultButton === true) {lines.push(`${inner}<DefaultButton>true</DefaultButton>`);}
  if (el.picture) {
    lines.push(`${inner}<Picture>`);
    lines.push(`${inner}\t<xr:Ref>${escapeXml(xmlStr(el.picture))}</xr:Ref>`);
    lines.push(`${inner}\t<xr:LoadTransparent>true</xr:LoadTransparent>`);
    lines.push(`${inner}</Picture>`);
  }
  if (el.representation) {lines.push(`${inner}<Representation>${escapeXml(xmlStr(el.representation))}</Representation>`);}
  if (el.locationInCommandBar) {lines.push(`${inner}<LocationInCommandBar>${escapeXml(xmlStr(el.locationInCommandBar))}</LocationInCommandBar>`);}
  emitCompanion(lines, 'ExtendedTooltip', `${name}РасширеннаяПодсказка`, inner, id);
  emitEvents(lines, el, name, inner, 'button');
  lines.push(`${indent}</Button>`);
}

function emitPictureDecoration(lines: string[], el: Record<string, unknown>, name: string, eid: number, indent: string, id: IdAllocator): void {
  lines.push(`${indent}<PictureDecoration name="${escapeXml(name)}" id="${String(eid)}">`);
  const inner = `${indent}\t`;
  emitTitle(lines, el, name, inner);
  emitCommonFlags(lines, el, inner);
  if (el.picture || el.src) {
    const ref = xmlStr(el.src ?? el.picture);
    lines.push(`${inner}<Picture>`);
    lines.push(`${inner}\t<xr:Ref>${escapeXml(ref)}</xr:Ref>`);
    lines.push(`${inner}\t<xr:LoadTransparent>true</xr:LoadTransparent>`);
    lines.push(`${inner}</Picture>`);
  }
  if (el.hyperlink === true) {lines.push(`${inner}<Hyperlink>true</Hyperlink>`);}
  if (el.width) {lines.push(`${inner}<Width>${escapeXml(xmlStr(el.width))}</Width>`);}
  if (el.height) {lines.push(`${inner}<Height>${escapeXml(xmlStr(el.height))}</Height>`);}
  emitCompanion(lines, 'ContextMenu', `${name}КонтекстноеМеню`, inner, id);
  emitCompanion(lines, 'ExtendedTooltip', `${name}РасширеннаяПодсказка`, inner, id);
  emitEvents(lines, el, name, inner, 'picture');
  lines.push(`${indent}</PictureDecoration>`);
}

function emitPictureField(lines: string[], el: Record<string, unknown>, name: string, eid: number, indent: string, id: IdAllocator): void {
  lines.push(`${indent}<PictureField name="${escapeXml(name)}" id="${String(eid)}">`);
  const inner = `${indent}\t`;
  if (el.path) {
    lines.push(`${inner}<DataPath>${escapeXml(xmlStr(el.path))}</DataPath>`);
  }
  emitTitle(lines, el, name, inner);
  emitCommonFlags(lines, el, inner);
  if (el.width) {lines.push(`${inner}<Width>${escapeXml(xmlStr(el.width))}</Width>`);}
  if (el.height) {lines.push(`${inner}<Height>${escapeXml(xmlStr(el.height))}</Height>`);}
  emitCompanion(lines, 'ContextMenu', `${name}КонтекстноеМеню`, inner, id);
  emitCompanion(lines, 'ExtendedTooltip', `${name}РасширеннаяПодсказка`, inner, id);
  emitEvents(lines, el, name, inner, 'picField');
  lines.push(`${indent}</PictureField>`);
}

function emitCalendar(lines: string[], el: Record<string, unknown>, name: string, eid: number, indent: string, id: IdAllocator): void {
  lines.push(`${indent}<CalendarField name="${escapeXml(name)}" id="${String(eid)}">`);
  const inner = `${indent}\t`;
  if (el.path) {
    lines.push(`${inner}<DataPath>${escapeXml(xmlStr(el.path))}</DataPath>`);
  }
  emitTitle(lines, el, name, inner, !el.path);
  emitCommonFlags(lines, el, inner);
  emitCompanion(lines, 'ContextMenu', `${name}КонтекстноеМеню`, inner, id);
  emitCompanion(lines, 'ExtendedTooltip', `${name}РасширеннаяПодсказка`, inner, id);
  emitEvents(lines, el, name, inner, 'calendar');
  lines.push(`${indent}</CalendarField>`);
}

function emitCommandBar(lines: string[], el: Record<string, unknown>, name: string, eid: number, indent: string, id: IdAllocator): void {
  lines.push(`${indent}<CommandBar name="${escapeXml(name)}" id="${String(eid)}">`);
  const inner = `${indent}\t`;
  if (el.autofill === true) {lines.push(`${inner}<Autofill>true</Autofill>`);}
  emitCommonFlags(lines, el, inner);
  if (Array.isArray(el.children) && el.children.length > 0) {
    lines.push(`${inner}<ChildItems>`);
    for (const child of el.children) {
      emitElement(lines, child as FormElementDefinition, `${inner}\t`, id, { inCmdBar: true });
    }
    lines.push(`${inner}</ChildItems>`);
  }
  lines.push(`${indent}</CommandBar>`);
}

function emitPopup(lines: string[], el: Record<string, unknown>, name: string, eid: number, indent: string, id: IdAllocator): void {
  lines.push(`${indent}<Popup name="${escapeXml(name)}" id="${String(eid)}">`);
  const inner = `${indent}\t`;
  emitTitle(lines, el, name, inner, true);
  emitCommonFlags(lines, el, inner);
  if (el.picture) {
    lines.push(`${inner}<Picture>`);
    lines.push(`${inner}\t<xr:Ref>${escapeXml(xmlStr(el.picture))}</xr:Ref>`);
    lines.push(`${inner}\t<xr:LoadTransparent>true</xr:LoadTransparent>`);
    lines.push(`${inner}</Picture>`);
  }
  if (el.representation) {lines.push(`${inner}<Representation>${escapeXml(xmlStr(el.representation))}</Representation>`);}
  if (Array.isArray(el.children) && el.children.length > 0) {
    lines.push(`${inner}<ChildItems>`);
    for (const child of el.children) {
      emitElement(lines, child as FormElementDefinition, `${inner}\t`, id, { inCmdBar: true });
    }
    lines.push(`${inner}</ChildItems>`);
  }
  lines.push(`${indent}</Popup>`);
}

// ─── Common helpers ─────────────────────────────────────────────────────────

function emitCommonFlags(lines: string[], el: Record<string, unknown>, indent: string): void {
  if (el.visible === false || el.hidden === true) {
    lines.push(`${indent}<Visible>false</Visible>`);
  }
  if (el.userVisible === false) {
    lines.push(`${indent}<UserVisible>`);
    lines.push(`${indent}\t<xr:Common>false</xr:Common>`);
    lines.push(`${indent}</UserVisible>`);
  }
  if (el.enabled === false || el.disabled === true) {
    lines.push(`${indent}<Enabled>false</Enabled>`);
  }
  if (el.readOnly === true) {
    lines.push(`${indent}<ReadOnly>true</ReadOnly>`);
  }
}

function emitTitle(lines: string[], el: Record<string, unknown>, name: string, indent: string, auto = false): void {
  let title: unknown = el.title;
  if (!title && auto && name) {
    title = titleFromName(name);
  }
  if (title) {
    lines.push(...buildLocalizedTag(indent, 'Title', xmlStr(title)).split('\n'));
  }
}

function emitCompanion(lines: string[], tag: string, name: string, indent: string, id: IdAllocator): void {
  lines.push(`${indent}<${tag} name="${escapeXml(name)}" id="${String(id.nextElement())}"/>`);
}

function emitEvents(lines: string[], el: Record<string, unknown>, elementName: string, indent: string, typeKey: string): void {
  if (!Array.isArray(el.on) || el.on.length === 0) {
    return;
  }
  const onList = el.on as unknown[];
  if (typeKey in KNOWN_EVENTS) {
    const allowed = KNOWN_EVENTS[typeKey];
    if (allowed.length > 0) {
      for (const evt of onList) {
        const evtName = xmlStr(evt);
        if (!allowed.includes(evtName)) {
          warn(`[WARN] Unknown event '${evtName}' for ${typeKey} '${elementName}'. Known: ${allowed.join(', ')}`);
        }
      }
    }
  }
  lines.push(`${indent}<Events>`);
  const handlers = isPlainObject(el.handlers) ? el.handlers : null;
  for (const evt of onList) {
    const evtName = xmlStr(evt);
    const handlerVal = handlers ? handlers[evtName] : undefined;
    const handler = typeof handlerVal === 'string' && handlerVal
      ? handlerVal
      : getHandlerName(elementName, evtName);
    lines.push(`${indent}\t<Event name="${escapeXml(evtName)}">${escapeXml(handler)}</Event>`);
  }
  lines.push(`${indent}</Events>`);
}

function getHandlerName(elementName: string, eventName: string): string {
  const suffix = EVENT_SUFFIX_MAP[eventName];
  return suffix ? `${elementName}${suffix}` : `${elementName}${eventName}`;
}

function titleFromName(name: string): string {
  if (!name) {return '';}
  let s = name.replace(/([А-ЯA-Z])([А-ЯA-Z][а-яa-z])/g, '$1 $2');
  s = s.replace(/([а-яa-z0-9])([А-ЯA-Z])/g, '$1 $2');
  const parts = s.split(' ');
  if (parts.length === 0) {return s;}
  const out = [parts[0]];
  for (const p of parts.slice(1)) {
    out.push(p.length > 1 && p === p.toUpperCase() ? p : p.toLowerCase());
  }
  return out.join(' ');
}

function normalizeRadioButtonType(raw: unknown): string {
  if (!raw) {return 'Auto';}
  const rawStr = xmlStr(raw);
  const s = rawStr.trim().toLowerCase();
  if (s === 'auto' || s === 'авто') {return 'Auto';}
  if (['radiobutton', 'radiobuttons', 'переключатель', 'радио'].includes(s)) {return 'RadioButtons';}
  if (['tumbler', 'тумблер'].includes(s)) {return 'Tumbler';}
  return rawStr.trim();
}

interface ChoiceValueShape { xsiType: string; text: string }

function normalizeChoiceValue(value: unknown): ChoiceValueShape {
  if (typeof value === 'boolean') {
    return { xsiType: 'xs:boolean', text: value ? 'true' : 'false' };
  }
  if (typeof value === 'number') {
    return { xsiType: 'xs:decimal', text: String(value) };
  }
  const s = value === null || value === undefined ? '' : xmlStr(value);
  if (!s) {return { xsiType: 'xs:string', text: '' };}
  const parts = s.split('.');
  if (parts.length >= 2) {
    const root = parts[0];
    let canonRoot: string | null = null;
    if (root in REF_ROOT_SYNONYMS) {
      canonRoot = REF_ROOT_SYNONYMS[root];
    } else if (Object.values(REF_ROOT_SYNONYMS).includes(root)) {
      canonRoot = root;
    }
    if (canonRoot) {
      const typeName = parts[1];
      let normalized: string | null = null;
      if (canonRoot === 'Enum') {
        if (parts.length === 3) {
          normalized = `Enum.${typeName}.EnumValue.${parts[2]}`;
        } else if (parts.length >= 4) {
          const member = parts[2];
          const rest = ENUM_VALUE_SYNONYMS.has(member) ? parts.slice(3).join('.') : parts.slice(2).join('.');
          normalized = `Enum.${typeName}.EnumValue.${rest}`;
        }
      } else {
        if (parts.length >= 3) {
          normalized = `${canonRoot}.${parts.slice(1).join('.')}`;
        }
      }
      if (normalized) {
        return { xsiType: 'xr:DesignTimeRef', text: normalized };
      }
    }
  }
  return { xsiType: 'xs:string', text: s };
}

function emitChoicePresentation(lines: string[], pres: unknown, indent: string): void {
  if (pres === null || pres === undefined || pres === '') {
    lines.push(`${indent}<Presentation/>`);
    return;
  }
  let pairs: [string, string][];
  if (typeof pres === 'string') {
    pairs = [['ru', pres]];
  } else if (isPlainObject(pres)) {
    pairs = Object.entries(pres).map(([k, v]) => [k, xmlStr(v)]);
  } else {
    pairs = [['ru', xmlStr(pres)]];
  }
  lines.push(`${indent}<Presentation>`);
  for (const [lang, content] of pairs) {
    lines.push(`${indent}\t<v8:item>`);
    lines.push(`${indent}\t\t<v8:lang>${escapeXml(lang)}</v8:lang>`);
    lines.push(`${indent}\t\t<v8:content>${escapeXml(content)}</v8:content>`);
    lines.push(`${indent}\t</v8:item>`);
  }
  lines.push(`${indent}</Presentation>`);
}

// ─── Type emitters ──────────────────────────────────────────────────────────

function resolveTypeStr(typeStr: string): string {
  if (!typeStr) {return typeStr;}
  if (typeStr.startsWith('cfg:')) {
    typeStr = typeStr.slice(4);
  }
  const m1 = /^([^(]+)\((.+)\)$/.exec(typeStr);
  if (m1) {
    const base = m1[1].trim();
    const params = m1[2];
    const r = FORM_TYPE_SYNONYMS[base.toLowerCase()];
    return r ? `${r}(${params})` : typeStr;
  }
  if (typeStr.includes('.')) {
    const i = typeStr.indexOf('.');
    const prefix = typeStr.slice(0, i);
    const suffix = typeStr.slice(i);
    const r = FORM_TYPE_SYNONYMS[prefix.toLowerCase()];
    return r ? `${r}${suffix}` : typeStr;
  }
  const key = typeStr.toLowerCase();
  return key in FORM_TYPE_SYNONYMS ? FORM_TYPE_SYNONYMS[key] : typeStr;
}

function emitSingleType(lines: string[], rawType: string, indent: string): void {
  const typeStr = resolveTypeStr(rawType);
  if (typeStr === 'boolean') {
    lines.push(`${indent}<v8:Type>xs:boolean</v8:Type>`);
    return;
  }
  const mString = /^string(\((\d+)\))?$/.exec(typeStr);
  if (mString) {
    // Группа 2 формально типизирована как `string`, но фактически может быть
    // undefined при отсутствии скобок — берём явным присвоением для совместимости.
    const length: string = mString[2] || '0';
    lines.push(`${indent}<v8:Type>xs:string</v8:Type>`);
    lines.push(`${indent}<v8:StringQualifiers>`);
    lines.push(`${indent}\t<v8:Length>${length}</v8:Length>`);
    lines.push(`${indent}\t<v8:AllowedLength>Variable</v8:AllowedLength>`);
    lines.push(`${indent}</v8:StringQualifiers>`);
    return;
  }
  const mDecimal = /^decimal\((\d+),(\d+)(,nonneg)?\)$/.exec(typeStr);
  if (mDecimal) {
    const digits = mDecimal[1];
    const fraction = mDecimal[2];
    const sign = mDecimal[3] ? 'Nonnegative' : 'Any';
    lines.push(`${indent}<v8:Type>xs:decimal</v8:Type>`);
    lines.push(`${indent}<v8:NumberQualifiers>`);
    lines.push(`${indent}\t<v8:Digits>${digits}</v8:Digits>`);
    lines.push(`${indent}\t<v8:FractionDigits>${fraction}</v8:FractionDigits>`);
    lines.push(`${indent}\t<v8:AllowedSign>${sign}</v8:AllowedSign>`);
    lines.push(`${indent}</v8:NumberQualifiers>`);
    return;
  }
  const mDate = /^(date|dateTime|time)$/.exec(typeStr);
  if (mDate) {
    const fractionsMap: Record<string, string> = { date: 'Date', dateTime: 'DateTime', time: 'Time' };
    const fractions = fractionsMap[typeStr];
    lines.push(`${indent}<v8:Type>xs:dateTime</v8:Type>`);
    lines.push(`${indent}<v8:DateQualifiers>`);
    lines.push(`${indent}\t<v8:DateFractions>${fractions}</v8:DateFractions>`);
    lines.push(`${indent}</v8:DateQualifiers>`);
    return;
  }
  if (typeStr in V8_TYPES) {
    lines.push(`${indent}<v8:Type>${V8_TYPES[typeStr]}</v8:Type>`);
    return;
  }
  if (typeStr in UI_TYPES) {
    lines.push(`${indent}<v8:Type>${UI_TYPES[typeStr]}</v8:Type>`);
    return;
  }
  if (typeStr.startsWith('DataComposition') && typeStr in DCS_MAP) {
    lines.push(`${indent}<v8:Type>${DCS_MAP[typeStr]}</v8:Type>`);
    return;
  }
  if (typeStr === 'DynamicList') {
    lines.push(`${indent}<v8:Type>cfg:DynamicList</v8:Type>`);
    return;
  }
  if (CFG_REF_PATTERN.test(typeStr)) {
    lines.push(`${indent}<v8:Type>cfg:${typeStr}</v8:Type>`);
    return;
  }
  if (typeStr in KNOWN_INVALID_TYPES) {
    throw new Error(`Invalid form attribute type '${typeStr}': ${KNOWN_INVALID_TYPES[typeStr]}`);
  }
  if (typeStr.includes('.')) {
    lines.push(`${indent}<v8:Type>cfg:${typeStr}</v8:Type>`);
  } else {
    warn(`WARNING: Unrecognized bare type '${typeStr}' — will be emitted without namespace prefix`);
    lines.push(`${indent}<v8:Type>${escapeXml(typeStr)}</v8:Type>`);
  }
}

function emitType(lines: string[], typeStr: string, indent: string): void {
  if (!typeStr) {
    lines.push(`${indent}<Type/>`);
    return;
  }
  const parts = typeStr.split(/[|+]/).map((s) => s.trim()).filter(Boolean);
  lines.push(`${indent}<Type>`);
  for (const part of parts) {
    emitSingleType(lines, part, `${indent}\t`);
  }
  lines.push(`${indent}</Type>`);
}

// ─── Attributes / Parameters / Commands / Properties ────────────────────────

function emitAttributes(lines: string[], attrs: readonly FormAttributeDefinition[] | undefined, indent: string, id: IdAllocator): void {
  if (!attrs || attrs.length === 0) {return;}
  lines.push(`${indent}<Attributes>`);
  for (const attr of attrs) {
    validateName(attr.name, 'Имя реквизита формы');
    const attrId = id.nextAttribute();
    lines.push(`${indent}\t<Attribute name="${escapeXml(attr.name)}" id="${String(attrId)}">`);
    const inner = `${indent}\t\t`;
    let attrTitle = (attr as { title?: string }).title;
    if (!attrTitle && attr.main !== true) {
      attrTitle = titleFromName(attr.name);
    }
    if (attrTitle) {
      lines.push(...buildLocalizedTag(inner, 'Title', attrTitle).split('\n'));
    }
    if (attr.type) {
      emitType(lines, attr.type, inner);
    } else {
      lines.push(`${inner}<Type/>`);
    }
    if (attr.main === true) {
      lines.push(`${inner}<MainAttribute>true</MainAttribute>`);
    }
    let mainSaved = false;
    if (attr.main === true && attr.type) {
      const t = attr.type;
      mainSaved = /^(CatalogObject|DocumentObject|ChartOfAccountsObject|ChartOfCalculationTypesObject|ChartOfCharacteristicTypesObject|ExchangePlanObject|BusinessProcessObject|TaskObject)\./.test(t) || t.includes('RecordManager.');
    }
    if (attr.savedData === true || mainSaved) {
      lines.push(`${inner}<SavedData>true</SavedData>`);
    }
    const fillChecking = (attr as { fillChecking?: string }).fillChecking;
    if (fillChecking) {
      lines.push(`${inner}<FillChecking>${escapeXml(fillChecking)}</FillChecking>`);
    }
    if (attr.columns && attr.columns.length > 0) {
      lines.push(`${inner}<Columns>`);
      for (const col of attr.columns) {
        const colId = id.nextAttribute();
        lines.push(`${inner}\t<Column name="${escapeXml(col.name)}" id="${String(colId)}">`);
        const colTitle = (col as { title?: string }).title;
        if (colTitle) {
          lines.push(...buildLocalizedTag(`${inner}\t\t`, 'Title', colTitle).split('\n'));
        }
        emitType(lines, col.type ?? '', `${inner}\t\t`);
        lines.push(`${inner}\t</Column>`);
      }
      lines.push(`${inner}</Columns>`);
    }
    if (attr.settings) {
      const s = attr.settings;
      lines.push(`${inner}<Settings xsi:type="DynamicList">`);
      const si = `${inner}\t`;
      if (s.mainTable) {
        lines.push(`${si}<MainTable>${escapeXml(xmlStr(s.mainTable))}</MainTable>`);
      }
      const mq = s.manualQuery ? 'true' : 'false';
      lines.push(`${si}<ManualQuery>${mq}</ManualQuery>`);
      const ddr = s.dynamicDataRead ? 'true' : 'false';
      lines.push(`${si}<DynamicDataRead>${ddr}</DynamicDataRead>`);
      lines.push(`${inner}</Settings>`);
    }
    lines.push(`${indent}\t</Attribute>`);
  }
  lines.push(`${indent}</Attributes>`);
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

function emitCommands(lines: string[], cmds: readonly FormCommandDefinition[] | undefined, indent: string, id: IdAllocator): void {
  if (!cmds || cmds.length === 0) {return;}
  lines.push(`${indent}<Commands>`);
  for (const cmd of cmds) {
    validateName(cmd.name, 'Имя команды формы');
    const cmdId = id.nextCommand();
    lines.push(`${indent}\t<Command name="${escapeXml(cmd.name)}" id="${String(cmdId)}">`);
    const inner = `${indent}\t\t`;
    const cmdTitle = cmd.title ?? titleFromName(cmd.name);
    if (cmdTitle) {
      lines.push(...buildLocalizedTag(inner, 'Title', cmdTitle).split('\n'));
    }
    if (cmd.action) {
      lines.push(`${inner}<Action>${escapeXml(cmd.action)}</Action>`);
    }
    if (cmd.shortcut) {
      lines.push(`${inner}<Shortcut>${escapeXml(cmd.shortcut)}</Shortcut>`);
    }
    if (cmd.picture) {
      lines.push(`${inner}<Picture>`);
      lines.push(`${inner}\t<xr:Ref>${escapeXml(cmd.picture)}</xr:Ref>`);
      lines.push(`${inner}\t<xr:LoadTransparent>true</xr:LoadTransparent>`);
      lines.push(`${inner}</Picture>`);
    }
    const representation = (cmd as { representation?: string }).representation;
    if (representation) {
      lines.push(`${inner}<Representation>${escapeXml(representation)}</Representation>`);
    }
    lines.push(`${indent}\t</Command>`);
  }
  lines.push(`${indent}</Commands>`);
}

function emitProperties(lines: string[], props: Record<string, unknown>, indent: string): void {
  if (Object.keys(props).length === 0) {return;}
  for (const [pName, pValue] of Object.entries(props)) {
    const xmlName = pName in PROP_MAP ? PROP_MAP[pName] : `${pName.charAt(0).toUpperCase()}${pName.slice(1)}`;
    const val = typeof pValue === 'boolean' ? (pValue ? 'true' : 'false') : xmlStr(pValue);
    lines.push(`${indent}<${xmlName}>${escapeXml(val)}</${xmlName}>`);
  }
}

// ─── Legacy edit helpers (используются FormEditService) ─────────────────────

export function buildAttributeXml(attr: FormAttributeDefinition, indent: string, id: number): string {
  const lines: string[] = [];
  validateName(attr.name, 'Имя реквизита формы');
  lines.push(`${indent}<Attribute name="${escapeXml(attr.name)}" id="${String(id)}">`);
  const inner = `${indent}\t`;
  const attrTitle = (attr as { title?: string }).title;
  if (attrTitle) {
    lines.push(...buildLocalizedTag(inner, 'Title', attrTitle).split('\n'));
  }
  if (attr.type) {
    emitType(lines, attr.type, inner);
  } else {
    lines.push(`${inner}<Type/>`);
  }
  if (attr.main === true) {lines.push(`${inner}<MainAttribute>true</MainAttribute>`);}
  if (attr.savedData === true) {lines.push(`${inner}<SavedData>true</SavedData>`);}
  if (attr.columns?.length) {
    lines.push(`${inner}<Columns>`);
    let columnId = 1;
    for (const col of attr.columns) {
      lines.push(`${inner}\t<Column name="${escapeXml(col.name)}" id="${String(columnId++)}">`);
      emitType(lines, col.type ?? '', `${inner}\t\t`);
      lines.push(`${inner}\t</Column>`);
    }
    lines.push(`${inner}</Columns>`);
  }
  if (attr.settings) {
    const s = attr.settings;
    lines.push(`${inner}<Settings xsi:type="DynamicList">`);
    if (s.mainTable) {
      lines.push(`${inner}\t<MainTable>${escapeXml(xmlStr(s.mainTable))}</MainTable>`);
    }
    if (s.dynamicDataRead === true) {
      lines.push(`${inner}\t<DynamicDataRead>true</DynamicDataRead>`);
    }
    lines.push(`${inner}</Settings>`);
  }
  lines.push(`${indent}</Attribute>`);
  return lines.join('\n');
}

export function buildCommandXml(cmd: FormCommandDefinition, indent: string, id: number): string {
  const lines: string[] = [];
  validateName(cmd.name, 'Имя команды формы');
  lines.push(`${indent}<Command name="${escapeXml(cmd.name)}" id="${String(id)}">`);
  const inner = `${indent}\t`;
  if (cmd.title) {
    lines.push(...buildLocalizedTag(inner, 'Title', cmd.title).split('\n'));
  }
  if (cmd.shortcut) {
    lines.push(`${inner}<Shortcut>${escapeXml(cmd.shortcut)}</Shortcut>`);
  }
  if (cmd.actions?.length) {
    for (const action of cmd.actions) {
      lines.push(`${inner}<Action${action.callType ? ` callType="${escapeXml(action.callType)}"` : ''}>${escapeXml(action.handler)}</Action>`);
    }
  } else {
    lines.push(`${inner}<Action${cmd.callType ? ` callType="${escapeXml(cmd.callType)}"` : ''}>${escapeXml(cmd.action ?? `${cmd.name}Обработка`)}</Action>`);
  }
  lines.push(`${indent}</Command>`);
  return lines.join('\n');
}

export function buildElementXml(raw: FormElementDefinition, indent: string, id: IdAllocator): string {
  const lines: string[] = [];
  emitElement(lines, raw, indent, id);
  return lines.join('\n');
}

// ─── Утилиты ────────────────────────────────────────────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Унифицированное приведение значения DSL-элемента (тип `unknown`) к строке
 * для XML. Нужно потому, что значения свойств элементов формы приходят из
 * пользовательского JSON и формально имеют тип `unknown`; прямой `String(v)`
 * на объекте даёт `"[object Object]"`. Здесь объекты/массивы сериализуются
 * через `JSON.stringify`, а примитивы конвертируются как есть.
 */
function xmlStr(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return JSON.stringify(value);
}

// keep backward exports
export type { FormEventPatch, ElementEventPatch };

// Avoid “unused import” complaints — these helpers exist for backward compat:
void appendBoolean;
void appendScalar;
