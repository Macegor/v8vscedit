import type { RangeDto } from '@ui-shared/types/dynamicPanel';

export interface RevealSymbolPayload {
  readonly range: RangeDto;
}

export interface PropertyChangedPayload {
  readonly key: string;
  readonly value: unknown;
}

export interface OpenTypePickerPayload {
  readonly key: string;
}

export interface OpenMetadataReferencePickerPayload {
  readonly key: string;
}

export interface RemoveMetadataReferencePayload {
  readonly key: string;
  readonly value: string;
}

export interface OpenFormPickerPayload {
  readonly key: string;
}

export interface ClearFormPropertyPayload {
  readonly key: string;
}

export interface RemoveSubsystemMembershipPayload {
  readonly value: string;
}

export interface UpdateTypeQualifiersPayload {
  readonly qualifiers: Record<string, string>;
}

/** Команды, отправляемые из webview в host. */
export type DynamicPanelCommand =
  | 'revealSymbol'
  | 'propertyChanged'
  | 'openTypePicker'
  | 'openMetadataReferencePicker'
  | 'removeMetadataReference'
  | 'openFormPicker'
  | 'clearFormProperty'
  | 'openSubsystemMembershipPicker'
  | 'removeSubsystemMembership'
  | 'updateTypeQualifiers'
  | 'invalidName';
