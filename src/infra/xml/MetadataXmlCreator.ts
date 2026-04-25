import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { ChildTag } from '../../domain/ChildTag';
import { getMetaFolder, MetaKind } from '../../domain/MetaTypes';
import { ConfigurationXmlEditor, EditResult } from './ConfigurationXmlEditor';
import { getObjectLocationFromXml } from '../fs/MetaPathResolver';

export interface AddRootMetadataOptions {
  configRoot: string;
  kind: MetaKind;
  name: string;
}

export interface AddChildMetadataOptions {
  ownerObjectXmlPath: string;
  childTag: ChildTag | 'Column';
  name: string;
  tabularSectionName?: string;
}

/**
 * Создаёт минимально полноценные XML-исходники метаданных внутри выгрузки.
 * Нужен runtime-расширению, чтобы не зависеть от локальных `.codex/skills`.
 */
export class MetadataXmlCreator {
  private readonly configEditor = new ConfigurationXmlEditor();

  addRootObject(options: AddRootMetadataOptions): EditResult {
    const validation = validateMetadataName(options.name);
    if (!validation.success) {
      return validation;
    }

    const folder = getMetaFolder(options.kind);
    if (!folder) {
      return fail(`Тип "${options.kind}" не поддерживает создание файлов.`);
    }

    const typeDir = path.join(options.configRoot, folder);
    const xmlPath = path.join(typeDir, `${options.name}.xml`);
    const objectDir = path.join(typeDir, options.name);
    if (fs.existsSync(xmlPath) || fs.existsSync(objectDir)) {
      return fail(`Объект "${options.kind}.${options.name}" уже существует.`);
    }

    fs.mkdirSync(typeDir, { recursive: true });
    fs.writeFileSync(xmlPath, buildRootObjectXml(options.kind, options.name), 'utf-8');

    const changedFiles = [xmlPath];
    for (const modulePath of getDefaultModulePaths(options.kind, objectDir)) {
      ensureEmptyFile(modulePath);
      changedFiles.push(modulePath);
    }
    if (options.kind === 'CommonForm') {
      const formXmlPath = path.join(objectDir, 'Ext', 'Form.xml');
      fs.mkdirSync(path.dirname(formXmlPath), { recursive: true });
      fs.writeFileSync(formXmlPath, buildManagedFormXml(), 'utf-8');
      changedFiles.push(formXmlPath);
    }

    if (options.kind === 'Role') {
      const rightsPath = path.join(objectDir, 'Ext', 'Rights.xml');
      fs.mkdirSync(path.dirname(rightsPath), { recursive: true });
      fs.writeFileSync(rightsPath, buildEmptyRightsXml(), 'utf-8');
      changedFiles.push(rightsPath);
    }

    if (options.kind === 'BusinessProcess') {
      const flowchartPath = path.join(objectDir, 'Ext', 'Flowchart.xml');
      fs.mkdirSync(path.dirname(flowchartPath), { recursive: true });
      fs.writeFileSync(flowchartPath, buildBusinessProcessFlowchartXml(), 'utf-8');
      changedFiles.push(flowchartPath);
    }

    const configXmlPath = path.join(options.configRoot, 'Configuration.xml');
    const register = this.configEditor.addChildObject(configXmlPath, `${options.kind}.${options.name}`);
    if (!register.success) {
      return register;
    }

    return ok([...changedFiles, ...register.changedFiles]);
  }

  addChildElement(options: AddChildMetadataOptions): EditResult {
    const validation = validateMetadataName(options.name);
    if (!validation.success) {
      return validation;
    }
    if (!fs.existsSync(options.ownerObjectXmlPath)) {
      return fail(`Не найден XML владельца: ${options.ownerObjectXmlPath}`);
    }

    const xml = fs.readFileSync(options.ownerObjectXmlPath, 'utf-8');
    const nextXml = addChildToObjectXml(xml, options);
    if (!nextXml.changed) {
      return fail(nextXml.error ?? 'Не удалось добавить дочерний элемент.');
    }

    fs.writeFileSync(options.ownerObjectXmlPath, nextXml.xml, 'utf-8');
    const changedFiles = [options.ownerObjectXmlPath];
    changedFiles.push(...ensureAuxiliaryChildFiles(options));
    return ok(changedFiles);
  }
}

function addChildToObjectXml(xml: string, options: AddChildMetadataOptions): { changed: true; xml: string } | { changed: false; error: string } {
  if (options.childTag === 'Column') {
    if (!options.tabularSectionName) {
      return { changed: false, error: 'Не указана табличная часть для добавления колонки.' };
    }
    return addColumnToTabularSectionXml(xml, options.tabularSectionName, options.name);
  }

  const objectMatch = /<([A-Za-z][A-Za-z0-9]*)\b[^>]*>/.exec(xml);
  if (!objectMatch) {
    return { changed: false, error: 'Не найден корневой элемент объекта метаданных.' };
  }
  const childObjects = getChildObjectsBlock(xml);
  if (!childObjects) {
    return { changed: false, error: 'В XML объекта отсутствует блок <ChildObjects>.' };
  }
  if (hasChildName(childObjects.inner, options.childTag, options.name)) {
    return { changed: false, error: `Элемент "${options.name}" уже существует.` };
  }

  const indent = detectChildIndent(childObjects.inner, '\t\t\t');
  const fragment = buildChildFragment(options.childTag, options.name, indent);
  const replacement = buildChildObjectsReplacement(childObjects, fragment, indent);
  return { changed: true, xml: `${xml.slice(0, childObjects.start)}${replacement}${xml.slice(childObjects.end)}` };
}

function addColumnToTabularSectionXml(xml: string, tabularSectionName: string, columnName: string): { changed: true; xml: string } | { changed: false; error: string } {
  const section = findNamedChildBlock(xml, 'TabularSection', tabularSectionName);
  if (!section) {
    return { changed: false, error: `Табличная часть "${tabularSectionName}" не найдена.` };
  }
  const sectionXml = xml.slice(section.start, section.end);
  const childObjects = getChildObjectsBlock(sectionXml);
  if (!childObjects) {
    return { changed: false, error: `В табличной части "${tabularSectionName}" отсутствует <ChildObjects>.` };
  }
  if (hasChildName(childObjects.inner, 'Attribute', columnName)) {
    return { changed: false, error: `Колонка "${columnName}" уже существует.` };
  }

  const indent = detectChildIndent(childObjects.inner, '\t\t\t\t\t');
  const fragment = buildTypedFieldFragment('Attribute', columnName, indent);
  const replacement = buildChildObjectsReplacement(childObjects, fragment, indent);
  const nextSectionXml = `${sectionXml.slice(0, childObjects.start)}${replacement}${sectionXml.slice(childObjects.end)}`;
  return {
    changed: true,
    xml: `${xml.slice(0, section.start)}${nextSectionXml}${xml.slice(section.end)}`,
  };
}

function buildRootObjectXml(kind: MetaKind, name: string): string {
  const parts = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" xmlns:v8="http://v8.1c.ru/8.1/data/core" xmlns:xr="http://v8.1c.ru/8.3/xcf/readable" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" version="2.18">',
    `\t<${kind} uuid="${newUuid()}">`,
    `\t\t<Properties>${buildRootProperties(kind, name)}\n\t\t</Properties>`,
    needsChildObjects(kind) ? '\t\t<ChildObjects/>' : '',
    `\t</${kind}>`,
    '</MetaDataObject>',
    '',
  ].filter((item) => item.length > 0);
  return parts.join('\n');
}

function buildRootProperties(kind: MetaKind, name: string): string {
  const base = [
    `\n\t\t\t<Name>${escapeXml(name)}</Name>`,
    buildLocalizedTag('\t\t\t', 'Synonym', splitCamelCase(name)),
    '\t\t\t<Comment/>',
  ];

  switch (kind) {
    case 'Catalog':
      return [...base, '\t\t\t<CodeLength>9</CodeLength>', '\t\t\t<DescriptionLength>25</DescriptionLength>'].join('\n');
    case 'Document':
    case 'BusinessProcess':
    case 'Task':
      return [...base, '\t\t\t<NumberLength>9</NumberLength>', '\t\t\t<NumberType>String</NumberType>'].join('\n');
    case 'Constant':
    case 'DefinedType':
    case 'CommonAttribute':
    case 'SessionParameter':
      return [...base, buildStringType('\t\t\t')].join('\n');
    case 'CommonModule':
      return [...base, '\t\t\t<Global>false</Global>', '\t\t\t<ClientManagedApplication>true</ClientManagedApplication>', '\t\t\t<Server>true</Server>'].join('\n');
    case 'InformationRegister':
      return [...base, '\t\t\t<Periodicity>Nonperiodical</Periodicity>', '\t\t\t<WriteMode>Independent</WriteMode>'].join('\n');
    case 'AccumulationRegister':
      return [...base, '\t\t\t<RegisterType>Balance</RegisterType>'].join('\n');
    case 'Role':
      return [...base, '\t\t\t<SetForNewObjects>false</SetForNewObjects>', '\t\t\t<SetForAttributesByDefault>true</SetForAttributesByDefault>', '\t\t\t<IndependentRightsOfChildObjects>false</IndependentRightsOfChildObjects>'].join('\n');
    default:
      return base.join('\n');
  }
}

function buildChildFragment(tag: ChildTag, name: string, indent: string): string {
  if (tag === 'Attribute' || tag === 'AddressingAttribute' || tag === 'Dimension' || tag === 'Resource') {
    return buildTypedFieldFragment(tag, name, indent);
  }
  if (tag === 'TabularSection') {
    return buildTabularSectionFragment(name, indent);
  }
  if (tag === 'Form') {
    return buildSimpleChildFragment('Form', name, indent, ['FormType>Managed']);
  }
  if (tag === 'Template') {
    return buildSimpleChildFragment('Template', name, indent, ['TemplateType>SpreadsheetDocument']);
  }
  return buildSimpleChildFragment(tag, name, indent);
}

function buildTypedFieldFragment(tag: 'Attribute' | 'AddressingAttribute' | 'Dimension' | 'Resource', name: string, indent: string): string {
  return [
    `${indent}<${tag} uuid="${newUuid()}">`,
    `${indent}\t<Properties>`,
    `${indent}\t\t<Name>${escapeXml(name)}</Name>`,
    buildLocalizedTag(`${indent}\t\t`, 'Synonym', splitCamelCase(name)),
    `${indent}\t\t<Comment/>`,
    buildStringType(`${indent}\t\t`),
    `${indent}\t</Properties>`,
    `${indent}</${tag}>`,
  ].join('\n');
}

function buildTabularSectionFragment(name: string, indent: string): string {
  return [
    `${indent}<TabularSection uuid="${newUuid()}">`,
    `${indent}\t<Properties>`,
    `${indent}\t\t<Name>${escapeXml(name)}</Name>`,
    buildLocalizedTag(`${indent}\t\t`, 'Synonym', splitCamelCase(name)),
    `${indent}\t\t<Comment/>`,
    `${indent}\t</Properties>`,
    `${indent}\t<ChildObjects/>`,
    `${indent}</TabularSection>`,
  ].join('\n');
}

function buildSimpleChildFragment(tag: 'Form' | 'Command' | 'Template' | 'EnumValue', name: string, indent: string, extraRawTags: string[] = []): string {
  const extra = extraRawTags.map((raw) => {
    const [tagName, value] = raw.split('>');
    return `${indent}\t\t<${tagName}>${escapeXml(value ?? '')}</${tagName}>`;
  });
  return [
    `${indent}<${tag} uuid="${newUuid()}">`,
    `${indent}\t<Properties>`,
    `${indent}\t\t<Name>${escapeXml(name)}</Name>`,
    buildLocalizedTag(`${indent}\t\t`, 'Synonym', splitCamelCase(name)),
    `${indent}\t\t<Comment/>`,
    ...extra,
    `${indent}\t</Properties>`,
    `${indent}</${tag}>`,
  ].join('\n');
}

function getChildObjectsBlock(xml: string): { inner: string; start: number; end: number; selfClosing: boolean } | null {
  const openClose = /<ChildObjects\b[^>]*\/>/.exec(xml);
  if (openClose) {
    const pos = openClose.index;
    return { inner: '', start: pos, end: pos + openClose[0].length, selfClosing: true };
  }
  const match = /<ChildObjects\b[^>]*>([\s\S]*?)<\/ChildObjects>/.exec(xml);
  if (!match || match.index === undefined) {
    return null;
  }
  const innerStart = match.index + match[0].indexOf('>') + 1;
  return { inner: match[1], start: innerStart, end: innerStart + match[1].length, selfClosing: false };
}

function buildChildObjectsReplacement(
  block: { inner: string; selfClosing: boolean },
  fragment: string,
  indent: string
): string {
  const parentIndent = indent.length > 0 ? indent.slice(0, -1) : '';
  if (block.selfClosing) {
    return `<ChildObjects>\n${fragment}\n${parentIndent}</ChildObjects>`;
  }
  return insertChildFragment(block.inner, fragment, indent);
}

function insertChildFragment(inner: string, fragment: string, indent: string): string {
  const parentIndent = indent.length > 0 ? indent.slice(0, -1) : '';
  if (!inner.trim()) {
    return `\n${fragment}\n${parentIndent}`;
  }
  const trimmedRight = inner.replace(/\s+$/, '');
  return `${trimmedRight}\n${fragment}\n${parentIndent}`;
}

function findNamedChildBlock(xml: string, tag: string, name: string): { start: number; end: number } | null {
  const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<Name>${escapeRegExp(name)}<\\/Name>[\\s\\S]*?<\\/${tag}>`, 'g');
  const match = re.exec(xml);
  return match ? { start: match.index, end: match.index + match[0].length } : null;
}

function hasChildName(inner: string, tag: string, name: string): boolean {
  return new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<Name>${escapeRegExp(name)}<\\/Name>[\\s\\S]*?<\\/${tag}>`).test(inner);
}

function ensureAuxiliaryChildFiles(options: AddChildMetadataOptions): string[] {
  const loc = getObjectLocationFromXml(options.ownerObjectXmlPath);
  if (options.childTag === 'Command') {
    const commandModule = path.join(loc.objectDir, 'Commands', options.name, 'Ext', 'CommandModule.bsl');
    ensureEmptyFile(commandModule);
    return [commandModule];
  }
  if (options.childTag === 'Form') {
    const formModule = path.join(loc.objectDir, 'Forms', options.name, 'Ext', 'Form', 'Module.bsl');
    const formXml = path.join(loc.objectDir, 'Forms', options.name, 'Ext', 'Form.xml');
    fs.mkdirSync(path.dirname(formXml), { recursive: true });
    fs.writeFileSync(formXml, buildManagedFormXml(), 'utf-8');
    ensureEmptyFile(formModule);
    return [formXml, formModule];
  }
  if (options.childTag === 'Template') {
    const templateXml = path.join(loc.objectDir, 'Templates', `${options.name}.xml`);
    const templateBin = path.join(loc.objectDir, 'Templates', options.name, 'Ext', 'Template.bin');
    fs.mkdirSync(path.dirname(templateXml), { recursive: true });
    fs.writeFileSync(templateXml, buildTemplateXml(options.name), 'utf-8');
    ensureEmptyFile(templateBin);
    return [templateXml, templateBin];
  }
  return [];
}

function getDefaultModulePaths(kind: MetaKind, objectDir: string): string[] {
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

function needsChildObjects(kind: MetaKind): boolean {
  return !['Constant', 'DefinedType', 'ScheduledJob', 'EventSubscription', 'CommonModule', 'Role'].includes(kind);
}

function ensureEmptyFile(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, '', 'utf-8');
  }
}

function buildLocalizedTag(indent: string, tag: string, text: string): string {
  if (!text) {
    return `${indent}<${tag}/>`;
  }
  return [
    `${indent}<${tag}>`,
    `${indent}\t<v8:item>`,
    `${indent}\t\t<v8:lang>ru</v8:lang>`,
    `${indent}\t\t<v8:content>${escapeXml(text)}</v8:content>`,
    `${indent}\t</v8:item>`,
    `${indent}</${tag}>`,
  ].join('\n');
}

function buildStringType(indent: string): string {
  return [
    `${indent}<Type>`,
    `${indent}\t<v8:Type>xs:string</v8:Type>`,
    `${indent}\t<v8:StringQualifiers>`,
    `${indent}\t\t<v8:Length>10</v8:Length>`,
    `${indent}\t\t<v8:AllowedLength>Variable</v8:AllowedLength>`,
    `${indent}\t</v8:StringQualifiers>`,
    `${indent}</Type>`,
  ].join('\n');
}

function buildEmptyRightsXml(): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<Rights xmlns="http://v8.1c.ru/8.3/xcf/readable" xmlns:xr="http://v8.1c.ru/8.3/xcf/readable"/>',
    '',
  ].join('\n');
}

function buildBusinessProcessFlowchartXml(): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<Flowchart xmlns="http://v8.1c.ru/8.3/MDClasses" version="2.18"/>',
    '',
  ].join('\n');
}

function buildManagedFormXml(): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<Form xmlns="http://v8.1c.ru/8.3/managed-application/forms" version="2.18">',
    '\t<AutoCommandBar name="ФормаКоманднаяПанель" id="-1"/>',
    '\t<ChildItems/>',
    '\t<Attributes/>',
    '\t<Commands/>',
    '</Form>',
    '',
  ].join('\n');
}

function buildTemplateXml(name: string): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" xmlns:v8="http://v8.1c.ru/8.1/data/core" xmlns:xr="http://v8.1c.ru/8.3/xcf/readable" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" version="2.18">',
    `\t<Template uuid="${newUuid()}">`,
    '\t\t<Properties>',
    `\t\t\t<Name>${escapeXml(name)}</Name>`,
    buildLocalizedTag('\t\t\t', 'Synonym', splitCamelCase(name)),
    '\t\t\t<Comment/>',
    '\t\t\t<TemplateType>SpreadsheetDocument</TemplateType>',
    '\t\t</Properties>',
    '\t</Template>',
    '</MetaDataObject>',
    '',
  ].join('\n');
}

function detectChildIndent(inner: string, fallback: string): string {
  return /\n([ \t]+)</.exec(inner)?.[1] ?? fallback;
}

function splitCamelCase(name: string): string {
  const withSpaces = name
    .replace(/([а-яё])([А-ЯЁ])/g, '$1 $2')
    .replace(/([a-z])([A-Z])/g, '$1 $2');
  return withSpaces.length > 1 ? withSpaces[0] + withSpaces.slice(1).toLocaleLowerCase('ru-RU') : withSpaces;
}

function validateMetadataName(value: string): EditResult {
  return /^[\p{L}][\p{L}\p{Nd}_]*$/u.test(value)
    ? ok([])
    : fail('Имя должно начинаться с буквы и содержать только буквы, цифры и подчёркивание.');
}

function newUuid(): string {
  return crypto.randomUUID();
}

function ok(changedFiles: string[]): EditResult {
  return { success: true, changed: changedFiles.length > 0, changedFiles, warnings: [], errors: [] };
}

function fail(message: string): EditResult {
  return { success: false, changed: false, changedFiles: [], warnings: [], errors: [message] };
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
