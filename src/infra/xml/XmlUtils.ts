import { XMLBuilder, XMLParser } from 'fast-xml-parser';

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

const builder = new XMLBuilder({
  preserveOrder: true,
  ignoreAttributes: false,
  suppressEmptyNode: false,
  processEntities: false,
  format: false,
});

/**
 * Возвращает список узлов XML в режиме `preserveOrder`.
 * Вспомогательная функция скрывает конфигурацию парсера от вызывающего кода.
 */
function parseXml(xml: string): XmlNodeList {
  return parser.parse(xml) as XmlNodeList;
}

/** Собирает XML обратно из списка узлов. */
function buildXml(nodes: XmlNodeList): string {
  return builder.build(nodes);
}

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

function collectText(nodes: XmlNodeList): string {
  let result = '';
  for (const node of nodes) {
    if (isTextNode(node)) {
      result += node['#text'];
      continue;
    }
    result += collectText(getElementChildren(node));
  }
  return result.trim();
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

function wrapForFragment(fragmentXml: string): XmlNodeList {
  return parseXml(`<FragmentRoot>${fragmentXml}</FragmentRoot>`);
}

function getWrappedRootChildren(fragmentXml: string): XmlNodeList {
  const wrapped = findFirstElement(wrapForFragment(fragmentXml), 'FragmentRoot');
  return wrapped ? getElementChildren(wrapped) : [];
}

/** Извлекает текст первого вхождения тега без атрибутов. */
export function extractSimpleTag(xml: string, tagName: string): string | undefined {
  const element = findFirstElement(parseXml(xml), tagName);
  if (!element) {
    return undefined;
  }
  const value = collectText(getElementChildren(element));
  return value.length > 0 ? value : undefined;
}

/** Извлекает синоним из `<Synonym><v8:item><v8:content>...</v8:content>`. */
export function extractSynonym(xml: string): string {
  const synonym = findFirstElement(parseXml(xml), 'Synonym');
  if (!synonym) {
    return '';
  }

  const content = findFirstElement(getElementChildren(synonym), 'v8:content');
  return content ? collectText(getElementChildren(content)) : '';
}

/**
 * Возвращает внутренний XML первого тега `<tagName>...</tagName>`.
 * Имя сохранено для совместимости, но вложенность теперь обрабатывает parser.
 */
export function extractNestingAwareBlock(xml: string, tagName: string): string | null {
  const element = findFirstElement(parseXml(xml), tagName);
  if (!element) {
    return null;
  }
  return buildXml(getElementChildren(element));
}

/** Возвращает содержимое первого верхнеуровневого блока `<ChildObjects>`. */
export function extractMainChildObjectsInnerXml(xml: string): string | null {
  return extractNestingAwareBlock(xml, 'ChildObjects');
}

/**
 * Находит в фрагменте XML полный узел дочернего элемента по тегу и имени.
 */
export function findChildElementFullXmlInBlock(
  block: string,
  childTag: string,
  elementName: string
): string | null {
  const children = getWrappedRootChildren(block);

  for (const child of findDirectChildren(children, childTag)) {
    const nameNode = findFirstElement(getElementChildren(child), 'Name');
    if (!nameNode) {
      continue;
    }
    if (collectText(getElementChildren(nameNode)) === elementName) {
      return buildXml([child]);
    }
  }

  return null;
}

/** Извлекает полный XML дочернего объекта из главного `<ChildObjects>`. */
export function extractChildMetaElementXml(
  xml: string,
  childTag: string,
  elementName: string
): string | null {
  const mainBlock = extractMainChildObjectsInnerXml(xml);
  if (!mainBlock) {
    return null;
  }
  return findChildElementFullXmlInBlock(mainBlock, childTag, elementName);
}

/** Возвращает XML колонки табличной части по имени ТЧ и колонки. */
export function extractColumnXmlFromTabularSection(
  objectXml: string,
  sectionName: string,
  columnName: string
): string | null {
  const tabularSectionXml = extractChildMetaElementXml(objectXml, 'TabularSection', sectionName);
  if (!tabularSectionXml) {
    return null;
  }

  const childObjectsInner = extractNestingAwareBlock(tabularSectionXml, 'ChildObjects');
  if (!childObjectsInner) {
    return null;
  }

  return findChildElementFullXmlInBlock(childObjectsInner, 'Attribute', columnName);
}
