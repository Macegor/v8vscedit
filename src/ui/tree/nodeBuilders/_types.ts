import { MetadataNode } from '../TreeNode';

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

/** Квалификаторы строкового типа */
export interface MetadataStringQualifiers {
  length?: number;
  allowedLength?: 'Variable' | 'Fixed';
}

/** Квалификаторы числового типа */
export interface MetadataNumberQualifiers {
  digits?: number;
  fractionDigits?: number;
  allowedSign?: 'Any' | 'Nonnegative';
}

/** Квалификаторы типа даты */
export interface MetadataDateQualifiers {
  dateFractions?: 'Date' | 'DateTime' | 'Time';
}

/** Один элемент типа (примитив или ссылочный тип конфигурации) */
export interface MetadataTypeItem {
  /** Каноническая запись типа для XML (`String`, `CatalogRef.Номенклатура`) */
  canonical: string;
  /** Человекочитаемое представление (`Строка`, `СправочникСсылка.Номенклатура`) */
  display: string;
  /** Группа для дерева выбора типов */
  group: 'primitive' | 'reference' | 'defined';
}

/** Структурированное значение свойства `Type` */
export interface MetadataTypeValue {
  items: MetadataTypeItem[];
  stringQualifiers?: MetadataStringQualifiers;
  numberQualifiers?: MetadataNumberQualifiers;
  dateQualifiers?: MetadataDateQualifiers;
  /** Человекочитаемое представление состава типов через запятую */
  presentation: string;
  /** Исходный XML блока `<Type>...</Type>` без внешнего тега */
  rawInnerXml: string;
}

/** Допустимые виды значений свойства объекта метаданных */
export type PropertyValueKind = 'string' | 'boolean' | 'enum' | 'multiEnum' | 'localizedString' | 'metadataType';

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

/** Значение свойства с множественным выбором */
export interface MultiEnumPropertyValue {
  selected: string[];
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
export type PropertyValue =
  | string
  | boolean
  | EnumPropertyValue
  | MultiEnumPropertyValue
  | LocalizedStringValue
  | MetadataTypeValue;

/** Описание одного свойства объекта метаданных */
export interface ObjectPropertyItem {
  key: string;
  title: string;
  kind: PropertyValueKind;
  value: PropertyValue;
  /** Значение пришло из основной конфигурации, а не из XML расширения */
  inherited?: boolean;
  /** Свойство показано только для чтения */
  readonly?: boolean;
  /** Технический источник значения для панели свойств */
  source?: 'local' | 'inherited';
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
