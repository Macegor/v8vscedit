/**
 * Аналог `.claude/skills/form-info/scripts/form-info.py`.
 * Структурно строит отчёт по форме: иерархия элементов, свойства,
 * AutoCommandBar, реквизиты, параметры, команды, события, BaseForm.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  attr,
  escapeRegExp,
  extractBlock,
  extractLocalizedContent,
  extractTag,
  resolveFormXmlPath,
} from './FormShared';
import type {
  FormAttributeInfo,
  FormCommandInfo,
  FormElementInfo,
  FormInfoOptions,
  FormInfoResult,
} from './types';

const SKIP_ELEMENT_TAGS = new Set([
  'ExtendedTooltip', 'ContextMenu', 'AutoCommandBar',
  'SearchStringAddition', 'ViewStatusAddition', 'SearchControlAddition',
  'ColumnGroup',
]);

const CONTAINER_TAGS = new Set(['UsualGroup', 'Pages', 'Table', 'CommandBar', 'ButtonGroup', 'Popup']);

const ALL_ELEMENT_TAGS = [
  'UsualGroup', 'ColumnGroup', 'InputField', 'CheckBoxField', 'RadioButtonField',
  'LabelDecoration', 'LabelField', 'PictureDecoration', 'PictureField',
  'CalendarField', 'Table', 'Button', 'Pages', 'Page', 'CommandBar', 'Popup',
  'ButtonGroup', 'ExtendedTooltip', 'ContextMenu', 'AutoCommandBar',
  'SearchStringAddition', 'ViewStatusAddition', 'SearchControlAddition',
];

export class FormInfoService {
  info(options: FormInfoOptions): FormInfoResult {
    const formPath = resolveFormXmlPath(options.formPath);
    const xml = fs.readFileSync(formPath, 'utf-8');
    const elements = collectElements(xml);
    const attributes = collectAttributes(xml);
    const commands = collectCommands(xml);
    const events = collectFormEvents(xml);
    const titleBlock = extractBlock(xml, 'Title');
    const title = (titleBlock ? extractLocalizedContent(titleBlock) ?? titleBlock.trim() : undefined)
      ?? extractTag(xml, 'Title')
      ?? path.basename(path.dirname(path.dirname(formPath)));
    const baseFormVersion = extractBaseFormVersion(xml);
    const baseForm = baseFormVersion ? `present (version ${baseFormVersion})` : (xml.includes('<BaseForm') ? 'present' : undefined);
    const allLines = buildInfoReport(xml, formPath, title, baseForm, attributes, commands, events, options.expand ?? '');
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 150;
    return { formPath, title, elements, attributes, commands, events, baseForm, lines: allLines.slice(offset, offset + limit) };
  }
}

// ─── Element & attribute collection ─────────────────────────────────────────

export function collectElements(xml: string): FormElementInfo[] {
  const result: FormElementInfo[] = [];
  const elementTags = ALL_ELEMENT_TAGS.join('|');
  const re = new RegExp(`<(${elementTags})\\b([^>]*?)(\\/?)>`, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    const tag = match[1];
    if (SKIP_ELEMENT_TAGS.has(tag)) {continue;}
    const attrs = match[2];
    const body = match[3] === '/' ? '' : sliceElementBody(xml, tag, match.index, re.lastIndex);
    result.push({
      tag,
      name: attr(attrs, 'name') ?? '',
      id: attr(attrs, 'id') ?? '',
      dataPath: extractTag(body, 'DataPath'),
      commandName: extractTag(body, 'CommandName'),
    });
  }
  return result;
}

function sliceElementBody(xml: string, tag: string, startAt: number, openEnd: number): string {
  const close = findMatchingClose(xml, tag, openEnd);
  return close < 0 ? '' : xml.slice(openEnd, close);
}

function findMatchingClose(xml: string, tag: string, from: number): number {
  const openRe = new RegExp(`<${tag}\\b[^/>]*>`, 'g');
  const closeStr = `</${tag}>`;
  let depth = 1;
  let pos = from;
  while (depth > 0 && pos < xml.length) {
    const nextClose = xml.indexOf(closeStr, pos);
    if (nextClose < 0) {return -1;}
    openRe.lastIndex = pos;
    let advanced = false;
    for (;;) {
      const o = openRe.exec(xml);
      if (!o || o.index >= nextClose) {break;}
      depth++;
      openRe.lastIndex = o.index + o[0].length;
      pos = openRe.lastIndex;
      advanced = true;
    }
    if (advanced && openRe.lastIndex < nextClose) {
      continue;
    }
    depth--;
    pos = nextClose + closeStr.length;
  }
  return pos - closeStr.length;
}

export function collectAttributes(xml: string): FormAttributeInfo[] {
  const attrsBlock = extractBlock(xml, 'Attributes') ?? '';
  const result: FormAttributeInfo[] = [];
  const re = /<Attribute\b([^>]*)>([\s\S]*?)<\/Attribute>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(attrsBlock)) !== null) {
    const body = match[2];
    result.push({
      name: attr(match[1], 'name') ?? '',
      id: attr(match[1], 'id') ?? '',
      types: [...body.matchAll(/<v8:Type>([^<]+)<\/v8:Type>/g)].map((item) => item[1]),
      main: /<MainAttribute>\s*true\s*<\/MainAttribute>/.test(body),
    });
  }
  return result;
}

export function collectCommands(xml: string): FormCommandInfo[] {
  const cmdsBlock = extractBlock(xml, 'Commands') ?? '';
  const result: FormCommandInfo[] = [];
  const re = /<Command\b([^>]*)>([\s\S]*?)<\/Command>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(cmdsBlock)) !== null) {
    const body = match[2];
    result.push({
      name: attr(match[1], 'name') ?? '',
      id: attr(match[1], 'id') ?? '',
      actions: [...body.matchAll(/<Action(?:\s[^>]*)?>([^<]+)<\/Action>/g)].map((item) => item[1]),
    });
  }
  return result;
}

function collectFormEvents(xml: string): string[] {
  const eventsBlock = extractFormLevelBlock(xml, 'Events');
  if (!eventsBlock) {return [];}
  const result: string[] = [];
  for (const match of eventsBlock.matchAll(/<Event\b([^>]*)>([^<]*)<\/Event>/g)) {
    const name = attr(match[1], 'name') ?? '';
    const ct = attr(match[1], 'callType');
    const handler = match[2].trim();
    if (!name) {continue;}
    result.push(`${name}${ct ? `[${ct}]` : ''} -> ${handler}`);
  }
  return result;
}

/** Достаёт блок верхнего уровня формы (т.е. <Events> прямо под <Form>, не внутри элементов). */
function extractFormLevelBlock(xml: string, tagName: string): string | null {
  const formMatch = /<Form\b[^>]*>([\s\S]*)<\/Form>/.exec(xml);
  if (!formMatch) {return null;}
  const inside = formMatch[1];
  // Простой подход: первый блок на «корневом» уровне ChildItems нам не нужен — Events на верхнем уровне
  // расположены перед/после AutoCommandBar; используем нежадный поиск, но проверяем что он не внутри ChildItems.
  // Достаточно: ищем блок, не предварённый <ChildItems> без закрытия до него.
  const re = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(inside)) !== null) {
    const before = inside.slice(0, match.index);
    const openCount = (before.match(/<ChildItems>/g) ?? []).length;
    const closeCount = (before.match(/<\/ChildItems>/g) ?? []).length;
    if (openCount === closeCount) {
      return match[1];
    }
  }
  return null;
}

function extractBaseFormVersion(xml: string): string | undefined {
  const m = /<BaseForm\b[^>]*\bversion="([^"]+)"/.exec(xml);
  return m?.[1];
}

// ─── Type rendering ─────────────────────────────────────────────────────────

function formatType(typeBlock: string | null): string {
  if (!typeBlock) {return '';}
  const typeSetMatch = /<v8:TypeSet\b[^>]*>([^<]+)<\/v8:TypeSet>/.exec(typeBlock);
  if (typeSetMatch) {
    return typeSetMatch[1].replace(/^cfg:/, '');
  }
  const raws = [...typeBlock.matchAll(/<v8:Type>([^<]+)<\/v8:Type>/g)].map((m) => m[1]);
  if (raws.length === 0) {return '';}
  return raws.map((raw) => renderSingleType(raw, typeBlock)).join(' | ');
}

function renderSingleType(raw: string, typeBlock: string): string {
  if (raw === 'xs:string') {
    const lengthM = /<v8:StringQualifiers>[\s\S]*?<v8:Length>(\d+)<\/v8:Length>/.exec(typeBlock);
    const length = lengthM ? Number(lengthM[1]) : 0;
    return length > 0 ? `string(${String(length)})` : 'string';
  }
  if (raw === 'xs:decimal') {
    const nqM = /<v8:NumberQualifiers>([\s\S]*?)<\/v8:NumberQualifiers>/.exec(typeBlock);
    if (nqM) {
      const digits = /<v8:Digits>(\d+)<\/v8:Digits>/.exec(nqM[1])?.[1] ?? '0';
      const frac = /<v8:FractionDigits>(\d+)<\/v8:FractionDigits>/.exec(nqM[1])?.[1] ?? '0';
      return `decimal(${digits},${frac})`;
    }
    return 'decimal';
  }
  if (raw === 'xs:boolean') {return 'boolean';}
  if (raw === 'xs:dateTime') {
    const dM = /<v8:DateQualifiers>[\s\S]*?<v8:DateFractions>([^<]+)<\/v8:DateFractions>/.exec(typeBlock);
    const frac = dM?.[1] ?? '';
    if (frac === 'Date') {return 'date';}
    if (frac === 'Time') {return 'time';}
    return 'dateTime';
  }
  if (raw === 'xs:binary') {return 'binary';}
  if (raw.startsWith('cfg:') || /^d\d+p\d+:/.test(raw)) {
    return raw.replace(/^(?:cfg|d\d+p\d+):/, '');
  }
  const v8Map: Record<string, string> = {
    'v8:ValueStorage': 'ValueStorage',
    'v8:ValueTable': 'ValueTable', 'v8:ValueTree': 'ValueTree',
    'v8:ValueListType': 'ValueList', 'v8:TypeDescription': 'TypeDescription',
    'v8:Universal': 'Universal', 'v8:Array': 'Array', 'v8:FixedArray': 'FixedArray',
    'v8:Structure': 'Structure', 'v8:FixedStructure': 'FixedStructure',
    'v8:UUID': 'UUID',
    'v8ui:FormattedString': 'FormattedString', 'v8ui:Picture': 'Picture',
    'v8ui:Color': 'Color', 'v8ui:Font': 'Font',
  };
  if (raw in v8Map) {return v8Map[raw];}
  if (raw.startsWith('dcsset:') || raw.startsWith('dcssch:') || raw.startsWith('dcscor:')) {
    return raw.replace(/^dcs(?:set|sch|cor):/, 'DCS.');
  }
  return raw;
}

// ─── Report builder ─────────────────────────────────────────────────────────

interface TreeState { hasCollapsed: boolean }

function buildInfoReport(
  xml: string,
  formPath: string,
  formTitle: string,
  baseForm: string | undefined,
  attributes: readonly FormAttributeInfo[],
  commands: readonly FormCommandInfo[],
  formEvents: readonly string[],
  expand: string,
): string[] {
  const lines: string[] = [];

  // Header
  const { formName, objectContext } = resolveFormContext(formPath);
  const isExtension = baseForm !== undefined;
  const extMarker = isExtension ? ' [EXTENSION]' : '';
  let header = `=== Form: ${formName}${extMarker}`;
  if (formTitle && !looksLikeAutoPath(formTitle)) {
    header += ` — "${formTitle}"`;
  }
  if (objectContext) {
    header += ` (${objectContext})`;
  }
  header += ' ===';
  lines.push(header);

  // Properties
  const props = collectFormProperties(xml);
  if (props.length > 0) {
    lines.push('');
    lines.push('Properties: ' + props.join(', '));
  }

  // Form events
  if (formEvents.length > 0) {
    lines.push('');
    lines.push('Events:');
    for (const evt of formEvents) {
      lines.push(`  ${evt}`);
    }
  }

  // Main AutoCommandBar
  const cbLoc = /<CommandBarLocation>([^<]+)<\/CommandBarLocation>/.exec(xml)?.[1] ?? 'Auto';
  const mainAcbBlock = extractRootAutoCommandBar(xml);
  const acbLines = mainAcbBlock ? formatMainAutoCommandBar(mainAcbBlock) : [];
  if (acbLines.length > 0 && (cbLoc === 'Auto' || cbLoc === 'Top')) {
    lines.push('');
    lines.push(...acbLines);
  }

  // Element tree
  const rootCi = extractRootChildItems(xml);
  const state: TreeState = { hasCollapsed: false };
  if (rootCi) {
    lines.push('');
    lines.push('Elements:');
    const treeLines: string[] = [];
    buildTree(rootCi, '  ', treeLines, expand, state);
    lines.push(...treeLines);
  }

  if (acbLines.length > 0 && cbLoc === 'Bottom') {
    lines.push('');
    lines.push(...acbLines);
  }

  // Attributes
  const attrLines = formatAttributes(xml, attributes);
  if (attrLines.length > 0) {
    lines.push('');
    lines.push('Attributes:');
    lines.push(...attrLines);
  }

  // Parameters
  const paramLines = formatParameters(xml);
  if (paramLines.length > 0) {
    lines.push('');
    lines.push('Parameters:');
    lines.push(...paramLines);
  }

  // Commands
  const cmdLines = formatCommands(xml, commands);
  if (cmdLines.length > 0) {
    lines.push('');
    lines.push('Commands:');
    lines.push(...cmdLines);
  }

  // BaseForm footer
  if (baseForm) {
    lines.push('');
    lines.push(`BaseForm: ${baseForm}`);
  }

  // Hint
  if (state.hasCollapsed) {
    lines.push('');
    lines.push('Hint: use expand=<name> to expand a collapsed section, expand=* for all');
  }

  return lines;
}

function looksLikeAutoPath(s: string): boolean {
  return /[/\\]/.test(s) || s.toLowerCase().endsWith('.xml');
}

function resolveFormContext(formPath: string): { formName: string; objectContext: string } {
  const parts = formPath.replace(/\\/g, '/').split('/');
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i] === 'Forms' && i + 1 < parts.length) {
      const formName = parts[i + 1];
      if (i >= 2) {
        return { formName, objectContext: `${parts[i - 2]}.${parts[i - 1]}` };
      }
      return { formName, objectContext: '' };
    }
  }
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i] === 'Ext' && i >= 2) {
      return { formName: parts[i - 1], objectContext: parts[i - 2] };
    }
  }
  return { formName: path.basename(formPath, '.xml'), objectContext: '' };
}

const REPORTABLE_PROPS = [
  'Width', 'Height', 'Group', 'WindowOpeningMode', 'EnterKeyBehavior',
  'AutoTitle', 'AutoURL', 'AutoFillCheck', 'Customizable', 'CommandBarLocation',
  'SaveDataInSettings', 'AutoSaveDataInSettings', 'AutoTime', 'UsePostingMode',
  'RepostOnWrite', 'UseForFoldersAndItems', 'ReportResult', 'DetailsData',
  'ReportFormType', 'VerticalScroll', 'ScalingMode',
] as const;

function collectFormProperties(xml: string): string[] {
  const result: string[] = [];
  for (const pn of REPORTABLE_PROPS) {
    const m = new RegExp(`<${pn}>([\\s\\S]*?)<\\/${pn}>`).exec(xml);
    if (m) {
      const val = (extractLocalizedContent(m[1]) ?? m[1]).trim();
      result.push(`${pn}=${val}`);
    }
  }
  return result;
}

function extractRootAutoCommandBar(xml: string): string | null {
  // Главный AutoCommandBar — на верхнем уровне Form, не вложен в <Table>
  const formMatch = /<Form\b[^>]*>([\s\S]*)<\/Form>/.exec(xml);
  if (!formMatch) {return null;}
  const inside = formMatch[1];
  const re = /<AutoCommandBar\b[^>]*>([\s\S]*?)<\/AutoCommandBar>|<AutoCommandBar\b[^/>]*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(inside)) !== null) {
    const before = inside.slice(0, m.index);
    const openCount = (before.match(/<ChildItems>/g) ?? []).length;
    const closeCount = (before.match(/<\/ChildItems>/g) ?? []).length;
    if (openCount !== closeCount) {continue;}
    const tableOpens = (before.match(/<Table\b/g) ?? []).length;
    const tableCloses = (before.match(/<\/Table>/g) ?? []).length;
    if (tableOpens !== tableCloses) {continue;}
    return m[0];
  }
  return null;
}

function extractRootChildItems(xml: string): string | null {
  const formMatch = /<Form\b[^>]*>([\s\S]*)<\/Form>/.exec(xml);
  if (!formMatch) {return null;}
  const inside = formMatch[1];
  // Найти <ChildItems> верхнего уровня формы (не внутри AutoCommandBar, Table, и т.п.)
  // Это первый <ChildItems> такой, что число открывающих non-self-closing тегов до него
  // совпадает с числом закрывающих — т.е. глубина вложения = 0.
  const re = /<ChildItems>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(inside)) !== null) {
    const before = inside.slice(0, m.index);
    if (atFormRootDepth(before)) {
      const start = m.index + '<ChildItems>'.length;
      const close = findContainerClose(inside, '<ChildItems>', '</ChildItems>', start);
      return close < 0 ? null : inside.slice(start, close);
    }
  }
  return null;
}

/** True если глубина XML-узлов в `before` равна 0 (т.е. позиция — на уровне Form). */
function atFormRootDepth(before: string): boolean {
  let depth = 0;
  const re = /<(\/?)([A-Za-z][\w.:-]*)\b([^>]*)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(before)) !== null) {
    const isClose = m[1] === '/';
    const attrs = m[3];
    const selfClosing = !isClose && attrs.endsWith('/');
    if (isClose) {depth--;}
    else if (!selfClosing) {depth++;}
  }
  return depth === 0;
}

function findContainerClose(haystack: string, openTag: string, closeTag: string, fromPos: number): number {
  let depth = 1;
  let pos = fromPos;
  while (depth > 0 && pos < haystack.length) {
    const nextOpen = haystack.indexOf(openTag, pos);
    const nextClose = haystack.indexOf(closeTag, pos);
    if (nextClose < 0) {return -1;}
    if (nextOpen >= 0 && nextOpen < nextClose) {
      depth++;
      pos = nextOpen + openTag.length;
    } else {
      depth--;
      if (depth === 0) {return nextClose;}
      pos = nextClose + closeTag.length;
    }
  }
  return -1;
}

function formatMainAutoCommandBar(acbBlock: string): string[] {
  const autofillM = /<Autofill>([^<]+)<\/Autofill>/.exec(acbBlock);
  const autofill = !(autofillM?.[1].trim() === 'false');
  const halignM = /<HorizontalAlign>([^<]+)<\/HorizontalAlign>/.exec(acbBlock);
  const flags: string[] = [autofill ? 'autofill' : 'no-autofill'];
  if (halignM) {
    flags.push(`align=${halignM[1].trim()}`);
  }
  const buttons: string[] = [];
  const ci = /<ChildItems>([\s\S]*?)<\/ChildItems>/.exec(acbBlock);
  if (ci) {
    const btnRe = /<(Button|CommandBar|Popup)\b([^>]*)>([\s\S]*?)<\/\1>/g;
    let m: RegExpExecArray | null;
    while ((m = btnRe.exec(ci[1])) !== null) {
      const name = attr(m[2], 'name') ?? '';
      const body = m[3];
      const cmdName = /<CommandName>([^<]+)<\/CommandName>/.exec(body)?.[1] ?? '';
      const locM = /<LocationInCommandBar>([^<]+)<\/LocationInCommandBar>/.exec(body);
      const locStr = locM ? ` [${locM[1]}]` : '';
      const tag = elementTagAbbrev(m[1]);
      if (cmdName) {
        buttons.push(`  ${tag} ${name} -> ${cmdName}${locStr}`);
      } else {
        buttons.push(`  ${tag} ${name}${locStr}`);
      }
    }
  }
  if (buttons.length === 0 && autofill && !halignM) {
    return ['AutoCommandBar [autofill]'];
  }
  return [`AutoCommandBar [${flags.join(', ')}]`, ...buttons];
}

function elementTagAbbrev(tag: string): string {
  const map: Record<string, string> = {
    UsualGroup: '[Group]', InputField: '[Input]', CheckBoxField: '[Check]',
    LabelDecoration: '[Label]', LabelField: '[LabelField]',
    PictureDecoration: '[Picture]', PictureField: '[PicField]',
    CalendarField: '[Calendar]', Table: '[Table]', Button: '[Button]',
    CommandBar: '[CmdBar]', Pages: '[Pages]', Page: '[Page]', Popup: '[Popup]',
    ButtonGroup: '[BtnGroup]', RadioButtonField: '[Radio]',
  };
  return map[tag] ?? `[${tag}]`;
}

interface TreeNode {
  tag: string;
  name: string;
  body: string;
  fullMatch: string;
  startIndex: number;
  endIndex: number;
}

function parseSignificantChildren(containerInner: string): TreeNode[] {
  const result: TreeNode[] = [];
  // Найти прямых детей container, не вложенных глубже
  let pos = 0;
  while (pos < containerInner.length) {
    const m = /<([A-Za-z]+)\b([^>]*?)(\/?)>/.exec(containerInner.slice(pos));
    if (!m) {break;}
    const tag = m[1];
    const startAbs = pos + m.index;
    const openEnd = startAbs + m[0].length;
    if (m[3] === '/') {
      if (!SKIP_ELEMENT_TAGS.has(tag)) {
        result.push({ tag, name: attr(m[2], 'name') ?? '', body: '', fullMatch: m[0], startIndex: startAbs, endIndex: openEnd });
      }
      pos = openEnd;
      continue;
    }
    const closeAt = findMatchingClose(containerInner, tag, openEnd);
    if (closeAt < 0) {break;}
    if (!SKIP_ELEMENT_TAGS.has(tag)) {
      result.push({
        tag, name: attr(m[2], 'name') ?? '',
        body: containerInner.slice(openEnd, closeAt),
        fullMatch: containerInner.slice(startAbs, closeAt + `</${tag}>`.length),
        startIndex: startAbs,
        endIndex: closeAt + `</${tag}>`.length,
      });
    }
    pos = closeAt + `</${tag}>`.length;
  }
  return result;
}

function buildTree(containerInner: string, prefix: string, lines: string[], expand: string, state: TreeState): void {
  const children = parseSignificantChildren(containerInner);
  children.forEach((child, i) => {
    const last = i === children.length - 1;
    const connector = last ? '└─' : '├─';
    const continuation = last ? '  ' : '│ ';
    const tagAbbrev = getElementTagDetailed(child);
    const flags = getElementFlags(child.body);
    const events = getEventsCompact(child.body);
    const binding = getBindingString(child.body);
    const diffTitle = titleDiffers(child.body, child.name);
    const titleStr = diffTitle ? ` [title:${diffTitle}]` : '';
    let line = `${prefix}${connector} ${tagAbbrev} ${child.name}${binding}${flags}${titleStr}${events}`;

    if (child.tag === 'Page') {
      const ciInner = extractChildItemsBody(child.body);
      const pageTitle = titleDiffers(child.body, child.name);
      const shouldExpand = expand === '*' || expand === child.name || (pageTitle && expand === pageTitle);
      if (shouldExpand && ciInner !== null) {
        lines.push(line);
        buildTree(ciInner, prefix + continuation, lines, expand, state);
      } else {
        const cnt = ciInner ? parseSignificantChildren(ciInner).length : 0;
        line += ` (${String(cnt)} items)`;
        state.hasCollapsed = true;
        lines.push(line);
      }
    } else if (CONTAINER_TAGS.has(child.tag)) {
      lines.push(line);
      const ciInner = extractChildItemsBody(child.body);
      if (ciInner !== null) {
        buildTree(ciInner, prefix + continuation, lines, expand, state);
      }
    } else {
      lines.push(line);
    }
  });
}

function extractChildItemsBody(body: string): string | null {
  const openIdx = body.indexOf('<ChildItems>');
  if (openIdx < 0) {return null;}
  let depth = 1;
  let pos = openIdx + '<ChildItems>'.length;
  while (depth > 0 && pos < body.length) {
    const nextOpen = body.indexOf('<ChildItems>', pos);
    const nextClose = body.indexOf('</ChildItems>', pos);
    if (nextClose < 0) {return null;}
    if (nextOpen >= 0 && nextOpen < nextClose) {
      depth++;
      pos = nextOpen + '<ChildItems>'.length;
    } else {
      depth--;
      if (depth === 0) {
        return body.slice(openIdx + '<ChildItems>'.length, nextClose);
      }
      pos = nextClose + '</ChildItems>'.length;
    }
  }
  return null;
}

function getElementTagDetailed(node: TreeNode): string {
  if (node.tag === 'UsualGroup') {
    const groupM = /<Group>([^<]+)<\/Group>/.exec(node.body);
    let orient = '';
    if (groupM) {
      const map: Record<string, string> = { Vertical: ':V', Horizontal: ':H', AlwaysHorizontal: ':AH', AlwaysVertical: ':AV' };
      orient = map[groupM[1].trim()] ?? '';
    }
    const collapse = node.body.includes('<Behavior>Collapsible</Behavior>') ? ',collapse' : '';
    return `[Group${orient}${collapse}]`;
  }
  return elementTagAbbrev(node.tag);
}

function getElementFlags(body: string): string {
  const flags: string[] = [];
  if (/<Visible>\s*false\s*<\/Visible>/.test(body)) {flags.push('visible:false');}
  if (/<Enabled>\s*false\s*<\/Enabled>/.test(body)) {flags.push('enabled:false');}
  if (/<ReadOnly>\s*true\s*<\/ReadOnly>/.test(body)) {flags.push('ro');}
  return flags.length ? ` [${flags.join(',')}]` : '';
}

function getEventsCompact(body: string): string {
  const eventsM = /<Events>([\s\S]*?)<\/Events>/.exec(body);
  if (!eventsM) {return '';}
  const evts: string[] = [];
  for (const m of eventsM[1].matchAll(/<Event\b([^>]*)>/g)) {
    const name = attr(m[1], 'name') ?? '';
    const ct = attr(m[1], 'callType');
    if (!name) {continue;}
    evts.push(ct ? `${name}[${ct}]` : name);
  }
  return evts.length ? ` {${evts.join(', ')}}` : '';
}

function getBindingString(body: string): string {
  const dp = /<DataPath>([^<]+)<\/DataPath>/.exec(body);
  if (dp) {return ` -> ${dp[1]}`;}
  const cn = /<CommandName>([^<]+)<\/CommandName>/.exec(body);
  if (cn) {
    const v = cn[1];
    const std = /^Form\.StandardCommand\.(.+)$/.exec(v);
    if (std) {return ` -> ${std[1]} [std]`;}
    const fc = /^Form\.Command\.(.+)$/.exec(v);
    if (fc) {return ` -> ${fc[1]} [cmd]`;}
    return ` -> ${v}`;
  }
  return '';
}

function titleDiffers(body: string, name: string): string | null {
  const titleBlockM = /<Title\b[^>]*>([\s\S]*?)<\/Title>/.exec(body);
  if (!titleBlockM) {return null;}
  const titleText = extractLocalizedContent(titleBlockM[1]) ?? titleBlockM[1].trim();
  if (!titleText) {return null;}
  const normT = titleText.replace(/\s+/g, '').toLowerCase();
  const normN = name.toLowerCase();
  return normT === normN ? null : titleText;
}

function formatAttributes(xml: string, attributes: readonly FormAttributeInfo[]): string[] {
  if (attributes.length === 0) {return [];}
  const block = extractBlock(xml, 'Attributes') ?? '';
  const lines: string[] = [];
  for (const attrInfo of attributes) {
    const attrBlockM = new RegExp(`<Attribute\\b[^>]*name="${escapeRegExp(attrInfo.name)}"[^>]*>([\\s\\S]*?)<\\/Attribute>`).exec(block);
    const body = attrBlockM?.[1] ?? '';
    const typeBlockM = /<Type\b[^>]*>([\s\S]*?)<\/Type>/.exec(body);
    const typeStr = formatType(typeBlockM ? typeBlockM[0] : null);
    const prefixChar = attrInfo.main ? '*' : ' ';
    const mainSuffix = attrInfo.main ? ' (main)' : '';
    let dynTable = '';
    if (typeStr === 'DynamicList') {
      const mt = /<MainTable>([^<]+)<\/MainTable>/.exec(body)?.[1];
      if (mt) {dynTable = ` -> ${mt}`;}
    }
    let colStr = '';
    const columnsM = /<Columns>([\s\S]*?)<\/Columns>/.exec(body);
    if (columnsM && (typeStr === 'ValueTable' || typeStr === 'ValueTree')) {
      const cols: string[] = [];
      for (const c of columnsM[1].matchAll(/<Column\b([^>]*)>([\s\S]*?)<\/Column>/g)) {
        const cName = attr(c[1], 'name') ?? '';
        const cTypeBlock = /<Type\b[^>]*>([\s\S]*?)<\/Type>/.exec(c[2]);
        const cType = formatType(cTypeBlock ? cTypeBlock[0] : null);
        cols.push(cType ? `${cName}: ${cType}` : cName);
      }
      if (cols.length) {colStr = ` [${cols.join(', ')}]`;}
    }
    if (typeStr || colStr || dynTable) {
      lines.push(`  ${prefixChar}${attrInfo.name}: ${typeStr}${colStr}${dynTable}${mainSuffix}`);
    } else {
      lines.push(`  ${prefixChar}${attrInfo.name}${mainSuffix}`);
    }
  }
  return lines;
}

function formatParameters(xml: string): string[] {
  const block = extractBlock(xml, 'Parameters');
  if (!block) {return [];}
  const lines: string[] = [];
  for (const m of block.matchAll(/<Parameter\b([^>]*)>([\s\S]*?)<\/Parameter>/g)) {
    const name = attr(m[1], 'name') ?? '';
    const typeBlock = /<Type\b[^>]*>([\s\S]*?)<\/Type>/.exec(m[2]);
    const typeStr = formatType(typeBlock ? typeBlock[0] : null);
    const isKey = /<KeyParameter>\s*true\s*<\/KeyParameter>/.test(m[2]);
    const keySuffix = isKey ? ' (key)' : '';
    lines.push(typeStr ? `  ${name}: ${typeStr}${keySuffix}` : `  ${name}${keySuffix}`);
  }
  return lines;
}

function formatCommands(xml: string, commands: readonly FormCommandInfo[]): string[] {
  if (commands.length === 0) {return [];}
  const block = extractBlock(xml, 'Commands') ?? '';
  const lines: string[] = [];
  for (const cmd of commands) {
    const m = new RegExp(`<Command\\b[^>]*name="${escapeRegExp(cmd.name)}"[^>]*>([\\s\\S]*?)<\\/Command>`).exec(block);
    const body = m?.[1] ?? '';
    const shortcut = /<Shortcut>([^<]+)<\/Shortcut>/.exec(body)?.[1];
    const scStr = shortcut ? ` [${shortcut}]` : '';
    const actions = [...body.matchAll(/<Action\b([^>]*)>([^<]*)<\/Action>/g)];
    let actionStr = '';
    if (actions.length > 1) {
      const parts = actions.map((a) => {
        const ct = attr(a[1], 'callType');
        const ctStr = ct ? `[${ct}]` : '';
        return `${a[2].trim()}${ctStr}`;
      });
      actionStr = ' -> ' + parts.join(', ');
    } else if (actions.length === 1) {
      const ct = attr(actions[0][1], 'callType');
      const ctStr = ct ? `[${ct}]` : '';
      actionStr = ` -> ${actions[0][2].trim()}${ctStr}`;
    }
    lines.push(`  ${cmd.name}${actionStr}${scStr}`);
  }
  return lines;
}

// ─── Backward-compatible helpers used by FormValidateService ────────────────

export function collectEvents(xml: string): string[] {
  return [...xml.matchAll(/<Event\b([^>]*)>([^<]*)<\/Event>/g)]
    .map((match) => {
      const name = attr(match[1], 'name') ?? '';
      const callType = attr(match[1], 'callType');
      const ct = callType ? `[${callType}]` : '';
      return `${name}${ct} -> ${match[2].trim()}`;
    })
    .filter((line) => !line.startsWith(' ->'));
}
