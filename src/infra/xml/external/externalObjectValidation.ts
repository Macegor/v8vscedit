import * as fs from 'fs';
import * as path from 'path';
import { isKnownFormatVersion } from '../format/formatRegistry';
import {
  ALLOWED_CHILD_TYPES,
  CHILD_ORDER,
  EPF_CLASS_ID,
  ERF_CLASS_ID,
  extractBlock,
  extractTag,
  GUID_PATTERN,
  IDENT_PATTERN,
  resolveExternalObjectXmlPath,
} from './externalObjectShared';
import { extractMainChildObjectsInnerXml } from '../XmlUtils';

export interface ExternalObjectValidationOptions {
  readonly objectPath: string;
  readonly detailed?: boolean;
  readonly maxErrors?: number;
}

export interface ExternalObjectValidationResult {
  readonly objectPath: string;
  readonly type: 'ExternalDataProcessor' | 'ExternalReport' | 'unknown';
  readonly name: string;
  readonly errors: number;
  readonly warnings: number;
  readonly checks: number;
  readonly lines: readonly string[];
}

export function runValidation(options: ExternalObjectValidationOptions): ExternalObjectValidationResult {
  const objectPath = resolveExternalObjectXmlPath(options.objectPath);
  const maxErrors = options.maxErrors ?? 30;
  const detailed = options.detailed === true;
  const lines: string[] = [];
  let errors = 0;
  let warnings = 0;
  let ok = 0;
  let type: ExternalObjectValidationResult['type'] = 'unknown';
  let name = '(unknown)';

  const reportOk = (message: string) => {
    ok++;
    if (detailed) {
      lines.push(`[OK]    ${message}`);
    }
  };
  const reportWarn = (message: string) => {
    warnings++;
    lines.push(`[WARN]  ${message}`);
  };
  const reportError = (message: string) => {
    errors++;
    lines.push(`[ERROR] ${message}`);
  };
  const canContinue = () => errors < maxErrors;

  if (!objectPath || !fs.existsSync(objectPath)) {
    return {
      objectPath: options.objectPath,
      type,
      name,
      errors: 1,
      warnings: 0,
      checks: 1,
      lines: [`[ERROR] Файл не найден: ${options.objectPath}`],
    };
  }

  let xml: string;
  try {
    xml = fs.readFileSync(objectPath, 'utf-8');
  } catch (error) {
    return {
      objectPath,
      type,
      name,
      errors: 1,
      warnings: 0,
      checks: 1,
      lines: [`[ERROR] XML не прочитан: ${String(error)}`],
    };
  }

  const rootMatch = /<MetaDataObject\b([^>]*)>\s*<(ExternalDataProcessor|ExternalReport)\b([^>]*)>/m.exec(xml);
  if (!rootMatch) {
    reportError('1. Корень должен иметь вид MetaDataObject/ExternalDataProcessor или MetaDataObject/ExternalReport.');
    return finalizeValidation(objectPath, type, name, errors, warnings, ok, lines);
  }

  type = rootMatch[2] as 'ExternalDataProcessor' | 'ExternalReport';
  const objectOpenAttrs = rootMatch[3];
  const version = /version="([^"]+)"/.exec(rootMatch[1])?.[1] ?? '';
  const uuid = /uuid="([^"]+)"/.exec(objectOpenAttrs)?.[1] ?? '';
  name = extractTag(xml, 'Name') ?? '(unknown)';
  lines.unshift(`=== Validation: ${type === 'ExternalDataProcessor' ? 'EPF' : 'ERF'}.${name} ===`);

  if (!uuid || !GUID_PATTERN.test(uuid)) {
    reportError(`1. Некорректный uuid у <${type}>.`);
  } else {
    reportOk(`1. Root structure: MetaDataObject/${type}, version ${version || '(empty)'}`);
  }
  if (version && !isKnownFormatVersion(version)) {
    reportWarn(`1. Необычная версия MetaDataObject: ${version}.`);
  }

  const internalInfo = extractBlock(xml, 'InternalInfo');
  if (canContinue()) {
    validateInternalInfo(type, name, internalInfo, reportError, reportWarn, reportOk);
  }

  const properties = extractBlock(xml, 'Properties');
  const defaultForm = extractTag(properties ?? '', 'DefaultForm') ?? '';
  const auxiliaryForm = extractTag(properties ?? '', 'AuxiliaryForm') ?? '';
  const mainDcs = type === 'ExternalReport' ? extractTag(properties ?? '', 'MainDataCompositionSchema') ?? '' : '';
  if (canContinue()) {
    if (!properties) {
      reportError('3. Блок Properties отсутствует.');
    } else if (!name || name === '(unknown)' || !IDENT_PATTERN.test(name)) {
      reportError(`3. Properties: некорректное имя "${name}".`);
    } else {
      const extras = [defaultForm ? 'DefaultForm set' : '', mainDcs ? 'MainDCS set' : ''].filter(Boolean).join(', ');
      reportOk(`3. Properties: Name="${name}"${extras ? `, ${extras}` : ''}`);
    }
  }

  // Депт-аварное извлечение верхнеуровневого <ChildObjects>: non-greedy regex
  // останавливался на закрытии ВНУТРЕННЕГО <ChildObjects> колонок ТЧ и обрезал
  // верхний срез до Form, из-за чего валидатор терял TabularSection/Form (см. M1).
  const childObjects = extractMainChildObjectsInnerXml(xml) ?? '';
  const children = parseChildObjects(childObjects);
  if (canContinue()) {
    validateChildObjects(children, reportError, reportWarn, reportOk);
  }
  if (canContinue()) {
    validateCrossRefs(type, name, children, { defaultForm, auxiliaryForm, mainDcs }, reportError, reportWarn, reportOk);
  }
  if (canContinue()) {
    validateAttributes(children, reportError, reportOk);
  }
  if (canContinue()) {
    validateNameUniqueness(children, reportError, reportOk);
  }
  if (canContinue()) {
    validateExternalObjectFiles(objectPath, name, children, reportError, reportOk);
  }

  return finalizeValidation(objectPath, type, name, errors, warnings, ok, lines);
}

function validateInternalInfo(
  type: 'ExternalDataProcessor' | 'ExternalReport',
  name: string,
  inner: string | null,
  reportError: (message: string) => void,
  reportWarn: (message: string) => void,
  reportOk: (message: string) => void
): void {
  if (!inner) {
    reportError('2. InternalInfo block missing.');
    return;
  }
  const expectedClassId = type === 'ExternalDataProcessor' ? EPF_CLASS_ID : ERF_CLASS_ID;
  const classId = extractTag(inner, 'xr:ClassId') ?? extractTag(inner, 'ClassId') ?? '';
  const objectId = extractTag(inner, 'xr:ObjectId') ?? extractTag(inner, 'ObjectId') ?? '';
  const generatedTypeMatches = [...inner.matchAll(/<xr:GeneratedType\b([^>]*)>/g)];
  if (classId !== expectedClassId) {
    reportError(`2. ClassId is "${classId}", expected "${expectedClassId}".`);
    return;
  }
  if (objectId && !GUID_PATTERN.test(objectId)) {
    reportError('2. Invalid ObjectId UUID.');
    return;
  }
  if (generatedTypeMatches.length === 0) {
    reportError('2. No GeneratedType entries found.');
    return;
  }
  const expectedPrefix = `${type}Object.`;
  for (const match of generatedTypeMatches) {
    const generatedName = /name="([^"]+)"/.exec(match[1])?.[1] ?? '';
    if (name !== '(unknown)' && generatedName && !generatedName.startsWith(expectedPrefix)) {
      reportWarn(`2. GeneratedType name "${generatedName}" does not start with "${expectedPrefix}".`);
    }
  }
  reportOk(`2. InternalInfo: ClassId correct, ${String(generatedTypeMatches.length)} GeneratedType`);
}

function validateChildObjects(
  children: readonly ExternalChild[],
  reportError: (message: string) => void,
  reportWarn: (message: string) => void,
  reportOk: (message: string) => void
): void {
  let lastOrder = -1;
  let orderWarned = false;
  const counts = new Map<string, number>();
  for (const child of children) {
    if (!ALLOWED_CHILD_TYPES.has(child.tag)) {
      reportError(`4. ChildObjects: disallowed element "${child.tag}".`);
      continue;
    }
    counts.set(child.tag, (counts.get(child.tag) ?? 0) + 1);
    const currentOrder = CHILD_ORDER[child.tag] ?? -1;
    if (currentOrder < lastOrder && !orderWarned) {
      reportWarn('4. ChildObjects: нарушен порядок Attribute, TabularSection, Form, Template, Command.');
      orderWarned = true;
    }
    lastOrder = currentOrder;
  }
  const summary = [...counts.entries()]
    .sort((a, b) => (CHILD_ORDER[a[0]] ?? 99) - (CHILD_ORDER[b[0]] ?? 99))
    .map(([tag, count]) => `${tag}(${String(count)})`)
    .join(', ');
  reportOk(summary ? `4. ChildObjects: ${summary}` : '4. ChildObjects: empty');
}

function validateCrossRefs(
  type: 'ExternalDataProcessor' | 'ExternalReport',
  name: string,
  children: readonly ExternalChild[],
  refs: { readonly defaultForm: string; readonly auxiliaryForm: string; readonly mainDcs: string },
  reportError: (message: string) => void,
  reportWarn: (message: string) => void,
  reportOk: (message: string) => void
): void {
  const forms = new Set(children.filter((child) => child.tag === 'Form').map((child) => child.name));
  const templates = new Set(children.filter((child) => child.tag === 'Template').map((child) => child.name));
  let checked = 0;
  for (const [label, value] of [['DefaultForm', refs.defaultForm], ['AuxiliaryForm', refs.auxiliaryForm]] as const) {
    if (!value) {
      continue;
    }
    checked++;
    const prefix = `${type}.${name}.Form.`;
    if (!value.startsWith(prefix)) {
      reportWarn(`5. ${label} value "${value}" has unexpected prefix.`);
      continue;
    }
    const formName = value.slice(prefix.length);
    if (!forms.has(formName)) {
      reportError(`5. ${label} references "${formName}", but no such Form in ChildObjects.`);
    }
  }
  if (refs.mainDcs) {
    checked++;
    const prefix = `ExternalReport.${name}.Template.`;
    if (!refs.mainDcs.startsWith(prefix)) {
      reportWarn(`5. MainDataCompositionSchema value "${refs.mainDcs}" has unexpected prefix.`);
    } else {
      const templateName = refs.mainDcs.slice(prefix.length);
      if (!templates.has(templateName)) {
        reportError(`5. MainDataCompositionSchema references "${templateName}", but no such Template in ChildObjects.`);
      }
    }
  }
  if (checked > 0) {
    reportOk('5. Cross-references valid.');
  }
}

function validateAttributes(
  children: readonly ExternalChild[],
  reportError: (message: string) => void,
  reportOk: (message: string) => void
): void {
  const attributes = children.filter((child) => child.tag === 'Attribute');
  for (const attr of attributes) {
    if (!attr.uuid || !GUID_PATTERN.test(attr.uuid)) {
      reportError(`6. Attribute "${attr.name}" has invalid uuid.`);
      return;
    }
    if (!attr.name || !IDENT_PATTERN.test(attr.name)) {
      reportError(`6. Attribute "${attr.name}" has invalid identifier.`);
      return;
    }
    if (!/<Type\b[\s\S]*?(<v8:Type>|<v8:TypeSet>)/.test(attr.xml)) {
      reportError(`6. Attribute "${attr.name}" Type block has no v8:Type or v8:TypeSet.`);
      return;
    }
  }
  if (attributes.length > 0) {
    reportOk(`6. Attributes: ${String(attributes.length)} checked.`);
  }
}

function validateNameUniqueness(
  children: readonly ExternalChild[],
  reportError: (message: string) => void,
  reportOk: (message: string) => void
): void {
  const seen = new Map<string, string>();
  for (const child of children) {
    if (!child.name) {
      continue;
    }
    const previous = seen.get(child.name);
    if (previous) {
      reportError(`8. Duplicate name "${child.name}" (${child.tag} conflicts with ${previous}).`);
      return;
    }
    seen.set(child.name, child.tag);
  }
  reportOk(`8. Name uniqueness: ${String(seen.size)} names, all unique.`);
}

function validateExternalObjectFiles(
  objectXmlPath: string,
  name: string,
  children: readonly ExternalChild[],
  reportError: (message: string) => void,
  reportOk: (message: string) => void
): void {
  const objectDir = path.join(path.dirname(objectXmlPath), name);
  let checked = 0;
  for (const child of children) {
    if (child.tag === 'Form') {
      const descriptor = path.join(objectDir, 'Forms', `${child.name}.xml`);
      const formXml = path.join(objectDir, 'Forms', child.name, 'Ext', 'Form.xml');
      if (!fs.existsSync(descriptor)) {
        reportError(`9. Missing form descriptor: Forms/${child.name}.xml`);
        return;
      }
      if (!fs.existsSync(formXml)) {
        reportError(`9. Missing form layout: Forms/${child.name}/Ext/Form.xml`);
        return;
      }
      checked += 2;
    }
    if (child.tag === 'Template') {
      const descriptor = path.join(objectDir, 'Templates', `${child.name}.xml`);
      const extDir = path.join(objectDir, 'Templates', child.name, 'Ext');
      if (!fs.existsSync(descriptor)) {
        reportError(`9. Missing template descriptor: Templates/${child.name}.xml`);
        return;
      }
      if (!fs.existsSync(extDir) || !fs.readdirSync(extDir).some((file) => file.startsWith('Template.'))) {
        reportError(`9. Missing template content: Templates/${child.name}/Ext/Template.*`);
        return;
      }
      checked += 2;
    }
  }
  const objectModule = path.join(objectDir, 'Ext', 'ObjectModule.bsl');
  if (fs.existsSync(objectModule)) {
    checked++;
  }
  if (checked > 0) {
    reportOk(`9. File existence: ${String(checked)} files verified.`);
  }
}

interface ExternalChild {
  readonly tag: string;
  readonly name: string;
  readonly uuid: string;
  readonly xml: string;
}

function parseChildObjects(inner: string): ExternalChild[] {
  const children: ExternalChild[] = [];
  const tagRegex = /<([A-Za-z][A-Za-z0-9]*)\b([^>]*)>([\s\S]*?)<\/\1>|<([A-Za-z][A-Za-z0-9]*)\b([^>]*)\/>/g;
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(inner)) !== null) {
    // Опциональные альтернативы регулярки фактически могут вернуть undefined.
    const groups = match as unknown as readonly (string | undefined)[];
    const tag = groups[1] ?? groups[4] ?? '';
    const attrs = groups[2] ?? groups[5] ?? '';
    const body = groups[3] ?? '';
    if (!tag) {
      continue;
    }
    children.push({
      tag,
      name: extractTag(body, 'Name') ?? body.trim(),
      uuid: /uuid="([^"]+)"/.exec(attrs)?.[1] ?? '',
      xml: match[0],
    });
  }
  return children;
}

function finalizeValidation(
  objectPath: string,
  type: ExternalObjectValidationResult['type'],
  name: string,
  errors: number,
  warnings: number,
  ok: number,
  lines: string[]
): ExternalObjectValidationResult {
  const checks = errors + warnings + ok;
  if (errors === 0 && warnings === 0 && lines.length === 1) {
    lines.push(`=== Validation OK: ${type}.${name} (${String(checks)} checks) ===`);
  } else {
    lines.push('');
    lines.push(`=== Result: ${String(errors)} errors, ${String(warnings)} warnings (${String(checks)} checks) ===`);
  }
  return { objectPath, type, name, errors, warnings, checks, lines };
}
