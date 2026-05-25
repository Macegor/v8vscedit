/**
 * Типы дочерних элементов объекта метаданных 1С, отображаемые в дереве.
 * Имена совпадают с XML-тегами, в которых эти элементы встречаются внутри `<ChildObjects>`.
 */
export type ChildTag =
  | 'StandardAttribute'
  | 'Attribute'
  | 'AddressingAttribute'
  | 'TabularSection'
  | 'Form'
  | 'Command'
  | 'Template'
  | 'Dimension'
  | 'Resource'
  | 'EnumValue';

/** Человекочитаемые подписи групп дочерних элементов и типы их узлов дерева */
export interface ChildTagConfig {
  tag: ChildTag;
  /**
   * Подпись группы для UI дерева — может содержать пробелы
   * («Стандартные реквизиты», «Табличные части»).
   */
  label: string;
  /** Идентификатор визуального типа узла (совпадает с {@link ChildTag}) */
  kind: ChildTag;
  /**
   * Каноничный сегмент пути 1С, **единственное число**, CamelCase без пробелов.
   * Используется при построении MCP-путей (`canonicalChildPath`). Отличается
   * от `label`: `label` — для дерева/UI, `pathSegment` — для путей.
   */
  pathSegment: string;
}

export const CHILD_TAG_CONFIG: Readonly<Record<ChildTag, ChildTagConfig>> = {
  StandardAttribute: { tag: 'StandardAttribute', label: 'Стандартные реквизиты', kind: 'StandardAttribute', pathSegment: 'СтандартныйРеквизит' },
  Attribute: { tag: 'Attribute', label: 'Реквизиты', kind: 'Attribute', pathSegment: 'Реквизит' },
  AddressingAttribute: { tag: 'AddressingAttribute', label: 'Реквизиты адресации', kind: 'AddressingAttribute', pathSegment: 'РеквизитАдресации' },
  TabularSection: { tag: 'TabularSection', label: 'Табличные части', kind: 'TabularSection', pathSegment: 'ТабличнаяЧасть' },
  Form: { tag: 'Form', label: 'Формы', kind: 'Form', pathSegment: 'Форма' },
  Command: { tag: 'Command', label: 'Команды', kind: 'Command', pathSegment: 'Команда' },
  Template: { tag: 'Template', label: 'Макеты', kind: 'Template', pathSegment: 'Макет' },
  Dimension: { tag: 'Dimension', label: 'Измерения', kind: 'Dimension', pathSegment: 'Измерение' },
  Resource: { tag: 'Resource', label: 'Ресурсы', kind: 'Resource', pathSegment: 'Ресурс' },
  EnumValue: { tag: 'EnumValue', label: 'Значения', kind: 'EnumValue', pathSegment: 'ЗначениеПеречисления' },
} as const;
