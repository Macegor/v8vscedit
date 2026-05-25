import * as fs from 'fs';
import * as path from 'path';
import { XMLValidator } from 'fast-xml-parser';
import { writeTextFilePreservingBomAndEol } from './XmlUtils';

const CI_NS = 'http://v8.1c.ru/8.3/xcf/extrnprops';
const XR_NS = 'http://v8.1c.ru/8.3/xcf/readable';
const XS_NS = 'http://www.w3.org/2001/XMLSchema';
const XSI_NS = 'http://www.w3.org/2001/XMLSchema-instance';
const SECTION_ORDER = ['CommandsVisibility', 'CommandsPlacement', 'CommandsOrder', 'SubsystemsOrder', 'GroupsOrder'] as const;

type CommandInterfaceSection = typeof SECTION_ORDER[number];

export type CommandInterfaceOperation =
  | { readonly operation: 'hide' | 'show'; readonly value: string | readonly string[] }
  | { readonly operation: 'place'; readonly value: { readonly command: string; readonly group: string } }
  | { readonly operation: 'order'; readonly value: { readonly group: string; readonly commands: readonly string[] } }
  | { readonly operation: 'subsystem-order'; readonly value: readonly string[] }
  | { readonly operation: 'group-order'; readonly value: readonly string[] };

export interface CommandInterfaceEditOptions {
  readonly ciPath: string;
  readonly operations: readonly CommandInterfaceOperation[];
  readonly createIfMissing?: boolean;
}

export interface CommandInterfaceEditResult {
  readonly ciPath: string;
  readonly added: number;
  readonly removed: number;
  readonly modified: number;
  readonly changedFiles: readonly string[];
  readonly lines: readonly string[];
}

export interface CommandInterfaceInfoOptions {
  readonly ciPath: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface CommandInterfaceInfoResult {
  readonly ciPath: string;
  readonly visibility: readonly { readonly command: string; readonly common: string }[];
  readonly placement: readonly { readonly command: string; readonly group: string; readonly placement: string }[];
  readonly order: readonly { readonly command: string; readonly group: string }[];
  readonly subsystemsOrder: readonly string[];
  readonly groupsOrder: readonly string[];
  readonly lines: readonly string[];
}

export interface CommandInterfaceValidationOptions {
  readonly ciPath: string;
  readonly detailed?: boolean;
  readonly maxErrors?: number;
}

export interface CommandInterfaceValidationIssue {
  readonly severity: 'error' | 'warning' | 'ok';
  readonly message: string;
}

export interface CommandInterfaceValidationResult {
  readonly ciPath: string;
  readonly errors: number;
  readonly warnings: number;
  readonly checks: number;
  readonly issues: readonly CommandInterfaceValidationIssue[];
  readonly lines: readonly string[];
}

interface ParsedCommandInterface {
  readonly visibility: { readonly command: string; readonly common: string }[];
  readonly placement: { readonly command: string; readonly group: string; readonly placement: string }[];
  readonly order: { readonly command: string; readonly group: string }[];
  readonly subsystemsOrder: string[];
  readonly groupsOrder: string[];
  readonly sections: readonly CommandInterfaceSection[];
}

export class CommandInterfaceService {
  info(options: CommandInterfaceInfoOptions): CommandInterfaceInfoResult {
    const ciPath = resolveCommandInterfacePath(options.ciPath);
    const xml = fs.readFileSync(ciPath, 'utf-8');
    const parsed = parseCommandInterface(xml);
    const lines = paginate(buildInfoLines(ciPath, parsed), options.limit, options.offset);
    return { ciPath, ...parsed, lines };
  }

  edit(options: CommandInterfaceEditOptions): CommandInterfaceEditResult {
    const ciPath = resolveCommandInterfacePath(options.ciPath, options.createIfMissing);
    if (!fs.existsSync(ciPath)) {
      if (!options.createIfMissing) {
        throw new Error(`CommandInterface.xml не найден: ${ciPath}`);
      }
      fs.mkdirSync(path.dirname(ciPath), { recursive: true });
      fs.writeFileSync(ciPath, buildEmptyCommandInterfaceXml(detectFormatVersion(path.dirname(ciPath))), 'utf-8');
    }

    const original = fs.readFileSync(ciPath, 'utf-8');
    let xml = original;
    let added = 0;
    let removed = 0;
    let modified = 0;
    const lines: string[] = [];

    for (const op of options.operations) {
      switch (op.operation) {
        case 'hide':
        case 'show': {
          const result = this.setVisibility(xml, toStringList(op.value), op.operation === 'show');
          xml = result.xml;
          added += result.added;
          modified += result.modified;
          lines.push(...result.lines);
          break;
        }
        case 'place': {
          const result = this.placeCommand(xml, op.value.command, op.value.group);
          xml = result.xml;
          added += result.added;
          modified += result.modified;
          lines.push(...result.lines);
          break;
        }
        case 'order': {
          const result = this.setCommandOrder(xml, op.value.group, op.value.commands);
          xml = result.xml;
          added += result.added;
          removed += result.removed;
          lines.push(...result.lines);
          break;
        }
        case 'subsystem-order': {
          const result = replaceListSection(xml, 'SubsystemsOrder', 'Subsystem', op.value);
          xml = result.xml;
          added += result.added;
          removed += result.removed;
          lines.push(`Порядок подсистем: ${String(op.value.length)} записей.`);
          break;
        }
        case 'group-order': {
          const result = replaceListSection(xml, 'GroupsOrder', 'Group', op.value);
          xml = result.xml;
          added += result.added;
          removed += result.removed;
          lines.push(`Порядок групп: ${String(op.value.length)} записей.`);
          break;
        }
      }
    }

    if (xml !== original) {
      writeTextFilePreservingBomAndEol(ciPath, original, xml);
    }
    return {
      ciPath,
      added,
      removed,
      modified,
      changedFiles: xml === original ? [] : [ciPath],
      lines,
    };
  }

  validate(options: CommandInterfaceValidationOptions): CommandInterfaceValidationResult {
    const ciPath = resolveCommandInterfacePath(options.ciPath);
    const maxErrors = options.maxErrors ?? 30;
    const xml = fs.readFileSync(ciPath, 'utf-8');
    const issues: CommandInterfaceValidationIssue[] = [];
    const add = (severity: CommandInterfaceValidationIssue['severity'], message: string) => {
      if (severity === 'ok' && !options.detailed) {
        return;
      }
      if (severity !== 'ok' || options.detailed) {
        issues.push({ severity, message });
      }
    };

    const syntax = XMLValidator.validate(xml);
    if (syntax !== true) {
      add('error', `XML не разобран: ${syntax.err.msg}`);
      return buildValidationResult(ciPath, issues, maxErrors);
    }
    add('ok', 'XML корректно разобран.');
    if (!/<CommandInterface\b/.test(xml)) {
      add('error', 'Корневой элемент должен быть <CommandInterface>.');
      return buildValidationResult(ciPath, issues, maxErrors);
    }
    if (!xml.includes(`xmlns="${CI_NS}"`)) {
      add('error', `Неверное пространство имён CommandInterface, ожидается ${CI_NS}.`);
    } else {
      add('ok', 'Пространство имён CommandInterface корректно.');
    }
    if (!/\bversion="[^"]+"/.test(xml)) {
      add('warning', 'У CommandInterface нет атрибута version.');
    }

    const parsed = parseCommandInterface(xml);
    validateSectionOrder(parsed.sections, issues, options.detailed === true);
    validateVisibility(parsed.visibility, issues, options.detailed === true);
    validatePlacement(parsed.placement, issues, options.detailed === true);
    validateOrder(parsed.order, issues, options.detailed === true);
    validateSimpleList('SubsystemsOrder', parsed.subsystemsOrder, (item) => item.startsWith('Subsystem.'), issues, options.detailed === true);
    validateSimpleList('GroupsOrder', parsed.groupsOrder, () => true, issues, options.detailed === true);

    for (const command of [
      ...parsed.visibility.map((item) => item.command),
      ...parsed.placement.map((item) => item.command),
      ...parsed.order.map((item) => item.command),
    ]) {
      if (!isValidCommandRef(command)) {
        add('warning', `Нераспознанный формат ссылки команды: ${command}`);
      }
    }

    return buildValidationResult(ciPath, issues, maxErrors);
  }

  private setVisibility(xml: string, commands: readonly string[], visible: boolean): { xml: string; added: number; modified: number; lines: string[] } {
    const current = parseCommandInterface(xml).visibility.map((item) => [item.command, item.common] as const);
    const map = new Map(current);
    let added = 0;
    let modified = 0;
    const lines: string[] = [];
    for (const rawCommand of commands) {
      const command = normalizeCommandRef(rawCommand);
      const value = visible ? 'true' : 'false';
      const previous = map.get(command);
      if (previous === value) {
        lines.push(`Без изменений: ${command}.`);
        continue;
      }
      if (previous === undefined) {
        added += 1;
      } else {
        modified += 1;
      }
      map.set(command, value);
      lines.push(`${visible ? 'Показана' : 'Скрыта'} команда: ${command}.`);
    }
    const section = buildVisibilitySection([...map.entries()].map(([command, common]) => ({ command, common })));
    return { xml: replaceSection(xml, 'CommandsVisibility', section), added, modified, lines };
  }

  private placeCommand(xml: string, rawCommand: string, group: string): { xml: string; added: number; modified: number; lines: string[] } {
    const command = normalizeCommandRef(rawCommand);
    const current = parseCommandInterface(xml).placement.map((item) => [item.command, item] as const);
    const map = new Map(current);
    const previous = map.get(command);
    const changed = previous?.group !== group || previous.placement !== 'Auto';
    map.set(command, { command, group, placement: 'Auto' });
    const section = buildPlacementSection([...map.values()]);
    return {
      xml: replaceSection(xml, 'CommandsPlacement', section),
      added: previous ? 0 : 1,
      modified: previous && changed ? 1 : 0,
      lines: [changed ? `Команда ${command} помещена в группу ${group}.` : `Без изменений: ${command}.`],
    };
  }

  private setCommandOrder(xml: string, group: string, rawCommands: readonly string[]): { xml: string; added: number; removed: number; lines: string[] } {
    const commands = rawCommands.map(normalizeCommandRef);
    const current = parseCommandInterface(xml).order;
    const kept = current.filter((item) => item.group !== group);
    const removed = current.length - kept.length;
    const next = [...kept, ...commands.map((command) => ({ command, group }))];
    return {
      xml: replaceSection(xml, 'CommandsOrder', buildOrderSection(next)),
      added: commands.length,
      removed,
      lines: [`Порядок группы ${group}: ${String(commands.length)} команд.`],
    };
  }
}

function resolveCommandInterfacePath(inputPath: string, allowMissing = false): string {
  let ciPath = path.resolve(inputPath);
  if (fs.existsSync(ciPath) && fs.statSync(ciPath).isDirectory()) {
    ciPath = path.join(ciPath, 'Ext', 'CommandInterface.xml');
  }
  if (!fs.existsSync(ciPath) && path.basename(ciPath) === 'CommandInterface.xml') {
    const extCandidate = path.join(path.dirname(ciPath), 'Ext', 'CommandInterface.xml');
    if (fs.existsSync(extCandidate) || allowMissing) {
      ciPath = extCandidate;
    }
  }
  if (!fs.existsSync(ciPath) && !allowMissing) {
    throw new Error(`CommandInterface.xml не найден: ${ciPath}`);
  }
  return ciPath;
}

function parseCommandInterface(xml: string): ParsedCommandInterface {
  return {
    visibility: parseVisibility(extractSectionInner(xml, 'CommandsVisibility') ?? ''),
    placement: parsePlacement(extractSectionInner(xml, 'CommandsPlacement') ?? ''),
    order: parseOrder(extractSectionInner(xml, 'CommandsOrder') ?? ''),
    subsystemsOrder: parseTextEntries(extractSectionInner(xml, 'SubsystemsOrder') ?? '', 'Subsystem'),
    groupsOrder: parseTextEntries(extractSectionInner(xml, 'GroupsOrder') ?? '', 'Group'),
    sections: extractSections(xml),
  };
}

function parseVisibility(inner: string): { command: string; common: string }[] {
  return parseCommandBlocks(inner).map((block) => ({
    command: block.name,
    common: extractSimpleInner(block.xml, 'xr:Common') ?? extractSimpleInner(block.xml, 'Common') ?? '',
  }));
}

function parsePlacement(inner: string): { command: string; group: string; placement: string }[] {
  return parseCommandBlocks(inner).map((block) => ({
    command: block.name,
    group: extractSimpleInner(block.xml, 'CommandGroup') ?? '',
    placement: extractSimpleInner(block.xml, 'Placement') ?? '',
  }));
}

function parseOrder(inner: string): { command: string; group: string }[] {
  return parseCommandBlocks(inner).map((block) => ({
    command: block.name,
    group: extractSimpleInner(block.xml, 'CommandGroup') ?? '',
  }));
}

function parseCommandBlocks(inner: string): { name: string; xml: string }[] {
  const items: { name: string; xml: string }[] = [];
  const commandRe = /<Command\b([^>]*)>([\s\S]*?)<\/Command>/g;
  let match: RegExpExecArray | null;
  while ((match = commandRe.exec(inner)) !== null) {
    const name = /name="([^"]*)"/.exec(match[1])?.[1] ?? '';
    items.push({ name: unescapeXml(name), xml: match[0] });
  }
  return items;
}

function parseTextEntries(inner: string, tagName: string): string[] {
  const entries: string[] = [];
  const re = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(inner)) !== null) {
    entries.push(unescapeXml(match[1].trim()));
  }
  return entries;
}

function extractSections(xml: string): CommandInterfaceSection[] {
  const sections: CommandInterfaceSection[] = [];
  const body = /<CommandInterface\b[^>]*>([\s\S]*?)<\/CommandInterface>/.exec(xml)?.[1] ?? '';
  const tagRe = /<([A-Za-z][A-Za-z0-9]*)\b[^>]*>/g;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(body)) !== null) {
    if ((SECTION_ORDER as readonly string[]).includes(match[1])) {
      sections.push(match[1] as CommandInterfaceSection);
    }
  }
  return sections;
}

function extractSectionInner(xml: string, section: CommandInterfaceSection): string | null {
  return new RegExp(`<${section}>([\\s\\S]*?)<\\/${section}>`).exec(xml)?.[1] ?? null;
}

function replaceSection(xml: string, section: CommandInterfaceSection, sectionXml: string): string {
  const re = new RegExp(`<${section}>[\\s\\S]*?<\\/${section}>`);
  if (re.test(xml)) {
    return xml.replace(re, sectionXml);
  }
  const myIndex = SECTION_ORDER.indexOf(section);
  for (const nextSection of SECTION_ORDER.slice(myIndex + 1)) {
    const nextRe = new RegExp(`\\s*<${nextSection}>`);
    const next = nextRe.exec(xml);
    if (next) {
      return `${xml.slice(0, next.index)}\n\t${sectionXml}${xml.slice(next.index)}`;
    }
  }
  return xml.replace(/<\/CommandInterface>\s*$/, `\t${sectionXml}\n</CommandInterface>\n`);
}

function replaceListSection(xml: string, section: 'SubsystemsOrder' | 'GroupsOrder', tagName: 'Subsystem' | 'Group', items: readonly string[]): { xml: string; added: number; removed: number } {
  const current = parseTextEntries(extractSectionInner(xml, section) ?? '', tagName);
  const sectionXml = `\t<${section}>\n${items.map((item) => `\t\t<${tagName}>${escapeXmlText(item)}</${tagName}>`).join('\n')}\n\t</${section}>`;
  return { xml: replaceSection(xml, section, sectionXml), added: items.length, removed: current.length };
}

function buildVisibilitySection(items: readonly { readonly command: string; readonly common: string }[]): string {
  return `\t<CommandsVisibility>\n${items.map((item) => `\t\t<Command name="${escapeXmlAttribute(item.command)}">\n\t\t\t<Visibility>\n\t\t\t\t<xr:Common>${item.common}</xr:Common>\n\t\t\t</Visibility>\n\t\t</Command>`).join('\n')}\n\t</CommandsVisibility>`;
}

function buildPlacementSection(items: readonly { readonly command: string; readonly group: string; readonly placement: string }[]): string {
  return `\t<CommandsPlacement>\n${items.map((item) => `\t\t<Command name="${escapeXmlAttribute(item.command)}">\n\t\t\t<CommandGroup>${escapeXmlText(item.group)}</CommandGroup>\n\t\t\t<Placement>${escapeXmlText(item.placement)}</Placement>\n\t\t</Command>`).join('\n')}\n\t</CommandsPlacement>`;
}

function buildOrderSection(items: readonly { readonly command: string; readonly group: string }[]): string {
  return `\t<CommandsOrder>\n${items.map((item) => `\t\t<Command name="${escapeXmlAttribute(item.command)}">\n\t\t\t<CommandGroup>${escapeXmlText(item.group)}</CommandGroup>\n\t\t</Command>`).join('\n')}\n\t</CommandsOrder>`;
}

function buildInfoLines(ciPath: string, parsed: ParsedCommandInterface): string[] {
  const lines = [
    `Командный интерфейс: ${ciPath}`,
    `Видимость команд: ${String(parsed.visibility.length)}`,
    `Размещение команд: ${String(parsed.placement.length)}`,
    `Порядок команд: ${String(parsed.order.length)}`,
    `Порядок подсистем: ${String(parsed.subsystemsOrder.length)}`,
    `Порядок групп: ${String(parsed.groupsOrder.length)}`,
  ];
  for (const item of parsed.visibility) {
    lines.push(`  ${item.command}: ${item.common}`);
  }
  for (const item of parsed.placement) {
    lines.push(`  ${item.command} -> ${item.group} (${item.placement || 'без Placement'})`);
  }
  return lines;
}

function buildValidationResult(ciPath: string, issues: CommandInterfaceValidationIssue[], maxErrors: number): CommandInterfaceValidationResult {
  const limited = limitErrors(issues, maxErrors);
  const errors = limited.filter((issue) => issue.severity === 'error').length;
  const warnings = limited.filter((issue) => issue.severity === 'warning').length;
  const lines = [`=== Validation: CommandInterface ===`, `Файл: ${ciPath}`, ''];
  for (const issue of limited) {
    const prefix = issue.severity === 'error' ? '[ERROR]' : issue.severity === 'warning' ? '[WARN] ' : '[OK]   ';
    lines.push(`${prefix} ${issue.message}`);
  }
  lines.push('', `=== Result: ${String(errors)} errors, ${String(warnings)} warnings (${String(limited.length)} checks) ===`);
  return { ciPath, errors, warnings, checks: limited.length, issues: limited, lines };
}

function validateSectionOrder(sections: readonly CommandInterfaceSection[], issues: CommandInterfaceValidationIssue[], detailed: boolean): void {
  let previous = -1;
  const seen = new Set<string>();
  for (const section of sections) {
    const index = SECTION_ORDER.indexOf(section);
    if (index < previous) {
      issues.push({ severity: 'error', message: `Раздел ${section} расположен не по порядку.` });
    }
    if (seen.has(section)) {
      issues.push({ severity: 'error', message: `Раздел ${section} продублирован.` });
    }
    seen.add(section);
    previous = index;
  }
  if (detailed) {
    issues.push({ severity: 'ok', message: `Разделы CommandInterface: ${String(sections.length)}.` });
  }
}

function validateVisibility(items: readonly { readonly command: string; readonly common: string }[], issues: CommandInterfaceValidationIssue[], detailed: boolean): void {
  const names = items.map((item) => item.command);
  pushDuplicateWarnings('CommandsVisibility', names, issues);
  for (const item of items) {
    if (!item.command) {
      issues.push({ severity: 'error', message: 'CommandsVisibility содержит Command без name.' });
    }
    if (item.common !== 'true' && item.common !== 'false') {
      issues.push({ severity: 'error', message: `CommandsVisibility[${item.command}]: xr:Common должен быть true/false.` });
    }
  }
  if (detailed) {
    issues.push({ severity: 'ok', message: `CommandsVisibility: ${String(items.length)} записей.` });
  }
}

function validatePlacement(items: readonly { readonly command: string; readonly group: string; readonly placement: string }[], issues: CommandInterfaceValidationIssue[], detailed: boolean): void {
  for (const item of items) {
    if (!item.command || !item.group) {
      issues.push({ severity: 'error', message: `CommandsPlacement содержит неполную запись для ${item.command || '<без имени>'}.` });
    }
    if (item.placement && item.placement !== 'Auto') {
      issues.push({ severity: 'warning', message: `CommandsPlacement[${item.command}]: Placement=${item.placement}, обычно ожидается Auto.` });
    }
  }
  if (detailed) {
    issues.push({ severity: 'ok', message: `CommandsPlacement: ${String(items.length)} записей.` });
  }
}

function validateOrder(items: readonly { readonly command: string; readonly group: string }[], issues: CommandInterfaceValidationIssue[], detailed: boolean): void {
  for (const item of items) {
    if (!item.command || !item.group) {
      issues.push({ severity: 'error', message: `CommandsOrder содержит неполную запись для ${item.command || '<без имени>'}.` });
    }
  }
  if (detailed) {
    issues.push({ severity: 'ok', message: `CommandsOrder: ${String(items.length)} записей.` });
  }
}

function validateSimpleList(name: string, items: readonly string[], predicate: (item: string) => boolean, issues: CommandInterfaceValidationIssue[], detailed: boolean): void {
  pushDuplicateWarnings(name, items, issues);
  for (const item of items) {
    if (!item || !predicate(item)) {
      issues.push({ severity: 'error', message: `${name}: неверное значение "${item}".` });
    }
  }
  if (detailed) {
    issues.push({ severity: 'ok', message: `${name}: ${String(items.length)} записей.` });
  }
}

function pushDuplicateWarnings(section: string, values: readonly string[], issues: CommandInterfaceValidationIssue[]): void {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      dupes.add(value);
    }
    seen.add(value);
  }
  for (const value of dupes) {
    issues.push({ severity: 'warning', message: `${section}: дубль ${value}.` });
  }
}

function limitErrors(issues: readonly CommandInterfaceValidationIssue[], maxErrors: number): CommandInterfaceValidationIssue[] {
  const result: CommandInterfaceValidationIssue[] = [];
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

function buildEmptyCommandInterfaceXml(version: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<CommandInterface xmlns="${CI_NS}"
\txmlns:xr="${XR_NS}"
\txmlns:xs="${XS_NS}"
\txmlns:xsi="${XSI_NS}"
\tversion="${version}">
</CommandInterface>
`;
}

function detectFormatVersion(startDir: string): string {
  let current = startDir;
  while (current && path.dirname(current) !== current) {
    const configPath = path.join(current, 'Configuration.xml');
    if (fs.existsSync(configPath)) {
      const match = /<MetaDataObject\b[^>]*version="([^"]+)"/.exec(fs.readFileSync(configPath, 'utf-8'));
      if (match) {
        return match[1];
      }
    }
    current = path.dirname(current);
  }
  return '2.18';
}

function extractSimpleInner(xml: string, tagName: string): string | null {
  return new RegExp(`<${escapeRegExp(tagName)}>([\\s\\S]*?)<\\/${escapeRegExp(tagName)}>`).exec(xml)?.[1].trim() ?? null;
}

function toStringList(value: string | readonly string[]): string[] {
  if (typeof value === 'string') {
    return value ? [value] : [];
  }
  return value.map(String).filter(Boolean);
}

const TYPE_NORM_MAP: Record<string, string> = {
  Catalogs: 'Catalog',
  Documents: 'Document',
  Enums: 'Enum',
  Constants: 'Constant',
  Reports: 'Report',
  DataProcessors: 'DataProcessor',
  Subsystems: 'Subsystem',
  Справочники: 'Catalog',
  Документы: 'Document',
  Перечисления: 'Enum',
  Отчеты: 'Report',
  Отчёты: 'Report',
  Обработки: 'DataProcessor',
  Подсистемы: 'Subsystem',
};

function normalizeCommandRef(command: string): string {
  const dot = command.indexOf('.');
  if (dot < 0) {
    return command;
  }
  const first = command.slice(0, dot);
  return `${TYPE_NORM_MAP[first] ?? first}${command.slice(dot)}`;
}

function isValidCommandRef(command: string): boolean {
  return /^[A-Za-z]+\.[^\s.]+\.StandardCommand\.\w+$/.test(command) ||
    /^[A-Za-z]+\.[^\s.]+\.Command\.\w+$/.test(command) ||
    /^CommonCommand\.\w+$/.test(command) ||
    /^0:[0-9a-fA-F-]{36}$/.test(command);
}

function paginate(lines: readonly string[], limit?: number, offset?: number): string[] {
  const start = offset ?? 0;
  const sliced = lines.slice(start, limit && limit > 0 ? start + limit : undefined);
  if (limit && limit > 0 && start + limit < lines.length) {
    return [...sliced, '', `[ОБРЕЗАНО] Показано ${String(sliced.length)} из ${String(lines.length)} строк.`];
  }
  return sliced;
}

function escapeXmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value).replace(/"/g, '&quot;');
}

function unescapeXml(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
