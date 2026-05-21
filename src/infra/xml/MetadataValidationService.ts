import * as fs from 'fs';
import * as path from 'path';
import { META_TYPES, type MetaKind } from '../../domain/MetaTypes';
import type { MetaChild } from '../../domain/MetaObject';
import { ObjectXmlReader } from './ObjectXmlReader';
import { extractMainChildObjectsInnerXml, findChildElementsFullXmlInBlock } from './XmlUtils';
import { resolveMetadataObjectPath } from './MetadataInfoService';

export type MetadataValidationSeverity = 'error' | 'warning' | 'info';

export interface MetadataValidationIssue {
  readonly severity: MetadataValidationSeverity;
  readonly code: string;
  readonly message: string;
  readonly path?: string;
}

export interface MetadataValidationOptions {
  readonly objectPath: string;
  readonly detailed?: boolean;
  readonly maxErrors?: number;
}

export interface SingleMetadataValidationResult {
  readonly objectPath: string;
  readonly xmlPath?: string;
  readonly kind?: string;
  readonly name?: string;
  readonly ok: boolean;
  readonly errors: number;
  readonly warnings: number;
  readonly issues: readonly MetadataValidationIssue[];
  readonly lines: readonly string[];
}

export interface MetadataValidationResult {
  readonly ok: boolean;
  readonly errors: number;
  readonly warnings: number;
  readonly objects: readonly SingleMetadataValidationResult[];
  readonly lines: readonly string[];
}

/**
 * Базовая структурная валидация объекта метаданных. Проверки опираются на
 * META_TYPES и ObjectXmlReader, поэтому UI и MCP видят те же ограничения,
 * что и дерево расширения.
 */
export class MetadataValidationService {
  private readonly reader = new ObjectXmlReader();

  validate(options: MetadataValidationOptions): MetadataValidationResult {
    const paths = options.objectPath
      .split('|')
      .map((item) => item.trim())
      .filter(Boolean);
    const objects = paths.map((objectPath) => this.validateOne(objectPath, options));
    const errors = objects.reduce((sum, item) => sum + item.errors, 0);
    const warnings = objects.reduce((sum, item) => sum + item.warnings, 0);
    return {
      ok: errors === 0,
      errors,
      warnings,
      objects,
      lines: buildBatchLines(objects),
    };
  }

  private validateOne(objectPath: string, options: MetadataValidationOptions): SingleMetadataValidationResult {
    const issues: MetadataValidationIssue[] = [];
    const maxErrors = Math.max(1, options.maxErrors ?? 30);
    let errorCount = 0;
    const add = (issue: MetadataValidationIssue) => {
      if (issue.severity === 'error') {
        if (errorCount >= maxErrors) {
          return;
        }
        errorCount += 1;
      }
      issues.push(issue);
    };

    const xmlPath = resolveMetadataObjectPath(objectPath);
    if (!xmlPath) {
      add({ severity: 'error', code: 'file-not-found', message: `XML объекта не найден: ${objectPath}` });
      return buildSingleResult(objectPath, undefined, undefined, undefined, issues, options.detailed);
    }

    let xml = '';
    try {
      xml = fs.readFileSync(xmlPath, 'utf-8');
    } catch (error) {
      add({ severity: 'error', code: 'file-read', message: error instanceof Error ? error.message : String(error), path: xmlPath });
      return buildSingleResult(objectPath, xmlPath, undefined, undefined, issues, options.detailed);
    }

    const object = this.reader.read(xmlPath);
    if (!object) {
      add({ severity: 'error', code: 'not-metadata-object', message: 'Файл не содержит корректный MetaDataObject.', path: xmlPath });
      return buildSingleResult(objectPath, xmlPath, undefined, undefined, issues, options.detailed);
    }

    if (!isKnownMetaKind(object.tag)) {
      add({ severity: 'error', code: 'unknown-kind', message: `Тип метаданных не зарегистрирован в META_TYPES: ${object.tag}`, path: xmlPath });
    }
    if (!object.name) {
      add({ severity: 'error', code: 'empty-name', message: 'Не заполнено свойство Name.', path: xmlPath });
    } else if (!isMetadataName(object.name)) {
      add({ severity: 'error', code: 'invalid-name', message: `Недопустимое имя метаданных: ${object.name}`, path: xmlPath });
    }

    const fileName = path.basename(xmlPath, '.xml');
    if (fileName !== 'Configuration' && object.name && fileName !== object.name) {
      add({ severity: 'warning', code: 'file-name-mismatch', message: `Имя файла "${fileName}" отличается от Name "${object.name}".`, path: xmlPath });
    }

    const rootUuid = extractRootUuid(xml, object.tag);
    if (rootUuid && !isUuid(rootUuid)) {
      add({ severity: 'error', code: 'invalid-uuid', message: `Некорректный UUID объекта: ${rootUuid}`, path: xmlPath });
    }

    validateChildTags(object.tag, object.children, add, xmlPath);
    validateDuplicateChildren(object.children, add, xmlPath);
    validateAuxiliaryFiles(xmlPath, object.children, add);
    if (options.detailed) {
      add({ severity: 'info', code: 'parsed', message: `Объект прочитан: ${object.tag}.${object.name}`, path: xmlPath });
    }

    return buildSingleResult(objectPath, xmlPath, object.tag, object.name, issues, options.detailed);
  }
}

function validateChildTags(
  kind: string,
  children: readonly MetaChild[],
  add: (issue: MetadataValidationIssue) => void,
  xmlPath: string
): void {
  const def = isKnownMetaKind(kind) ? META_TYPES[kind] : undefined;
  const allowed = new Set<string>(def?.childTags ?? []);
  if (allowed.size === 0) {
    const nonStandard = children.filter((child) => child.tag !== 'StandardAttribute');
    for (const child of nonStandard) {
      add({
        severity: 'warning',
        code: 'unexpected-child',
        message: `Тип ${kind} не описывает дочерний элемент ${child.tag}.${child.name}.`,
        path: xmlPath,
      });
    }
    return;
  }
  for (const child of children) {
    if (!allowed.has(child.tag)) {
      add({
        severity: child.tag === 'StandardAttribute' ? 'warning' : 'error',
        code: 'disallowed-child',
        message: `Для ${kind} не разрешён дочерний элемент ${child.tag}.${child.name}.`,
        path: xmlPath,
      });
    }
  }
}

function validateDuplicateChildren(
  children: readonly MetaChild[],
  add: (issue: MetadataValidationIssue) => void,
  xmlPath: string
): void {
  const seen = new Map<string, string>();
  for (const child of children) {
    const key = `${child.tag}.${child.name}`.toLowerCase();
    if (seen.has(key)) {
      add({ severity: 'error', code: 'duplicate-child', message: `Дублируется дочерний элемент ${child.tag}.${child.name}.`, path: xmlPath });
    }
    seen.set(key, child.name);
    for (const column of child.columns ?? []) {
      const columnKey = `${child.name}.Column.${column.name}`.toLowerCase();
      if (seen.has(columnKey)) {
        add({ severity: 'error', code: 'duplicate-column', message: `Дублируется колонка ${child.name}.${column.name}.`, path: xmlPath });
      }
      seen.set(columnKey, column.name);
    }
  }
}

function validateAuxiliaryFiles(
  xmlPath: string,
  children: readonly MetaChild[],
  add: (issue: MetadataValidationIssue) => void
): void {
  const objectDir = path.join(path.dirname(xmlPath), path.basename(xmlPath, '.xml'));
  if (!fs.existsSync(objectDir)) {
    return;
  }
  for (const child of children) {
    if (child.tag !== 'Form' && child.tag !== 'Command' && child.tag !== 'Template') {
      continue;
    }
    const expected = getAuxiliaryXmlPath(objectDir, child);
    if (expected && !fs.existsSync(expected)) {
      add({
        severity: 'warning',
        code: 'missing-child-file',
        message: `Для ${child.tag}.${child.name} не найден файл ${path.relative(objectDir, expected)}.`,
        path: expected,
      });
    }
  }
}

function getAuxiliaryXmlPath(objectDir: string, child: MetaChild): string | null {
  if (child.tag === 'Form') {
    return path.join(objectDir, 'Forms', `${child.name}.xml`);
  }
  if (child.tag === 'Command') {
    return path.join(objectDir, 'Commands', `${child.name}.xml`);
  }
  if (child.tag === 'Template') {
    return path.join(objectDir, 'Templates', `${child.name}.xml`);
  }
  return null;
}

function buildSingleResult(
  objectPath: string,
  xmlPath: string | undefined,
  kind: string | undefined,
  name: string | undefined,
  issues: readonly MetadataValidationIssue[],
  detailed: boolean | undefined
): SingleMetadataValidationResult {
  const errors = issues.filter((issue) => issue.severity === 'error').length;
  const warnings = issues.filter((issue) => issue.severity === 'warning').length;
  const visibleIssues = detailed ? issues : issues.filter((issue) => issue.severity !== 'info');
  const title = kind && name ? `${kind}.${name}` : objectPath;
  return {
    objectPath,
    xmlPath,
    kind,
    name,
    ok: errors === 0,
    errors,
    warnings,
    issues,
    lines: [
      `Объект: ${title}`,
      `Ошибки: ${String(errors)}, предупреждения: ${String(warnings)}`,
      ...visibleIssues.map((issue) => `${issue.severity.toUpperCase()} ${issue.code}: ${issue.message}`),
    ],
  };
}

function buildBatchLines(objects: readonly SingleMetadataValidationResult[]): readonly string[] {
  const lines: string[] = [];
  for (const object of objects) {
    if (lines.length > 0) {
      lines.push('');
    }
    lines.push(...object.lines);
  }
  return lines;
}

function isKnownMetaKind(kind: string): kind is MetaKind {
  return Object.prototype.hasOwnProperty.call(META_TYPES, kind);
}

function isMetadataName(value: string): boolean {
  return /^[\p{L}_][\p{L}\p{Nd}_]*$/u.test(value);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function extractRootUuid(xml: string, kind: string): string | undefined {
  const match = new RegExp(`<${escapeRegExp(kind)}\\b[^>]*\\buuid="([^"]+)"`, 'i').exec(xml);
  return match?.[1];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function collectRawChildTagNames(xml: string): readonly string[] {
  const childObjects = extractMainChildObjectsInnerXml(xml);
  if (!childObjects) {
    return [];
  }
  const tags = new Set<string>();
  for (const tag of Object.keys(META_TYPES)) {
    for (const item of findChildElementsFullXmlInBlock(childObjects, tag)) {
      if (item.name) {
        tags.add(tag);
      }
    }
  }
  return [...tags];
}
