import { MetadataNode } from '../MetadataNode';

/**
 * Контекст, передаваемый обработчику при построении узлов навигатора.
 */
export interface HandlerContext {
  /** Корневой каталог конфигурации (содержит Configuration.xml) */
  configRoot: string;
  /** Тип конфигурации */
  configKind: 'cf' | 'cfe';
  /** Префикс имён собственных объектов расширения */
  namePrefix: string;
  /** Имена объектов из ChildObjects в Configuration.xml */
  names: string[];
}

/** Допустимые виды значений свойства объекта метаданных */
export type PropertyValueKind = 'string' | 'boolean' | 'enum' | 'localizedString';

/** Значение перечислимого свойства */
export interface EnumPropertyOption {
  value: string;
  label: string;
}

/** Значение перечислимого свойства */
export interface EnumPropertyValue {
  current: string;
  currentLabel?: string;
  allowedValues: EnumPropertyOption[];
}

/** Описание локализованной строки */
export interface LocalizedStringValue {
  presentation: string;
  values: Array<{
    lang: string;
    content: string;
  }>;
}

/** Значение свойства объекта метаданных */
export type PropertyValue = string | boolean | EnumPropertyValue | LocalizedStringValue;

/** Описание одного свойства объекта метаданных */
export interface ObjectPropertyItem {
  key: string;
  title: string;
  kind: PropertyValueKind;
  value: PropertyValue;
}

/** Коллекция свойств объекта метаданных */
export type ObjectPropertiesCollection = ObjectPropertyItem[];

/**
 * Обработчик типа объекта метаданных.
 * Отвечает за формирование узлов навигатора, отображение и редактирование свойств.
 */
export interface ObjectHandler {
  /** Строит узлы объектов для группы в навигаторе */
  buildTreeNodes(ctx: HandlerContext): MetadataNode[];
  /** Проверяет, доступны ли свойства для указанного узла */
  canShowProperties?(node: MetadataNode): boolean;
  /** Возвращает свойства объекта для панели */
  getProperties?(node: MetadataNode): ObjectPropertiesCollection;
}
