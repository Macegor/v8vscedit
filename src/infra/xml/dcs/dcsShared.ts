import * as fs from 'fs';
import * as path from 'path';
import { escapeXmlText, unescapeXml } from '../XmlUtils';

export function resolveTemplateContentPath(inputPath: string): string {
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
    throw new Error(`Template.xml СКД не найден: ${target}`);
  }
  return target;
}

export function resolveType(type: string): string {
  const aliases: Record<string, string> = { строка: 'string', число: 'decimal', булево: 'boolean', дата: 'date', bool: 'boolean', int: 'decimal', number: 'decimal' };
  return aliases[type.toLowerCase()] ?? type;
}

export function emitValueType(type: string, indent: string): string {
  const normalized = resolveType(type);
  if (/^string(?:\((\d+)\))?$/.test(normalized)) {
    const length = /^string\((\d+)\)$/.exec(normalized)?.[1] ?? '0';
    return [`${indent}<v8:Type>xs:string</v8:Type>`, `${indent}<v8:StringQualifiers><v8:Length>${length}</v8:Length><v8:AllowedLength>Variable</v8:AllowedLength></v8:StringQualifiers>`].join('\n');
  }
  const decimal = /^decimal\((\d+),(\d+)\)$/.exec(normalized);
  if (decimal) {
    return [`${indent}<v8:Type>xs:decimal</v8:Type>`, `${indent}<v8:NumberQualifiers><v8:Digits>${decimal[1]}</v8:Digits><v8:FractionDigits>${decimal[2]}</v8:FractionDigits><v8:AllowedSign>Any</v8:AllowedSign></v8:NumberQualifiers>`].join('\n');
  }
  if (normalized === 'decimal') {
    return `${indent}<v8:Type>xs:decimal</v8:Type>`;
  }
  if (normalized === 'boolean') {
    return `${indent}<v8:Type>xs:boolean</v8:Type>`;
  }
  if (normalized === 'date' || normalized === 'dateTime') {
    return `${indent}<v8:Type>xs:dateTime</v8:Type>`;
  }
  if (normalized === 'StandardPeriod') {
    return `${indent}<v8:Type>v8:StandardPeriod</v8:Type>`;
  }
  return normalized.includes('.')
    ? `${indent}<v8:Type xmlns:d5p1="http://v8.1c.ru/8.1/data/enterprise/current-config">d5p1:${escapeXmlText(normalized)}</v8:Type>`
    : `${indent}<v8:Type>${escapeXmlText(normalized)}</v8:Type>`;
}

export function buildUseRestriction(restrict: readonly string[], indent: string): string {
  const map: Record<string, string> = { noField: 'field', noFilter: 'condition', noCondition: 'condition', noGroup: 'group', noOrder: 'order' };
  return [`${indent}<useRestriction>`, ...restrict.map((item) => map[item] ? `${indent}\t<${map[item]}>true</${map[item]}>` : '').filter(Boolean), `${indent}</useRestriction>`].join('\n');
}

export function buildMlText(tagName: string, value: string, indent: string): string {
  return [`${indent}<${tagName} xsi:type="v8:LocalStringType">`, `${indent}\t<v8:item><v8:lang>ru</v8:lang><v8:content>${escapeXmlText(value)}</v8:content></v8:item>`, `${indent}</${tagName}>`].join('\n');
}

export function matchBlocks(xml: string, tagName: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tagName}\\b[^>]*>[\\s\\S]*?<\\/${tagName}>`, 'g'))].map((match) => match[0]);
}

export function extractBlock(xml: string, tagName: string): string | null {
  return new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`).exec(xml)?.[1] ?? null;
}

export function readText(xml: string, tagName: string): string {
  return unescapeXml(extractBlock(xml, tagName)?.trim() ?? '');
}

export function readMlText(xml: string, tagName: string): string {
  const block = extractBlock(xml, tagName) ?? '';
  return unescapeXml(/<v8:content>([\s\S]*?)<\/v8:content>/.exec(block)?.[1]?.trim() ?? '');
}

export function readValueType(xml: string): string {
  const raw = /<v8:Type(?:\s[^>]*)?>([\s\S]*?)<\/v8:Type>/.exec(xml)?.[1]?.trim() ?? '';
  return raw.replace(/^[A-Za-z0-9]+:/, '');
}

export function readSectionTexts(xml: string, sectionTag: string, childTag: string): string[] {
  const section = extractBlock(xml, sectionTag) ?? '';
  return matchBlocks(section, childTag).map((block) => readText(block, childTag)).filter(Boolean);
}

export function countTags(xml: string, tagName: string): number {
  return (xml.match(new RegExp(`<${tagName}\\b`, 'g')) ?? []).length;
}

export function replaceFirstMatchingBlock(xml: string, tagName: string, predicate: (block: string) => boolean, editor: (block: string) => string): string {
  for (const block of matchBlocks(xml, tagName)) {
    if (predicate(block)) {
      const editedBlock = editor(block);
      return xml.replace(block, () => editedBlock);
    }
  }
  return xml;
}

export function insertBeforeClose(xml: string, tagName: string, fragment: string): string {
  return xml.replace(new RegExp(`\\s*</${tagName}>`), () => `\n${fragment}\n</${tagName}>`);
}

export function replaceOrInsert(xml: string, tagName: string, inner: string, parentTag: string): string {
  const re = new RegExp(`<${tagName}>[\\s\\S]*?<\\/${tagName}>`);
  if (re.test(xml)) {
    return xml.replace(re, () => `<${tagName}>${inner}</${tagName}>`);
  }
  return insertBeforeClose(xml, parentTag, `<${tagName}>${inner}</${tagName}>`);
}

export function appendIntoSection(xml: string, tagName: string, fragment: string): string {
  const re = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`);
  if (re.test(xml)) {
    return xml.replace(new RegExp(`</${tagName}>`), () => `${fragment}</${tagName}>`);
  }
  return insertBeforeClose(xml, 'settings', `<${tagName}>${fragment}</${tagName}>`);
}

export function removeElementByChildText(xml: string, tagName: string, childTag: string, value: string): string {
  for (const block of matchBlocks(xml, tagName)) {
    if (readText(block, childTag) === value) {
      return xml.replace(block, '');
    }
  }
  return xml;
}

export function editFirstDataSet(xml: string, dataSetName: string | undefined, editor: (block: string) => string): string {
  return replaceFirstMatchingBlock(xml, 'dataSet', (block) => !dataSetName || readText(block, 'name') === dataSetName, editor);
}

export function editFirstVariantSettings(xml: string, variantName: string | undefined, editor: (block: string) => string): string {
  return replaceFirstMatchingBlock(xml, 'settingsVariant', (block) => !variantName || readText(block, 'name') === variantName, (variantBlock) => {
    const settings = extractBlock(variantBlock, 'settings') ?? '';
    const editedSettings = editor(settings);
    return variantBlock.replace(settings, () => editedSettings);
  });
}
