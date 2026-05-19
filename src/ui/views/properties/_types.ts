/**
 * Типы панели свойств объекта метаданных. Переэкспорт исторических
 * определений из слоя tree — там они родились как часть `ObjectHandler`.
 * Перенос в отдельный файл внутри `views/properties/` оставлен как
 * технический долг: на длинной дистанции их следует окончательно отделить
 * от обработчиков дерева.
 */
import type {
  ExchangePlanContentSnapshot,
} from '../../../infra/xml/ExchangePlanContentService';
import type {
  SubsystemMembershipSnapshot,
} from '../../../infra/xml/SubsystemXmlService';
import type { MetadataNode } from '../../tree/TreeNode';
import type {
  PropertyValueKind,
  MetadataTypeItem,
  MetadataReferenceListItem,
  MetadataStringQualifiers,
  MetadataNumberQualifiers,
  MetadataDateQualifiers,
  ObjectPropertiesCollection,
} from '../../tree/nodeBuilders/_types';

export type {
  PropertyValueKind,
  MetadataTypeValue,
  MetadataTypeItem,
  MetadataReferenceListItem,
  MetadataReferenceListValue,
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

/** Контрол свойства для передачи в Vue-приложение */
export interface PropertyControl {
  id: string;
  label: string;
  kind: PropertyValueKind;
  value: unknown;
  readonly: boolean;
  inherited: boolean;
  /** Варианты для enum и multiEnum */
  options?: { value: string; label: string }[];
  /** Выбранные значения для multiEnum */
  selected?: string[];
  /** Представление типа для metadataType */
  typePresentation?: string;
  typeItems?: MetadataTypeItem[];
  stringQualifiers?: MetadataStringQualifiers | null;
  numberQualifiers?: MetadataNumberQualifiers | null;
  dateQualifiers?: MetadataDateQualifiers | null;
  /** Элементы списка для metadataReferenceList */
  referenceItems?: MetadataReferenceListItem[];
}

/** Секция панели свойств */
export interface PropertySection {
  title: string;
  order: number;
  controls: PropertyControl[];
}

/** Состояние панели свойств для отправки в Vue-приложение */
export interface PropertiesViewState {
  title: string;
  readonly: boolean;
  readonlyReason?: 'support' | 'repository';
  sections: PropertySection[];
  subsystemSnapshot?: SubsystemMembershipSnapshot | null;
  exchangePlanContentSnapshot?: ExchangePlanContentSnapshot | null;
}

/** Контекст построения состояния панели свойств. */
export interface PropertiesRenderContext {
  node: MetadataNode;
  properties: ObjectPropertiesCollection;
  isEditLocked: boolean;
  isEditLockedBySupport: boolean;
  isEditLockedByRepository: boolean;
  subsystemSnapshot: SubsystemMembershipSnapshot | null;
  exchangePlanContentSnapshot: ExchangePlanContentSnapshot | null;
}
