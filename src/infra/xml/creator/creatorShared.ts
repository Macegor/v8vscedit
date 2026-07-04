import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { ChildTag } from '../../../domain/ChildTag';
import { getMetaType, type MetaKind } from '../../../domain/MetaTypes';
import type { EditResult } from '../ConfigurationXmlEditor';
import { getObjectLocationFromXml } from '../../fs/MetaPathResolver';
import { DEFAULT_FORMAT_VERSION } from '../format/formatRegistry';
import type { FormatRuleset } from '../format/FormatRuleset';
import {
  buildLocalizedTag as buildLocalizedTagShared,
  escapeXmlAttribute as escapeXml,
} from '../XmlUtils';

export const DEFAULT_TEMPLATE_TYPE: TemplateType = 'SpreadsheetDocument';

export type TemplateType =
  | 'SpreadsheetDocument'
  | 'TextDocument'
  | 'HTMLDocument'
  | 'BinaryData'
  | 'DataCompositionSchema'
  | 'DataCompositionAppearanceTemplate'
  | 'GraphicalSchema'
  | 'AddIn';

export interface AddRootMetadataOptions {
  configRoot: string;
  kind: MetaKind;
  name: string;
  templateType?: TemplateType;
}

export interface AddChildMetadataOptions {
  ownerObjectXmlPath: string;
  childTag: ChildTag | 'Column';
  name: string;
  tabularSectionName?: string;
  /** Имя URL-шаблона-контейнера при добавлении метода HTTP-сервиса (аналог `tabularSectionName`). */
  urlTemplateName?: string;
  templateType?: TemplateType;
}

export { escapeXml };

/** Блок `<StandardAttributes>` вида (или пусто) как элемент массива свойств. */
export function saBlock(kind: MetaKind, ruleset: FormatRuleset): string[] {
  const block = ruleset.standardAttributes(kind);
  return block ? [block] : [];
}

/** Блок `<StandardTabularSections>` вида (или пусто) как элемент массива свойств. */
export function stsBlock(kind: MetaKind, ruleset: FormatRuleset): string[] {
  const block = ruleset.standardTabularSections(kind);
  return block ? [block] : [];
}

export function buildInternalInfo(kind: MetaKind, objectName: string, indent: string, ruleset: FormatRuleset): string {
  const types = ruleset.generatedTypes[kind];
  if (!types?.length) {
    return '';
  }
  const lines = [`${indent}<InternalInfo>`];
  if (kind === 'ExchangePlan') {
    lines.push(`${indent}\t<xr:ThisNode>${newUuid()}</xr:ThisNode>`);
  }
  for (const generatedType of types) {
    lines.push(...buildGeneratedTypeLines(
      `${generatedType.prefix}.${objectName}`,
      generatedType.category,
      `${indent}\t`
    ));
  }
  lines.push(`${indent}</InternalInfo>`);
  return lines.join('\n');
}

export function buildTabularSectionInternalInfo(ownerKind: string, ownerName: string, sectionName: string, indent: string, ruleset: FormatRuleset): string {
  const generatedTypeLines = ruleset
    .tabularSectionGeneratedTypes(ownerKind, ownerName, sectionName)
    .flatMap((ref) => buildGeneratedTypeLines(ref.name, ref.category, `${indent}\t`));
  return [
    `${indent}<InternalInfo>`,
    ...generatedTypeLines,
    `${indent}</InternalInfo>`,
  ].join('\n');
}

export function buildGeneratedTypeLines(name: string, category: string, indent: string): string[] {
  return [
    `${indent}<xr:GeneratedType name="${escapeXml(name)}" category="${escapeXml(category)}">`,
    `${indent}\t<xr:TypeId>${newUuid()}</xr:TypeId>`,
    `${indent}\t<xr:ValueId>${newUuid()}</xr:ValueId>`,
    `${indent}</xr:GeneratedType>`,
  ];
}

export function getDefaultModulePaths(kind: MetaKind, objectDir: string): string[] {
  const ext = path.join(objectDir, 'Ext');
  const result: string[] = [];
  if (['Catalog', 'Document', 'Report', 'DataProcessor', 'ExchangePlan', 'ChartOfAccounts', 'ChartOfCharacteristicTypes', 'ChartOfCalculationTypes', 'BusinessProcess', 'Task'].includes(kind)) {
    result.push(path.join(ext, 'ObjectModule.bsl'));
  }
  if (['Report', 'DataProcessor', 'Constant', 'Enum'].includes(kind)) {
    result.push(path.join(ext, 'ManagerModule.bsl'));
  }
  if (kind === 'Constant') {
    result.push(path.join(ext, 'ValueManagerModule.bsl'));
  }
  if (['InformationRegister', 'AccumulationRegister', 'AccountingRegister', 'CalculationRegister'].includes(kind)) {
    result.push(path.join(ext, 'RecordSetModule.bsl'));
  }
  if (['CommonModule', 'HTTPService', 'WebService'].includes(kind)) {
    result.push(path.join(ext, 'Module.bsl'));
  }
  if (kind === 'CommonCommand') {
    result.push(path.join(ext, 'CommandModule.bsl'));
  }
  if (kind === 'CommonForm') {
    result.push(path.join(ext, 'Form', 'Module.bsl'));
  }
  return result;
}

/**
 * Решение «нужен ли блок <ChildObjects/>» — на основе декларации в META_TYPES.
 * Объекты без дочерних тегов (SessionParameter, Constant, DefinedType,
 * Style, StyleItem, CommonPicture, Language, FunctionalOption, ...) ломают
 * платформенную загрузку при наличии лишнего <ChildObjects/>:
 *   «ошибка формата документа — читаемое свойство не соответствует ожидаемому».
 */
export function needsChildObjects(kind: MetaKind): boolean {
  // Ряд видов содержит контейнер <ChildObjects> в схеме, даже если в реестре
  // META_TYPES у них не объявлены дочерние теги: подсистема (вложенные
  // подсистемы), критерий отбора и хранилище настроек (формы). В эталонной
  // выгрузке 2.20 у них присутствует пустой <ChildObjects/>; без него платформа
  // 1С не загружает объект ("ожидаемое ChildObjects").
  if (
    kind === 'Subsystem' ||
    kind === 'FilterCriterion' ||
    kind === 'SettingsStorage' ||
    kind === 'HTTPService' ||
    kind === 'WebService'
  ) {
    return true;
  }
  const def = getMetaType(kind);
  return Array.isArray(def.childTags) && def.childTags.length > 0;
}

export function ensureEmptyFile(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, '', 'utf-8');
  }
}

// В создании метаданных пустой синоним сериализуется как самозакрывающийся <tag/>.
export function buildLocalizedTag(indent: string, tag: string, text: string): string {
  return buildLocalizedTagShared(indent, tag, text, { emptyAsSelfClosing: true });
}

export function writeTextFile(filePath: string, content: string): boolean {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (fs.existsSync(filePath)) {
    return false;
  }
  fs.writeFileSync(filePath, content, 'utf-8');
  return true;
}

export function resolveTemplateType(templateType: TemplateType | undefined): TemplateType {
  return templateType ?? DEFAULT_TEMPLATE_TYPE;
}

export function resolveObjectFormatVersion(xmlPath: string): string {
  const configRoot = getObjectLocationFromXml(xmlPath).configRoot;
  return detectConfigFormatVersion(configRoot)
    ?? readFormatVersionFromFile(xmlPath)
    ?? DEFAULT_FORMAT_VERSION;
}

export function resolveConfigFormatVersion(configRoot: string): string {
  return detectConfigFormatVersion(configRoot)
    ?? DEFAULT_FORMAT_VERSION;
}

function detectConfigFormatVersion(configRoot: string): string | null {
  return readFormatVersionFromFile(path.join(configRoot, 'ConfigDumpInfo.xml'))
    ?? readFormatVersionFromFile(path.join(configRoot, 'Configuration.xml'));
}

function readFormatVersionFromFile(filePath: string): string | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const head = fs.readFileSync(filePath, 'utf-8').slice(0, 4000);
  return /<(?!\?xml\b)[A-Za-z_:][\w:.-]*\b[^>]*\bversion="([\d.]+)"/.exec(head)?.[1] ?? null;
}

export function detectChildIndent(inner: string, fallback: string): string {
  return /\n([ \t]+)</.exec(inner)?.[1] ?? fallback;
}

export function splitCamelCase(name: string): string {
  const withSpaces = name
    .replace(/([а-яё])([А-ЯЁ])/g, '$1 $2')
    .replace(/([a-z])([A-Z])/g, '$1 $2');
  return withSpaces.length > 1 ? withSpaces[0] + withSpaces.slice(1).toLocaleLowerCase('ru-RU') : withSpaces;
}

export function validateMetadataName(value: string): EditResult {
  return /^[\p{L}][\p{L}\p{Nd}_]*$/u.test(value)
    ? ok([])
    : fail('Имя должно начинаться с буквы и содержать только буквы, цифры и подчёркивание.');
}

export function newUuid(): string {
  return crypto.randomUUID();
}

export function ok(changedFiles: string[]): EditResult {
  return { success: true, changed: changedFiles.length > 0, changedFiles, warnings: [], errors: [] };
}

export function fail(message: string): EditResult {
  return { success: false, changed: false, changedFiles: [], warnings: [], errors: [message] };
}
