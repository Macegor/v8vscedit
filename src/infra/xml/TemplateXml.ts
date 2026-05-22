import * as fs from 'fs';
import * as path from 'path';
import type { TemplateType } from './MetadataXmlCreator';

const TEMPLATE_TYPES: ReadonlySet<string> = new Set<TemplateType>([
  'SpreadsheetDocument',
  'TextDocument',
  'HTMLDocument',
  'BinaryData',
  'DataCompositionSchema',
  'DataCompositionAppearanceTemplate',
  'GraphicalSchema',
  'AddIn',
]);

/** Читает тип макета из XML-описания макета. */
export function readTemplateTypeFromXml(xmlPath: string): TemplateType | null {
  if (!fs.existsSync(xmlPath)) {
    return null;
  }

  const xml = fs.readFileSync(xmlPath, 'utf-8');
  const value = /<TemplateType>\s*([^<]+?)\s*<\/TemplateType>/.exec(xml)?.[1]?.trim();
  return value && TEMPLATE_TYPES.has(value) ? value as TemplateType : null;
}

/** Находит реальный файл содержимого текстового макета без его создания. */
export function resolveTextTemplateContentPath(templateXmlPath: string, templateName?: string): string | null {
  return getTextTemplateContentCandidates(templateXmlPath, templateName)
    .find((candidate) => fs.existsSync(candidate)) ?? null;
}

/** Возвращает существующий `Template.txt` или создаёт его в штатном каталоге макета. */
export function ensureTextTemplateContentPath(templateXmlPath: string, templateName?: string): string {
  const existing = resolveTextTemplateContentPath(templateXmlPath, templateName);
  if (existing) {
    return existing;
  }

  const contentPath = getDefaultTextTemplateContentPath(templateXmlPath, templateName);
  fs.mkdirSync(path.dirname(contentPath), { recursive: true });
  fs.writeFileSync(contentPath, '', 'utf-8');
  return contentPath;
}

function getTextTemplateContentCandidates(templateXmlPath: string, templateName?: string): string[] {
  const templateDir = path.dirname(templateXmlPath);
  const baseName = path.basename(templateXmlPath, '.xml');
  const name = templateName && templateName.length > 0 ? templateName : baseName;
  return [
    path.join(templateDir, name, 'Ext', 'Template.txt'),
    path.join(templateDir, 'Ext', 'Template.txt'),
  ];
}

function getDefaultTextTemplateContentPath(templateXmlPath: string, templateName?: string): string {
  const candidates = getTextTemplateContentCandidates(templateXmlPath, templateName);
  const templateDir = path.dirname(templateXmlPath);
  const baseName = path.basename(templateXmlPath, '.xml');
  const name = templateName && templateName.length > 0 ? templateName : baseName;
  return path.basename(templateDir) === name && candidates[1] ? candidates[1] : candidates[0];
}
