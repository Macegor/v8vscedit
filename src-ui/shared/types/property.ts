import type { IconDto } from './icon';

/** Вид значения свойства */
export type PropertyValueKind =
  | 'string'
  | 'boolean'
  | 'enum'
  | 'multiEnum'
  | 'localizedString'
  | 'metadataType'
  | 'metadataReferenceList';

/** Вариант значения enum-свойства */
export interface PropertyEnumOption {
  readonly value: string;
  readonly label: string;
}

/** Один элемент типа 1С */
export interface MetadataTypeItem {
  readonly canonical: string;
  readonly display: string;
  readonly group: 'primitive' | 'reference' | 'defined';
}

export interface MetadataStringQualifiers {
  readonly length?: number;
  readonly allowedLength?: 'Variable' | 'Fixed';
}

export interface MetadataNumberQualifiers {
  readonly digits?: number;
  readonly fractionDigits?: number;
  readonly allowedSign?: 'Any' | 'Nonnegative';
}

export interface MetadataDateQualifiers {
  readonly dateFractions?: 'Date' | 'DateTime' | 'Time';
}

export interface MetadataReferenceListItem {
  readonly canonical: string;
  readonly display: string;
}

export interface SubsystemMembershipTreeNode {
  readonly name: string;
  readonly label: string;
  readonly xmlPath: string;
  readonly checked: boolean;
  readonly children: SubsystemMembershipTreeNode[];
}

export interface SubsystemMembershipSnapshot {
  readonly tree: SubsystemMembershipTreeNode[];
  readonly selectedXmlPaths: string[];
}

export interface ExchangePlanContentItem {
  readonly exchangePlanName: string;
  readonly exchangePlanLabel: string;
  readonly autoRecord: string;
  readonly autoRecordLabel: string;
}

export interface ExchangePlanContentSnapshot {
  readonly items: ExchangePlanContentItem[];
}

/** DTO одного контрола (строки) панели свойств */
export interface PropertyControl {
  readonly id: string;
  readonly label: string;
  readonly kind: PropertyValueKind;
  readonly value: unknown;
  readonly readonly: boolean;
  readonly inherited: boolean;
  readonly options?: PropertyEnumOption[];
  readonly selected?: string[];
  readonly typePresentation?: string;
  readonly typeItems?: MetadataTypeItem[];
  readonly stringQualifiers?: MetadataStringQualifiers | null;
  readonly numberQualifiers?: MetadataNumberQualifiers | null;
  readonly dateQualifiers?: MetadataDateQualifiers | null;
  readonly referenceItems?: MetadataReferenceListItem[];
}

/** DTO секции панели свойств */
export interface PropertySectionDto {
  readonly title: string;
  readonly order: number;
  readonly controls: PropertyControl[];
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
  readonly readonlyReason?: 'support' | 'repository';
  readonly diagnostics?: PropertyValidationMessage[];
  readonly subsystemSnapshot?: SubsystemMembershipSnapshot | null;
  readonly exchangePlanContentSnapshot?: ExchangePlanContentSnapshot | null;
}
