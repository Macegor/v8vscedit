import { XMLParser } from 'fast-xml-parser';
import * as fs from 'fs';
import { getDefaultStandardAttributeIndexing } from '../../domain/StandardAttribute';

export interface XmlTextNode { '#text': string }
export type XmlElementNode = Record<string, XmlNodeList>;
export type XmlNode = XmlTextNode | XmlElementNode;
export type XmlNodeList = XmlNode[];

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  trimValues: false,
  parseTagValue: false,
  // Декодируем 5 предопределённых XML-сущностей при чтении значений тегов
  // (extractSimpleTag/extractSynonym и др.): сырые «&amp;» искажают сравнения
  // имён. Функции, возвращающие XML-блоки, работают срезами исходной строки,
  // а не сериализацией парсера, поэтому сущности в блоках остаются нетронутыми.
  // Запись значений выполняется через escapeXmlText — симметрия чтение↔запись цела.
  processEntities: true,
});

/**
 * Возвращает список узлов XML в режиме `preserveOrder`.
 * Вспомогательная функция скрывает конфигурацию парсера от вызывающего кода.
 */
function parseXml(xml: string): XmlNodeList {
  return parser.parse(xml) as XmlNodeList;
}

export function isTextNode(node: XmlNode): node is XmlTextNode {
  return Object.prototype.hasOwnProperty.call(node, '#text');
}

export function getElementName(node: XmlNode): string | null {
  if (isTextNode(node)) {
    return null;
  }
  const [name] = Object.keys(node);
  return name;
}

export function getElementChildren(node: XmlNode): XmlNodeList {
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

export function findFirstElement(nodes: XmlNodeList, tagName: string): XmlElementNode | null {
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

export interface XmlElementRange {
  readonly start: number;
  readonly openEnd: number;
  readonly end: number;
  readonly closeStart: number;
}

export function findNestingAwareElementRange(xml: string, tagName: string): XmlElementRange | null {
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

function findFirstElementRange(xml: string, tagName: string): XmlElementRange | null {
  return findNestingAwareElementRange(xml, tagName);
}

export function findDirectElementRanges(xml: string, tagName: string): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  const tagRe = /<\/?([A-Za-z_][\w:.-]*)(?:\s[^<>]*)?\/?>/g;
  let depth = 0;
  let current: { tag: string; start: number } | null = null;
  let match: RegExpExecArray | null;

  while ((match = tagRe.exec(xml)) !== null) {
    const text = match[0];
    const name = match[1];
    if (text.startsWith('</')) {
      depth = Math.max(0, depth - 1);
      if (depth === 0 && current?.tag === name) {
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

/**
 * Экранирует спецсимволы regexp в литеральной строке.
 * Канонический хелпер: ранее по проекту были рассыпаны побайтно идентичные
 * локальные копии (MetadataXmlCreator, MetadataXmlRemover, CfeBorrowService и др.).
 */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Извлекает версию формата из атрибута `version="…"` корневого тега
 * `<MetaDataObject>` (единый примитив, дедупликация 5a-5). Только текстовое
 * извлечение по границе имени тега — политику поиска Configuration.xml
 * (walk-up/один каталог), объём чтения (весь файл/head) и fallback при
 * отсутствии каждый вызывающий задаёт сам, т.к. они существенно расходятся.
 */
export function extractMetaDataObjectVersion(xml: string): string | undefined {
  return /<MetaDataObject\b[^>]*version="([^"]+)"/.exec(xml)?.[1];
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

interface DirectChildWithName {
  readonly range: { start: number; end: number };
  readonly childXml: string;
  readonly child: XmlElementNode;
  /** Узел `<Name>` дочернего элемента; `null`, если тег отсутствует. */
  readonly nameNode: XmlElementNode | null;
}

/**
 * Общий каркас для локаторов прямых дочерних элементов: для каждого прямого
 * (нужной вложенности) диапазона `childTag` в блоке возвращает срез, разобранный
 * узел и его `<Name>`. Отдаёт данные, не принимая за вызывающего решение о
 * фильтрации по имени/наличию тега — конкретное поведение остаётся в функциях.
 */
function* iterateDirectChildrenWithName(block: string, childTag: string): Iterable<DirectChildWithName> {
  for (const range of findDirectElementRanges(block, childTag)) {
    const childXml = block.slice(range.start, range.end);
    const children = getWrappedRootChildren(childXml);
    const child = findDirectChildren(children, childTag).at(0);
    // findDirectElementRanges отдаёт диапазон именно элемента childTag, поэтому
    // повторный разбор childXml всегда содержит его — ветка недостижима, но
    // нужна для сужения типа (.at(0) → T | undefined) без non-null assertion.
    /* c8 ignore next 3 */
    if (!child) {
      continue;
    }
    const nameNode = findFirstElement(getElementChildren(child), 'Name');
    yield { range, childXml, child, nameNode };
  }
}

/**
 * Находит в фрагменте XML полный узел дочернего элемента по тегу и имени.
 */
export function findChildElementFullXmlInBlock(
  block: string,
  childTag: string,
  elementName: string
): string | null {
  for (const { childXml, nameNode } of iterateDirectChildrenWithName(block, childTag)) {
    if (!nameNode) {
      continue;
    }
    if (collectText(getElementChildren(nameNode)) === elementName) {
      return childXml;
    }
  }

  return null;
}

/**
 * Возвращает диапазон {start,end} прямого дочернего узла по тегу и имени
 * ОТНОСИТЕЛЬНО переданного блока (не абсолютный в исходном XML).
 * Учитывает вложенность через findDirectElementRanges, поэтому не «перепрыгивает»
 * закрывающий тег внутреннего одноимённого контейнера.
 */
export function findChildElementRangeInBlock(
  block: string,
  childTag: string,
  elementName: string
): { start: number; end: number } | null {
  for (const { range, nameNode } of iterateDirectChildrenWithName(block, childTag)) {
    if (!nameNode) {
      continue;
    }
    if (collectText(getElementChildren(nameNode)) === elementName) {
      return range;
    }
  }

  return null;
}

/**
 * Возвращает абсолютный диапазон {start,end} дочернего объекта из главного
 * `<ChildObjects>` в полном XML объекта. Депт-аварный локатор-двойник
 * {@link extractChildMetaElementXml}: нужен мутаторам, чтобы заменять блок
 * по индексу, а не по текстовому совпадению (устраняет подмену одноимённых блоков).
 */
export function findChildMetaElementRange(
  xml: string,
  childTag: string,
  elementName: string
): { start: number; end: number } | null {
  const mainRange = findFirstElementRange(xml, 'ChildObjects');
  if (!mainRange) {
    return null;
  }
  const block = xml.slice(mainRange.openEnd, mainRange.closeStart);
  const inner = findChildElementRangeInBlock(block, childTag, elementName);
  if (!inner) {
    return null;
  }
  return { start: mainRange.openEnd + inner.start, end: mainRange.openEnd + inner.end };
}

/**
 * Возвращает абсолютный диапазон {start,end} колонки табличной части по имени ТЧ
 * и колонки в полном XML объекта. Двойник {@link extractColumnXmlFromTabularSection}.
 */
export function findColumnRangeInTabularSection(
  objectXml: string,
  sectionName: string,
  columnName: string
): { start: number; end: number } | null {
  const sectionRange = findChildMetaElementRange(objectXml, 'TabularSection', sectionName);
  if (!sectionRange) {
    return null;
  }
  const sectionXml = objectXml.slice(sectionRange.start, sectionRange.end);
  const childObjectsRange = findFirstElementRange(sectionXml, 'ChildObjects');
  if (!childObjectsRange) {
    return null;
  }
  const childObjectsInner = sectionXml.slice(childObjectsRange.openEnd, childObjectsRange.closeStart);
  const columnRange = findChildElementRangeInBlock(childObjectsInner, 'Attribute', columnName);
  if (!columnRange) {
    return null;
  }
  const base = sectionRange.start + childObjectsRange.openEnd;
  return { start: base + columnRange.start, end: base + columnRange.end };
}

/** Проверяет наличие прямого дочернего элемента по имени или текстовой ссылке. */
export function hasDirectChildElementNameInBlock(
  block: string,
  childTag: string,
  elementName: string
): boolean {
  for (const { child, nameNode } of iterateDirectChildrenWithName(block, childTag)) {
    // Fallback: при отсутствии <Name> имя берётся из всего текста узла —
    // поведение сохранено относительно исходной реализации.
    const name = nameNode
      ? collectText(getElementChildren(nameNode))
      : collectText(getElementChildren(child));
    if (name.trim() === elementName) {
      return true;
    }
  }
  return false;
}

/** Возвращает все прямые дочерние элементы указанного типа из XML-блока. */
export function findChildElementsFullXmlInBlock(
  block: string,
  childTag: string
): { name: string; xml: string }[] {
  const result: { name: string; xml: string }[] = [];
  for (const { childXml, nameNode } of iterateDirectChildrenWithName(block, childTag)) {
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
): { name: string; xml: string }[] {
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

/** Извлекает XML стандартного реквизита из корня объекта или табличной части. */
export function extractStandardAttributeXml(
  objectXml: string,
  attributeName: string,
  tabularSectionName?: string
): string | null {
  const sourceXml = tabularSectionName
    ? extractChildMetaElementXml(objectXml, 'TabularSection', tabularSectionName)
    : extractRootObjectElementXml(objectXml);
  if (!sourceXml) {
    return null;
  }
  const propertiesInner = extractNestingAwareBlock(sourceXml, 'Properties');
  if (!propertiesInner) {
    return null;
  }
  const standardAttributesInner = extractNestingAwareBlock(propertiesInner, 'StandardAttributes');
  if (!standardAttributesInner) {
    return `<xr:StandardAttribute name="${escapeXmlAttribute(attributeName)}"/>`;
  }
  const nameAttr = escapeRegExp(attributeName);
  const re = new RegExp(
    `<(?:[A-Za-z_][\\w.-]*:)?StandardAttribute\\b[^>]*\\bname="${nameAttr}"[^>]*>[\\s\\S]*?<\\/(?:[A-Za-z_][\\w.-]*:)?StandardAttribute>`,
    'm'
  );
  return re.exec(standardAttributesInner)?.[0] ?? null;
}

/** Создаёт описание стандартного реквизита в XML объекта, если оно ещё не было материализовано. */
export function ensureStandardAttributeXml(
  objectXmlPath: string,
  attributeName: string,
  rootKind: string
): string | null {
  let xml: string;
  try {
    xml = fs.readFileSync(objectXmlPath, 'utf-8');
  } catch {
    return null;
  }
  const existing = extractExistingStandardAttributeXml(xml, attributeName);
  if (existing) {
    return existing;
  }

  const propertiesMatch = /<Properties>([\s\S]*?)<\/Properties>/.exec(xml);
  if (!propertiesMatch) {
    return null;
  }
  const propsInner = propertiesMatch[1];
  const standardAttributeXml = buildDefaultStandardAttributeXml(rootKind, attributeName, '\t\t\t\t');
  const standardAttributesMatch = /<StandardAttributes>([\s\S]*?)<\/StandardAttributes>/.exec(propsInner);
  const selfClosingStandardAttributesMatch = /<StandardAttributes\s*\/>/.exec(propsInner);

  const nextPropsInner = standardAttributesMatch
    ? propsInner.replace(
        standardAttributesMatch[0],
        `<StandardAttributes>${standardAttributesMatch[1]}\n${standardAttributeXml}\n\t\t\t</StandardAttributes>`
      )
    : selfClosingStandardAttributesMatch
    ? propsInner.replace(
        selfClosingStandardAttributesMatch[0],
        `<StandardAttributes>\n${standardAttributeXml}\n\t\t\t</StandardAttributes>`
      )
    : insertStandardAttributesBlock(propsInner, standardAttributeXml);

  if (nextPropsInner === propsInner) {
    return null;
  }
  const nextXml = xml.replace(propsInner, nextPropsInner);
  writeTextFilePreservingBomAndEol(objectXmlPath, xml, nextXml);
  return extractExistingStandardAttributeXml(nextXml, attributeName);
}

function extractExistingStandardAttributeXml(objectXml: string, attributeName: string): string | null {
  const rootXml = extractRootObjectElementXml(objectXml);
  if (!rootXml) {
    return null;
  }
  const propertiesInner = extractNestingAwareBlock(rootXml, 'Properties');
  if (!propertiesInner) {
    return null;
  }
  const standardAttributesInner = extractNestingAwareBlock(propertiesInner, 'StandardAttributes');
  if (!standardAttributesInner) {
    return null;
  }
  const nameAttr = escapeRegExp(attributeName);
  const re = new RegExp(
    `<(?:[A-Za-z_][\\w.-]*:)?StandardAttribute\\b[^>]*\\bname="${nameAttr}"[^>]*>[\\s\\S]*?<\\/(?:[A-Za-z_][\\w.-]*:)?StandardAttribute>`,
    'm'
  );
  return re.exec(standardAttributesInner)?.[0] ?? null;
}

function insertStandardAttributesBlock(propsInner: string, standardAttributeXml: string): string {
  const block = `\t\t\t<StandardAttributes>\n${standardAttributeXml}\n\t\t\t</StandardAttributes>`;
  const inputByStringIndex = propsInner.search(/\n\t\t\t<InputByString\b/);
  if (inputByStringIndex >= 0) {
    return `${propsInner.slice(0, inputByStringIndex)}\n${block}${propsInner.slice(inputByStringIndex)}`;
  }
  return `${propsInner.trimEnd()}\n${block}\n\t\t`;
}

function buildDefaultStandardAttributeXml(rootKind: string, attributeName: string, indent: string): string {
  const indexing = getDefaultStandardAttributeIndexing(rootKind, attributeName);
  return [
    `${indent}<xr:StandardAttribute name="${escapeXmlAttribute(attributeName)}">`,
    indexing ? `${indent}\t<xr:Indexing>${indexing}</xr:Indexing>` : undefined,
    `${indent}</xr:StandardAttribute>`,
  ].filter((line): line is string => Boolean(line)).join('\n');
}

/**
 * Экранирует текстовое содержимое тегов: `&`, `<`, `>`.
 * Кавычки не трогает — для значений атрибутов используйте {@link escapeXmlAttribute}.
 * Канонический хелпер: ранее по проекту были рассыпаны идентичные локальные копии.
 */
export function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Экранирует значения XML-атрибутов: `&`, `<`, `>`, `"`.
 * Порядок замен не влияет на результат (ни одна сущность не содержит `<`/`>`/`"`),
 * поэтому вывод побитово совпадает с прежними локальными версиями.
 */
export function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value).replace(/"/g, '&quot;');
}

/**
 * Собирает локализованный XML-блок (`<tag><v8:item><v8:lang>ru…`).
 * Канонический хелпер: ранее две расходящиеся копии — в FormShared (всегда полный
 * блок) и в MetadataXmlCreator (для пустого текста отдавал самозакрывающийся
 * `<tag/>`). Флаг `emptyAsSelfClosing` сохраняет обе стратегии без изменения байтов.
 */
export function buildLocalizedTag(
  indent: string,
  tag: string,
  text: string,
  options?: { emptyAsSelfClosing?: boolean }
): string {
  if (options?.emptyAsSelfClosing && !text) {
    return `${indent}<${tag}/>`;
  }
  return [
    `${indent}<${tag}>`,
    `${indent}\t<v8:item>`,
    `${indent}\t\t<v8:lang>ru</v8:lang>`,
    `${indent}\t\t<v8:content>${escapeXmlAttribute(text)}</v8:content>`,
    `${indent}\t</v8:item>`,
    `${indent}</${tag}>`,
  ].join('\n');
}

/**
 * Декодирует 5 предопределённых XML-сущностей и числовую форму апострофа `&#39;`.
 * Канонический хелпер: ранее по проекту были рассыпаны идентичные локальные копии
 * (DataCompositionSchemaService, SubsystemXmlService, CommandInterfaceService,
 * MxlTemplateService), причём часть из них не декодировала `&apos;`/`&#39;`.
 * `&amp;` декодируется ПОСЛЕДНИМ: иначе буквальный текст `&amp;lt;` (в исходном XML
 * это литерал `&lt;`) ошибочно превратился бы в `<` из-за повторного прохода.
 */
export function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function extractRootObjectElementXml(fullXml: string): string | null {
  const rootMatch = /<MetaDataObject[^>]*>\s*<([A-Za-z][A-Za-z0-9]*)\b/.exec(fullXml);
  const rootTag = rootMatch?.[1];
  if (!rootTag) {
    return null;
  }
  const range = findFirstElementRange(fullXml, rootTag);
  return range ? fullXml.slice(range.start, range.end) : null;
}

/** Возвращает все колонки табличной части по имени ТЧ. */
export function extractColumnsXmlFromTabularSection(
  objectXml: string,
  sectionName: string
): { name: string; xml: string }[] {
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

/**
 * Сравнивает XML «до» и «после» мутации без учёта стиля переводов строк.
 *
 * Мутаторы собирают вставляемые блоки с «голыми» `\n` (через `.join('\n')`),
 * тогда как исходный файл может быть в CRLF. Побайтовое `updated === original`
 * тогда ложно считает файл изменившимся на каждом идемпотентном вызове. Нормализуем
 * оба варианта к `\n` перед сравнением: реальное содержательное отличие детектится,
 * различие только в EOL-стиле — нет (запись всё равно вернёт исходный EOL через
 * {@link writeTextFilePreservingBomAndEol}).
 */
export function hasRealChange(original: string, updated: string): boolean {
  const normalize = (value: string): string => value.replace(/\r\n|\r|\n/g, '\n');
  return normalize(original) !== normalize(updated);
}

/**
 * Убирает все XML-теги из фрагмента, оставляя только текст (с обрезкой пробелов).
 * Канонический хелпер (перенесён из приватного `stripXmlText`
 * EventSubscriptionPropertyService): текстовая утилита без vscode — место в infra.
 */
export function stripXmlTags(inner: string): string {
  return inner.replace(/<[^>]+>/g, '').trim();
}

/** Записывает XML, сохраняя BOM и преобладающий стиль переводов строк исходного файла. */
export function writeTextFilePreservingBomAndEol(
  filePath: string,
  originalContent: string,
  nextContent: string
): void {
  const hasBom = originalContent.charCodeAt(0) === 0xfeff;
  const eol = originalContent.includes('\r\n') ? '\r\n' : '\n';
  const normalized = nextContent.replace(/\r\n|\n/g, eol);
  fs.writeFileSync(filePath, `${hasBom && normalized.charCodeAt(0) !== 0xfeff ? '\ufeff' : ''}${normalized}`, 'utf-8');
}
