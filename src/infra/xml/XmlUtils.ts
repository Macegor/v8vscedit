import { XMLParser } from 'fast-xml-parser';

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

/**
 * Возвращает список узлов XML в режиме `preserveOrder`.
 * Вспомогательная функция скрывает конфигурацию парсера от вызывающего кода.
 */
function parseXml(xml: string): XmlNodeList {
  return parser.parse(xml) as XmlNodeList;
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

function findFirstElementRange(xml: string, tagName: string): { start: number; openEnd: number; end: number; closeStart: number } | null {
  const tagRe = new RegExp(`</?${escapeRegExp(tagName)}(?:\\s[^<>]*)?\\/?>`, 'g');
  let depth = 0;
  let start = -1;
  let openEnd = -1;
  let match: RegExpExecArray | null;

  while ((match = tagRe.exec(xml)) !== null) {
    const text = match[0];
    if (text.startsWith('</')) {
      if (start === -1) {
        continue;
      }
      depth--;
      if (depth === 0) {
        return {
          start,
          openEnd,
          closeStart: match.index,
          end: match.index + text.length,
        };
      }
      continue;
    }

    if (start === -1) {
      start = match.index;
      openEnd = match.index + text.length;
    }
    if (text.endsWith('/>')) {
      if (depth === 0) {
        return {
          start,
          openEnd,
          closeStart: openEnd,
          end: openEnd,
        };
      }
      continue;
    }
    depth++;
  }

  return null;
}

function findDirectElementRanges(xml: string, tagName: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const tagRe = /<\/?([A-Za-z_][\w:.-]*)(?:\s[^<>]*)?\/?>/g;
  let depth = 0;
  let current: { tag: string; start: number } | null = null;
  let match: RegExpExecArray | null;

  while ((match = tagRe.exec(xml)) !== null) {
    const text = match[0];
    const name = match[1];
    if (text.startsWith('</')) {
      depth = Math.max(0, depth - 1);
      if (depth === 0 && current && current.tag === name) {
        ranges.push({ start: current.start, end: match.index + text.length });
        current = null;
      }
      continue;
    }

    const selfClosing = text.endsWith('/>');
    if (depth === 0 && name === tagName) {
      if (selfClosing) {
        ranges.push({ start: match.index, end: match.index + text.length });
      } else {
        current = { tag: name, start: match.index };
      }
    }
    if (!selfClosing) {
      depth++;
    }
  }

  return ranges;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
 * Имя сохранено для совместимости; исходное форматирование блока не нормализуется.
 */
export function extractNestingAwareBlock(xml: string, tagName: string): string | null {
  const range = findFirstElementRange(xml, tagName);
  if (!range) {
    return null;
  }
  return xml.slice(range.openEnd, range.closeStart);
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
  for (const range of findDirectElementRanges(block, childTag)) {
    const childXml = block.slice(range.start, range.end);
    const children = getWrappedRootChildren(childXml);
    const child = findDirectChildren(children, childTag)[0];
    if (!child) {
      continue;
    }
    const nameNode = findFirstElement(getElementChildren(child), 'Name');
    if (!nameNode) {
      continue;
    }
    if (collectText(getElementChildren(nameNode)) === elementName) {
      return childXml;
    }
  }

  return null;
}

/** Возвращает все прямые дочерние элементы указанного типа из XML-блока. */
export function findChildElementsFullXmlInBlock(
  block: string,
  childTag: string
): Array<{ name: string; xml: string }> {
  const result: Array<{ name: string; xml: string }> = [];
  for (const range of findDirectElementRanges(block, childTag)) {
    const childXml = block.slice(range.start, range.end);
    const children = getWrappedRootChildren(childXml);
    const child = findDirectChildren(children, childTag)[0];
    if (!child) {
      continue;
    }
    const nameNode = findFirstElement(getElementChildren(child), 'Name');
    if (!nameNode) {
      continue;
    }
    result.push({
      name: collectText(getElementChildren(nameNode)),
      xml: childXml,
    });
  }

  return result;
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

/** Возвращает все дочерние элементы указанного типа из главного `<ChildObjects>`. */
export function extractChildMetaElementsXml(
  xml: string,
  childTag: string
): Array<{ name: string; xml: string }> {
  const mainBlock = extractMainChildObjectsInnerXml(xml);
  if (!mainBlock) {
    return [];
  }
  return findChildElementsFullXmlInBlock(mainBlock, childTag);
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

/** Возвращает все колонки табличной части по имени ТЧ. */
export function extractColumnsXmlFromTabularSection(
  objectXml: string,
  sectionName: string
): Array<{ name: string; xml: string }> {
  const tabularSectionXml = extractChildMetaElementXml(objectXml, 'TabularSection', sectionName);
  if (!tabularSectionXml) {
    return [];
  }

  const childObjectsInner = extractNestingAwareBlock(tabularSectionXml, 'ChildObjects');
  if (!childObjectsInner) {
    return [];
  }

  return findChildElementsFullXmlInBlock(childObjectsInner, 'Attribute');
}
