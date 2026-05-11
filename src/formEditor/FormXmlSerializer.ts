/**
 * Сериализатор FormModel → XML.
 *
 * Стратегия: вместо полного rebuild XML, работаем напрямую с ordered-mode
 * деревом fast-xml-parser. Это сохраняет все неизвестные элементы,
 * комментарии, namespaces и форматирование.
 *
 * Основная идея:
 * 1. Парсим оригинальный XML в ordered-mode дерево (сохраняем его)
 * 2. При изменениях модели применяем их к ordered-mode дереву
 * 3. Сериализуем дерево обратно через XMLBuilder
 */

import { XMLParser, XMLBuilder } from 'fast-xml-parser';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type XmlNode = Record<string, any>;

const parserOptions = {
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: false,
  parseTagValue: false,
  commentPropName: '#comment',
  processEntities: false,
};

const builderOptions = {
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: true,
  indentBy: '\t',
  commentPropName: '#comment',
  suppressBooleanAttributes: false,
  processEntities: false,
};

const parser = new XMLParser(parserOptions);
const builder = new XMLBuilder(builderOptions);

/** Известные теги элементов формы */
const ELEMENT_TAGS = new Set<string>([
  'UsualGroup', 'InputField', 'LabelField', 'LabelDecoration', 'Button',
  'Table', 'Pages', 'Page', 'CheckBoxField', 'RadioButtonField',
  'PictureField', 'PictureDecoration', 'SpreadSheetDocumentField',
  'HTMLDocumentField', 'TextDocumentField', 'PlannerField',
  'ProgressBarField', 'CalendarField', 'ChartField', 'GanttChartField',
  'PeriodField', 'DendrogramField', 'Popup', 'ColumnGroup',
  'SearchStringAddition', 'ViewStatusAddition', 'SearchControlAddition',
  'AutoCommandBar', 'CommandBar', 'CommandBarButton', 'Separator',
  'Navigator', 'ContextMenu',
]);

/**
 * Хранит оригинальное ordered-mode дерево XML.
 * Используется для round-trip сериализации.
 */
export class FormXmlDocument {
  private orderedTree: XmlNode[];
  private originalXml: string;

  constructor(xmlContent: string) {
    this.originalXml = xmlContent;
    this.orderedTree = parser.parse(xmlContent);
  }

  /** Переместить элемент формы (по id) в новую позицию */
  moveElement(
    elementId: number,
    targetParentId: number,
    insertBeforeId: number | null
  ): boolean {
    const formNode = this.findTag(this.orderedTree, 'Form');
    if (!formNode) return false;

    // Найти и удалить элемент из текущего родителя
    const removed = this.removeElementById(formNode, elementId);
    if (!removed) return false;

    // Найти целевого родителя и вставить
    if (targetParentId === 0) {
      // Корень — вставить в ChildItems формы
      const childItems = this.findOrCreateChildItems(formNode);
      this.insertElement(childItems, removed, insertBeforeId);
    } else {
      const targetParent = this.findElementById(formNode, targetParentId);
      if (!targetParent) return false;
      const childItems = this.findOrCreateChildItems(targetParent);
      this.insertElement(childItems, removed, insertBeforeId);
    }

    return true;
  }

  /** Обновить свойство элемента формы */
  updateElementProperty(
    elementId: number,
    propertyName: string,
    value: string
  ): boolean {
    const formNode = this.findTag(this.orderedTree, 'Form');
    if (!formNode) return false;

    const element = this.findElementById(formNode, elementId);
    if (!element) return false;

    const tagName = this.getTagName(element);
    if (!tagName) return false;

    const children: XmlNode[] = element[tagName];
    if (!Array.isArray(children)) return false;

    // Найти существующее свойство
    const existingIdx = children.findIndex(
      (c) => this.getTagName(c) === propertyName
    );

    if (existingIdx >= 0) {
      // Обновить значение
      children[existingIdx][propertyName] = [{ '#text': value }];
    } else {
      // Добавить новое свойство (перед ChildItems если есть)
      const childItemsIdx = children.findIndex(
        (c) => this.getTagName(c) === 'ChildItems'
      );
      const newProp: XmlNode = { [propertyName]: [{ '#text': value }] };
      if (childItemsIdx >= 0) {
        children.splice(childItemsIdx, 0, newProp);
      } else {
        children.push(newProp);
      }
    }

    return true;
  }

  /** Удалить элемент формы по id */
  deleteElement(elementId: number): boolean {
    const formNode = this.findTag(this.orderedTree, 'Form');
    if (!formNode) return false;
    return this.removeElementById(formNode, elementId) !== null;
  }

  /** Создать новый элемент формы */
  createElement(
    parentId: number,
    elementType: string,
    name: string,
    insertBeforeId: number | null
  ): { success: boolean; newId: number } {
    const formNode = this.findTag(this.orderedTree, 'Form');
    if (!formNode) return { success: false, newId: -1 };

    const newId = this.getMaxId(formNode) + 1;

    // Строим XML-узел нового элемента
    const elementChildren: XmlNode[] = [];

    // Для групп добавляем пустой ChildItems
    if (
      elementType === 'UsualGroup' ||
      elementType === 'ColumnGroup' ||
      elementType === 'Pages' ||
      elementType === 'Page' ||
      elementType === 'CommandBar'
    ) {
      elementChildren.push({ ChildItems: [] });
    }

    const newNode: XmlNode = {
      [elementType]: elementChildren,
      ':@': { '@_name': name, '@_id': String(newId) },
    };

    // Вставляем в целевого родителя
    if (parentId === 0) {
      const childItems = this.findOrCreateChildItems(formNode);
      this.insertElement(childItems, newNode, insertBeforeId);
    } else {
      const targetParent = this.findElementById(formNode, parentId);
      if (!targetParent) return { success: false, newId: -1 };
      const childItems = this.findOrCreateChildItems(targetParent);
      this.insertElement(childItems, newNode, insertBeforeId);
    }

    return { success: true, newId };
  }

  /** Найти максимальный id среди всех элементов формы */
  private getMaxId(contextNode: XmlNode): number {
    let maxId = 0;
    const tagName = this.getTagName(contextNode);
    if (!tagName) return maxId;

    const children: XmlNode[] = contextNode[tagName];
    if (!Array.isArray(children)) return maxId;

    for (const child of children) {
      const childTag = this.getTagName(child);
      if (!childTag) continue;

      const attrs = child[':@'];
      if (attrs && attrs['@_id']) {
        const id = parseInt(attrs['@_id'], 10);
        if (id > maxId) maxId = id;
      }

      if (childTag === 'ChildItems' || ELEMENT_TAGS.has(childTag) ||
          childTag === 'Attributes' || childTag === 'Commands') {
        const childMax = this.getMaxId(child);
        if (childMax > maxId) maxId = childMax;
      }
    }

    return maxId;
  }

  /** Сериализовать текущее состояние в XML */
  serialize(): string {
    let xml = builder.build(this.orderedTree) as string;
    // Убедимся что XML declaration на месте
    if (!xml.startsWith('<?xml')) {
      // Извлечь из оригинала
      const declMatch = this.originalXml.match(/<\?xml[^?]*\?>\s*/);
      if (declMatch) {
        xml = declMatch[0] + xml;
      }
    }
    return xml;
  }

  // ── Вспомогательные методы ────────────────────────────────────────────────

  private getTagName(node: XmlNode): string | undefined {
    for (const key of Object.keys(node)) {
      if (key !== ':@' && key !== '#text' && key !== '#comment') return key;
    }
    return undefined;
  }

  private findTag(nodes: XmlNode[], tag: string): XmlNode | undefined {
    return nodes.find((n) => this.getTagName(n) === tag);
  }

  /** Рекурсивный поиск элемента формы по id */
  private findElementById(
    contextNode: XmlNode,
    id: number
  ): XmlNode | undefined {
    const tagName = this.getTagName(contextNode);
    if (!tagName) return undefined;

    const children: XmlNode[] = contextNode[tagName];
    if (!Array.isArray(children)) return undefined;

    for (const child of children) {
      const childTag = this.getTagName(child);
      if (!childTag) continue;

      // Проверить сам элемент
      if (ELEMENT_TAGS.has(childTag)) {
        const attrs = child[':@'];
        if (attrs && parseInt(attrs['@_id'], 10) === id) {
          return child;
        }
      }

      // Рекурсия в ChildItems и сами элементы
      if (childTag === 'ChildItems' || ELEMENT_TAGS.has(childTag)) {
        const found = this.findElementById(child, id);
        if (found) return found;
      }
    }

    return undefined;
  }

  /** Удалить элемент по id из дерева. Возвращает удалённый узел. */
  private removeElementById(
    contextNode: XmlNode,
    id: number
  ): XmlNode | null {
    const tagName = this.getTagName(contextNode);
    if (!tagName) return null;

    const children: XmlNode[] = contextNode[tagName];
    if (!Array.isArray(children)) return null;

    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const childTag = this.getTagName(child);
      if (!childTag) continue;

      if (ELEMENT_TAGS.has(childTag)) {
        const attrs = child[':@'];
        if (attrs && parseInt(attrs['@_id'], 10) === id) {
          children.splice(i, 1);
          return child;
        }
      }

      if (childTag === 'ChildItems' || ELEMENT_TAGS.has(childTag)) {
        const removed = this.removeElementById(child, id);
        if (removed) return removed;
      }
    }

    return null;
  }

  /** Найти или создать ChildItems внутри элемента */
  private findOrCreateChildItems(elementNode: XmlNode): XmlNode {
    const tagName = this.getTagName(elementNode);
    if (!tagName) throw new Error('Invalid element node');

    const children: XmlNode[] = elementNode[tagName];
    let childItems = children.find(
      (c) => this.getTagName(c) === 'ChildItems'
    );

    if (!childItems) {
      childItems = { ChildItems: [] };
      children.push(childItems);
    }

    return childItems;
  }

  /** Вставить элемент в ChildItems перед указанным id (или в конец) */
  private insertElement(
    childItemsNode: XmlNode,
    element: XmlNode,
    insertBeforeId: number | null
  ): void {
    const items: XmlNode[] = childItemsNode['ChildItems'];

    if (insertBeforeId === null) {
      items.push(element);
      return;
    }

    for (let i = 0; i < items.length; i++) {
      const childTag = this.getTagName(items[i]);
      if (!childTag) continue;
      const attrs = items[i][':@'];
      if (attrs && parseInt(attrs['@_id'], 10) === insertBeforeId) {
        items.splice(i, 0, element);
        return;
      }
    }

    // Не нашли — добавляем в конец
    items.push(element);
  }
}
