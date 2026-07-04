import * as fs from 'fs';
import { XMLParser } from 'fast-xml-parser';
import type { MetaChild, MetaObject } from '../../domain/MetaObject';
import {
  getStandardAttributesForKind,
  getStandardAttributePresentation,
} from '../../domain/StandardAttribute';
import {
  escapeXmlText,
  extractStandardAttributeXml,
  extractSimpleTag,
  extractSynonym,
  findChildMetaElementRange,
  findColumnRangeInTabularSection,
  hasRealChange,
  writeTextFilePreservingBomAndEol,
} from './XmlUtils';
import { normalizeTypedFieldPropertiesAfterTypeChange } from './TypedFieldPropertyRules';

interface XmlTextNode { '#text': string }
type XmlElementNode = Record<string, XmlNodeList>;
type XmlNode = XmlTextNode | XmlElementNode;
type XmlNodeList = XmlNode[];
type XmlAttributes = Record<string, string | undefined>;

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  trimValues: false,
  parseTagValue: false,
  processEntities: false,
});

function isTextNode(node: XmlNode): node is XmlTextNode {
  return Object.prototype.hasOwnProperty.call(node, '#text');
}

function getElementName(node: XmlNode): string | null {
  if (isTextNode(node)) {
    return null;
  }
  const [name] = Object.keys(node);
  return name;
}

function getElementChildren(node: XmlNode): XmlNodeList {
  if (isTextNode(node)) {
    return [];
  }
  const name = getElementName(node);
  return name ? (node[name] ?? []) : [];
}

function findFirstElement(nodes: XmlNodeList, tagName: string): XmlElementNode | null {
  for (const node of nodes) {
    const name = getElementName(node);
    if (!name) {
      continue;
    }
    if (name === tagName) {
      return node as XmlElementNode;
    }
    const found = findFirstElement(getElementChildren(node), tagName);
    if (found) {
      return found;
    }
  }
  return null;
}

function findDirectChildren(nodes: XmlNodeList, tagName: string): XmlElementNode[] {
  return nodes.filter((node): node is XmlElementNode => getElementName(node) === tagName);
}

function findDirectChildrenByLocalName(nodes: XmlNodeList, tagName: string): XmlElementNode[] {
  return nodes.filter((node): node is XmlElementNode => {
    const name = getElementName(node);
    return name === tagName || name?.endsWith(`:${tagName}`) === true;
  });
}

function getAttribute(element: XmlElementNode, name: string): string | undefined {
  const attrs = (element as Record<string, unknown>)[':@'];
  if (!isXmlAttributes(attrs)) {
    return undefined;
  }
  return attrs[`@_${name}`];
}

function isXmlAttributes(value: unknown): value is XmlAttributes {
  return typeof value === 'object' && value !== null;
}

/**
 * Читает XML объекта метаданных и возвращает имя, синоним и дочерние элементы.
 */
export class ObjectXmlReader {
  read(xmlPath: string): MetaObject | null {
    let xml: string;
    try {
      xml = fs.readFileSync(xmlPath, 'utf-8');
    } catch {
      return null;
    }

    const nodes = parser.parse(xml) as XmlNodeList;
    const metaDataObject = findFirstElement(nodes, 'MetaDataObject');
    if (!metaDataObject) {
      return null;
    }

    const rootElement = getElementChildren(metaDataObject).find((node) => Boolean(getElementName(node)));
    const rootTag = rootElement ? getElementName(rootElement) : null;
    if (!rootTag) {
      return null;
    }

    return {
      tag: rootTag,
      name: extractSimpleTag(xml, 'Name') ?? '',
      synonym: extractSynonym(xml),
      children: this.parseChildren(rootElement as XmlElementNode, rootTag),
    };
  }

  private parseChildren(rootElement: XmlNode, rootTag: string): MetaChild[] {
    const result: MetaChild[] = [];
    result.push(...this.parseRootStandardAttributes(rootElement, rootTag));

    const childObjects = findFirstElement(getElementChildren(rootElement), 'ChildObjects');
    if (!childObjects) {
      return result;
    }

    const directChildren = getElementChildren(childObjects);

    for (const tag of ['Attribute', 'Dimension', 'Resource'] as const) {
      for (const element of findDirectChildren(directChildren, tag)) {
        result.push(this.toMetaChild(tag, element));
      }
    }

    for (const element of findDirectChildren(directChildren, 'EnumValue')) {
      result.push(this.toMetaChild('EnumValue', element));
    }

    for (const element of findDirectChildren(directChildren, 'TabularSection')) {
      result.push(this.toTabularSectionChild(element));
    }

    for (const tag of ['Form', 'Template'] as const) {
      for (const element of findDirectChildren(directChildren, tag)) {
        const name = extractSimpleTagFromElement(element, 'Name') ?? collectDirectText(getElementChildren(element));
        result.push({ tag, name, synonym: '' });
      }
    }

    for (const element of findDirectChildren(directChildren, 'Command')) {
      result.push(this.toMetaChild('Command', element));
    }

    for (const element of findDirectChildren(directChildren, 'AddressingAttribute')) {
      result.push(this.toMetaChild('AddressingAttribute', element));
    }

    for (const element of findDirectChildren(directChildren, 'Subsystem')) {
      const name = extractSimpleTagFromElement(element, 'Name') ?? collectDirectText(getElementChildren(element));
      result.push({ tag: 'Subsystem', name, synonym: '' });
    }

    return result;
  }

  private toMetaChild(tag: string, element: XmlElementNode): MetaChild {
    return {
      tag,
      name: extractSimpleTagFromElement(element, 'Name') ?? collectDirectText(getElementChildren(element)),
      synonym: extractSynonymFromElement(element),
    };
  }

  private toTabularSectionChild(element: XmlElementNode): MetaChild {
    const columns: MetaChild[] = [];
    const childObjects = findFirstElement(getElementChildren(element), 'ChildObjects');
    if (childObjects) {
      for (const column of findDirectChildren(getElementChildren(childObjects), 'Attribute')) {
        columns.push(this.toMetaChild('Attribute', column));
      }
    }

    return {
      tag: 'TabularSection',
      name: extractSimpleTagFromElement(element, 'Name') ?? collectDirectText(getElementChildren(element)),
      synonym: extractSynonymFromElement(element),
      columns,
    };
  }

  private parseRootStandardAttributes(rootElement: XmlNode, rootTag: string): MetaChild[] {
    const possible = getStandardAttributesForKind(rootTag);
    const properties = findDirectChildren(getElementChildren(rootElement), 'Properties').at(0);
    if (!properties) {
      return possible.map((item) => ({
        tag: 'StandardAttribute',
        name: item.name,
        presentation: item.presentation,
        synonym: item.presentation,
      }));
    }
    const standardAttributes = findDirectChildren(getElementChildren(properties), 'StandardAttributes').at(0);
    if (!standardAttributes) {
      return mergeStandardAttributes(possible, collectStandardAttributeNamesFromFieldRefs(properties));
    }
    const explicit = findDirectChildrenByLocalName(getElementChildren(standardAttributes), 'StandardAttribute')
      .map((element): MetaChild | null => {
        const name = getAttribute(element, 'name') ?? '';
        if (!name) {
          return null;
        }
        const presentation = getStandardAttributePresentation(name);
        return {
          tag: 'StandardAttribute',
          name,
          presentation,
          synonym: extractLocalizedStringFromElement(element, 'Synonym') || presentation,
        };
      })
      .filter((item): item is MetaChild => Boolean(item));
    return mergeStandardAttributes(possible, collectStandardAttributeNamesFromFieldRefs(properties), explicit);
  }

  updateTypeInObject(
    xmlPath: string,
    options: {
      targetKind:
        | 'Attribute'
        | 'AddressingAttribute'
        | 'Dimension'
        | 'Resource'
        | 'Column'
        | 'SessionParameter'
        | 'CommonAttribute'
        | 'Constant'
        | 'DefinedType'
        | 'EventSubscription'
        | 'CommonCommand'
        | 'Command';
      targetName: string;
      tabularSectionName?: string;
      propertyName?: 'Type' | 'Source' | 'CommandParameterType';
      typeInnerXml: string;
    }
  ): boolean {
    let xml: string;
    try {
      xml = fs.readFileSync(xmlPath, 'utf-8');
    } catch {
      return false;
    }

    const normalizedType = indentTypeInner(options.typeInnerXml);
    // Локатор целевого блока: для корневых типов — весь XML, иначе — диапазон
    // конкретного дочернего узла (депт-аварный, устраняет подмену одноимённых блоков).
    const targetRange = (() => {
      if (isRootTypeTargetKind(options.targetKind)) {
        return { start: 0, end: xml.length };
      }
      if (options.targetKind === 'Column') {
        if (!options.tabularSectionName) {
          return null;
        }
        return findColumnRangeInTabularSection(xml, options.tabularSectionName, options.targetName);
      }
      return findChildMetaElementRange(xml, options.targetKind, options.targetName);
    })();

    if (!targetRange) {
      return false;
    }

    const targetXml = xml.slice(targetRange.start, targetRange.end);
    const updatedTarget = updateTypeInElement(targetXml, normalizedType, options.propertyName ?? 'Type');
    if (updatedTarget === targetXml) {
      return false;
    }

    const updatedXml = xml.slice(0, targetRange.start) + updatedTarget + xml.slice(targetRange.end);
    // EOL-нечувствительное сравнение: вставленный блок собран с «голыми» \n, а файл
    // может быть в CRLF — побайтовое `=== xml` тогда ложно считает файл изменившимся
    // на каждом идемпотентном вызове (см. hasRealChange).
    if (!hasRealChange(xml, updatedXml)) {
      return false;
    }

    writeTextFilePreservingBomAndEol(xmlPath, xml, updatedXml);
    return true;
  }

  updatePropertyInObject(
    xmlPath: string,
    options: {
      targetKind: 'Self' | 'StandardAttribute' | 'Attribute' | 'AddressingAttribute' | 'Dimension' | 'Resource' | 'Column' | 'TabularSection' | 'Command' | 'EnumValue';
      targetName: string;
      tabularSectionName?: string;
      propertyKey: string;
      valueKind: 'string' | 'boolean' | 'localizedString' | 'metadataReferenceList' | 'metadataFieldList';
      value: string | boolean | string[];
    }
  ): boolean {
    let xml: string;
    try {
      xml = fs.readFileSync(xmlPath, 'utf-8');
    } catch {
      return false;
    }

    // Целевой блок адресуется диапазоном {start,end} в исходном XML, а не текстовым
    // совпадением: одноимённые колонки в разных ТЧ (или совпадающие Type-блоки)
    // не должны подменять друг друга. StandardAttribute локатора-диапазона не имеет
    // (лежит внутри StandardAttributes и уникален по атрибуту name), поэтому для него
    // сохраняется адресная замена по извлечённому значению.
    const targetRange = ((): { start: number; end: number } | null => {
      if (options.targetKind === 'Self') {
        return { start: 0, end: xml.length };
      }
      if (options.targetKind === 'Column') {
        if (!options.tabularSectionName) {
          return null;
        }
        return findColumnRangeInTabularSection(xml, options.tabularSectionName, options.targetName);
      }
      if (options.targetKind === 'StandardAttribute') {
        const standardXml = extractStandardAttributeXml(xml, options.targetName, options.tabularSectionName);
        if (!standardXml) {
          return null;
        }
        const start = xml.indexOf(standardXml);
        return start >= 0 ? { start, end: start + standardXml.length } : null;
      }
      return findChildMetaElementRange(xml, options.targetKind, options.targetName);
    })();

    if (!targetRange) {
      return false;
    }

    const targetXml = xml.slice(targetRange.start, targetRange.end);
    const updatedTarget = updatePropertyInElement(targetXml, options.propertyKey, options.valueKind, options.value);
    if (updatedTarget === targetXml) {
      return false;
    }

    const updatedXml = xml.slice(0, targetRange.start) + updatedTarget + xml.slice(targetRange.end);
    // EOL-нечувствительное сравнение (см. hasRealChange): buildPropertyValueBlock
    // собирает вставляемый блок через .join('\n'), поэтому на CRLF-файле побайтовое
    // сравнение давало бы ложный «изменён» при идемпотентной вставке.
    if (!hasRealChange(xml, updatedXml)) {
      return false;
    }
    writeTextFilePreservingBomAndEol(xmlPath, xml, updatedXml);
    return true;
  }
}

function extractSimpleTagFromElement(element: XmlElementNode, tagName: string): string | undefined {
  const target = findFirstElement(getElementChildren(element), tagName);
  if (!target) {
    return undefined;
  }
  return collectDirectText(getElementChildren(target)) || undefined;
}

function extractSynonymFromElement(element: XmlElementNode): string {
  return extractLocalizedStringFromElement(element, 'Synonym');
}

function extractLocalizedStringFromElement(element: XmlElementNode, tagName: string): string {
  const synonym = findFirstElement(getElementChildren(element), 'Synonym');
  const target = synonym ?? findFirstElementByLocalName(getElementChildren(element), tagName);
  if (!target) {
    return '';
  }
  const content = findFirstElement(getElementChildren(target), 'v8:content');
  return content ? collectDirectText(getElementChildren(content)) : '';
}

function findFirstElementByLocalName(nodes: XmlNodeList, tagName: string): XmlElementNode | null {
  for (const node of nodes) {
    const name = getElementName(node);
    if (!name) {
      continue;
    }
    if (name === tagName || name.endsWith(`:${tagName}`)) {
      return node as XmlElementNode;
    }
    const found = findFirstElementByLocalName(getElementChildren(node), tagName);
    if (found) {
      return found;
    }
  }
  return null;
}

function collectDirectText(nodes: XmlNodeList): string {
  let result = '';
  for (const node of nodes) {
    if (isTextNode(node)) {
      result += node['#text'];
    }
  }
  return result.trim();
}

function collectStandardAttributeNamesFromFieldRefs(element: XmlElementNode): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  visitFieldRefs(getElementChildren(element), (ref) => {
    const name = /\.StandardAttribute\.([A-Za-z][A-Za-z0-9]*)$/.exec(ref)?.[1];
    if (!name || seen.has(name)) {
      return;
    }
    seen.add(name);
    result.push(name);
  });
  return result;
}

function mergeStandardAttributes(
  possible: { name: string; presentation: string }[],
  inferredNames: string[],
  explicit: MetaChild[] = []
): MetaChild[] {
  const byName = new Map<string, MetaChild>();
  for (const item of explicit) {
    byName.set(item.name, item);
  }
  for (const item of possible) {
    if (!byName.has(item.name)) {
      byName.set(item.name, {
        tag: 'StandardAttribute',
        name: item.name,
        presentation: item.presentation,
        synonym: item.presentation,
      });
    }
  }
  for (const name of inferredNames) {
    if (!byName.has(name)) {
      const presentation = getStandardAttributePresentation(name);
      byName.set(name, {
        tag: 'StandardAttribute',
        name,
        presentation,
        synonym: presentation,
      });
    }
  }
  const possibleNames = new Set(possible.map((item) => item.name));
  const explicitNames = new Set(explicit.map((item) => item.name));
  return [
    ...possible.map((item) => byName.get(item.name)).filter((item): item is MetaChild => Boolean(item)),
    ...explicit.filter((item) => !possibleNames.has(item.name)),
    ...inferredNames
      .filter((name) => !possibleNames.has(name) && !explicitNames.has(name))
      .map((name) => byName.get(name))
      .filter((item): item is MetaChild => Boolean(item)),
  ];
}

function visitFieldRefs(nodes: XmlNodeList, visitor: (ref: string) => void): void {
  for (const node of nodes) {
    const name = getElementName(node);
    if (!name) {
      continue;
    }
    if (name === 'Field' || name.endsWith(':Field')) {
      visitor(collectDirectText(getElementChildren(node)));
      continue;
    }
    visitFieldRefs(getElementChildren(node), visitor);
  }
}

function updateTypeInElement(
  elementXml: string,
  typeInnerXml: string,
  propertyName: 'Type' | 'Source' | 'CommandParameterType' = 'Type'
): string {
  const typeBlock = `<${propertyName}>\n${typeInnerXml}\n</${propertyName}>`;
  const propertyRe = new RegExp(`<${propertyName}>[\\s\\S]*?<\\/${propertyName}>`);
  if (propertyRe.test(elementXml)) {
    const updated = elementXml.replace(propertyRe, () => typeBlock);
    return propertyName === 'Type' ? normalizeTypedFieldProperties(updated, typeInnerXml) : updated;
  }
  const selfClosingRe = new RegExp(`<${propertyName}(?:\\s[^>]*)?\\/>`);
  if (selfClosingRe.test(elementXml)) {
    const updated = elementXml.replace(selfClosingRe, () => typeBlock);
    return propertyName === 'Type' ? normalizeTypedFieldProperties(updated, typeInnerXml) : updated;
  }
  const propertiesMatch = /<Properties>([\s\S]*?)<\/Properties>/.exec(elementXml);
  if (!propertiesMatch) {
    return elementXml;
  }
  const propsInner = propertiesMatch[1];
  const nextPropsInner = /<Comment[\s\S]*?<\/Comment>/.test(propsInner)
    ? propsInner.replace(/(<Comment[\s\S]*?<\/Comment>)/, (_m, g1: string) => `${g1}\n${typeBlock}`)
    : /<Name[\s\S]*?<\/Name>/.test(propsInner)
    ? propsInner.replace(/(<Name[\s\S]*?<\/Name>)/, (_m, g1: string) => `${g1}\n${typeBlock}`)
    : `${propsInner}\n${typeBlock}`;
  const updated = elementXml.replace(propsInner, () => nextPropsInner);
  return propertyName === 'Type' ? normalizeTypedFieldProperties(updated, typeInnerXml) : updated;
}

function normalizeTypedFieldProperties(elementXml: string, typeInnerXml: string): string {
  const tag = detectNormalizedTypeOwnerTag(elementXml);
  if (
    tag === 'Attribute' ||
    tag === 'AddressingAttribute' ||
    tag === 'Dimension' ||
    tag === 'Resource' ||
    tag === 'Constant' ||
    tag === 'CommonAttribute'
  ) {
    return normalizeTypedFieldPropertiesAfterTypeChange(elementXml, tag, typeInnerXml);
  }
  return elementXml;
}

function detectNormalizedTypeOwnerTag(elementXml: string): string | undefined {
  const text = elementXml.trimStart().replace(/^<\?xml\b[\s\S]*?\?>\s*/, '');
  return /^<MetaDataObject\b[^>]*>\s*<([A-Za-z][A-Za-z0-9]*)\b/.exec(text)?.[1]
    ?? /^<([A-Za-z][A-Za-z0-9]*)\b/.exec(text)?.[1];
}

function isRootTypeTargetKind(kind: string): boolean {
  return kind === 'SessionParameter'
    || kind === 'CommonAttribute'
    || kind === 'Constant'
    || kind === 'DefinedType'
    || kind === 'EventSubscription'
    || kind === 'CommonCommand';
}

function indentTypeInner(typeInnerXml: string): string {
  return typeInnerXml
    .split('\n')
    .map((line) => line.replace(/\r/g, '').trimEnd())
    .filter((line) => line.length > 0)
    .map((line) => `\t\t\t${line}`)
    .join('\n');
}

function updatePropertyInElement(
  elementXml: string,
  propertyKey: string,
  valueKind: 'string' | 'boolean' | 'localizedString' | 'metadataReferenceList' | 'metadataFieldList',
  value: string | boolean | string[]
): string {
  const propertiesMatch = /<Properties>([\s\S]*?)<\/Properties>/.exec(elementXml);
  if (!propertiesMatch) {
    return elementXml;
  }
  const propsInner = propertiesMatch[1];
  const propertyRe = new RegExp(`<${propertyKey}>[\\s\\S]*?<\\/${propertyKey}>`);
  const selfClosingRe = new RegExp(`<${propertyKey}(?:\\s[^>]*)?\\/>`);
  const propertyMatch = propertyRe.exec(propsInner);
  const nextValueBlock = propertyMatch && valueKind === 'localizedString'
    ? updateLocalizedPropertyContent(propertyMatch[0], Array.isArray(value) ? '' : value)
    : buildPropertyValueBlock(propertyKey, valueKind, value);

  // Если свойство ещё не объявлено в Properties, вставляем его в конец блока
  // перед закрывающим </Properties>. Раньше вставка шла сразу после <Name> или
  // <Comment>, из-за чего ServerCall у CommonModule оказывался перед Synonym и
  // 1С не принимал такой порядок (xs:sequence в схеме).
  const nextPropsInner = propertyMatch
    ? propsInner.replace(propertyMatch[0], () => nextValueBlock)
    : selfClosingRe.test(propsInner)
    ? propsInner.replace(selfClosingRe, () => nextValueBlock)
    : appendPropertyAtEnd(propsInner, nextValueBlock);

  if (nextPropsInner === propsInner) {
    return elementXml;
  }
  return elementXml.replace(propsInner, () => nextPropsInner);
}

function buildPropertyValueBlock(
  propertyKey: string,
  valueKind: 'string' | 'boolean' | 'localizedString' | 'metadataReferenceList' | 'metadataFieldList',
  value: string | boolean | string[]
): string {
  if (valueKind === 'boolean') {
    return `<${propertyKey}>${value === true ? 'true' : 'false'}</${propertyKey}>`;
  }
  if (valueKind === 'metadataReferenceList') {
    const items = Array.isArray(value) ? value : [];
    if (items.length === 0) {
      return `<${propertyKey}/>`;
    }
    return [
      `<${propertyKey}>`,
      ...items.map((item) => `\t\t\t\t<xr:Item xsi:type="xr:MDObjectRef">${escapeXmlText(item)}</xr:Item>`),
      `\t\t\t</${propertyKey}>`,
    ].join('\n');
  }
  if (valueKind === 'metadataFieldList') {
    const items = Array.isArray(value) ? value : [];
    if (items.length === 0) {
      return `<${propertyKey}/>`;
    }
    return [
      `<${propertyKey}>`,
      ...items.map((item) => `\t\t\t\t<xr:Field>${escapeXmlText(item)}</xr:Field>`),
      `\t\t\t</${propertyKey}>`,
    ].join('\n');
  }
  if (valueKind === 'localizedString') {
    const content = escapeXmlText(typeof value === 'string' ? value : String(value));
    return [
      `<${propertyKey}>`,
      '\t\t\t\t\t<v8:item>',
      '\t\t\t\t\t\t<v8:lang>ru</v8:lang>',
      `\t\t\t\t\t\t<v8:content>${content}</v8:content>`,
      '\t\t\t\t\t</v8:item>',
      `</${propertyKey}>`,
    ].join('\n');
  }
  return `<${propertyKey}>${escapeXmlText(String(value))}</${propertyKey}>`;
}

function updateLocalizedPropertyContent(propertyBlock: string, value: string | boolean): string {
  const content = escapeXmlText(typeof value === 'string' ? value : String(value));
  const contentRe = /(<v8:content>)[\s\S]*?(<\/v8:content>)/;
  if (!contentRe.test(propertyBlock)) {
    return propertyBlock.replace(/<v8:content\s*\/>/, () => `<v8:content>${content}</v8:content>`);
  }
  return propertyBlock.replace(contentRe, (_m, open: string, close: string) => `${open}${content}${close}`);
}

function appendPropertyAtEnd(propsInner: string, valueBlock: string): string {
  const trailingWhitespaceMatch = /([\t ]*)$/.exec(propsInner);
  const trailingIndent = trailingWhitespaceMatch ? trailingWhitespaceMatch[1] : '';
  // Восстанавливаем закрывающий отступ Properties (например, "\t\t"), чтобы
  // новая строка вставала на ту же глубину, что и существующие свойства.
  const innerIndent = trailingIndent ? `${trailingIndent}\t` : '';
  const base = propsInner.replace(/[\t ]*$/, '');
  const baseTrimmed = base.replace(/\n+$/, '');
  return `${baseTrimmed}\n${innerIndent}${valueBlock}\n${trailingIndent}`;
}
