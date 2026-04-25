import * as fs from 'fs';
import * as path from 'path';
import { ChildTag } from '../../domain/ChildTag';
import { getMetaFolder, MetaKind } from '../../domain/MetaTypes';
import { getObjectLocationFromXml } from '../fs/ObjectLocation';
import { ConfigurationXmlEditor, EditResult } from './ConfigurationXmlEditor';

export interface MetadataReference {
  filePath: string;
  pattern: string;
}

export interface RemoveRootMetadataOptions {
  configRoot: string;
  kind: MetaKind;
  name: string;
  force?: boolean;
  keepFiles?: boolean;
}

export interface RemoveChildMetadataOptions {
  ownerObjectXmlPath: string;
  childTag: ChildTag | 'Column';
  name: string;
  tabularSectionName?: string;
  keepFiles?: boolean;
}

export interface RemoveMetadataResult extends EditResult {
  references: MetadataReference[];
}

const TYPE_REF_NAMES: Partial<Record<MetaKind, readonly string[]>> = {
  Catalog: ['CatalogRef', 'CatalogObject'],
  Document: ['DocumentRef', 'DocumentObject'],
  Enum: ['EnumRef'],
  ExchangePlan: ['ExchangePlanRef', 'ExchangePlanObject'],
  ChartOfAccounts: ['ChartOfAccountsRef', 'ChartOfAccountsObject'],
  ChartOfCharacteristicTypes: ['ChartOfCharacteristicTypesRef', 'ChartOfCharacteristicTypesObject'],
  ChartOfCalculationTypes: ['ChartOfCalculationTypesRef', 'ChartOfCalculationTypesObject'],
  BusinessProcess: ['BusinessProcessRef', 'BusinessProcessObject'],
  Task: ['TaskRef', 'TaskObject'],
};

const TYPE_RU_MANAGER: Partial<Record<MetaKind, string>> = {
  Catalog: 'Справочники',
  Document: 'Документы',
  Enum: 'Перечисления',
  Constant: 'Константы',
  InformationRegister: 'РегистрыСведений',
  AccumulationRegister: 'РегистрыНакопления',
  AccountingRegister: 'РегистрыБухгалтерии',
  CalculationRegister: 'РегистрыРасчета',
  ChartOfAccounts: 'ПланыСчетов',
  ChartOfCharacteristicTypes: 'ПланыВидовХарактеристик',
  ChartOfCalculationTypes: 'ПланыВидовРасчета',
  BusinessProcess: 'БизнесПроцессы',
  Task: 'Задачи',
  ExchangePlan: 'ПланыОбмена',
  Report: 'Отчеты',
  DataProcessor: 'Обработки',
  DocumentJournal: 'ЖурналыДокументов',
};

/**
 * Удаляет метаданные из XML-выгрузки без зависимости от внешних skill-скриптов.
 * Повторяет безопасный порядок удаления: ссылки, регистрация, подсистемы, файлы.
 */
export class MetadataXmlRemover {
  private readonly configEditor = new ConfigurationXmlEditor();

  removeRootObject(options: RemoveRootMetadataOptions): RemoveMetadataResult {
    const folder = getMetaFolder(options.kind);
    if (!folder) {
      return fail(`Тип "${options.kind}" не поддерживает удаление файлов.`);
    }

    const configXmlPath = path.join(options.configRoot, 'Configuration.xml');
    if (!fs.existsSync(configXmlPath)) {
      return fail(`Не найден Configuration.xml: ${configXmlPath}`);
    }

    const typeDir = path.join(options.configRoot, folder);
    const flatXmlPath = path.join(typeDir, `${options.name}.xml`);
    const objectDir = path.join(typeDir, options.name);
    const deepXmlPath = path.join(objectDir, `${options.name}.xml`);
    const xmlPath = fs.existsSync(deepXmlPath) ? deepXmlPath : flatXmlPath;
    const hasXml = fs.existsSync(flatXmlPath) || fs.existsSync(deepXmlPath);
    const hasDir = fs.existsSync(objectDir) && fs.statSync(objectDir).isDirectory();

    const registered = this.isRegistered(configXmlPath, options.kind, options.name);
    if (!hasXml && !hasDir && !registered) {
      return fail(`Объект "${options.kind}.${options.name}" не найден.`);
    }

    const references = this.findReferences({
      configRoot: options.configRoot,
      kind: options.kind,
      name: options.name,
      folder,
      objectDir: hasDir ? objectDir : undefined,
      xmlPaths: [flatXmlPath, deepXmlPath].filter((item) => fs.existsSync(item)),
    });
    if (references.length > 0 && !options.force) {
      return {
        success: false,
        changed: false,
        changedFiles: [],
        warnings: [],
        errors: [`Найдены ссылки на "${options.kind}.${options.name}": ${references.length}.`],
        references,
      };
    }

    const changedFiles: string[] = [];
    const warnings: string[] = [];

    const deregister = this.configEditor.removeChildObject(configXmlPath, `${options.kind}.${options.name}`);
    if (!deregister.success) {
      return { ...deregister, references };
    }
    changedFiles.push(...deregister.changedFiles);
    warnings.push(...deregister.warnings);

    const subsystemFiles = this.removeFromSubsystems(options.configRoot, `${options.kind}.${options.name}`);
    changedFiles.push(...subsystemFiles);

    if (!options.keepFiles) {
      for (const filePath of [flatXmlPath, deepXmlPath]) {
        if (fs.existsSync(filePath) && this.isInsideOrEqual(filePath, options.configRoot)) {
          fs.rmSync(filePath, { force: true });
          changedFiles.push(filePath);
        }
      }
      if (hasDir && this.isInsideOrEqual(objectDir, options.configRoot)) {
        fs.rmSync(objectDir, { recursive: true, force: true });
        changedFiles.push(objectDir);
      }
    }

    return ok(uniquePaths(changedFiles), warnings, references);
  }

  removeChildElement(options: RemoveChildMetadataOptions): RemoveMetadataResult {
    if (!fs.existsSync(options.ownerObjectXmlPath)) {
      return fail(`Не найден XML владельца: ${options.ownerObjectXmlPath}`);
    }

    const xml = fs.readFileSync(options.ownerObjectXmlPath, 'utf-8');
    const nextXml = options.childTag === 'Column'
      ? removeColumnFromTabularSectionXml(xml, options.tabularSectionName, options.name)
      : removeNamedChildFromObjectXml(xml, options.childTag, options.name);
    if (!nextXml.changed) {
      return fail(nextXml.error);
    }

    fs.writeFileSync(options.ownerObjectXmlPath, nextXml.xml, 'utf-8');
    const changedFiles = [options.ownerObjectXmlPath];
    if (!options.keepFiles) {
      changedFiles.push(...this.removeAuxiliaryChildFiles(options));
    }
    return ok(uniquePaths(changedFiles), [], []);
  }

  private isRegistered(configXmlPath: string, kind: MetaKind, name: string): boolean {
    const xml = fs.readFileSync(configXmlPath, 'utf-8');
    return new RegExp(`<${kind}>\\s*${escapeRegExp(name)}\\s*<\\/${kind}>`).test(xml);
  }

  private findReferences(options: {
    configRoot: string;
    kind: MetaKind;
    name: string;
    folder: string;
    objectDir?: string;
    xmlPaths: string[];
  }): MetadataReference[] {
    const patterns = this.buildReferencePatterns(options.kind, options.name, options.folder);
    const references: MetadataReference[] = [];
    const excludedXml = new Set(options.xmlPaths.map((item) => path.resolve(item).toLowerCase()));
    const excludedDir = options.objectDir ? path.resolve(options.objectDir).toLowerCase() : undefined;

    for (const filePath of this.walkFiles(options.configRoot)) {
      if (!/\.(xml|bsl)$/i.test(filePath)) {
        continue;
      }
      const normalized = path.resolve(filePath).toLowerCase();
      if (excludedXml.has(normalized) || (excludedDir && isPathInsideOrEqual(normalized, excludedDir))) {
        continue;
      }
      const relPath = path.relative(options.configRoot, filePath).replace(/\\/g, '/');
      if (relPath === 'Configuration.xml' || relPath === 'ConfigDumpInfo.xml' || relPath.startsWith('Subsystems/')) {
        continue;
      }

      let content = '';
      try {
        content = fs.readFileSync(filePath, 'utf-8');
      } catch {
        continue;
      }
      const pattern = patterns.find((item) => content.includes(item));
      if (pattern) {
        references.push({ filePath, pattern });
      }
    }

    return references;
  }

  private buildReferencePatterns(kind: MetaKind, name: string, folder: string): string[] {
    const patterns = [
      ...(TYPE_REF_NAMES[kind] ?? []).map((refName) => `${refName}.${name}`),
      `${folder}.${name}`,
      `${kind}.${name}`,
    ];
    const manager = TYPE_RU_MANAGER[kind];
    if (manager) {
      patterns.push(`${manager}.${name}`);
    }
    if (kind === 'CommonModule') {
      patterns.push(`${name}.`, `<Handler>${name}.`, `<MethodName>${name}.`);
    }
    return [...new Set(patterns)];
  }

  private removeFromSubsystems(configRoot: string, objectRef: string): string[] {
    const changed: string[] = [];
    const subsystemsRoot = path.join(configRoot, 'Subsystems');
    if (!fs.existsSync(subsystemsRoot)) {
      return changed;
    }

    for (const filePath of this.walkFiles(subsystemsRoot)) {
      if (!filePath.toLowerCase().endsWith('.xml')) {
        continue;
      }
      const xml = fs.readFileSync(filePath, 'utf-8');
      const next = removeContentItem(xml, objectRef);
      if (next !== xml) {
        fs.writeFileSync(filePath, next, 'utf-8');
        changed.push(filePath);
      }
    }
    return changed;
  }

  private removeAuxiliaryChildFiles(options: RemoveChildMetadataOptions): string[] {
    const loc = getObjectLocationFromXml(options.ownerObjectXmlPath);
    const changed: string[] = [];
    const removePath = (targetPath: string) => {
      if (!fs.existsSync(targetPath) || !this.isInsideOrEqual(targetPath, loc.configRoot)) {
        return;
      }
      fs.rmSync(targetPath, { recursive: true, force: true });
      changed.push(targetPath);
    };

    if (options.childTag === 'Command') {
      removePath(path.join(loc.objectDir, 'Commands', options.name));
    } else if (options.childTag === 'Form') {
      removePath(path.join(loc.objectDir, 'Forms', options.name));
    } else if (options.childTag === 'Template') {
      removePath(path.join(loc.objectDir, 'Templates', `${options.name}.xml`));
      removePath(path.join(loc.objectDir, 'Templates', options.name));
    }
    return changed;
  }

  private walkFiles(rootDir: string): string[] {
    const result: string[] = [];
    if (!fs.existsSync(rootDir)) {
      return result;
    }
    for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
      const fullPath = path.join(rootDir, entry.name);
      if (entry.isDirectory()) {
        result.push(...this.walkFiles(fullPath));
      } else {
        result.push(fullPath);
      }
    }
    return result;
  }

  private isInsideOrEqual(targetPath: string, rootPath: string): boolean {
    return isPathInsideOrEqual(path.resolve(targetPath).toLowerCase(), path.resolve(rootPath).toLowerCase());
  }
}

function removeNamedChildFromObjectXml(
  xml: string,
  childTag: ChildTag,
  name: string
): { changed: true; xml: string } | { changed: false; error: string } {
  const block = findNamedChildBlock(xml, childTag, name);
  if (!block) {
    return { changed: false, error: `Элемент "${name}" не найден.` };
  }
  return { changed: true, xml: removeRangeWithLine(xml, block.start, block.end) };
}

function removeColumnFromTabularSectionXml(
  xml: string,
  tabularSectionName: string | undefined,
  columnName: string
): { changed: true; xml: string } | { changed: false; error: string } {
  if (!tabularSectionName) {
    return { changed: false, error: 'Не указана табличная часть для удаления колонки.' };
  }
  const section = findNamedChildBlock(xml, 'TabularSection', tabularSectionName);
  if (!section) {
    return { changed: false, error: `Табличная часть "${tabularSectionName}" не найдена.` };
  }
  const sectionXml = xml.slice(section.start, section.end);
  const column = findNamedChildBlock(sectionXml, 'Attribute', columnName);
  if (!column) {
    return { changed: false, error: `Колонка "${columnName}" не найдена.` };
  }
  const nextSectionXml = removeRangeWithLine(sectionXml, column.start, column.end);
  return { changed: true, xml: `${xml.slice(0, section.start)}${nextSectionXml}${xml.slice(section.end)}` };
}

function findNamedChildBlock(xml: string, tag: string, name: string): { start: number; end: number } | null {
  const blockRe = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'g');
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(xml)) !== null) {
    if (hasOwnName(match[0], name)) {
      return { start: match.index, end: match.index + match[0].length };
    }
  }
  return null;
}

function hasOwnName(blockXml: string, name: string): boolean {
  const properties = /<Properties>([\s\S]*?)<\/Properties>/.exec(blockXml)?.[1];
  if (properties === undefined) {
    return false;
  }
  return new RegExp(`<Name>\\s*${escapeRegExp(name)}\\s*<\\/Name>`).test(properties);
}

function removeContentItem(xml: string, objectRef: string): string {
  const escaped = escapeRegExp(objectRef);
  return xml.replace(
    new RegExp(`[ \\t\\r\\n]*<xr:Item\\b[^>]*>\\s*${escaped}\\s*<\\/xr:Item>`, 'g'),
    ''
  );
}

function removeRangeWithLine(xml: string, start: number, end: number): string {
  let from = start;
  let to = end;
  while (from > 0 && (xml[from - 1] === ' ' || xml[from - 1] === '\t')) {
    from -= 1;
  }
  if (from > 0 && xml[from - 1] === '\n') {
    from -= 1;
    if (from > 0 && xml[from - 1] === '\r') {
      from -= 1;
    }
  } else if (to < xml.length && xml[to] === '\r') {
    to += 1;
    if (to < xml.length && xml[to] === '\n') {
      to += 1;
    }
  } else if (to < xml.length && xml[to] === '\n') {
    to += 1;
  }
  return `${xml.slice(0, from)}${xml.slice(to)}`;
}

function ok(changedFiles: string[], warnings: string[], references: MetadataReference[]): RemoveMetadataResult {
  return { success: true, changed: changedFiles.length > 0, changedFiles, warnings, errors: [], references };
}

function fail(message: string): RemoveMetadataResult {
  return { success: false, changed: false, changedFiles: [], warnings: [], errors: [message], references: [] };
}

function uniquePaths(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const key = path.resolve(item).toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}

function isPathInsideOrEqual(targetPath: string, rootPath: string): boolean {
  const relative = path.relative(rootPath, targetPath);
  return relative === '' || (Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
