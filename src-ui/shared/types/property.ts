import type { IconDto } from './icon';

/** Вид значения свойства */
export type PropertyValueKind = 'text' | 'boolean' | 'number' | 'enum' | 'type' | 'reference' | 'subsystems' | 'commandInterface';

/** Вариант значения enum-свойства */
export interface PropertyEnumOption {
  readonly value: string;
  readonly label: string;
}

/** DTO одного контрола (строки) панели свойств */
export interface PropertyControlDto {
  readonly id: string;
  readonly label: string;
  readonly kind: PropertyValueKind;
  readonly value: unknown;
  readonly defaultValue?: unknown;
  readonly enumOptions?: PropertyEnumOption[];
  readonly readonly?: boolean;
  readonly description?: string;
  readonly sectionId?: string;
}

/** DTO секции панели свойств */
export interface PropertySectionDto {
  readonly id: string;
  readonly title: string;
  readonly controls: PropertyControlDto[];
}

/** Диагностическое сообщение на панели свойств */
export interface PropertyValidationMessage {
  readonly kind: 'info' | 'warning' | 'error';
  readonly message: string;
}

/** Полное состояние панели свойств */
export interface PropertiesViewState {
  readonly title: string;
  readonly icon?: IconDto;
  readonly sections: PropertySectionDto[];
  readonly readonly: boolean;
  readonly diagnostics: PropertyValidationMessage[];
}
