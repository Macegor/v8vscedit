import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { XMLValidator } from 'fast-xml-parser';
import { getMetaFolder, META_TYPES } from '../../domain/MetaTypes';
import { ConfigurationXmlEditor } from './ConfigurationXmlEditor';
import { CommandInterfaceService, type CommandInterfaceInfoResult, type CommandInterfaceValidationResult } from './CommandInterfaceService';
import { SubsystemXmlService, type SubsystemInfo } from './SubsystemXmlService';
import { escapeXmlText, extractMetaDataObjectVersion } from './XmlUtils';

const DEFAULT_FORMAT_VERSION = '2.18';
const IDENTIFIER_RE = /^[A-Za-zА-Яа-яЁё_][A-Za-z0-9А-Яа-яЁё_]*$/;
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const KNOWN_SINGULAR_TYPES = new Set(Object.keys(META_TYPES));
const KNOWN_PLURAL_TYPES = new Set(Object.values(META_TYPES).map((def) => def.folder));

export type SubsystemInfoMode = 'overview' | 'content' | 'ci' | 'tree' | 'full';

export interface SubsystemInfoOptions {
  readonly subsystemPath: string;
  readonly mode?: SubsystemInfoMode;
  readonly name?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface SubsystemInfoResult {
  readonly subsystemPath: string;
  readonly mode: SubsystemInfoMode;
  readonly subsystem?: SubsystemInfo;
  readonly contentGroups?: readonly { readonly type: string; readonly refs: readonly string[] }[];
  readonly tree?: readonly SubsystemTreeItem[];
  readonly commandInterface?: CommandInterfaceInfoResult | null;
  readonly lines: readonly string[];
}

export interface SubsystemTreeItem {
  readonly name: string;
  readonly xmlPath: string | null;
  readonly missing: boolean;
  readonly contentCount: number;
  readonly childCount: number;
  readonly markers: readonly string[];
  readonly children: readonly SubsystemTreeItem[];
}

export interface SubsystemValidationOptions {
  readonly subsystemPath: string;
  readonly detailed?: boolean;
  readonly maxErrors?: number;
}

export interface SubsystemValidationIssue {
  readonly severity: 'error' | 'warning' | 'ok';
  readonly message: string;
}

export interface SubsystemValidationResult {
  readonly subsystemPath: string;
  readonly name: string;
  readonly errors: number;
  readonly warnings: number;
  readonly checks: number;
  readonly issues: readonly SubsystemValidationIssue[];
  readonly lines: readonly string[];
  readonly commandInterface?: CommandInterfaceValidationResult | null;
}

export interface SubsystemCompileOptions {
  readonly outputDir: string;
  readonly parentPath?: string;
  readonly definition: SubsystemDefinition;
}

export interface SubsystemDefinition {
  readonly name: string;
  readonly synonym?: string;
  readonly comment?: string;
  readonly includeHelpInContents?: boolean;
  readonly includeInCommandInterface?: boolean;
  readonly useOneCommand?: boolean;
  readonly explanation?: string;
  readonly picture?: string;
  readonly content?: readonly string[];
  readonly children?: readonly string[];
}

export interface SubsystemCompileResult {
  readonly name: string;
  readonly uuid: string;
  readonly subsystemPath: string;
  readonly changedFiles: readonly string[];
  readonly warnings: readonly string[];
}

export class SubsystemToolsService {
  private readonly subsystemXmlService = new SubsystemXmlService();
  private readonly configurationXmlEditor = new ConfigurationXmlEditor();
  private readonly commandInterfaceService = new CommandInterfaceService();

  info(options: SubsystemInfoOptions): SubsystemInfoResult {
    const mode = options.mode ?? 'overview';
    const targetPath = resolveSubsystemPath(options.subsystemPath, options.name, mode === 'tree');
    if (mode === 'tree') {
      const tree = fs.statSync(targetPath).isDirectory()
        ? this.readRootTree(targetPath, options.name)
        : [this.readTreeItem(targetPath)];
      const lines = paginate(['Дерево подсистем:', '', ...tree.flatMap((item, index) => renderTree(item, '', index === tree.length - 1, true))], options.limit, options.offset);
      return { subsystemPath: targetPath, mode, tree, lines };
    }

    const subsystem = this.subsystemXmlService.readSubsystem(targetPath);
    const contentGroups = groupContent(subsystem.contentRefs);
    const commandInterface = subsystem.commandInterfacePath
      ? this.commandInterfaceService.info({ ciPath: subsystem.commandInterfacePath })
      : null;
    const lines = buildInfoLines(mode, subsystem, contentGroups, commandInterface);
    return {
      subsystemPath: targetPath,
      mode,
      subsystem,
      contentGroups,
      commandInterface: mode === 'ci' || mode === 'full' ? commandInterface : undefined,
      lines: paginate(lines, options.limit, options.offset),
    };
  }

  validate(options: SubsystemValidationOptions): SubsystemValidationResult {
    const subsystemPath = resolveSubsystemPath(options.subsystemPath);
    const maxErrors = options.maxErrors ?? 30;
    const xml = fs.readFileSync(subsystemPath, 'utf-8');
    const issues: SubsystemValidationIssue[] = [];
    const push = (severity: SubsystemValidationIssue['severity'], message: string) => {
      if (severity === 'ok' && !options.detailed) {
        return;
      }
      issues.push({ severity, message });
    };

    const syntax = XMLValidator.validate(xml);
    if (syntax !== true) {
      push('error', `XML не разобран: ${syntax.err.msg}`);
      return buildValidationResult(subsystemPath, '', issues, maxErrors, null);
    }
    push('ok', 'XML корректно разобран.');
    if (!/<MetaDataObject\b/.test(xml) || !/<Subsystem\b/.test(xml)) {
      push('error', 'Ожидается структура MetaDataObject/Subsystem.');
      return buildValidationResult(subsystemPath, '', issues, maxErrors, null);
    }

    const uuid = /<Subsystem\b[^>]*\buuid="([^"]+)"/.exec(xml)?.[1] ?? '';
    if (!UUID_RE.test(uuid)) {
      push('error', 'У Subsystem отсутствует корректный uuid.');
    } else {
      push('ok', `UUID корректен: ${uuid}.`);
    }

    const subsystem = this.subsystemXmlService.readSubsystem(subsystemPath);
    if (!IDENTIFIER_RE.test(subsystem.name)) {
      push('error', `Имя подсистемы недопустимо: ${subsystem.name || '<пусто>'}.`);
    } else {
      push('ok', `Имя подсистемы корректно: ${subsystem.name}.`);
    }

    for (const prop of ['Name', 'Synonym', 'Comment', 'IncludeHelpInContents', 'IncludeInCommandInterface', 'UseOneCommand', 'Explanation', 'Picture', 'Content']) {
      if (!new RegExp(`<${prop}(?:>|\\s|/)`).test(xml)) {
        push('error', `Отсутствует обязательное свойство ${prop}.`);
      }
    }
    for (const prop of ['IncludeHelpInContents', 'IncludeInCommandInterface', 'UseOneCommand']) {
      const value = extractSimpleTagText(xml, prop);
      if (value !== 'true' && value !== 'false') {
        push('error', `${prop} должен быть true/false.`);
      }
    }

    const duplicatedContent = findDuplicates(subsystem.contentRefs);
    for (const ref of duplicatedContent) {
      push('warning', `Content содержит дубль: ${ref}.`);
    }
    for (const ref of subsystem.contentRefs) {
      const type = ref.split('.')[0] ?? '';
      if (!/^[A-Za-z]+\..+/.test(ref) && !UUID_RE.test(ref)) {
        push('error', `Content содержит неверную ссылку: ${ref}.`);
      } else if (KNOWN_PLURAL_TYPES.has(type)) {
        push('error', `Content использует множественный тип ${type}; нужен singular-тип.`);
      } else if (type && !KNOWN_SINGULAR_TYPES.has(type) && !UUID_RE.test(ref)) {
        push('warning', `Content содержит неизвестный тип: ${ref}.`);
      }
    }

    const duplicatedChildren = findDuplicates(subsystem.childSubsystems);
    for (const child of duplicatedChildren) {
      push('error', `ChildObjects содержит дубль подсистемы: ${child}.`);
    }
    for (const child of subsystem.childSubsystems) {
      if (!child) {
        push('error', 'ChildObjects содержит пустую подсистему.');
        continue;
      }
      const childPath = path.join(subsystem.homeDir, 'Subsystems', child, `${child}.xml`);
      const flatChildPath = path.join(subsystem.homeDir, 'Subsystems', `${child}.xml`);
      if (!fs.existsSync(childPath) && !fs.existsSync(flatChildPath)) {
        push('warning', `Файл дочерней подсистемы не найден: ${child}.`);
      }
    }
    if (subsystem.pictureRef && !subsystem.pictureRef.startsWith('CommonPicture.')) {
      push('warning', `Картинка "${subsystem.pictureRef}" обычно должна ссылаться на CommonPicture.*.`);
    }
    if (subsystem.useOneCommand && subsystem.contentRefs.length !== 1) {
      push('warning', `UseOneCommand=true, но в Content ${String(subsystem.contentRefs.length)} объектов.`);
    }

    let ciResult: CommandInterfaceValidationResult | null = null;
    if (subsystem.commandInterfacePath) {
      ciResult = this.commandInterfaceService.validate({
        ciPath: subsystem.commandInterfacePath,
        detailed: options.detailed,
        maxErrors,
      });
      for (const issue of ciResult.issues) {
        if (issue.severity !== 'ok') {
          push(issue.severity, `CommandInterface: ${issue.message}`);
        }
      }
    } else {
      push('ok', 'CommandInterface.xml не задан.');
    }

    return buildValidationResult(subsystemPath, subsystem.name, issues, maxErrors, ciResult);
  }

  compile(options: SubsystemCompileOptions): SubsystemCompileResult {
    const definition = normalizeDefinition(options.definition);
    if (!IDENTIFIER_RE.test(definition.name)) {
      throw new Error(`Недопустимое имя подсистемы: ${definition.name}`);
    }

    const parentPath = options.parentPath ? resolveSubsystemPath(options.parentPath) : undefined;
    const configRoot = parentPath ? this.subsystemXmlService.readSubsystem(parentPath).configRoot : path.resolve(options.outputDir);
    const formatVersion = detectFormatVersion(configRoot);
    const targetDir = parentPath
      ? path.join(this.subsystemXmlService.readSubsystem(parentPath).homeDir, 'Subsystems')
      : path.join(configRoot, getMetaFolder('Subsystem') ?? 'Subsystems');
    const subsystemPath = path.join(targetDir, `${definition.name}.xml`);
    const warnings: string[] = [];
    if (fs.existsSync(subsystemPath)) {
      throw new Error(`Подсистема уже существует: ${subsystemPath}`);
    }

    fs.mkdirSync(targetDir, { recursive: true });
    const uuid = crypto.randomUUID();
    fs.writeFileSync(subsystemPath, buildSubsystemXml(definition, uuid, formatVersion), 'utf-8');
    const changedFiles = [subsystemPath];

    if (definition.children.length > 0) {
      const childRoot = path.join(targetDir, definition.name, 'Subsystems');
      fs.mkdirSync(childRoot, { recursive: true });
      for (const child of definition.children) {
        const childPath = path.join(childRoot, `${child}.xml`);
        if (!fs.existsSync(childPath)) {
          fs.writeFileSync(childPath, buildSubsystemXml({ ...definition, name: child, content: [], children: [] }, crypto.randomUUID(), formatVersion), 'utf-8');
          changedFiles.push(childPath);
        }
      }
    }

    if (parentPath) {
      if (this.subsystemXmlService.addChildSubsystem(parentPath, definition.name)) {
        changedFiles.push(parentPath);
      }
    } else {
      const configXmlPath = path.join(configRoot, 'Configuration.xml');
      if (fs.existsSync(configXmlPath)) {
        const result = this.configurationXmlEditor.addChildObject(configXmlPath, `Subsystem.${definition.name}`);
        changedFiles.push(...result.changedFiles);
        warnings.push(...result.warnings);
        if (!result.success) {
          throw new Error(result.errors.join('\n') || 'Не удалось зарегистрировать подсистему в Configuration.xml.');
        }
      } else {
        warnings.push(`Configuration.xml не найден, подсистема не зарегистрирована: ${configXmlPath}`);
      }
    }

    return { name: definition.name, uuid, subsystemPath, changedFiles: [...new Set(changedFiles)], warnings };
  }

  private readRootTree(subsystemsRoot: string, name?: string): SubsystemTreeItem[] {
    const files = fs.readdirSync(subsystemsRoot)
      .filter((file) => file.endsWith('.xml'))
      .filter((file) => !name || path.basename(file, '.xml') === name)
      .sort((a, b) => a.localeCompare(b, 'ru'));
    return files.map((file) => this.readTreeItem(path.join(subsystemsRoot, file)));
  }

  private readTreeItem(xmlPath: string): SubsystemTreeItem {
    if (!fs.existsSync(xmlPath)) {
      return {
        name: path.basename(xmlPath, '.xml'),
        xmlPath: null,
        missing: true,
        contentCount: 0,
        childCount: 0,
        markers: ['NOT FOUND'],
        children: [],
      };
    }
    const subsystem = this.subsystemXmlService.readSubsystem(xmlPath);
    const markers = [
      subsystem.commandInterfacePath ? 'CI' : '',
      subsystem.useOneCommand ? 'OneCmd' : '',
      !subsystem.includeInCommandInterface ? 'Скрыт' : '',
    ].filter(Boolean);
    const children = subsystem.childSubsystems.map((child) => {
      const deep = path.join(subsystem.homeDir, 'Subsystems', child, `${child}.xml`);
      const flat = path.join(subsystem.homeDir, 'Subsystems', `${child}.xml`);
      return this.readTreeItem(fs.existsSync(deep) ? deep : flat);
    });
    return {
      name: subsystem.name,
      xmlPath,
      missing: false,
      contentCount: subsystem.contentRefs.length,
      childCount: children.length,
      markers,
      children,
    };
  }
}

function normalizeDefinition(definition: SubsystemDefinition): Required<Omit<SubsystemDefinition, 'picture'>> & { readonly picture: string } {
  const name = definition.name.trim();
  return {
    name,
    synonym: definition.synonym ?? name,
    comment: definition.comment ?? '',
    includeHelpInContents: definition.includeHelpInContents ?? true,
    includeInCommandInterface: definition.includeInCommandInterface ?? true,
    useOneCommand: definition.useOneCommand ?? false,
    explanation: definition.explanation ?? '',
    picture: definition.picture ?? '',
    content: [...(definition.content ?? [])],
    children: [...(definition.children ?? [])],
  };
}

function resolveSubsystemPath(inputPath: string, name?: string, allowDirectory = false): string {
  let target = path.resolve(inputPath);
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
    if (name) {
      target = path.join(target, `${name}.xml`);
    } else if (allowDirectory && path.basename(target) === 'Subsystems') {
      return target;
    } else {
      const dirName = path.basename(target);
      const nested = path.join(target, `${dirName}.xml`);
      const sibling = path.join(path.dirname(target), `${dirName}.xml`);
      target = fs.existsSync(nested) ? nested : sibling;
    }
  }
  if (!fs.existsSync(target)) {
    const fileName = path.basename(target, '.xml');
    const parent = path.dirname(target);
    const flat = path.basename(parent) === fileName ? path.join(path.dirname(parent), `${fileName}.xml`) : target;
    if (fs.existsSync(flat)) {
      target = flat;
    }
  }
  if (!fs.existsSync(target)) {
    throw new Error(`Подсистема не найдена: ${target}`);
  }
  return target;
}

function buildSubsystemXml(definition: ReturnType<typeof normalizeDefinition>, uuid: string, version: string): string {
  const content = definition.content.length > 0
    ? `<Content>\n${definition.content.map((ref) => `\t\t\t\t<xr:Item xsi:type="xr:MDObjectRef">${escapeXmlText(ref)}</xr:Item>`).join('\n')}\n\t\t\t</Content>`
    : '<Content/>';
  const children = definition.children.length > 0
    ? `<ChildObjects>\n${definition.children.map((child) => `\t\t\t<Subsystem>${escapeXmlText(child)}</Subsystem>`).join('\n')}\n\t\t</ChildObjects>`
    : '<ChildObjects/>';
  const picture = definition.picture
    ? `<Picture>\n\t\t\t\t<xr:Ref>${escapeXmlText(definition.picture)}</xr:Ref>\n\t\t\t\t<xr:LoadTransparent>false</xr:LoadTransparent>\n\t\t\t</Picture>`
    : '<Picture/>';

  return `<?xml version="1.0" encoding="UTF-8"?>
<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" xmlns:v8="http://v8.1c.ru/8.1/data/core" xmlns:xr="http://v8.1c.ru/8.3/xcf/readable" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" version="${version}">
\t<Subsystem uuid="${uuid}">
\t\t<Properties>
\t\t\t<Name>${escapeXmlText(definition.name)}</Name>
\t\t\t${buildLocalizedBlock('Synonym', definition.synonym)}
\t\t\t<Comment>${escapeXmlText(definition.comment)}</Comment>
\t\t\t<IncludeHelpInContents>${String(definition.includeHelpInContents)}</IncludeHelpInContents>
\t\t\t<IncludeInCommandInterface>${String(definition.includeInCommandInterface)}</IncludeInCommandInterface>
\t\t\t<UseOneCommand>${String(definition.useOneCommand)}</UseOneCommand>
\t\t\t${buildLocalizedBlock('Explanation', definition.explanation)}
\t\t\t${picture}
\t\t\t${content}
\t\t</Properties>
\t\t${children}
\t</Subsystem>
</MetaDataObject>
`;
}

function buildLocalizedBlock(tagName: string, value: string): string {
  if (!value) {
    return `<${tagName}/>`;
  }
  return `<${tagName}>
\t\t\t\t<v8:item>
\t\t\t\t\t<v8:lang>ru</v8:lang>
\t\t\t\t\t<v8:content>${escapeXmlText(value)}</v8:content>
\t\t\t\t</v8:item>
\t\t\t</${tagName}>`;
}

function buildInfoLines(mode: SubsystemInfoMode, subsystem: SubsystemInfo, groups: readonly { readonly type: string; readonly refs: readonly string[] }[], commandInterface: CommandInterfaceInfoResult | null): string[] {
  const lines: string[] = [];
  if (mode === 'overview' || mode === 'full') {
    lines.push(`Подсистема: ${subsystem.name}`);
    lines.push(`Синоним: ${subsystem.synonym || '<пусто>'}`);
    lines.push(`Включать в командный интерфейс: ${String(subsystem.includeInCommandInterface)}`);
    lines.push(`Одна команда: ${String(subsystem.useOneCommand)}`);
    lines.push(`Контент: ${String(subsystem.contentRefs.length)} объектов`);
    lines.push(`Дочерние подсистемы: ${String(subsystem.childSubsystems.length)}`);
    lines.push(`CommandInterface.xml: ${subsystem.commandInterfacePath ?? '<нет>'}`);
  }
  if (mode === 'content' || mode === 'full') {
    lines.push('', 'Состав:');
    for (const group of groups) {
      lines.push(`  ${group.type}:`);
      lines.push(...group.refs.map((ref) => `    ${ref}`));
    }
  }
  if ((mode === 'ci' || mode === 'full') && commandInterface) {
    lines.push('', 'Командный интерфейс:');
    lines.push(...commandInterface.lines.map((line) => `  ${line}`));
  }
  if ((mode === 'ci' || mode === 'full') && !commandInterface) {
    lines.push('', 'Командный интерфейс: <нет>');
  }
  return lines;
}

function groupContent(refs: readonly string[]): { readonly type: string; readonly refs: readonly string[] }[] {
  const map = new Map<string, string[]>();
  for (const ref of refs) {
    const type = ref.split('.')[0] || 'Other';
    map.set(type, [...(map.get(type) ?? []), ref]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, items]) => ({ type, refs: items }));
}

function renderTree(item: SubsystemTreeItem, prefix: string, isLast: boolean, isRoot: boolean): string[] {
  const connector = isRoot ? '' : isLast ? '└── ' : '├── ';
  const marker = item.markers.length > 0 ? ` [${item.markers.join(', ')}]` : '';
  const line = `${prefix}${connector}${item.name}${marker} (${String(item.contentCount)} объектов, ${String(item.childCount)} дочерних)`;
  const childPrefix = isRoot ? '' : `${prefix}${isLast ? '    ' : '│   '}`;
  return [
    line,
    ...item.children.flatMap((child, index) => renderTree(child, childPrefix, index === item.children.length - 1, false)),
  ];
}

function buildValidationResult(
  subsystemPath: string,
  name: string,
  issues: readonly SubsystemValidationIssue[],
  maxErrors: number,
  commandInterface: CommandInterfaceValidationResult | null
): SubsystemValidationResult {
  const limited = limitErrors(issues, maxErrors);
  const errors = limited.filter((issue) => issue.severity === 'error').length;
  const warnings = limited.filter((issue) => issue.severity === 'warning').length;
  const lines = [`=== Validation: Subsystem.${name || path.basename(subsystemPath, '.xml')} ===`, `Файл: ${subsystemPath}`, ''];
  for (const issue of limited) {
    const prefix = issue.severity === 'error' ? '[ERROR]' : issue.severity === 'warning' ? '[WARN] ' : '[OK]   ';
    lines.push(`${prefix} ${issue.message}`);
  }
  lines.push('', `=== Result: ${String(errors)} errors, ${String(warnings)} warnings (${String(limited.length)} checks) ===`);
  return { subsystemPath, name, errors, warnings, checks: limited.length, issues: limited, lines, commandInterface };
}

function findDuplicates(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const item of items) {
    if (seen.has(item)) {
      dupes.add(item);
    }
    seen.add(item);
  }
  return [...dupes];
}

function limitErrors(issues: readonly SubsystemValidationIssue[], maxErrors: number): SubsystemValidationIssue[] {
  const result: SubsystemValidationIssue[] = [];
  let errors = 0;
  for (const issue of issues) {
    result.push(issue);
    if (issue.severity === 'error') {
      errors += 1;
      if (errors >= maxErrors) {
        break;
      }
    }
  }
  return result;
}

function detectFormatVersion(configRoot: string): string {
  const configXmlPath = path.join(configRoot, 'Configuration.xml');
  if (!fs.existsSync(configXmlPath)) {
    return DEFAULT_FORMAT_VERSION;
  }
  return extractMetaDataObjectVersion(fs.readFileSync(configXmlPath, 'utf-8')) ?? DEFAULT_FORMAT_VERSION;
}

function extractSimpleTagText(xml: string, tagName: string): string {
  return new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`).exec(xml)?.[1].trim() ?? '';
}

function paginate(lines: readonly string[], limit?: number, offset?: number): string[] {
  const start = offset ?? 0;
  const sliced = lines.slice(start, limit && limit > 0 ? start + limit : undefined);
  if (limit && limit > 0 && start + limit < lines.length) {
    return [...sliced, '', `[ОБРЕЗАНО] Показано ${String(sliced.length)} из ${String(lines.length)} строк.`];
  }
  return sliced;
}
