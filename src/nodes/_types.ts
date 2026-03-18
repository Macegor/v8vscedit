import { NodeKind } from '../MetadataNode';

/**
 * Описание статических свойств типа узла дерева.
 *
 * Используется для:
 * - выбора SVG-иконки;
 * - описания доступных дочерних тегов;
 * - назначения команд по клику и в контекстном меню.
 */
export interface NodeDescriptor {
  /** Имя SVG-иконки без пути и расширения */
  icon: string;
  /** Имя папки в выгрузке конфигурации (Catalogs, Documents, ...), если применимо */
  folderName?: string;
  /** Поддерживаемые дочерние теги XML */
  children?: ReadonlyArray<ChildTag>;
  /** Команда по одиночному клику по узлу, если задана */
  singleClickCommand?: CommandId;
}

/** Теги дочерних элементов объектов метаданных */
export type ChildTag =
  | 'Attribute'
  | 'TabularSection'
  | 'Form'
  | 'Command'
  | 'Template'
  | 'Dimension'
  | 'Resource'
  | 'EnumValue';

/** Идентификаторы поддерживаемых команд навигатора */
export type CommandId =
  | 'openXmlFile'
  | 'openObjectModule'
  | 'openManagerModule'
  | 'openConstantModule'
  | 'openFormModule'
  | 'openCommandModule'
  | 'openServiceModule'
  | 'openCommonModuleCode';

/** Конфигурация отображения дочернего тега */
export interface ChildTagConfig {
  /** Имя тега в XML */
  tag: ChildTag;
  /** Заголовок группы в дереве */
  label: string;
  /** Тип узла для элементов данного тега */
  kind: NodeKind;
}

/**
 * Справочник по дочерним тегам: заголовок группы и тип узла.
 * Используется при построении дочерних узлов объектов.
 */
export const CHILD_TAG_CONFIG: Readonly<Record<ChildTag, ChildTagConfig>> = {
  Attribute: {
    tag: 'Attribute',
    label: 'Реквизиты',
    kind: 'Attribute',
  },
  TabularSection: {
    tag: 'TabularSection',
    label: 'Табличные части',
    kind: 'TabularSection',
  },
  Form: {
    tag: 'Form',
    label: 'Формы',
    kind: 'Form',
  },
  Command: {
    tag: 'Command',
    label: 'Команды',
    kind: 'Command',
  },
  Template: {
    tag: 'Template',
    label: 'Макеты',
    kind: 'Template',
  },
  Dimension: {
    tag: 'Dimension',
    label: 'Измерения',
    kind: 'Dimension',
  },
  Resource: {
    tag: 'Resource',
    label: 'Ресурсы',
    kind: 'Resource',
  },
  EnumValue: {
    tag: 'EnumValue',
    label: 'Значения',
    kind: 'EnumValue',
  },
} as const;

