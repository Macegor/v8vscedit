import * as fs from 'fs';
import * as path from 'path';
import { META_TYPES, type MetaKind } from '../../domain/MetaTypes';
import { ConfigXmlReader } from './ConfigXmlReader';
import { extractRepeatedSimpleTagValues, extractTagInnerXml } from './MetadataPropertiesXml';
import { extractSimpleTag } from './XmlUtils';

export type ConfigurationInfoMode = 'overview' | 'brief' | 'full';

export interface ConfigurationInfoOptions {
  readonly configPath: string;
  readonly mode?: ConfigurationInfoMode;
  readonly limit?: number;
  readonly offset?: number;
}

export interface ConfigurationInfoResult {
  readonly configXmlPath: string;
  readonly kind: 'cf' | 'cfe';
  readonly name: string;
  readonly synonym: string;
  readonly version: string;
  readonly vendor: string;
  readonly compatibilityMode: string;
  readonly formatVersion: string;
  readonly totalObjects: number;
  readonly objectCounts: Record<string, number>;
  readonly defaultRoles: readonly string[];
  readonly lines: readonly string[];
}

/**
 * Структурированная замена cf-info.py/cfe-info-поведения.
 * Возвращает и машинный DTO, и готовые строки для текстового отчёта.
 */
export class ConfigurationInfoService {
  private readonly reader = new ConfigXmlReader();

  read(options: ConfigurationInfoOptions): ConfigurationInfoResult {
    const configXmlPath = resolveConfigXmlPath(options.configPath);
    const xml = fs.readFileSync(configXmlPath, 'utf-8');
    const info = this.reader.read(configXmlPath);
    const counts = countChildObjects(info.childObjects);
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    const result = {
      configXmlPath,
      kind: info.kind,
      name: info.name,
      synonym: info.synonym,
      version: extractSimpleTag(xml, 'Version') ?? '',
      vendor: extractSimpleTag(xml, 'Vendor') ?? '',
      compatibilityMode: extractSimpleTag(xml, 'CompatibilityMode') ?? extractSimpleTag(xml, 'ConfigurationExtensionCompatibilityMode') ?? '',
      formatVersion: /<MetaDataObject\b[^>]*\bversion="([^"]+)"/.exec(xml)?.[1] ?? '',
      totalObjects: total,
      objectCounts: counts,
      defaultRoles: extractDefaultRoles(xml),
      lines: [] as string[],
    };
    const lines = paginate(buildLines(result, options.mode ?? 'overview'), options.offset ?? 0, options.limit ?? 150);
    return { ...result, lines };
  }
}

function countChildObjects(childObjects: Map<string, string[]>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [kind, names] of childObjects.entries()) {
    result[kind] = names.length;
  }
  return result;
}

function buildLines(result: Omit<ConfigurationInfoResult, 'lines'>, mode: ConfigurationInfoMode): string[] {
  const title = `${result.kind === 'cfe' ? 'Расширение' : 'Конфигурация'}: ${result.name}${result.synonym ? ` — "${result.synonym}"` : ''}${result.version ? ` v${result.version}` : ''}`;
  if (mode === 'brief') {
    return [`${title} | ${String(result.totalObjects)} объектов${result.compatibilityMode ? ` | ${result.compatibilityMode}` : ''}`];
  }

  const lines = [
    `=== ${title} ===`,
    '',
    `Формат:         ${result.formatVersion}`,
    `Совместимость:  ${result.compatibilityMode}`,
  ];
  if (result.vendor) {
    lines.push(`Поставщик:      ${result.vendor}`);
  }
  if (result.defaultRoles.length > 0) {
    lines.push(`Роли по умолчанию: ${result.defaultRoles.join(', ')}`);
  }
  lines.push('', `--- Состав (${String(result.totalObjects)} объектов) ---`);
  for (const [kind, count] of orderedCounts(result.objectCounts)) {
    lines.push(`  ${labelForKind(kind).padEnd(32)} ${String(count)}`);
  }

  if (mode === 'full') {
    lines.push('', '--- ChildObjects ---');
    for (const [kind, count] of orderedCounts(result.objectCounts)) {
      lines.push(`  ${kind}: ${String(count)}`);
    }
  }
  return lines;
}

function orderedCounts(counts: Record<string, number>): [string, number][] {
  return Object.entries(counts)
    .sort(([left], [right]) => {
      const leftOrder = lookupMetaType(left)?.groupOrder ?? 1_000;
      const rightOrder = lookupMetaType(right)?.groupOrder ?? 1_000;
      return leftOrder - rightOrder || left.localeCompare(right, 'ru');
    });
}

function labelForKind(kind: string): string {
  return lookupMetaType(kind)?.pluralLabel ?? kind;
}

function lookupMetaType(kind: string): typeof META_TYPES[MetaKind] | undefined {
  return Object.prototype.hasOwnProperty.call(META_TYPES, kind)
    ? META_TYPES[kind as MetaKind]
    : undefined;
}

function extractDefaultRoles(xml: string): string[] {
  const inner = extractTagInnerXml(xml, 'DefaultRoles');
  return inner ? extractRepeatedSimpleTagValues(inner, 'Item') : [];
}

function paginate(lines: string[], offset: number, limit: number): string[] {
  return lines.slice(Math.max(0, offset), Math.max(0, offset) + Math.max(1, limit));
}

function resolveConfigXmlPath(configPath: string): string {
  const resolved = path.resolve(configPath);
  const candidate = fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()
    ? path.join(resolved, 'Configuration.xml')
    : resolved;
  if (!fs.existsSync(candidate)) {
    throw new Error(`Configuration.xml не найден: ${configPath}`);
  }
  return candidate;
}
