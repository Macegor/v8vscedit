import * as fs from 'fs';
import * as path from 'path';
import type { ChildTag } from '../../../domain/ChildTag';
import { getObjectLocationFromXml } from '../../fs/MetaPathResolver';
import type { FormatRuleset } from '../format/FormatRuleset';
import { type RegisterOwnerKind, toRegisterOwnerKind } from '../TypedFieldPropertyRules';
import {
  escapeRegExp,
  findChildMetaElementRange,
  findDirectElementRanges,
  findNestingAwareElementRange,
  hasDirectChildElementNameInBlock,
} from '../XmlUtils';
import {
  buildFormDescriptorXml,
  buildManagedFormXml,
  buildTemplateXml,
  ensureTemplateContentFiles,
} from './auxiliaryFileBuilders';
import {
  buildLocalizedTag,
  buildTabularSectionInternalInfo,
  detectChildIndent,
  ensureEmptyFile,
  escapeXml,
  newUuid,
  resolveTemplateType,
  splitCamelCase,
  type AddChildMetadataOptions,
} from './creatorShared';

export function addChildToObjectXml(xml: string, options: AddChildMetadataOptions, ruleset: FormatRuleset): { changed: true; xml: string } | { changed: false; error: string } {
  if (options.childTag === 'Column') {
    if (!options.tabularSectionName) {
      return { changed: false, error: 'Не указана табличная часть для добавления колонки.' };
    }
    return addColumnToTabularSectionXml(xml, options.tabularSectionName, options.name, ruleset);
  }

  if (options.childTag === 'Method') {
    if (!options.urlTemplateName) {
      return { changed: false, error: 'Не указан URL-шаблон для добавления метода.' };
    }
    return addMethodToUrlTemplateXml(xml, options.urlTemplateName, options.name);
  }

  const ownerKind = extractMetadataObjectKind(xml);
  if (!ownerKind) {
    return { changed: false, error: 'Не найден корневой элемент объекта метаданных.' };
  }
  const childObjects = getChildObjectsBlock(xml);
  if (!childObjects) {
    return { changed: false, error: 'В XML объекта отсутствует блок <ChildObjects>.' };
  }
  if (hasChildName(childObjects.inner, options.childTag, options.name)) {
    return { changed: false, error: `Элемент "${options.name}" уже существует.` };
  }

  const childObjectsInner = removeNestedSimpleChildReference(childObjects.inner, options.childTag, options.name);
  const indent = detectChildIndent(childObjectsInner, '\t\t\t');
  const ownerName = extractObjectName(xml);
  const fragment = buildChildFragment(options.childTag, options.name, indent, ruleset, ownerKind, ownerName);
  const replacement = buildChildObjectsReplacement({ ...childObjects, inner: childObjectsInner }, fragment, indent);
  const nextXml = `${xml.slice(0, childObjects.start)}${replacement}${xml.slice(childObjects.end)}`;
  return {
    changed: true,
    xml: updateMainDataCompositionSchemaIfNeeded(nextXml, ownerKind, ownerName, options),
  };
}

function addColumnToTabularSectionXml(xml: string, tabularSectionName: string, columnName: string, ruleset: FormatRuleset): { changed: true; xml: string } | { changed: false; error: string } {
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
  // Тег колонки в XML — <Attribute>, но набор свойств у неё «колоночный»
  // (без свойств заполнения), поэтому передаём kind='Column'.
  const fragment = buildTypedFieldFragment('Attribute', columnName, indent, ruleset, 'Column');
  const replacement = buildChildObjectsReplacement(childObjects, fragment, indent);
  const nextSectionXml = `${sectionXml.slice(0, childObjects.start)}${replacement}${sectionXml.slice(childObjects.end)}`;
  return {
    changed: true,
    xml: `${xml.slice(0, section.start)}${nextSectionXml}${xml.slice(section.end)}`,
  };
}

function addMethodToUrlTemplateXml(xml: string, urlTemplateName: string, methodName: string): { changed: true; xml: string } | { changed: false; error: string } {
  const template = findNamedChildBlock(xml, 'URLTemplate', urlTemplateName);
  if (!template) {
    return { changed: false, error: `URL-шаблон "${urlTemplateName}" не найден.` };
  }
  const templateXml = xml.slice(template.start, template.end);
  const childObjects = getChildObjectsBlock(templateXml);
  if (!childObjects) {
    return { changed: false, error: `В URL-шаблоне "${urlTemplateName}" отсутствует <ChildObjects>.` };
  }
  if (hasChildName(childObjects.inner, 'Method', methodName)) {
    return { changed: false, error: `Метод "${methodName}" уже существует.` };
  }

  const indent = detectChildIndent(childObjects.inner, '\t\t\t\t\t');
  const fragment = buildMethodFragment(methodName, indent);
  const replacement = buildChildObjectsReplacement(childObjects, fragment, indent);
  const nextTemplateXml = `${templateXml.slice(0, childObjects.start)}${replacement}${templateXml.slice(childObjects.end)}`;
  return {
    changed: true,
    xml: `${xml.slice(0, template.start)}${nextTemplateXml}${xml.slice(template.end)}`,
  };
}

function buildChildFragment(
  tag: ChildTag,
  name: string,
  indent: string,
  ruleset: FormatRuleset,
  ownerKind?: string,
  ownerName?: string
): string {
  if (tag === 'StandardAttribute') {
    throw new Error('Стандартные реквизиты создаются платформой 1С и не добавляются вручную.');
  }
  if (tag === 'Attribute' || tag === 'AddressingAttribute' || tag === 'Dimension' || tag === 'Resource') {
    return buildTypedFieldFragment(tag, name, indent, ruleset, tag, toRegisterOwnerKind(ownerKind));
  }
  if (tag === 'TabularSection') {
    return buildTabularSectionFragment(name, indent, ruleset, ownerKind, ownerName);
  }
  if (tag === 'Form') {
    // Форма в <ChildObjects> — простая ссылка `<Form>Имя</Form>` (как макет).
    // Полное описание формы лежит отдельным файлом `Forms/Имя.xml`
    // (см. ensureAuxiliaryChildFiles). Полный блок с uuid внутри ChildObjects
    // платформа 1С отклоняет.
    return `${indent}<Form>${escapeXml(name)}</Form>`;
  }
  if (tag === 'Command') {
    return buildObjectCommandFragment(name, indent);
  }
  if (tag === 'Template') {
    return `${indent}<Template>${escapeXml(name)}</Template>`;
  }
  if (tag === 'URLTemplate') {
    return buildUrlTemplateFragment(name, indent);
  }
  if (tag === 'Method') {
    // Метод добавляется в контейнер URL-шаблона (addMethodToUrlTemplateXml),
    // а не напрямую в <ChildObjects> объекта — сюда управление не доходит.
    throw new Error('Метод HTTP-сервиса добавляется в URL-шаблон, а не напрямую в объект.');
  }
  return buildSimpleChildFragment(tag, name, indent);
}

/**
 * Свежий URL-шаблон HTTP-сервиса: Name/Synonym/Comment + пустой самозакрытый
 * `<Template/>` и пустой `<ChildObjects/>` под вложенные методы.
 */
function buildUrlTemplateFragment(name: string, indent: string): string {
  return [
    `${indent}<URLTemplate uuid="${newUuid()}">`,
    `${indent}\t<Properties>`,
    `${indent}\t\t<Name>${escapeXml(name)}</Name>`,
    buildLocalizedTag(`${indent}\t\t`, 'Synonym', splitCamelCase(name)),
    `${indent}\t\t<Comment/>`,
    `${indent}\t\t<Template/>`,
    `${indent}\t</Properties>`,
    `${indent}\t<ChildObjects/>`,
    `${indent}</URLTemplate>`,
  ].join('\n');
}

/**
 * Свежий метод URL-шаблона: Name/Synonym/Comment + `<HTTPMethod>GET</HTTPMethod>`
 * и пустой самозакрытый `<Handler/>`. Метод — лист, без `<ChildObjects>`.
 */
function buildMethodFragment(name: string, indent: string): string {
  return [
    `${indent}<Method uuid="${newUuid()}">`,
    `${indent}\t<Properties>`,
    `${indent}\t\t<Name>${escapeXml(name)}</Name>`,
    buildLocalizedTag(`${indent}\t\t`, 'Synonym', splitCamelCase(name)),
    `${indent}\t\t<Comment/>`,
    `${indent}\t\t<HTTPMethod>GET</HTTPMethod>`,
    `${indent}\t\t<Handler/>`,
    `${indent}\t</Properties>`,
    `${indent}</Method>`,
  ].join('\n');
}

function buildTypedFieldFragment(
  tag: 'Attribute' | 'AddressingAttribute' | 'Dimension' | 'Resource',
  name: string,
  indent: string,
  ruleset: FormatRuleset,
  propertyKind: 'Attribute' | 'AddressingAttribute' | 'Dimension' | 'Resource' | 'Column' = tag,
  registerKind?: RegisterOwnerKind
): string {
  const typeBlock = ruleset.buildDefaultTypeBlock(`${indent}\t\t`);
  return [
    `${indent}<${tag} uuid="${newUuid()}">`,
    `${indent}\t<Properties>`,
    `${indent}\t\t<Name>${escapeXml(name)}</Name>`,
    buildLocalizedTag(`${indent}\t\t`, 'Synonym', splitCamelCase(name)),
    `${indent}\t\t<Comment/>`,
    typeBlock,
    ...ruleset.buildTypedFieldProperties(propertyKind, typeBlock, `${indent}\t\t`, registerKind),
    `${indent}\t</Properties>`,
    `${indent}</${tag}>`,
  ].join('\n');
}

function buildTabularSectionFragment(name: string, indent: string, ruleset: FormatRuleset, ownerKind?: string, ownerName?: string): string {
  return [
    `${indent}<TabularSection uuid="${newUuid()}">`,
    ownerKind && ownerName ? buildTabularSectionInternalInfo(ownerKind, ownerName, name, `${indent}\t`, ruleset) : '',
    `${indent}\t<Properties>`,
    `${indent}\t\t<Name>${escapeXml(name)}</Name>`,
    buildLocalizedTag(`${indent}\t\t`, 'Synonym', splitCamelCase(name)),
    `${indent}\t\t<Comment/>`,
    `${indent}\t</Properties>`,
    `${indent}\t<ChildObjects/>`,
    `${indent}</TabularSection>`,
  ].filter((item) => item.length > 0).join('\n');
}

function buildSimpleChildFragment(tag: 'EnumValue', name: string, indent: string): string {
  return [
    `${indent}<${tag} uuid="${newUuid()}">`,
    `${indent}\t<Properties>`,
    `${indent}\t\t<Name>${escapeXml(name)}</Name>`,
    buildLocalizedTag(`${indent}\t\t`, 'Synonym', splitCamelCase(name)),
    `${indent}\t\t<Comment/>`,
    `${indent}\t</Properties>`,
    `${indent}</${tag}>`,
  ].join('\n');
}

/**
 * Полный блок команды объекта внутри `<ChildObjects>`. В отличие от формы/макета
 * команда сериализуется целиком (uuid + свойства), а не ссылкой. Набор и порядок
 * свойств — как в эталонной выгрузке 2.20 (пустой объект): без них платформа 1С
 * отклоняет команду.
 */
function buildObjectCommandFragment(name: string, indent: string): string {
  return [
    `${indent}<Command uuid="${newUuid()}">`,
    `${indent}\t<Properties>`,
    `${indent}\t\t<Name>${escapeXml(name)}</Name>`,
    buildLocalizedTag(`${indent}\t\t`, 'Synonym', splitCamelCase(name)),
    `${indent}\t\t<Comment/>`,
    // Объектной команде обязательна непустая группа командного интерфейса —
    // иначе платформа: «Не указана группа, в которую входит команда по умолчанию».
    `${indent}\t\t<Group>FormCommandBarImportant</Group>`,
    `${indent}\t\t<CommandParameterType/>`,
    `${indent}\t\t<ParameterUseMode>Single</ParameterUseMode>`,
    `${indent}\t\t<ModifiesData>false</ModifiesData>`,
    `${indent}\t\t<Representation>Auto</Representation>`,
    `${indent}\t\t<ToolTip/>`,
    `${indent}\t\t<Picture/>`,
    `${indent}\t\t<Shortcut/>`,
    `${indent}\t\t<OnMainServerUnavalableBehavior>Auto</OnMainServerUnavalableBehavior>`,
    `${indent}\t</Properties>`,
    `${indent}</Command>`,
  ].join('\n');
}

function getChildObjectsBlock(xml: string): { inner: string; start: number; end: number; selfClosing: boolean } | null {
  const range = findNestingAwareElementRange(xml, 'ChildObjects');
  if (!range) {
    return null;
  }
  const openTag = xml.slice(range.start, range.openEnd);
  const selfClosing = /\/>\s*$/.test(openTag);
  if (selfClosing) {
    return { inner: '', start: range.start, end: range.end, selfClosing: true };
  }
  return {
    inner: xml.slice(range.openEnd, range.closeStart),
    start: range.openEnd,
    end: range.closeStart,
    selfClosing: false,
  };
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

function findNamedChildBlock(xml: string, tag: ChildTag, name: string): { start: number; end: number } | null {
  // Депт-аварный поиск дочернего блока по тегу и <Name> из верхнеуровневого
  // <ChildObjects>: non-greedy regex мог «перепрыгнуть» закрывающий тег первой
  // секции и подменить одноимённый узел из другой ТЧ (см. M1).
  return findChildMetaElementRange(xml, tag, name);
}

function hasChildName(inner: string, tag: string, name: string): boolean {
  return hasDirectChildElementNameInBlock(inner, tag, name);
}

function removeNestedSimpleChildReference(inner: string, tag: ChildTag, name: string): string {
  if (tag !== 'Form' && tag !== 'Command' && tag !== 'Template') {
    return inner;
  }
  const directRanges = findDirectElementRanges(inner, tag);
  const re = new RegExp(`\\n?\\s*<${tag}>\\s*${escapeRegExp(name)}\\s*<\\/${tag}>`, 'g');
  return inner.replace(re, (match, offset: number) => {
    const tagOffset = match.indexOf(`<${tag}>`);
    const tagStart = tagOffset >= 0 ? offset + tagOffset : offset;
    const isDirect = directRanges.some((range) => tagStart >= range.start && tagStart < range.end);
    return isDirect ? match : '';
  });
}

function extractObjectName(xml: string): string | undefined {
  return /<Properties>[\s\S]*?<Name>([^<]+)<\/Name>/.exec(xml)?.[1];
}

function extractMetadataObjectKind(xml: string): string | undefined {
  return /<MetaDataObject\b[^>]*>\s*<([A-Za-z][A-Za-z0-9]*)\b/.exec(xml)?.[1];
}

function updateMainDataCompositionSchemaIfNeeded(
  xml: string,
  ownerKind: string,
  ownerName: string | undefined,
  options: AddChildMetadataOptions
): string {
  if (options.childTag !== 'Template' || resolveTemplateType(options.templateType) !== 'DataCompositionSchema') {
    return xml;
  }
  if (ownerKind !== 'Report' && ownerKind !== 'ExternalReport') {
    return xml;
  }
  if (!ownerName) {
    return xml;
  }
  const value = `${ownerKind}.${ownerName}.Template.${options.name}`;
  const emptyTag = /<MainDataCompositionSchema\s*\/>/;
  if (emptyTag.test(xml)) {
    return xml.replace(emptyTag, `<MainDataCompositionSchema>${escapeXml(value)}</MainDataCompositionSchema>`);
  }
  const openClose = /<MainDataCompositionSchema>([\s\S]*?)<\/MainDataCompositionSchema>/;
  const match = openClose.exec(xml);
  if (!match || match[1].trim()) {
    return xml;
  }
  return xml.replace(openClose, `<MainDataCompositionSchema>${escapeXml(value)}</MainDataCompositionSchema>`);
}

export function ensureAuxiliaryChildFiles(options: AddChildMetadataOptions, formatVersion: string, ruleset: FormatRuleset): string[] {
  const loc = getObjectLocationFromXml(options.ownerObjectXmlPath);
  if (options.childTag === 'Command') {
    const commandModule = path.join(loc.objectDir, 'Commands', options.name, 'Ext', 'CommandModule.bsl');
    ensureEmptyFile(commandModule);
    return [commandModule];
  }
  if (options.childTag === 'Form') {
    const descriptorXml = path.join(loc.objectDir, 'Forms', `${options.name}.xml`);
    const formModule = path.join(loc.objectDir, 'Forms', options.name, 'Ext', 'Form', 'Module.bsl');
    const formXml = path.join(loc.objectDir, 'Forms', options.name, 'Ext', 'Form.xml');
    fs.mkdirSync(path.dirname(formXml), { recursive: true });
    fs.writeFileSync(descriptorXml, buildFormDescriptorXml(options.name, formatVersion, ruleset), 'utf-8');
    fs.writeFileSync(formXml, buildManagedFormXml(formatVersion), 'utf-8');
    ensureEmptyFile(formModule);
    return [descriptorXml, formXml, formModule];
  }
  if (options.childTag === 'Template') {
    const templateXml = path.join(loc.objectDir, 'Templates', `${options.name}.xml`);
    const templateDir = path.join(loc.objectDir, 'Templates', options.name);
    const templateType = resolveTemplateType(options.templateType);
    const changedFiles: string[] = [];
    fs.mkdirSync(path.dirname(templateXml), { recursive: true });
    if (!fs.existsSync(templateXml)) {
      fs.writeFileSync(templateXml, buildTemplateXml(options.name, formatVersion, templateType, ruleset), 'utf-8');
      changedFiles.push(templateXml);
    }
    changedFiles.push(...ensureTemplateContentFiles(templateDir, templateType, formatVersion));
    return changedFiles;
  }
  return [];
}
