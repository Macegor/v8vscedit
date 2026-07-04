import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  escapeRegExp,
  escapeXmlAttribute as escapeXml,
  extractMetaDataObjectVersion,
} from '../XmlUtils';

export const XMLNS = 'xmlns="http://v8.1c.ru/8.3/MDClasses" xmlns:app="http://v8.1c.ru/8.2/managed-application/core" xmlns:cfg="http://v8.1c.ru/8.1/data/enterprise/current-config" xmlns:cmi="http://v8.1c.ru/8.2/managed-application/cmi" xmlns:ent="http://v8.1c.ru/8.1/data/enterprise" xmlns:lf="http://v8.1c.ru/8.2/managed-application/logform" xmlns:style="http://v8.1c.ru/8.1/data/ui/style" xmlns:sys="http://v8.1c.ru/8.1/data/ui/fonts/system" xmlns:v8="http://v8.1c.ru/8.1/data/core" xmlns:v8ui="http://v8.1c.ru/8.1/data/ui" xmlns:web="http://v8.1c.ru/8.1/data/ui/colors/web" xmlns:win="http://v8.1c.ru/8.1/data/ui/colors/windows" xmlns:xen="http://v8.1c.ru/8.3/xcf/enums" xmlns:xpr="http://v8.1c.ru/8.3/xcf/predef" xmlns:xr="http://v8.1c.ru/8.3/xcf/readable" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"';
export const EPF_CLASS_ID = 'c3831ec8-d8d5-4f93-8a22-f9bfae07327f';
export const ERF_CLASS_ID = 'e41aff26-25cf-4bb6-b6c1-3f478a75f374';
export const GUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
export const IDENT_PATTERN = /^[A-Za-zА-ЯЁа-яё_][A-Za-z0-9А-ЯЁа-яё_]*$/;
export const CHILD_ORDER: Record<string, number> = { Attribute: 0, TabularSection: 1, Form: 2, Template: 3, Command: 4 };
export const ALLOWED_CHILD_TYPES = new Set(Object.keys(CHILD_ORDER));

export function resolveExternalObjectLocation(inputPath: string): { objectDir: string; xmlPath?: string; name: string } {
  const resolved = path.resolve(inputPath);
  if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
    return { objectDir: resolved, xmlPath: resolveExternalObjectXmlPath(resolved) ?? undefined, name: path.basename(resolved) };
  }
  const xmlPath = resolveExternalObjectXmlPath(resolved);
  if (!xmlPath) {
    return { objectDir: resolved, name: path.basename(resolved) };
  }
  return { objectDir: path.join(path.dirname(xmlPath), path.basename(xmlPath, '.xml')), xmlPath, name: path.basename(xmlPath, '.xml') };
}

export function resolveExternalObjectXmlPath(inputPath: string): string | null {
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
    const xmlFile = fs.readdirSync(resolved).find((file) => file.toLowerCase().endsWith('.xml'));
    return xmlFile ? path.join(resolved, xmlFile) : null;
  }
  if (fs.existsSync(resolved)) {
    return resolved;
  }
  const parent = path.dirname(resolved);
  const base = path.basename(resolved, '.xml');
  const sibling = path.join(path.dirname(parent), `${base}.xml`);
  return fs.existsSync(sibling) ? sibling : null;
}

export function detectFormatVersion(startPath: string): string {
  let current = fs.existsSync(startPath) && fs.statSync(startPath).isFile() ? path.dirname(startPath) : startPath;
  while (current && current !== path.dirname(current)) {
    const configXml = path.join(current, 'Configuration.xml');
    if (fs.existsSync(configXml)) {
      const head = fs.readFileSync(configXml, 'utf-8').slice(0, 2000);
      return extractMetaDataObjectVersion(head) ?? '2.17';
    }
    current = path.dirname(current);
  }
  return '2.17';
}

export function extractBlock(xml: string, tagName: string): string | null {
  const re = new RegExp(`<${escapeRegExp(tagName)}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapeRegExp(tagName)}>`);
  return re.exec(xml)?.[1] ?? null;
}

export function extractTag(xml: string, tagName: string): string | undefined {
  const re = new RegExp(`<${escapeRegExp(tagName)}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapeRegExp(tagName)}>`);
  const value = re.exec(xml)?.[1]?.trim();
  return value !== undefined && value.length > 0 ? value : undefined;
}

export function validateName(value: string): void {
  if (!IDENT_PATTERN.test(value)) {
    throw new Error('Имя должно начинаться с буквы или подчёркивания и содержать только буквы, цифры и подчёркивание.');
  }
}

export function validateLang(value: string): void {
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(value)) {
    throw new Error('Код языка справки должен содержать только латиницу, цифры, дефис и подчёркивание.');
  }
}

export function validateBspIdentifier(value: string): void {
  if (!/^[A-Za-zА-ЯЁа-яё_][A-Za-z0-9А-ЯЁа-яё_]*$/.test(value)) {
    throw new Error('Идентификатор команды БСП должен быть идентификатором 1С.');
  }
}

export function writeNewTextFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `\ufeff${content}`, 'utf-8');
}

export function newUuid(): string {
  return crypto.randomUUID();
}

export function escapeHtml(value: string): string {
  return escapeXml(value);
}

export function escapeBslString(value: string): string {
  return value.replace(/"/g, '""').replace(/'/g, "''");
}
