/**
 * Типы панели свойств объекта метаданных. Переэкспорт исторических
 * определений из слоя tree — там они родились как часть `ObjectHandler`.
 * Перенос в отдельный файл внутри `views/properties/` оставлен как
 * технический долг: на длинной дистанции их следует окончательно отделить
 * от обработчиков дерева.
 */
export type {
  PropertyValueKind,
  MetadataTypeValue,
  MetadataTypeItem,
  MetadataStringQualifiers,
  MetadataNumberQualifiers,
  MetadataDateQualifiers,
  EnumPropertyOption,
  EnumPropertyValue,
  MultiEnumPropertyValue,
  LocalizedStringValue,
  PropertyValue,
  ObjectPropertyItem,
  ObjectPropertiesCollection,
} from '../../tree/nodeBuilders/_types';
