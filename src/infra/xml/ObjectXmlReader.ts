import * as fs from 'fs';
import { XMLParser } from 'fast-xml-parser';
import type { MetaChild, MetaObject } from '../../domain/MetaObject';
import {
  getStandardAttributesForKind,
  getStandardAttributePresentation,
} from '../../domain/StandardAttribute';
import {
  detectRootObjectKind,
  escapeXmlText,
  isEmptyPropertyValue,
  extractStandardAttributeXml,
  extractSimpleTag,
  extractSynonym,
  findChildMetaElementRange,
  findColumnRangeInTabularSection,
  findMethodRangeInUrlTemplate,
  hasRealChange,
  writeTextFilePreservingBomAndEol,
} from './XmlUtils';
import {
  isTypedFieldRole,
  normalizeTypedFieldPropertiesAfterTypeChange,
  type TypeAwarePropertyOwnerKind,
} from './TypedFieldPropertyRules';
import {
  collectPropertyBlocks,
  detectEol,
  detectPropertyIndent,
  findPropertiesRange,
  insertBlockInCanonicalPosition,
} from './typedField/PropertyBlockEditor';
import { insertPropertyBlockInOrder } from './properties/PropertyInsert';

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

    for (const element of findDirectChildren(directChildren, 'URLTemplate')) {
      result.push(this.toUrlTemplateChild(element));
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

  /**
   * URL-шаблон HTTP-сервиса — контейнер методов (третий уровень вложенности).
   * Переиспользует слот `columns` под вложенные `Method`, как ТЧ под колонки.
   */
  private toUrlTemplateChild(element: XmlElementNode): MetaChild {
    const columns: MetaChild[] = [];
    const childObjects = findFirstElement(getElementChildren(element), 'ChildObjects');
    if (childObjects) {
      for (const method of findDirectChildren(getElementChildren(childObjects), 'Method')) {
        columns.push(this.toMetaChild('Method', method));
      }
    }

    return {
      tag: 'URLTemplate',
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
    // Роль поля берём из targetKind вызывающего, а не из тега XML: колонка ТЧ
    // сериализуется тем же тегом <Attribute>, что и реквизит верхнего уровня,
    // и по тегу её состав свойств не отличить. Вид владельца — из корня файла:
    // им задаётся вторая ось состава (у колонки ТЧ справочника нет свойств
    // заполнения, у колонки ТЧ обработки — есть).
    const updatedTarget = updateTypeInElement(
      targetXml,
      options.typeInnerXml,
      options.propertyName ?? 'Type',
      isTypedFieldRole(options.targetKind) ? options.targetKind : undefined,
      // allowBareRoot сохраняет поведение прежней приватной копии функции.
      // Фактически недостижим: `xml` здесь — целиком прочитанный файл объекта
      // метаданных по пути из MetaPathResolver, а такой файл всегда обёрнут
      // <MetaDataObject>. Отказ от флага — отдельное решение, не косметика.
      detectRootObjectKind(xml, true),
      isRootTypeTargetKind(options.targetKind)
    );
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
      targetKind: 'Self' | 'StandardAttribute' | 'Attribute' | 'AddressingAttribute' | 'Dimension' | 'Resource' | 'Column' | 'TabularSection' | 'Command' | 'EnumValue' | 'URLTemplate' | 'Method';
      targetName: string;
      tabularSectionName?: string;
      urlTemplateName?: string;
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
      if (options.targetKind === 'Method') {
        // Метод — третий уровень вложенности: адресуется nesting-aware по имени
        // URL-шаблона-контейнера (аналог Column по tabularSectionName).
        if (!options.urlTemplateName) {
          return null;
        }
        return findMethodRangeInUrlTemplate(xml, options.urlTemplateName, options.targetName);
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
    const updatedTarget = updatePropertyInElement(
      targetXml,
      options.propertyKey,
      options.valueKind,
      options.value,
      // Канон порядка снят с КОРНЕЙ выгрузки, поэтому вид владельца передаётся
      // только для самого объекта: у дочернего элемента (реквизит, колонка,
      // команда) своя ось состава свойств, и ранг ключа корня там не при чём.
      options.targetKind === 'Self' ? detectRootObjectKind(xml) : undefined
    );
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

/** Отступ свойств по умолчанию — уровень `<Properties>` дочернего элемента объекта. */
const DEFAULT_PROPERTY_INDENT = '\t\t\t';

function updateTypeInElement(
  elementXml: string,
  typeInnerXml: string,
  propertyName: 'Type' | 'Source' | 'CommandParameterType' = 'Type',
  role?: TypeAwarePropertyOwnerKind,
  ownerKind?: string,
  isRootTarget = false
): string {
  // Отступ берётся у заменяемого блока (или у соседнего свойства), а не
  // захардкожен: у колонки ТЧ он на два уровня глубже, чем у реквизита
  // верхнего уровня, и фиксированные табы ломали бы файл на каждой смене типа.
  const indent = detectPropertyBlockIndent(elementXml, propertyName);
  const innerXml = indentTypeInner(typeInnerXml, `${indent}\t`);
  const updated = replaceOrInsertTypeBlock(
    elementXml,
    propertyName,
    `<${propertyName}>\n${innerXml}\n${indent}</${propertyName}>`,
    ownerKind,
    isRootTarget
  );
  // Состав свойств перестраивается только у типизированного поля и только при
  // смене <Type>: у Source подписки на событие и CommandParameterType команды
  // ни роли поля, ни владельца нет.
  if (updated === null || propertyName !== 'Type' || !role) {
    return updated ?? elementXml;
  }
  return normalizeTypedFieldPropertiesAfterTypeChange(updated, role, innerXml, ownerKind);
}

/**
 * Ставит готовый блок типа на место свойства; `null` — ставить некуда.
 *
 * Отсутствующий блок КОРНЕВОГО объекта (`isRootTarget`) встаёт по рангу из
 * `ROOT_PROPERTY_ORDER`: прежняя эвристика «сразу за Comment» давала верное
 * место случайно и только у части видов — у общей команды эталон кладёт
 * `CommandParameterType` десятым, после `IncludeHelpInContents`.
 *
 * У типизированного ПОЛЯ канон свой (`Name, Synonym, Comment, Type`), поэтому
 * там якорь остаётся прежним — но ищется по разобранным блокам, а не регэкспом
 * `<Comment>…</Comment>`: пустой комментарий платформа пишет самозакрытым
 * `<Comment/>`, и парная регулярка на нём промахивалась на `<Name>`.
 */
function replaceOrInsertTypeBlock(
  elementXml: string,
  propertyName: string,
  typeBlock: string,
  ownerKind?: string,
  isRootTarget = false
): string | null {
  const propertyRe = new RegExp(`<${propertyName}>[\\s\\S]*?<\\/${propertyName}>`);
  if (propertyRe.test(elementXml)) {
    return elementXml.replace(propertyRe, () => typeBlock);
  }
  const selfClosingRe = new RegExp(`<${propertyName}(?:\\s[^>]*)?\\/>`);
  if (selfClosingRe.test(elementXml)) {
    return elementXml.replace(selfClosingRe, () => typeBlock);
  }
  const propertiesMatch = /<Properties>([\s\S]*?)<\/Properties>/.exec(elementXml);
  if (!propertiesMatch) {
    return null;
  }
  const propsInner = propertiesMatch[1];
  const nextPropsInner = isRootTarget
    ? insertPropertyBlockInOrder(propsInner, ownerKind, propertyName, typeBlock)
    : insertTypeBlockAfterCommentOrName(propsInner, typeBlock);
  // Подстановка по смещению, а не `replace(propsInner, …)`: на пустом парном
  // `<Properties></Properties>` содержимое — пустая строка, и `String.replace('')`
  // вставил бы блок в позицию 0 (см. updatePropertyInElement).
  const innerStart = propertiesMatch.index + '<Properties>'.length;
  return elementXml.slice(0, innerStart) + nextPropsInner + elementXml.slice(innerStart + propsInner.length);
}

/**
 * Якоря канона типизированного ПОЛЯ: `Name`, `Synonym`, `Comment`, `Type`.
 * `Synonym` в карте не нужен — он между двумя якорями, и место типа от него не
 * зависит; вставляемому блоку даётся ранг 2, то есть «после обоих».
 */
const TYPED_FIELD_TYPE_ANCHOR_RANKS: ReadonlyMap<string, number> = new Map([
  ['Name', 0],
  ['Comment', 1],
]);

/** Тип поля встаёт сразу за комментарием, иначе — за именем (та же механика, что у корня). */
function insertTypeBlockAfterCommentOrName(propsInner: string, typeBlock: string): string {
  return insertBlockInCanonicalPosition(
    propsInner,
    collectPropertyBlocks(propsInner),
    (key) => TYPED_FIELD_TYPE_ANCHOR_RANKS.get(key),
    2,
    typeBlock,
    detectEol(propsInner)
  );
}

/**
 * Отступ блока свойства внутри `<Properties>`: собственный, если свойство уже
 * есть, иначе — соседнего свойства. Так новый блок встаёт на тот же уровень,
 * что и остальные, независимо от глубины элемента в файле.
 */
function detectPropertyBlockIndent(elementXml: string, propertyName: string): string {
  const properties = findPropertiesRange(elementXml);
  if (!properties) {
    return DEFAULT_PROPERTY_INDENT;
  }
  const blocks = collectPropertyBlocks(properties.inner);
  const own = blocks.find((block) => block.key === propertyName);
  return own && own.indent.length > 0 ? own.indent : detectPropertyIndent(blocks, DEFAULT_PROPERTY_INDENT);
}

function isRootTypeTargetKind(kind: string): boolean {
  return kind === 'SessionParameter'
    || kind === 'CommonAttribute'
    || kind === 'Constant'
    || kind === 'DefinedType'
    || kind === 'EventSubscription'
    || kind === 'CommonCommand';
}

function indentTypeInner(typeInnerXml: string, indent: string): string {
  return typeInnerXml
    .split('\n')
    .map((line) => line.replace(/\r/g, '').trimEnd())
    .filter((line) => line.length > 0)
    .map((line) => `${indent}${line}`)
    .join('\n');
}

/**
 * Правит одно свойство внутри `<Properties>` элемента.
 *
 * Фолбэк «ключ без ранга» здесь РАЗРЕШАЮЩИЙ (свойство дописывается в конец) и
 * этим намеренно отличается от `ConfigurationXmlEditor.modifyConfigurationProperty`,
 * где неизвестный ключ по-прежнему отбивается отказом: сюда приходят и свойства
 * дочерних элементов, у которых канона порядка нет вовсе, и запрет ломал бы
 * существующую запись их свойств.
 *
 * @param ownerKind корневой тег XML владельца (`Catalog`, `Configuration`, …)
 *   или `undefined` для дочернего элемента — вход {@link insertPropertyBlockInOrder}.
 */
function updatePropertyInElement(
  elementXml: string,
  propertyKey: string,
  valueKind: 'string' | 'boolean' | 'localizedString' | 'metadataReferenceList' | 'metadataFieldList',
  value: string | boolean | string[],
  ownerKind?: string
): string {
  const propertiesMatch = /<Properties>([\s\S]*?)<\/Properties>/.exec(elementXml);
  if (!propertiesMatch) {
    return elementXml;
  }
  const propsInner = propertiesMatch[1];
  const propertyRe = new RegExp(`<${propertyKey}>[\\s\\S]*?<\\/${propertyKey}>`);
  const selfClosingRe = new RegExp(`<${propertyKey}(?:\\s[^>]*)?\\/>`);
  const propertyMatch = propertyRe.exec(propsInner);
  // Очистка локализованного свойства идёт НЕ через правку содержимого: платформа
  // пустое значение пишет самозакрытым тегом, а правка по месту оставила бы
  // осиротевший `<v8:item>` с пустым `<v8:content>` — такой формы в эталоне нет
  // ни разу (105 278 заполненных `<v8:content>`, пустых 0). Массив на этом входе
  // означает то же самое: коэрсия ниже превращает его в пустую строку.
  const nextValueBlock = propertyMatch && valueKind === 'localizedString' && !isEmptyPropertyValue(value)
    ? updateLocalizedPropertyContent(propertyMatch[0], value)
    : buildPropertyValueBlock(propertyKey, valueKind, value, detectPropertyBlockIndent(elementXml, propertyKey));

  // Отсутствующее свойство встаёт на КАНОНИЧЕСКОЕ место (ROOT_PROPERTY_ORDER),
  // а не в конец блока: 1С принимает `<Properties>` только в порядке xs:sequence
  // своей схемы, а выбор формы на выгрузке 2.20 (тега в файле нет) до этого
  // уезжал за Explanation.
  const nextPropsInner = propertyMatch
    ? propsInner.replace(propertyMatch[0], () => nextValueBlock)
    : selfClosingRe.test(propsInner)
    ? propsInner.replace(selfClosingRe, () => nextValueBlock)
    : insertPropertyBlockInOrder(propsInner, ownerKind, propertyKey, nextValueBlock);

  if (nextPropsInner === propsInner) {
    return elementXml;
  }
  // Подстановка по СМЕЩЕНИЮ, а не `elementXml.replace(propsInner, …)`: на пустом
  // парном `<Properties></Properties>` содержимое — пустая строка, и
  // `String.replace('')` вставил бы свойство в позицию 0, то есть перед `<?xml`.
  const innerStart = propertiesMatch.index + '<Properties>'.length;
  return elementXml.slice(0, innerStart) + nextPropsInner + elementXml.slice(innerStart + propsInner.length);
}

function buildPropertyValueBlock(
  propertyKey: string,
  valueKind: 'string' | 'boolean' | 'localizedString' | 'metadataReferenceList' | 'metadataFieldList',
  value: string | boolean | string[],
  blockIndent: string
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
  // Сюда управление доходит только для 'string' и 'localizedString': boolean и
  // оба списочных вида обработаны выше и уже вернули свой блок (у них своя
  // пустота — пустой список).
  if (isEmptyPropertyValue(value)) {
    return `<${propertyKey}/>`;
  }
  if (valueKind === 'localizedString') {
    const content = escapeXmlText(typeof value === 'string' ? value : String(value));
    // Отступы — от места САМОГО свойства, а не фиксированные: блок пишется и на
    // корне объекта, и у дочернего элемента, где глубина другая. С хардкодом
    // цикл «очистить → заполнить заново» уводил `<v8:item>` на лишний уровень,
    // а закрывающий тег — в нулевую колонку.
    return [
      `<${propertyKey}>`,
      `${blockIndent}\t<v8:item>`,
      `${blockIndent}\t\t<v8:lang>ru</v8:lang>`,
      `${blockIndent}\t\t<v8:content>${content}</v8:content>`,
      `${blockIndent}\t</v8:item>`,
      `${blockIndent}</${propertyKey}>`,
    ].join('\n');
  }
  return `<${propertyKey}>${escapeXmlText(String(value))}</${propertyKey}>`;
}

function updateLocalizedPropertyContent(propertyBlock: string, value: string | boolean | string[]): string {
  const content = escapeXmlText(typeof value === 'string' ? value : String(value));
  const contentRe = /(<v8:content>)[\s\S]*?(<\/v8:content>)/;
  // Парный блок свойства с САМОЗАКРЫТЫМ `<v8:content/>` внутри: в эталоне такой
  // формы нет ни разу (0 при 105 278 заполненных), и наш писатель её не создаёт —
  // пустое локализованное значение схлопывается в `<Synonym/>` целиком. Ветка
  // оставлена как защита от файла, отредактированного человеком вручную, и из
  // production недостижима.
  /* c8 ignore next 3 */
  if (!contentRe.test(propertyBlock)) {
    return propertyBlock.replace(/<v8:content\s*\/>/, () => `<v8:content>${content}</v8:content>`);
  }
  return propertyBlock.replace(contentRe, (_m, open: string, close: string) => `${open}${content}${close}`);
}
