/**
 * Типы дочерних элементов объекта метаданных 1С, отображаемые в дереве.
 * Имена совпадают с XML-тегами, в которых эти элементы встречаются внутри `<ChildObjects>`.
 */
export type ChildTag =
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
  label: string;
  /** Идентификатор визуального типа узла (совпадает с {@link ChildTag}) */
  kind: ChildTag;
}

export const CHILD_TAG_CONFIG: Readonly<Record<ChildTag, ChildTagConfig>> = {
  Attribute: { tag: 'Attribute', label: 'Реквизиты', kind: 'Attribute' },
  AddressingAttribute: { tag: 'AddressingAttribute', label: 'Реквизиты адресации', kind: 'AddressingAttribute' },
  TabularSection: { tag: 'TabularSection', label: 'Табличные части', kind: 'TabularSection' },
  Form: { tag: 'Form', label: 'Формы', kind: 'Form' },
  Command: { tag: 'Command', label: 'Команды', kind: 'Command' },
  Template: { tag: 'Template', label: 'Макеты', kind: 'Template' },
  Dimension: { tag: 'Dimension', label: 'Измерения', kind: 'Dimension' },
  Resource: { tag: 'Resource', label: 'Ресурсы', kind: 'Resource' },
  EnumValue: { tag: 'EnumValue', label: 'Значения', kind: 'EnumValue' },
} as const;
