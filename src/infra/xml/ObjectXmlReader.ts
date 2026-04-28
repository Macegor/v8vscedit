import * as fs from 'fs';
import { XMLParser } from 'fast-xml-parser';
import { MetaChild, MetaObject } from '../../domain/MetaObject';
import {
  extractChildMetaElementXml,
  extractColumnXmlFromTabularSection,
  extractSimpleTag,
  extractSynonym,
} from './XmlUtils';
import { normalizeTypedFieldPropertiesAfterTypeChange } from './TypedFieldPropertyRules';

type XmlTextNode = { '#text': string };
type XmlElementNode = { [tagName: string]: XmlNodeList };
type XmlNode = XmlTextNode | XmlElementNode;
type XmlNodeList = XmlNode[];

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
  return name ?? null;
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
      children: this.parseChildren(rootElement as XmlElementNode),
    };
  }

  private parseChildren(rootElement: XmlNode): MetaChild[] {
    const result: MetaChild[] = [];
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

  updateTypeInObject(
    xmlPath: string,
    options: {
      targetKind: 'Attribute' | 'AddressingAttribute' | 'Dimension' | 'Resource' | 'Column' | 'SessionParameter' | 'CommonAttribute';
      targetName: string;
      tabularSectionName?: string;
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
    let targetXml: string | null = null;
    if (options.targetKind === 'Column') {
      if (!options.tabularSectionName) {
        return false;
      }
      targetXml = extractColumnXmlFromTabularSection(xml, options.tabularSectionName, options.targetName);
    } else if (options.targetKind === 'SessionParameter' || options.targetKind === 'CommonAttribute') {
      targetXml = xml;
    } else {
      targetXml = extractChildMetaElementXml(xml, options.targetKind, options.targetName);
    }

    if (!targetXml) {
      return false;
    }

    const updatedTarget = updateTypeInElement(targetXml, normalizedType);
    if (updatedTarget === targetXml) {
      return false;
    }

    const updatedXml = xml.replace(targetXml, updatedTarget);
    if (updatedXml === xml) {
      return false;
    }

    fs.writeFileSync(xmlPath, updatedXml, 'utf-8');
    return true;
  }

  updatePropertyInObject(
    xmlPath: string,
    options: {
      targetKind: 'Self' | 'Attribute' | 'AddressingAttribute' | 'Dimension' | 'Resource' | 'Column' | 'TabularSection' | 'EnumValue';
      targetName: string;
      tabularSectionName?: string;
      propertyKey: string;
      valueKind: 'string' | 'boolean' | 'localizedString';
      value: string | boolean;
    }
  ): boolean {
    let xml: string;
    try {
      xml = fs.readFileSync(xmlPath, 'utf-8');
    } catch {
      return false;
    }

    let targetXml: string | null;
    if (options.targetKind === 'Self') {
      targetXml = xml;
    } else if (options.targetKind === 'Column') {
      if (!options.tabularSectionName) {
        return false;
      }
      targetXml = extractColumnXmlFromTabularSection(xml, options.tabularSectionName, options.targetName);
    } else {
      targetXml = extractChildMetaElementXml(xml, options.targetKind, options.targetName);
    }

    if (!targetXml) {
      return false;
    }

    const updatedTarget = updatePropertyInElement(targetXml, options.propertyKey, options.valueKind, options.value);
    if (updatedTarget === targetXml) {
      return false;
    }

    const updatedXml = options.targetKind === 'Self'
      ? updatedTarget
      : xml.replace(targetXml, updatedTarget);
    if (updatedXml === xml) {
      return false;
    }
    fs.writeFileSync(xmlPath, updatedXml, 'utf-8');
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
  const synonym = findFirstElement(getElementChildren(element), 'Synonym');
  if (!synonym) {
    return '';
  }
  const content = findFirstElement(getElementChildren(synonym), 'v8:content');
  return content ? collectDirectText(getElementChildren(content)) : '';
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

function updateTypeInElement(elementXml: string, typeInnerXml: string): string {
  const typeBlock = `<Type>\n${typeInnerXml}\n</Type>`;
  if (/<Type>[\s\S]*?<\/Type>/.test(elementXml)) {
    const updated = elementXml.replace(/<Type>[\s\S]*?<\/Type>/, typeBlock);
    return normalizeTypedFieldProperties(updated, typeInnerXml);
  }
  const propertiesMatch = /<Properties>([\s\S]*?)<\/Properties>/.exec(elementXml);
  if (!propertiesMatch) {
    return elementXml;
  }
  const propsInner = propertiesMatch[1];
  let nextPropsInner = propsInner;
  if (/<Comment[\s\S]*?<\/Comment>/.test(propsInner)) {
    nextPropsInner = propsInner.replace(/(<Comment[\s\S]*?<\/Comment>)/, `$1\n${typeBlock}`);
  } else if (/<Name[\s\S]*?<\/Name>/.test(propsInner)) {
    nextPropsInner = propsInner.replace(/(<Name[\s\S]*?<\/Name>)/, `$1\n${typeBlock}`);
  } else {
    nextPropsInner = `${propsInner}\n${typeBlock}`;
  }
  return normalizeTypedFieldProperties(elementXml.replace(propsInner, nextPropsInner), typeInnerXml);
}

function normalizeTypedFieldProperties(elementXml: string, typeInnerXml: string): string {
  const tag = /^<([A-Za-z][A-Za-z0-9]*)\b/.exec(elementXml.trimStart())?.[1];
  if (tag === 'Attribute' || tag === 'AddressingAttribute' || tag === 'Dimension' || tag === 'Resource') {
    return normalizeTypedFieldPropertiesAfterTypeChange(elementXml, tag, typeInnerXml);
  }
  return elementXml;
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
  valueKind: 'string' | 'boolean' | 'localizedString',
  value: string | boolean
): string {
  const propertiesMatch = /<Properties>([\s\S]*?)<\/Properties>/.exec(elementXml);
  if (!propertiesMatch) {
    return elementXml;
  }
  const propsInner = propertiesMatch[1];
  const nextValueBlock = buildPropertyValueBlock(propertyKey, valueKind, value);
  const propertyRe = new RegExp(`<${propertyKey}>[\\s\\S]*?<\\/${propertyKey}>`);

  let nextPropsInner = propsInner;
  if (propertyRe.test(propsInner)) {
    nextPropsInner = propsInner.replace(propertyRe, nextValueBlock);
  } else if (/<Comment[\s\S]*?<\/Comment>/.test(propsInner)) {
    nextPropsInner = propsInner.replace(/(<Comment[\s\S]*?<\/Comment>)/, `$1\n${nextValueBlock}`);
  } else if (/<Name[\s\S]*?<\/Name>/.test(propsInner)) {
    nextPropsInner = propsInner.replace(/(<Name[\s\S]*?<\/Name>)/, `$1\n${nextValueBlock}`);
  } else {
    nextPropsInner = `${propsInner}\n${nextValueBlock}`;
  }

  if (nextPropsInner === propsInner) {
    return elementXml;
  }
  return elementXml.replace(propsInner, nextPropsInner);
}

function buildPropertyValueBlock(
  propertyKey: string,
  valueKind: 'string' | 'boolean' | 'localizedString',
  value: string | boolean
): string {
  if (valueKind === 'boolean') {
    return `<${propertyKey}>${value === true ? 'true' : 'false'}</${propertyKey}>`;
  }
  if (valueKind === 'localizedString') {
    const content = escapeXmlText(String(value ?? ''));
    return [
      `<${propertyKey}>`,
      '\t\t\t\t\t<v8:item>',
      '\t\t\t\t\t\t<v8:lang>ru</v8:lang>',
      `\t\t\t\t\t\t<v8:content>${content}</v8:content>`,
      '\t\t\t\t\t</v8:item>',
      `</${propertyKey}>`,
    ].join('\n');
  }
  return `<${propertyKey}>${escapeXmlText(String(value ?? ''))}</${propertyKey}>`;
}

function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
