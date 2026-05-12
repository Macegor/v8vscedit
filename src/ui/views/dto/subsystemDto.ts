import type { IconDto } from './iconDto';

/**
 * DTO состояния редактора подсистем для webview.
 */
export interface SubsystemEditorStateDto {
  readonly initialized: boolean;
  readonly subsystemId: string;
  readonly subsystemName: string;
  readonly properties: Record<string, unknown>;
  readonly content: SubsystemContentItemDto[];
  readonly children: SubsystemChildDto[];
  readonly locked: boolean;
}

export interface SubsystemContentItemDto {
  readonly id: string;
  readonly label: string;
  readonly included: boolean;
  readonly kind?: string;
}

export interface SubsystemChildDto {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly icon?: IconDto;
}
