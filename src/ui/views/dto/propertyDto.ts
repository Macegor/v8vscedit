import type {
  ObjectPropertyItem,
  ObjectPropertiesCollection,
  PropertyValueKind,
} from '../../tree/nodeBuilders/_types';
import type { EnumPropertyOption } from '../../../infra/xml/PropertySchema';
import type { IconDto } from './iconDto';

/**
 * DTO контрольного элемента панели свойств.
 */
export interface PropertyControlDto {
  readonly id: string;
  readonly label: string;
  readonly kind: PropertyValueKind;
  readonly value: unknown;
  readonly defaultValue?: unknown;
  readonly enumOptions?: PropertyEnumOptionDto[];
  readonly readonly?: boolean;
  readonly description?: string;
  readonly sectionId?: string;
}

export interface PropertyEnumOptionDto {
  readonly value: string;
  readonly label: string;
}

export interface PropertySectionDto {
  readonly id: string;
  readonly title: string;
  readonly controls: PropertyControlDto[];
}

export interface PropertyValidationMessageDto {
  readonly kind: 'info' | 'warning' | 'error';
  readonly message: string;
}

export interface PropertiesViewStateDto {
  readonly title: string;
  readonly icon?: IconDto;
  readonly sections: PropertySectionDto[];
  readonly readonly: boolean;
  readonly diagnostics: PropertyValidationMessageDto[];
}

/**
 * Группирует ObjectPropertyItem[] в PropertySectionDto[] по полю section.
 */
export function buildPropertySections(items: ObjectPropertiesCollection): PropertySectionDto[] {
  const groups = new Map<string, ObjectPropertyItem[]>();

  for (const item of items) {
    const sectionKey = item.section ?? 'Основные';
    let group = groups.get(sectionKey);
    if (!group) {
      group = [];
      groups.set(sectionKey, group);
    }
    group.push(item);
  }

  return Array.from(groups.entries()).map(([title, controls]) => ({
    id: slugify(title),
    title,
    controls: controls.map(buildPropertyControlDto),
  }));
}

/**
 * Преобразует host-side ObjectPropertyItem в PropertyControlDto.
 */
export function buildPropertyControlDto(item: ObjectPropertyItem): PropertyControlDto {
  return {
    id: item.key,
    label: item.title,
    kind: item.kind,
    value: serializePropertyValue(item.value),
    defaultValue: undefined,
    enumOptions: extractEnumOptions(item.value),
    readonly: item.readonly,
    description: undefined,
    sectionId: item.section ? slugify(item.section) : undefined,
  };
}

function serializePropertyValue(value: unknown): unknown {
  return value;
}

function extractEnumOptions(value: unknown): PropertyEnumOptionDto[] | undefined {
  if (
    value &&
    typeof value === 'object' &&
    'allowedValues' in value &&
    Array.isArray((value as Record<string, unknown>).allowedValues)
  ) {
    return (value as { allowedValues: EnumPropertyOption[] }).allowedValues.map(toOptionDto);
  }
  return undefined;
}

function toOptionDto(opt: EnumPropertyOption): PropertyEnumOptionDto {
  return { value: opt.value, label: opt.label };
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '-').replace(/[^a-zа-яё0-9-]/g, '');
}
