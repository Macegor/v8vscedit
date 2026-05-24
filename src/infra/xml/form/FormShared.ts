import * as fs from 'fs';
import * as path from 'path';
import type { FormPurpose } from './types';

export const MD_XMLNS = 'xmlns="http://v8.1c.ru/8.3/MDClasses" xmlns:app="http://v8.1c.ru/8.2/managed-application/core" xmlns:cfg="http://v8.1c.ru/8.1/data/enterprise/current-config" xmlns:cmi="http://v8.1c.ru/8.2/managed-application/cmi" xmlns:ent="http://v8.1c.ru/8.1/data/enterprise" xmlns:lf="http://v8.1c.ru/8.2/managed-application/logform" xmlns:style="http://v8.1c.ru/8.1/data/ui/style" xmlns:sys="http://v8.1c.ru/8.1/data/ui/fonts/system" xmlns:v8="http://v8.1c.ru/8.1/data/core" xmlns:v8ui="http://v8.1c.ru/8.1/data/ui" xmlns:web="http://v8.1c.ru/8.1/data/ui/colors/web" xmlns:win="http://v8.1c.ru/8.1/data/ui/colors/windows" xmlns:xen="http://v8.1c.ru/8.3/xcf/enums" xmlns:xpr="http://v8.1c.ru/8.3/xcf/predef" xmlns:xr="http://v8.1c.ru/8.3/xcf/readable" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"';
export const FORM_XMLNS = 'xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:app="http://v8.1c.ru/8.2/managed-application/core" xmlns:cfg="http://v8.1c.ru/8.1/data/enterprise/current-config" xmlns:dcscor="http://v8.1c.ru/8.1/data-composition-system/core" xmlns:dcsset="http://v8.1c.ru/8.1/data-composition-system/settings" xmlns:ent="http://v8.1c.ru/8.1/data/enterprise" xmlns:lf="http://v8.1c.ru/8.2/managed-application/logform" xmlns:style="http://v8.1c.ru/8.1/data/ui/style" xmlns:sys="http://v8.1c.ru/8.1/data/ui/fonts/system" xmlns:v8="http://v8.1c.ru/8.1/data/core" xmlns:v8ui="http://v8.1c.ru/8.1/data/ui" xmlns:web="http://v8.1c.ru/8.1/data/ui/colors/web" xmlns:win="http://v8.1c.ru/8.1/data/ui/colors/windows" xmlns:xr="http://v8.1c.ru/8.3/xcf/readable" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"';
export const FORM_NS = 'http://v8.1c.ru/8.3/xcf/logform';
export const GUID_PATTERN = /^[0-9a-fA-F-]{36}$/;
export const IDENT_PATTERN = /^[A-Za-zА-ЯЁа-яё_][A-Za-z0-9А-ЯЁа-яё_]*$/;
export const VALID_CALL_TYPES = new Set(['Before', 'After', 'Override']);

export interface IdAllocator {
  nextElement(): number;
  nextAttribute(): number;
  nextCommand(): number;
}

export function createIdAllocator(xml: string): IdAllocator {
  const max = (re: RegExp, min: number) => {
    let result = min;
    let match: RegExpExecArray | null;
    while ((match = re.exec(xml)) !== null) {
      const value = Number(match[1]);
      if (Number.isFinite(value) && value > result) {
        result = value;
      }
    }
    return result;
  };
  let elementId = max(/\b(?:InputField|CheckBoxField|LabelDecoration|LabelField|Table|UsualGroup|Pages|Page|Button|PictureDecoration|PictureField|CalendarField|CommandBar|Popup|ContextMenu|ExtendedTooltip|AutoCommandBar|SearchStringAddition|ViewStatusAddition|SearchControlAddition)\b[^>]*\bid="(\d+)"/g, 0);
  let attrId = max(/<Attribute\b[^>]*\bid="(\d+)"/g, 0);
  let commandId = max(/<Command\b[^>]*\bid="(\d+)"/g, 0);
  const extension = /<BaseForm\b/.test(xml);
  if (extension) {
    elementId = Math.max(elementId, 999999);
    attrId = Math.max(attrId, 999999);
    commandId = Math.max(commandId, 999999);
  }
  return {
    nextElement: () => ++elementId,
    nextAttribute: () => ++attrId,
    nextCommand: () => ++commandId,
  };
}

export function resolveObjectLocation(inputPath: string): { xmlPath: string; objectDir: string; kind: string; name: string } {
  const xmlPath = resolveObjectXmlPath(inputPath);
  if (!xmlPath) {
    throw new Error(`XML объекта не найден: ${inputPath}`);
  }
  const xml = fs.readFileSync(xmlPath, 'utf-8');
  const rootMatch = /<MetaDataObject\b[^>]*>\s*<([A-Za-z][A-Za-z0-9]*)\b/.exec(xml);
  const kind = rootMatch?.[1];
  const name = extractTag(extractBlock(xml, 'Properties') ?? xml, 'Name') ?? path.basename(xmlPath, '.xml');
  if (!kind) {
    throw new Error(`Не удалось определить тип объекта: ${xmlPath}`);
  }
  return {
    xmlPath,
    objectDir: path.join(path.dirname(xmlPath), path.basename(xmlPath, '.xml')),
    kind,
    name,
  };
}

export function resolveObjectXmlPath(inputPath: string): string | null {
  const resolved = path.resolve(inputPath);
  if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
    const dirName = path.basename(resolved);
    const inside = path.join(resolved, `${dirName}.xml`);
    const sibling = path.join(path.dirname(resolved), `${dirName}.xml`);
    if (fs.existsSync(inside)) {
      return inside;
    }
    if (fs.existsSync(sibling)) {
      return sibling;
    }
    return null;
  }
  return fs.existsSync(resolved) ? resolved : null;
}

export function resolveFormXmlPath(inputPath: string): string {
  const resolved = path.resolve(inputPath);
  if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
    return path.join(resolved, 'Ext', 'Form.xml');
  }
  if (fs.existsSync(resolved)) {
    if (path.basename(resolved) === 'Form.xml') {
      return resolved;
    }
    if (resolved.endsWith('.xml')) {
      const formName = path.basename(resolved, '.xml');
      const body = path.join(path.dirname(resolved), formName, 'Ext', 'Form.xml');
      if (fs.existsSync(body)) {
        return body;
      }
    }
  }
  if (path.basename(resolved) === 'Form.xml') {
    const candidate = path.join(path.dirname(resolved), 'Ext', 'Form.xml');
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  if (!fs.existsSync(resolved)) {
    throw new Error(`Form.xml не найден: ${inputPath}`);
  }
  return resolved;
}

export function resolveFormXmlPathForWrite(inputPath: string): string {
  const resolved = path.resolve(inputPath);
  if (path.basename(resolved) === 'Form.xml') {
    return resolved;
  }
  return path.join(resolved, 'Ext', 'Form.xml');
}

/**
 * Принимает большой набор синонимов назначения формы (английских + русских).
 *
 * Каноничные значения: Object, List, Choice, Record.
 * Также принимает: Item/ItemForm/Object/ObjectForm/Element/Folder/FolderForm/Group/GroupForm
 *                  → Object; List/ListForm → List; Choice/ChoiceForm → Choice;
 *                  Record/RecordForm → Record.
 * Русские: ФормаЭлемента/ФормаОбъекта/ФормаДокумента/ФормаГруппы/ФормаСчёта → Object;
 *          ФормаСписка → List; ФормаВыбора → Choice; ФормаЗаписи → Record.
 */
export function normalizePurpose(value: string): FormPurpose {
  const raw = value.trim();
  const lower = raw.toLowerCase();
  const synonyms: Record<string, FormPurpose> = {
    // English canonical + variants
    object: 'Object', objectform: 'Object', item: 'Object', itemform: 'Object',
    element: 'Object', elementform: 'Object', folder: 'Object', folderform: 'Object',
    group: 'Object', groupform: 'Object', document: 'Object', documentform: 'Object',
    account: 'Object', accountform: 'Object', node: 'Object', nodeform: 'Object',
    list: 'List', listform: 'List',
    choice: 'Choice', choiceform: 'Choice', selection: 'Choice', selectionform: 'Choice',
    record: 'Record', recordform: 'Record',
    // Russian (с буквой ё и без)
    формаэлемента: 'Object', формаобъекта: 'Object', формадокумента: 'Object',
    формагруппы: 'Object', формасчета: 'Object', формасчёта: 'Object',
    формаузла: 'Object', формазадачи: 'Object',
    формасписка: 'List', формавыбора: 'Choice', формазаписи: 'Record',
  };
  const collapsed = lower.replace(/\s+/g, '');
  if (collapsed in synonyms) {
    return synonyms[collapsed];
  }
  throw new Error(
    `Недопустимое назначение формы: "${value}". Используйте Object|List|Choice|Record ` +
    `или их синонимы (Item, ItemForm, Element, ObjectForm, Folder, ListForm, ChoiceForm, RecordForm, ` +
    `ФормаЭлемента, ФормаСписка, ФормаВыбора, ФормаЗаписи).`
  );
}

export function validatePurpose(objectKind: string, purpose: FormPurpose): void {
  const processorLike = ['DataProcessor', 'Report', 'ExternalDataProcessor', 'ExternalReport'];
  if (purpose === 'Choice' && (processorLike.includes(objectKind) || objectKind === 'InformationRegister')) {
    throw new Error(`Purpose=Choice недопустим для ${objectKind}`);
  }
  if (purpose === 'Record' && objectKind !== 'InformationRegister') {
    throw new Error('Purpose=Record допустим только для InformationRegister');
  }
}

export function isProcessorLike(kind: string): boolean {
  return ['DataProcessor', 'Report', 'ExternalDataProcessor', 'ExternalReport'].includes(kind);
}

export function isExternalKind(kind: string): boolean {
  return kind === 'ExternalDataProcessor' || kind === 'ExternalReport';
}

export function detectFormatVersion(startPath: string): string {
  let current = fs.existsSync(startPath) && fs.statSync(startPath).isFile() ? path.dirname(startPath) : startPath;
  while (current && current !== path.dirname(current)) {
    const configXml = path.join(current, 'Configuration.xml');
    if (fs.existsSync(configXml)) {
      const head = fs.readFileSync(configXml, 'utf-8').slice(0, 2000);
      return /<MetaDataObject\b[^>]*version="([^"]+)"/.exec(head)?.[1] ?? '2.17';
    }
    current = path.dirname(current);
  }
  return '2.17';
}

export function isEmptyTagValue(xml: string, tag: string): boolean {
  const value = extractTag(xml, tag);
  return value === undefined || value === '';
}

export function setTagValue(xml: string, tag: string, value: string, createIfMissing = false): string {
  const escaped = escapeXml(value);
  const selfClosing = new RegExp(`<${tag}\\s*\\/>`);
  if (selfClosing.test(xml)) {
    return xml.replace(selfClosing, value ? `<${tag}>${escaped}</${tag}>` : `<${tag}/>`);
  }
  const re = new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`);
  if (re.test(xml)) {
    return xml.replace(re, value ? `<${tag}>${escaped}</${tag}>` : `<${tag}/>`);
  }
  if (createIfMissing) {
    return xml.replace(/<\/Properties>/, `\t\t\t<${tag}>${escaped}</${tag}>\n\t\t</Properties>`);
  }
  return xml;
}

export function extractBlock(xml: string, tagName: string): string | null {
  const re = new RegExp(`<${escapeRegExp(tagName)}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapeRegExp(tagName)}>`);
  return re.exec(xml)?.[1] ?? null;
}

export function extractTag(xml: string, tagName: string): string | undefined {
  const re = new RegExp(`<${escapeRegExp(tagName)}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapeRegExp(tagName)}>`);
  return re.exec(xml)?.[1]?.trim();
}

export function extractLocalizedContent(xml: string): string | undefined {
  return /<v8:content>([\s\S]*?)<\/v8:content>/.exec(xml)?.[1]?.trim();
}

export function attr(attrs: string, name: string): string | undefined {
  return new RegExp(`${escapeRegExp(name)}="([^"]*)"`).exec(attrs)?.[1];
}

export function validateName(value: string, label: string): void {
  if (!IDENT_PATTERN.test(value)) {
    throw new Error(`${label} должно быть идентификатором 1С.`);
  }
}

export function writeNewTextFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `﻿${content}`, 'utf-8');
}

export function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildLocalizedTag(indent: string, tag: string, text: string): string {
  return [
    `${indent}<${tag}>`,
    `${indent}\t<v8:item>`,
    `${indent}\t\t<v8:lang>ru</v8:lang>`,
    `${indent}\t\t<v8:content>${escapeXml(text)}</v8:content>`,
    `${indent}\t</v8:item>`,
    `${indent}</${tag}>`,
  ].join('\n');
}

export function appendBoolean(lines: string[], indent: string, tag: string, value: boolean | undefined): void {
  if (value !== undefined) {
    lines.push(`${indent}<${tag}>${String(value)}</${tag}>`);
  }
}

export function appendScalar(lines: string[], indent: string, tag: string, value: unknown): void {
  if (value !== undefined) {
    lines.push(`${indent}<${tag}>${escapeXml(String(value))}</${tag}>`);
  }
}
