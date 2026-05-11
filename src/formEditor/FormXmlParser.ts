/**
 * Парсер Form.xml → FormModel.
 * Использует fast-xml-parser в ordered mode для корректной обработки порядка элементов.
 */

import { XMLParser } from 'fast-xml-parser';
import type {
  FormModel,
  FormElement,
  FormAttribute,
  FormAttributeColumn,
  FormCommand,
  FormEvent,
  FormElementType,
  GroupDirection,
} from './FormModel';

// ── Типы ordered-вывода fast-xml-parser ──────────────────────────────────────

// fast-xml-parser ordered mode выдаёт объекты произвольной структуры
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type XmlNode = Record<string, any>;

// ── Парсер ───────────────────────────────────────────────────────────────────

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
  parseTagValue: false,
});

/** Распарсить содержимое Form.xml в FormModel */
export function parseFormXml(xmlContent: string): FormModel {
  const ordered: XmlNode[] = parser.parse(xmlContent);

  // Корневой элемент — <Form> (с возможными namespace-обёртками)
  const formNode = findTag(ordered, 'Form');
  if (!formNode) {
    return emptyModel();
  }

  const formChildren = getChildren(formNode);

  // ChildItems → дерево элементов
  const childItemsNode = findTag(formChildren, 'ChildItems');
  const rootChildren = childItemsNode
    ? parseElements(getChildren(childItemsNode))
    : [];

  // AutoCommandBar (бывает на том же уровне, что и ChildItems)
  const autoBarNode = findTag(formChildren, 'AutoCommandBar');
  if (autoBarNode) {
    const barElement = parseSingleElement('AutoCommandBar', autoBarNode);
    if (barElement) {
      rootChildren.unshift(barElement);
    }
  }

  const root: FormElement = {
    id: 0,
    name: '__root__',
    type: 'UsualGroup',
    group: 'Vertical',
    children: rootChildren,
    rawProperties: {},
  };

  // Attributes
  const attributesNode = findTag(formChildren, 'Attributes');
  const attributes = attributesNode
    ? parseAttributes(getChildren(attributesNode))
    : [];

  // Commands
  const commandsNode = findTag(formChildren, 'Commands');
  const commands = commandsNode
    ? parseCommands(getChildren(commandsNode))
    : [];

  // Events
  const eventsNode = findTag(formChildren, 'Events');
  const events = eventsNode ? parseEvents(getChildren(eventsNode)) : [];

  return { root, attributes, commands, events };
}

// ── Парсинг элементов формы ──────────────────────────────────────────────────

/** Известные теги, являющиеся элементами формы */
const ELEMENT_TAGS = new Set<string>([
  'UsualGroup',
  'InputField',
  'LabelField',
  'LabelDecoration',
  'Button',
  'Table',
  'Pages',
  'Page',
  'CheckBoxField',
  'RadioButtonField',
  'PictureField',
  'PictureDecoration',
  'SpreadSheetDocumentField',
  'HTMLDocumentField',
  'TextDocumentField',
  'PlannerField',
  'ProgressBarField',
  'CalendarField',
  'ChartField',
  'GanttChartField',
  'PeriodField',
  'DendrogramField',
  'Popup',
  'ColumnGroup',
  'SearchStringAddition',
  'ViewStatusAddition',
  'SearchControlAddition',
  'AutoCommandBar',
  'CommandBar',
  'CommandBarButton',
  'Separator',
  'Navigator',
  'ContextMenu',
]);

function parseElements(nodes: XmlNode[]): FormElement[] {
  const result: FormElement[] = [];
  for (const node of nodes) {
    const tagName = getTagName(node);
    if (!tagName) continue;
    if (!ELEMENT_TAGS.has(tagName)) continue;

    const el = parseSingleElement(tagName, node);
    if (el) result.push(el);
  }
  return result;
}

function parseSingleElement(
  tagName: string,
  node: XmlNode
): FormElement | null {
  const attrs = node[':@'] ?? {};
  const name = attrs['@_name'] ?? '';
  const id = parseInt(attrs['@_id'] ?? '0', 10);

  const children = getChildren(node);
  const rawProperties: Record<string, string> = {};

  let group: GroupDirection | undefined;
  let dataPath: string | undefined;
  let title: string | undefined;
  let showTitle: boolean | undefined;
  let horizontalStretch: boolean | undefined;
  let verticalStretch: boolean | undefined;
  let width: number | undefined;
  let height: number | undefined;
  let readOnly: boolean | undefined;
  let visible: boolean | undefined;

  // Дочерние элементы (вложенные ChildItems)
  let childElements: FormElement[] = [];
  const childItemsNode = findTag(children, 'ChildItems');
  if (childItemsNode) {
    childElements = parseElements(getChildren(childItemsNode));
  }

  // Парсинг свойств
  for (const child of children) {
    const propName = getTagName(child);
    if (!propName) continue;

    // Пропускаем вложенные структурные теги
    if (
      propName === 'ChildItems' ||
      propName === 'ContextMenu' ||
      propName === 'ExtendedTooltip' ||
      propName === 'SearchStringAddition' ||
      propName === 'ViewStatusAddition' ||
      propName === 'SearchControlAddition'
    ) {
      continue;
    }

    const textValue = getTextContent(child);

    switch (propName) {
      case 'Group':
        group = textValue as GroupDirection;
        break;
      case 'DataPath':
        dataPath = textValue;
        break;
      case 'Title': {
        title = extractLocalizedString(child);
        break;
      }
      case 'ShowTitle':
        showTitle = textValue === 'true';
        break;
      case 'HorizontalStretch':
        horizontalStretch = textValue === 'true';
        break;
      case 'VerticalStretch':
        verticalStretch = textValue === 'true';
        break;
      case 'Width':
        width = parseInt(textValue ?? '0', 10) || undefined;
        break;
      case 'Height':
        height = parseInt(textValue ?? '0', 10) || undefined;
        break;
      case 'ReadOnly':
        readOnly = textValue === 'true';
        break;
      case 'Visible':
        visible = textValue === 'false' ? false : undefined;
        break;
      default:
        if (textValue !== undefined) {
          rawProperties[propName] = textValue;
        }
        break;
    }
  }

  return {
    id,
    name,
    type: tagName as FormElementType,
    group,
    dataPath,
    title,
    showTitle,
    horizontalStretch,
    verticalStretch,
    width,
    height,
    readOnly,
    visible,
    children: childElements,
    rawProperties,
  };
}

// ── Парсинг реквизитов ──────────────────────────────────────────────────────

function parseAttributes(nodes: XmlNode[]): FormAttribute[] {
  const result: FormAttribute[] = [];
  for (const node of nodes) {
    const tagName = getTagName(node);
    if (tagName !== 'Attribute') continue;

    const attrs = node[':@'] ?? {};
    const name = attrs['@_name'] ?? '';
    const id = parseInt(attrs['@_id'] ?? '0', 10);
    const children = getChildren(node);

    let valueType = '';
    let isMain = false;
    let savedData = false;
    const columns: FormAttributeColumn[] = [];

    for (const child of children) {
      const propName = getTagName(child);
      if (propName === 'Type') {
        valueType = extractType(child);
      } else if (propName === 'MainAttribute') {
        isMain = getTextContent(child) === 'true';
      } else if (propName === 'SavedData') {
        savedData = getTextContent(child) === 'true';
      } else if (propName === 'Columns') {
        columns.push(...parseColumns(getChildren(child)));
      }
    }

    result.push({ id, name, valueType, isMain, savedData, columns });
  }
  return result;
}

function parseColumns(nodes: XmlNode[]): FormAttributeColumn[] {
  const result: FormAttributeColumn[] = [];
  for (const node of nodes) {
    if (getTagName(node) !== 'Column') continue;
    const attrs = node[':@'] ?? {};
    const name = attrs['@_name'] ?? '';
    const id = parseInt(attrs['@_id'] ?? '0', 10);
    const children = getChildren(node);
    let valueType = '';
    for (const child of children) {
      if (getTagName(child) === 'Type') {
        valueType = extractType(child);
      }
    }
    result.push({ id, name, valueType });
  }
  return result;
}

// ── Парсинг команд ──────────────────────────────────────────────────────────

function parseCommands(nodes: XmlNode[]): FormCommand[] {
  const result: FormCommand[] = [];
  for (const node of nodes) {
    if (getTagName(node) !== 'Command') continue;
    const attrs = node[':@'] ?? {};
    const name = attrs['@_name'] ?? '';
    const id = parseInt(attrs['@_id'] ?? '0', 10);
    const children = getChildren(node);

    let title: string | undefined;
    let action: string | undefined;
    let representation: string | undefined;

    for (const child of children) {
      const propName = getTagName(child);
      if (propName === 'Title') {
        title = extractLocalizedString(child);
      } else if (propName === 'Action') {
        action = getTextContent(child);
      } else if (propName === 'Representation') {
        representation = getTextContent(child);
      }
    }

    result.push({ id, name, title, action, representation });
  }
  return result;
}

// ── Парсинг событий ─────────────────────────────────────────────────────────

function parseEvents(nodes: XmlNode[]): FormEvent[] {
  const result: FormEvent[] = [];
  for (const node of nodes) {
    if (getTagName(node) !== 'Event') continue;
    const attrs = node[':@'] ?? {};
    const name = attrs['@_name'] ?? '';
    const handler = getTextContent(node) ?? '';
    if (name && handler) {
      result.push({ name, handler });
    }
  }
  return result;
}

// ── Утилиты для ordered-mode XML ────────────────────────────────────────────

/** Получить имя тега в ordered-mode node */
function getTagName(node: XmlNode): string | undefined {
  for (const key of Object.keys(node)) {
    if (key !== ':@' && key !== '#text') return key;
  }
  return undefined;
}

/** Получить дочерние элементы ordered-mode node */
function getChildren(node: XmlNode): XmlNode[] {
  const tagName = getTagName(node);
  if (!tagName) return [];
  const val = node[tagName];
  if (Array.isArray(val)) return val as XmlNode[];
  return [];
}

/** Найти первый узел с заданным тегом среди массива ordered-mode nodes */
function findTag(nodes: XmlNode[], tag: string): XmlNode | undefined {
  return nodes.find((n) => getTagName(n) === tag);
}

/** Получить текстовое содержимое ordered-mode node */
function getTextContent(node: XmlNode): string | undefined {
  const children = getChildren(node);
  for (const child of children) {
    if ('#text' in child) {
      const val = child['#text'];
      if (typeof val === 'string') return val;
      if (Array.isArray(val) && val.length > 0) return String(val[0]);
    }
  }
  return undefined;
}

/** Извлечь локализованную строку из <Title>/<Synonym> — ищет v8:item → v8:content */
function extractLocalizedString(node: XmlNode): string | undefined {
  const children = getChildren(node);
  // Ищем v8:item
  const item = findTag(children, 'v8:item');
  if (!item) return getTextContent(node);
  const itemChildren = getChildren(item);
  const content = findTag(itemChildren, 'v8:content');
  if (!content) return undefined;
  return getTextContent(content);
}

/** Извлечь тип из <Type> → <v8:Type> */
function extractType(node: XmlNode): string {
  const children = getChildren(node);
  const typeNode = findTag(children, 'v8:Type');
  if (!typeNode) return '';
  return getTextContent(typeNode) ?? '';
}

function emptyModel(): FormModel {
  return {
    root: {
      id: 0,
      name: '__root__',
      type: 'UsualGroup',
      group: 'Vertical',
      children: [],
      rawProperties: {},
    },
    attributes: [],
    commands: [],
    events: [],
  };
}
