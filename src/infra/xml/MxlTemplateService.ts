import * as fs from 'fs';
import * as path from 'path';
import { XMLValidator } from 'fast-xml-parser';
import { escapeXmlAttribute, escapeXmlText, writeTextFilePreservingBomAndEol } from './XmlUtils';

const SPREADSHEET_NS = 'http://v8.1c.ru/8.2/data/spreadsheet';

export interface MxlCompileOptions {
  readonly outputPath: string;
  readonly definition: MxlDefinition;
}

export interface MxlDefinition {
  readonly columns: number;
  readonly page?: number | string;
  readonly defaultWidth?: number;
  readonly columnWidths?: Record<string, string | number>;
  readonly fonts?: Record<string, MxlFontDefinition>;
  readonly styles?: Record<string, MxlStyleDefinition>;
  readonly areas: readonly MxlAreaDefinition[];
}

export interface MxlFontDefinition {
  readonly face?: string;
  readonly size?: number;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
  readonly strikeout?: boolean;
}

export interface MxlStyleDefinition {
  readonly font?: string;
  readonly align?: 'left' | 'center' | 'right';
  readonly valign?: 'top' | 'center';
  readonly border?: string;
  readonly borderWidth?: 'thin' | 'thick';
  readonly wrap?: boolean;
  readonly format?: string;
}

export interface MxlAreaDefinition {
  readonly name: string;
  readonly rows: readonly MxlRowDefinition[];
}

export interface MxlRowDefinition {
  readonly height?: number;
  readonly rowStyle?: string;
  readonly empty?: number;
  readonly cells?: readonly MxlCellDefinition[];
}

export interface MxlCellDefinition {
  readonly col: number;
  readonly span?: number;
  readonly rowspan?: number;
  readonly style?: string;
  readonly param?: string;
  readonly detail?: string;
  readonly text?: string;
  readonly template?: string;
}

export interface MxlCompileResult {
  readonly templatePath: string;
  readonly changedFiles: readonly string[];
  readonly rows: number;
  readonly columns: number;
  readonly areas: readonly string[];
}

export interface MxlInfoOptions {
  readonly templatePath: string;
  readonly withText?: boolean;
  readonly maxParams?: number;
  readonly limit?: number;
  readonly offset?: number;
}

export interface MxlInfoResult {
  readonly templatePath: string;
  readonly name: string;
  readonly rows: number;
  readonly columns: number;
  readonly areas: readonly MxlAreaInfo[];
  readonly outsideParams: readonly string[];
  readonly mergeCount: number;
  readonly drawingCount: number;
  readonly lines: readonly string[];
}

export interface MxlAreaInfo {
  readonly name: string;
  readonly type: string;
  readonly beginRow: number;
  readonly endRow: number;
  readonly beginCol: number;
  readonly endCol: number;
  readonly params: readonly string[];
  readonly details: readonly string[];
  readonly texts: readonly string[];
  readonly templates: readonly string[];
}

export interface MxlValidationOptions {
  readonly templatePath: string;
  readonly detailed?: boolean;
  readonly maxErrors?: number;
}

export interface MxlValidationIssue {
  readonly severity: 'error' | 'warning' | 'ok';
  readonly message: string;
}

export interface MxlValidationResult {
  readonly templatePath: string;
  readonly errors: number;
  readonly warnings: number;
  readonly checks: number;
  readonly issues: readonly MxlValidationIssue[];
  readonly lines: readonly string[];
}

export class MxlTemplateService {
  compile(options: MxlCompileOptions): MxlCompileResult {
    const definition = normalizeDefinition(options.definition);
    const templatePath = path.resolve(options.outputPath);
    const xml = buildSpreadsheetXml(definition);
    fs.mkdirSync(path.dirname(templatePath), { recursive: true });
    const previous = fs.existsSync(templatePath) ? fs.readFileSync(templatePath, 'utf-8') : '';
    if (previous) {
      writeTextFilePreservingBomAndEol(templatePath, previous, xml);
    } else {
      fs.writeFileSync(templatePath, xml, 'utf-8');
    }
    return {
      templatePath,
      changedFiles: [templatePath],
      rows: definition.areas.reduce((sum, area) => sum + area.rows.reduce((rowSum, row) => rowSum + (row.empty ?? 1), 0), 0),
      columns: definition.columns,
      areas: definition.areas.map((area) => area.name),
    };
  }

  decompile(options: { readonly templatePath: string }): MxlDefinition {
    const info = this.info({ templatePath: options.templatePath, withText: true });
    const rows = parseRows(fs.readFileSync(info.templatePath, 'utf-8'));
    const areas = info.areas.map((area) => ({
      name: area.name,
      rows: rows
        .filter((row) => row.index >= area.beginRow && row.index <= area.endRow)
        .map((row) => ({
          cells: row.cells.map((cell) => ({
            col: cell.column + 1,
            param: cell.parameter || undefined,
            detail: cell.detail || undefined,
            text: cell.fillType === 'Text' ? cell.text || undefined : undefined,
            template: cell.fillType === 'Template' ? cell.text || undefined : undefined,
          })),
        })),
    }));
    return {
      columns: info.columns,
      defaultWidth: 10,
      areas,
    };
  }

  info(options: MxlInfoOptions): MxlInfoResult {
    const templatePath = resolveTemplateContentPath(options.templatePath);
    const xml = fs.readFileSync(templatePath, 'utf-8');
    const rows = parseRows(xml);
    const rowMap = new Map(rows.map((row) => [row.index, row]));
    const height = readInt(xml, 'height') || rows.length;
    const columns = /<columns>[\s\S]*?<size>(\d+)<\/size>/.exec(xml)?.[1];
    const areas = parseNamedAreas(xml).map((area) => enrichArea(area, rowMap, height, options.withText === true));
    const covered = new Set<number>();
    for (const area of areas) {
      for (let row = area.beginRow; row <= area.endRow; row += 1) {
        covered.add(row);
      }
    }
    const outsideParams: string[] = [];
    for (const row of rows) {
      if (!covered.has(row.index)) {
        outsideParams.push(...row.cells.flatMap((cell) => cellParams(cell)));
      }
    }
    const result: Omit<MxlInfoResult, 'lines'> = {
      templatePath,
      name: getTemplateDisplayName(templatePath),
      rows: height,
      columns: columns ? Number(columns) : 0,
      areas,
      outsideParams,
      mergeCount: countTags(xml, 'merge'),
      drawingCount: countTags(xml, 'drawing'),
    };
    return {
      ...result,
      lines: paginate(buildInfoLines(result, options.maxParams ?? 10, options.withText === true), options.limit, options.offset),
    };
  }

  validate(options: MxlValidationOptions): MxlValidationResult {
    const templatePath = resolveTemplateContentPath(options.templatePath);
    const xml = fs.readFileSync(templatePath, 'utf-8');
    const maxErrors = options.maxErrors ?? 20;
    const issues: MxlValidationIssue[] = [];
    const push = (severity: MxlValidationIssue['severity'], message: string) => {
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
    if (!/<document\b/.test(xml) || !xml.includes(`xmlns="${SPREADSHEET_NS}"`)) {
      push('error', `Ожидается document в пространстве имён ${SPREADSHEET_NS}.`);
    }
    const rows = parseRows(xml);
    const height = readInt(xml, 'height') || rows.length;
    const columns = Number(/<columns>[\s\S]*?<size>(\d+)<\/size>/.exec(xml)?.[1] ?? 0);
    const formatCount = countTags(xml, 'format');
    const fontCount = countTags(xml, 'font');
    const lineCount = countTags(xml, 'line');
    const maxRow = Math.max(-1, ...rows.map((row) => row.index));
    if (height < maxRow + 1) {
      push('error', `height=${String(height)}, но максимальный индекс строки ${String(maxRow)}.`);
    } else {
      push('ok', `height покрывает строки: ${String(height)}.`);
    }
    for (const row of rows) {
      for (const cell of row.cells) {
        if (columns > 0 && cell.column >= columns) {
          push('error', `Строка ${String(row.index)}: колонка ${String(cell.column)} вне диапазона ${String(columns)}.`);
        }
        if (cell.format > formatCount) {
          push('error', `Строка ${String(row.index)}: формат ${String(cell.format)} больше палитры ${String(formatCount)}.`);
        }
      }
    }
    for (const index of parseNumericTags(xml, 'font')) {
      if (index >= fontCount) {
        push('error', `Ссылка на шрифт ${String(index)} вне палитры ${String(fontCount)}.`);
      }
    }
    for (const index of [...parseNumericTags(xml, 'leftBorder'), ...parseNumericTags(xml, 'topBorder'), ...parseNumericTags(xml, 'rightBorder'), ...parseNumericTags(xml, 'bottomBorder')]) {
      if (index >= lineCount) {
        push('error', `Ссылка на линию ${String(index)} вне палитры ${String(lineCount)}.`);
      }
    }
    for (const area of parseNamedAreas(xml)) {
      if (area.beginRow !== -1 && area.beginRow >= height) {
        push('error', `Область ${area.name}: beginRow вне диапазона.`);
      }
      if (area.endRow !== -1 && area.endRow >= height) {
        push('error', `Область ${area.name}: endRow вне диапазона.`);
      }
    }
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
    throw new Error(`Template.xml не найден: ${target}`);
  }
  return target;
}

function normalizeDefinition(definition: MxlDefinition): MxlDefinition {
  if (!definition.columns || definition.columns < 1) {
    throw new Error('MXL DSL: поле columns обязательно и должно быть больше 0.');
  }
  if (definition.areas.length === 0) {
    throw new Error('MXL DSL: поле areas обязательно.');
  }
  const defaultWidth = calculateDefaultWidth(definition);
  return { ...definition, defaultWidth };
}

function calculateDefaultWidth(definition: MxlDefinition): number {
  const explicit = definition.defaultWidth ?? 10;
  const pageTargets: Record<string, number> = { 'A4-landscape': 780, 'A4-portrait': 540 };
  const target = typeof definition.page === 'number'
    ? definition.page
    : definition.page ? pageTargets[definition.page] ?? Number(definition.page) : 0;
  if (!target || !definition.columnWidths) {
    return explicit;
  }
  let absolute = 0;
  let units = 0;
  const specified = new Set<number>();
  for (const [spec, raw] of Object.entries(definition.columnWidths)) {
    const cols = parseColumnSpec(spec);
    const value = String(raw);
    for (const col of cols) {
      specified.add(col);
      if (value.endsWith('x')) {
        units += Number(value.slice(0, -1));
      } else {
        absolute += Number(value);
      }
    }
  }
  for (let col = 1; col <= definition.columns; col += 1) {
    if (!specified.has(col)) {
      units += 1;
    }
  }
  return units > 0 ? Math.round((target - absolute) / units) : explicit;
}

function buildSpreadsheetXml(definition: MxlDefinition): string {
  const fonts = buildFontPalette(definition.fonts);
  const formats = new FormatRegistry(definition.defaultWidth ?? 10);
  const columnFormats = buildColumnFormats(definition, formats);
  const rows: string[] = [];
  const merges: string[] = [];
  const namedItems: string[] = [];
  let rowIndex = 0;

  for (const area of definition.areas) {
    const start = rowIndex;
    for (const row of area.rows) {
      const count = row.empty ?? 1;
      for (let emptyIndex = 0; emptyIndex < count; emptyIndex += 1) {
        const cells = emptyIndex === 0 ? row.cells ?? [] : [];
        rows.push(buildRowXml(rowIndex, row, cells, formats, definition.styles ?? {}, merges));
        rowIndex += 1;
      }
    }
    namedItems.push(buildNamedRowsArea(area.name, start, rowIndex - 1));
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<document xmlns="http://v8.1c.ru/8.2/data/spreadsheet" xmlns:style="http://v8.1c.ru/8.1/data/ui/style" xmlns:v8="http://v8.1c.ru/8.1/data/core" xmlns:v8ui="http://v8.1c.ru/8.1/data/ui" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    '\t<languageSettings>',
    '\t\t<currentLanguage>ru</currentLanguage>',
    '\t\t<defaultLanguage>ru</defaultLanguage>',
    '\t\t<languageInfo><id>ru</id><code>Русский</code><description>Русский</description></languageInfo>',
    '\t</languageSettings>',
    '\t<columns>',
    `\t\t<size>${String(definition.columns)}</size>`,
    ...columnFormats,
    '\t</columns>',
    ...rows,
    '\t<templateMode>true</templateMode>',
    `\t<defaultFormatIndex>${String(formats.defaultIndex)}</defaultFormatIndex>`,
    `\t<height>${String(rowIndex)}</height>`,
    `\t<vgRows>${String(rowIndex)}</vgRows>`,
    ...merges,
    ...namedItems,
    ...formats.lineXml(),
    ...fonts.map((font) => `\t<font faceName="${escapeXmlAttribute(font.face)}" height="${String(font.size)}" bold="${String(font.bold)}" italic="${String(font.italic)}" underline="${String(font.underline)}" strikeout="${String(font.strikeout)}" kind="Absolute" scale="100"/>`),
    ...formats.formatXml(definition.styles ?? {}),
    '</document>',
    '',
  ].join('\n');
}

function buildFontPalette(fonts: Record<string, MxlFontDefinition> | undefined): { name: string; face: string; size: number; bold: boolean; italic: boolean; underline: boolean; strikeout: boolean }[] {
  const entries = Object.entries(fonts ?? {});
  const defaultEntry: [string, MxlFontDefinition] = ['default', { face: 'Arial', size: 10 }];
  const withDefault: [string, MxlFontDefinition][] = entries.some(([name]) => name === 'default')
    ? entries
    : [defaultEntry, ...entries];
  return withDefault.map(([name, font]) => ({
    name,
    face: font.face ?? 'Arial',
    size: font.size ?? 10,
    bold: font.bold === true,
    italic: font.italic === true,
    underline: font.underline === true,
    strikeout: font.strikeout === true,
  }));
}

class FormatRegistry {
  readonly defaultIndex: number;
  private readonly formats: { readonly kind: 'width' | 'height' | 'cell'; readonly style?: string; readonly fillType?: string; readonly value?: number }[] = [];
  private hasThinLine = false;
  private hasThickLine = false;

  constructor(defaultWidth: number) {
    this.defaultIndex = this.add({ kind: 'width', value: defaultWidth });
  }

  width(width: number): number {
    return this.add({ kind: 'width', value: width });
  }

  height(height: number): number {
    return this.add({ kind: 'height', value: height });
  }

  cell(styleName: string, fillType: string, styles: Partial<Record<string, MxlStyleDefinition>>): number {
    const style = styles[styleName];
    if (style?.border && style.border !== 'none') {
      if (style.borderWidth === 'thick') {
        this.hasThickLine = true;
      } else {
        this.hasThinLine = true;
      }
    }
    return this.add({ kind: 'cell', style: styleName, fillType });
  }

  lineXml(): string[] {
    const lines: string[] = [];
    if (this.hasThinLine) {
      lines.push('\t<line width="1" gap="false"><v8ui:style xsi:type="v8ui:SpreadsheetDocumentCellLineType">Solid</v8ui:style></line>');
    }
    if (this.hasThickLine) {
      lines.push('\t<line width="2" gap="false"><v8ui:style xsi:type="v8ui:SpreadsheetDocumentCellLineType">Solid</v8ui:style></line>');
    }
    return lines;
  }

  formatXml(styles: Partial<Record<string, MxlStyleDefinition>>): string[] {
    return this.formats.map((format) => {
      if (format.kind === 'width') {
        return `\t<format><width>${String(format.value ?? 10)}</width></format>`;
      }
      if (format.kind === 'height') {
        return `\t<format><height>${String(format.value ?? 10)}</height></format>`;
      }
      const style = styles[format.style ?? ''] ?? {};
      const borderIndex = style.borderWidth === 'thick' ? (this.hasThinLine ? 1 : 0) : 0;
      const parts = ['\t<format>', '\t\t<font>0</font>'];
      if (style.border && style.border !== 'none') {
        const sides = style.border.split(',').map((item) => item.trim());
        for (const side of ['left', 'top', 'right', 'bottom'] as const) {
          if (sides.includes('all') || sides.includes(side)) {
            parts.push(`\t\t<${side}Border>${String(borderIndex)}</${side}Border>`);
          }
        }
      }
      if (style.align) {
        parts.push(`\t\t<horizontalAlignment>${style.align === 'center' ? 'Center' : style.align === 'right' ? 'Right' : 'Left'}</horizontalAlignment>`);
      }
      if (style.valign) {
        parts.push(`\t\t<verticalAlignment>${style.valign === 'center' ? 'Center' : 'Top'}</verticalAlignment>`);
      }
      if (style.wrap) {
        parts.push('\t\t<textPlacement>Wrap</textPlacement>');
      }
      if (format.fillType) {
        parts.push(`\t\t<fillType>${format.fillType}</fillType>`);
      }
      if (style.format) {
        parts.push(`\t\t<format><v8:item><v8:lang>ru</v8:lang><v8:content>${escapeXmlText(style.format)}</v8:content></v8:item></format>`);
      }
      parts.push('\t</format>');
      return parts.join('\n');
    });
  }

  private add(format: { readonly kind: 'width' | 'height' | 'cell'; readonly style?: string; readonly fillType?: string; readonly value?: number }): number {
    const key = JSON.stringify(format);
    const index = this.formats.findIndex((item) => JSON.stringify(item) === key);
    if (index >= 0) {
      return index + 1;
    }
    this.formats.push(format);
    return this.formats.length;
  }
}

function buildColumnFormats(definition: MxlDefinition, formats: FormatRegistry): string[] {
  const lines: string[] = [];
  for (const [spec, raw] of Object.entries(definition.columnWidths ?? {})) {
    const rawText = String(raw);
    const width = rawText.endsWith('x')
      ? Math.round(Number(rawText.slice(0, -1)) * (definition.defaultWidth ?? 10))
      : Number(rawText);
    const formatIndex = formats.width(width);
    for (const col of parseColumnSpec(spec)) {
      lines.push(`\t\t<columnsItem><index>${String(col - 1)}</index><column><formatIndex>${String(formatIndex)}</formatIndex></column></columnsItem>`);
    }
  }
  return lines;
}

function buildRowXml(rowIndex: number, row: MxlRowDefinition, cells: readonly MxlCellDefinition[], formats: FormatRegistry, styles: Partial<Record<string, MxlStyleDefinition>>, merges: string[]): string {
  const parts = ['\t<rowsItem>', `\t\t<index>${String(rowIndex)}</index>`, '\t\t<row>'];
  if (row.height) {
    parts.push(`\t\t\t<formatIndex>${String(formats.height(row.height))}</formatIndex>`);
  }
  if (row.empty && cells.length === 0) {
    parts.push('\t\t\t<empty>true</empty>');
  } else if (cells.length === 0) {
    parts.push('\t\t\t<empty>true</empty>');
  } else {
    for (const cell of cells) {
      const fillType = cell.param ? 'Parameter' : cell.template ? 'Template' : cell.text ? 'Text' : '';
      const formatIndex = formats.cell(cell.style ?? row.rowStyle ?? 'default', fillType, styles);
      parts.push('\t\t\t<c>');
      parts.push(`\t\t\t\t<i>${String(cell.col - 1)}</i>`);
      parts.push('\t\t\t\t<c>');
      parts.push(`\t\t\t\t\t<f>${String(formatIndex)}</f>`);
      if (cell.param) {
        parts.push(`\t\t\t\t\t<parameter>${escapeXmlText(cell.param)}</parameter>`);
      }
      if (cell.detail) {
        parts.push(`\t\t\t\t\t<detailParameter>${escapeXmlText(cell.detail)}</detailParameter>`);
      }
      const text = cell.text ?? cell.template;
      if (text) {
        parts.push(`\t\t\t\t\t<tl><v8:item><v8:lang>ru</v8:lang><v8:content>${escapeXmlText(text)}</v8:content></v8:item></tl>`);
      }
      parts.push('\t\t\t\t</c>');
      parts.push('\t\t\t</c>');
      const span = cell.span ?? 1;
      const rowspan = cell.rowspan ?? 1;
      if (span > 1 || rowspan > 1) {
        merges.push(buildMerge(rowIndex, cell.col - 1, span - 1, rowspan - 1));
      }
    }
  }
  parts.push('\t\t</row>', '\t</rowsItem>');
  return parts.join('\n');
}

function buildMerge(row: number, col: number, width: number, height: number): string {
  return ['\t<merge>', `\t\t<r>${String(row)}</r>`, `\t\t<c>${String(col)}</c>`, height > 0 ? `\t\t<h>${String(height)}</h>` : '', `\t\t<w>${String(width)}</w>`, '\t</merge>'].filter(Boolean).join('\n');
}

function buildNamedRowsArea(name: string, beginRow: number, endRow: number): string {
  return [
    '\t<namedItem xsi:type="NamedItemCells">',
    `\t\t<name>${escapeXmlText(name)}</name>`,
    '\t\t<area>',
    '\t\t\t<type>Rows</type>',
    `\t\t\t<beginRow>${String(beginRow)}</beginRow>`,
    `\t\t\t<endRow>${String(endRow)}</endRow>`,
    '\t\t\t<beginColumn>-1</beginColumn>',
    '\t\t\t<endColumn>-1</endColumn>',
    '\t\t</area>',
    '\t</namedItem>',
  ].join('\n');
}

interface ParsedRow {
  readonly index: number;
  readonly cells: readonly ParsedCell[];
}

interface ParsedCell {
  readonly column: number;
  readonly format: number;
  readonly fillType: string;
  readonly parameter: string;
  readonly detail: string;
  readonly text: string;
}

function parseRows(xml: string): ParsedRow[] {
  const rows: ParsedRow[] = [];
  for (const rowBlock of matchBlocks(xml, 'rowsItem')) {
    const index = readInt(rowBlock, 'index');
    const cells: ParsedCell[] = [];
    for (const cellBlock of matchBlocks(extractBlock(rowBlock, 'row') ?? '', 'c')) {
      const inner = extractBlock(cellBlock, 'c') ?? '';
      cells.push({
        column: readInt(cellBlock, 'i'),
        format: readInt(inner, 'f'),
        fillType: inferFillType(inner),
        parameter: readText(inner, 'parameter'),
        detail: readText(inner, 'detailParameter'),
        text: readLocalizedContent(inner),
      });
    }
    rows.push({ index, cells });
  }
  return rows;
}

function parseNamedAreas(xml: string): { name: string; type: string; beginRow: number; endRow: number; beginCol: number; endCol: number }[] {
  const areas = [];
  for (const block of matchBlocks(xml, 'namedItem')) {
    if (!block.includes('NamedItemCells')) {
      continue;
    }
    const area = extractBlock(block, 'area') ?? '';
    areas.push({
      name: readText(block, 'name'),
      type: readText(area, 'type'),
      beginRow: readInt(area, 'beginRow'),
      endRow: readInt(area, 'endRow'),
      beginCol: readInt(area, 'beginColumn'),
      endCol: readInt(area, 'endColumn'),
    });
  }
  return areas;
}

function enrichArea(area: ReturnType<typeof parseNamedAreas>[number], rowMap: Map<number, ParsedRow>, height: number, withText: boolean): MxlAreaInfo {
  const beginRow = area.beginRow === -1 ? 0 : area.beginRow;
  const endRow = area.endRow === -1 ? height - 1 : area.endRow;
  const params: string[] = [];
  const details: string[] = [];
  const texts: string[] = [];
  const templates: string[] = [];
  for (let rowIndex = beginRow; rowIndex <= endRow; rowIndex += 1) {
    const row = rowMap.get(rowIndex);
    if (!row) {
      continue;
    }
    for (const cell of row.cells) {
      params.push(...cellParams(cell));
      if (cell.parameter && cell.detail) {
        details.push(`${cell.parameter}->${cell.detail}`);
      }
      if (withText && cell.text && cell.fillType === 'Text') {
        texts.push(cell.text);
      }
      if (withText && cell.text && cell.fillType === 'Template') {
        templates.push(cell.text);
      }
    }
  }
  return { ...area, beginRow, endRow, params, details, texts, templates };
}

function cellParams(cell: ParsedCell): string[] {
  const params = cell.parameter ? [cell.parameter] : [];
  if (cell.fillType === 'Template') {
    for (const match of cell.text.matchAll(/\[([^\]]+)]/g)) {
      if (!/^\d+$/.test(match[1])) {
        params.push(`${match[1]} [tpl]`);
      }
    }
  }
  return params;
}

function buildInfoLines(info: Omit<MxlInfoResult, 'lines'>, maxParams: number, withText: boolean): string[] {
  const lines = [`=== ${info.name} ===`, `  Rows: ${String(info.rows)}, Columns: ${String(info.columns)}`, '', '--- Named areas ---'];
  for (const area of info.areas) {
    lines.push(`  ${area.name.padEnd(25)} ${area.type.padEnd(12)} rows ${String(area.beginRow)}-${String(area.endRow)}  (${String(area.params.length)} params)`);
  }
  if (info.areas.some((area) => area.params.length > 0) || info.outsideParams.length > 0) {
    lines.push('', '--- Parameters by area ---');
    for (const area of info.areas.filter((item) => item.params.length > 0)) {
      lines.push(`  ${area.name}: ${truncate(area.params, maxParams)}`);
      if (area.details.length > 0) {
        lines.push(`    detail: ${truncate(area.details, maxParams)}`);
      }
    }
    if (info.outsideParams.length > 0) {
      lines.push(`  (outside areas): ${truncate(info.outsideParams, maxParams)}`);
    }
  }
  if (withText) {
    lines.push('', '--- Text content ---');
    for (const area of info.areas.filter((item) => item.texts.length > 0 || item.templates.length > 0)) {
      lines.push(`  ${area.name}:`);
      if (area.texts.length > 0) {
        lines.push(`    Text: ${truncate(area.texts.map((text) => `"${text}"`), maxParams)}`);
      }
      if (area.templates.length > 0) {
        lines.push(`    Templates: ${truncate(area.templates.map((text) => `"${text}"`), maxParams)}`);
      }
    }
  }
  lines.push('', '--- Stats ---', `  Merges: ${String(info.mergeCount)}`, `  Drawings: ${String(info.drawingCount)}`);
  return lines;
}

function buildValidationResult(templatePath: string, issues: readonly MxlValidationIssue[], maxErrors: number): MxlValidationResult {
  const limited = limitErrors(issues, maxErrors);
  const errors = limited.filter((issue) => issue.severity === 'error').length;
  const warnings = limited.filter((issue) => issue.severity === 'warning').length;
  const lines = [`=== Validation: Template.${getTemplateDisplayName(templatePath)} ===`, ''];
  for (const issue of limited) {
    const prefix = issue.severity === 'error' ? '[ERROR]' : issue.severity === 'warning' ? '[WARN] ' : '[OK]   ';
    lines.push(`${prefix} ${issue.message}`);
  }
  lines.push('', `=== Result: ${String(errors)} errors, ${String(warnings)} warnings (${String(limited.length)} checks) ===`);
  return { templatePath, errors, warnings, checks: limited.length, issues: limited, lines };
}

function parseColumnSpec(spec: string): number[] {
  return spec.split(',').flatMap((part) => {
    const trimmed = part.trim();
    const range = /^(\d+)-(\d+)$/.exec(trimmed);
    if (!range) {
      return [Number(trimmed)];
    }
    const values = [];
    for (let value = Number(range[1]); value <= Number(range[2]); value += 1) {
      values.push(value);
    }
    return values;
  }).filter((value) => Number.isFinite(value) && value > 0);
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

function readInt(xml: string, tagName: string): number {
  return Number(readText(xml, tagName) || 0);
}

function readLocalizedContent(xml: string): string {
  return unescapeXml(/<v8:content>([\s\S]*?)<\/v8:content>/.exec(xml)?.[1]?.trim() ?? '');
}

function inferFillType(cellXml: string): string {
  if (cellXml.includes('<parameter>')) {
    return 'Parameter';
  }
  const text = readLocalizedContent(cellXml);
  if (text && /\[[^\]]+]/.test(text)) {
    return 'Template';
  }
  return text ? 'Text' : '';
}

function countTags(xml: string, tagName: string): number {
  return (xml.match(new RegExp(`<${tagName}\\b`, 'g')) ?? []).length;
}

function parseNumericTags(xml: string, tagName: string): number[] {
  return [...xml.matchAll(new RegExp(`<${tagName}>(\\d+)<\\/${tagName}>`, 'g'))].map((match) => Number(match[1]));
}

function truncate(items: readonly string[], max: number): string {
  if (items.length <= max) {
    return items.join(', ');
  }
  return `${items.slice(0, max).join(', ')}, ... (+${String(items.length - max)})`;
}

function paginate(lines: readonly string[], limit?: number, offset?: number): string[] {
  const start = offset ?? 0;
  const sliced = lines.slice(start, limit && limit > 0 ? start + limit : undefined);
  if (limit && limit > 0 && start + limit < lines.length) {
    return [...sliced, '', `[ОБРЕЗАНО] Показано ${String(sliced.length)} из ${String(lines.length)} строк.`];
  }
  return sliced;
}

function limitErrors(issues: readonly MxlValidationIssue[], maxErrors: number): MxlValidationIssue[] {
  const result: MxlValidationIssue[] = [];
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

function getTemplateDisplayName(templatePath: string): string {
  return path.basename(path.dirname(path.dirname(templatePath))) || path.basename(templatePath);
}

function unescapeXml(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
}
