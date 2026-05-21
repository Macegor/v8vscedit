import * as fs from 'fs';
import * as path from 'path';
import type { ChildTag } from '../../domain/ChildTag';
import { CHILD_TAG_CONFIG } from '../../domain/ChildTag';
import type { MetaChild, MetaObject } from '../../domain/MetaObject';
import { META_TYPES, type MetaKind } from '../../domain/MetaTypes';
import { ObjectXmlReader } from './ObjectXmlReader';

export type MetadataInfoMode = 'overview' | 'brief' | 'full';

export interface MetadataInfoOptions {
  readonly objectPath: string;
  readonly mode?: MetadataInfoMode;
  readonly name?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface MetadataInfoResult {
  readonly xmlPath: string;
  readonly kind: string;
  readonly kindLabel: string;
  readonly name: string;
  readonly synonym: string;
  readonly childCounts: Record<string, number>;
  readonly children: readonly MetaChild[];
  readonly drillDown?: MetaChild;
  readonly lines: readonly string[];
}

/**
 * Структурная сводка объекта метаданных. Это runtime-аналог навыка meta-info:
 * агенты и UI получают один DTO, а текстовый отчёт остаётся производным видом.
 */
export class MetadataInfoService {
  private readonly reader = new ObjectXmlReader();

  read(options: MetadataInfoOptions): MetadataInfoResult {
    const xmlPath = resolveMetadataObjectPath(options.objectPath);
    if (!xmlPath) {
      throw new Error(`XML объекта метаданных не найден: ${options.objectPath}`);
    }
    const object = this.reader.read(xmlPath);
    if (!object) {
      throw new Error(`Файл не похож на XML объекта метаданных: ${xmlPath}`);
    }

    const kindLabel = getKindLabel(object.tag);
    const childCounts = countChildren(object.children);
    const drillDown = options.name ? findChildByName(object.children, options.name) : undefined;
    const allLines = buildLines(object, kindLabel, childCounts, options.mode ?? 'overview', drillDown);
    const offset = Math.max(0, options.offset ?? 0);
    const limit = Math.max(1, options.limit ?? allLines.length);

    return {
      xmlPath,
      kind: object.tag,
      kindLabel,
      name: object.name,
      synonym: object.synonym,
      childCounts,
      children: object.children,
      drillDown,
      lines: allLines.slice(offset, offset + limit),
    };
  }
}

export function resolveMetadataObjectPath(objectPath: string): string | null {
  const normalized = path.resolve(objectPath);
  if (fs.existsSync(normalized) && fs.statSync(normalized).isFile()) {
    return normalized;
  }
  if (fs.existsSync(normalized) && fs.statSync(normalized).isDirectory()) {
    const name = path.basename(normalized);
    const nested = path.join(normalized, `${name}.xml`);
    if (fs.existsSync(nested) && fs.statSync(nested).isFile()) {
      return nested;
    }
    const sibling = path.join(path.dirname(normalized), `${name}.xml`);
    if (fs.existsSync(sibling) && fs.statSync(sibling).isFile()) {
      return sibling;
    }
  }
  const withExtension = `${normalized}.xml`;
  if (fs.existsSync(withExtension) && fs.statSync(withExtension).isFile()) {
    return withExtension;
  }
  return null;
}

function getKindLabel(kind: string): string {
  return (META_TYPES as Readonly<Record<string, { label: string } | undefined>>)[kind]?.label ?? kind;
}

function countChildren(children: readonly MetaChild[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const child of children) {
    result[child.tag] = (result[child.tag] ?? 0) + 1;
    if (child.tag === 'TabularSection') {
      result.Column = (result.Column ?? 0) + (child.columns?.length ?? 0);
    }
  }
  return result;
}

function findChildByName(children: readonly MetaChild[], name: string): MetaChild | undefined {
  for (const child of children) {
    if (child.name === name || child.presentation === name || child.synonym === name) {
      return child;
    }
    const column = child.columns?.find((item) => item.name === name || item.synonym === name);
    if (column) {
      return column;
    }
  }
  return undefined;
}

function buildLines(
  object: MetaObject,
  kindLabel: string,
  childCounts: Record<string, number>,
  mode: MetadataInfoMode,
  drillDown: MetaChild | undefined
): string[] {
  if (drillDown) {
    return buildDrillDownLines(drillDown);
  }
  if (mode === 'brief') {
    return buildBriefLines(object, kindLabel, childCounts);
  }
  const lines = [
    `${kindLabel}: ${object.name}`,
    object.synonym ? `Синоним: ${object.synonym}` : 'Синоним: не задан',
    '',
    'Состав:',
    ...buildCountLines(childCounts),
  ];
  if (mode === 'full') {
    lines.push('', ...buildFullChildLines(object.children));
  } else {
    lines.push('', ...buildOverviewChildLines(object.children));
  }
  return lines;
}

function buildBriefLines(object: MetaObject, kindLabel: string, childCounts: Record<string, number>): string[] {
  const counters = buildCountLines(childCounts).join('; ') || 'дочерних элементов нет';
  const names = object.children
    .filter((child) => child.tag !== 'StandardAttribute')
    .map((child) => child.name)
    .filter(Boolean)
    .join(', ');
  return [
    `${kindLabel}: ${object.name}${object.synonym ? ` (${object.synonym})` : ''}`,
    `Состав: ${counters}`,
    names ? `Элементы: ${names}` : 'Элементы: нет',
  ];
}

function buildCountLines(childCounts: Record<string, number>): string[] {
  return Object.entries(childCounts)
    .sort(([a], [b]) => getChildOrder(a) - getChildOrder(b) || a.localeCompare(b, 'ru'))
    .map(([tag, count]) => `${getChildLabel(tag)}: ${String(count)}`);
}

function buildOverviewChildLines(children: readonly MetaChild[]): string[] {
  const grouped = groupChildren(children);
  const result: string[] = [];
  for (const [tag, items] of grouped) {
    result.push(`${getChildLabel(tag)}: ${items.map((item) => item.name).join(', ') || 'нет'}`);
  }
  return result.length > 0 ? result : ['Дочерних элементов нет.'];
}

function buildFullChildLines(children: readonly MetaChild[]): string[] {
  const grouped = groupChildren(children);
  const result: string[] = [];
  for (const [tag, items] of grouped) {
    result.push(`${getChildLabel(tag)}:`);
    for (const item of items) {
      const synonym = item.synonym && item.synonym !== item.name ? ` — ${item.synonym}` : '';
      result.push(`  - ${item.presentation ?? item.name}${synonym}`);
      if (item.columns?.length) {
        for (const column of item.columns) {
          const columnSynonym = column.synonym && column.synonym !== column.name ? ` — ${column.synonym}` : '';
          result.push(`    - ${column.name}${columnSynonym}`);
        }
      }
    }
  }
  return result.length > 0 ? result : ['Дочерних элементов нет.'];
}

function buildDrillDownLines(child: MetaChild): string[] {
  const lines = [
    `${getChildLabel(child.tag)}: ${child.presentation ?? child.name}`,
    child.synonym ? `Синоним: ${child.synonym}` : 'Синоним: не задан',
  ];
  if (child.columns?.length) {
    lines.push('Колонки:');
    for (const column of child.columns) {
      const synonym = column.synonym && column.synonym !== column.name ? ` — ${column.synonym}` : '';
      lines.push(`  - ${column.name}${synonym}`);
    }
  }
  return lines;
}

function groupChildren(children: readonly MetaChild[]): Map<string, MetaChild[]> {
  const result = new Map<string, MetaChild[]>();
  for (const child of children) {
    const current = result.get(child.tag) ?? [];
    current.push(child);
    result.set(child.tag, current);
  }
  return new Map([...result.entries()].sort(([a], [b]) => getChildOrder(a) - getChildOrder(b) || a.localeCompare(b, 'ru')));
}

function getChildLabel(tag: string): string {
  const config = (CHILD_TAG_CONFIG as Readonly<Record<string, { label: string } | undefined>>)[tag];
  if (config) {
    return config.label;
  }
  return (META_TYPES as Readonly<Record<string, { pluralLabel: string } | undefined>>)[tag]?.pluralLabel ?? tag;
}

function getChildOrder(tag: string): number {
  const order: readonly string[] = [
    'StandardAttribute',
    'Attribute',
    'Dimension',
    'Resource',
    'AddressingAttribute',
    'TabularSection',
    'Column',
    'EnumValue',
    'Form',
    'Command',
    'Template',
  ] satisfies readonly (ChildTag | 'Column')[];
  const index = order.indexOf(tag);
  return index === -1 ? 100 : index;
}
