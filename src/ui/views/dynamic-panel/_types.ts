import type { PropertiesViewState } from '../properties/_types';

export interface ModuleSymbolDto {
  readonly name: string;
  readonly detail?: string;
  readonly documentation?: string;
  readonly kind: ModuleSymbolKind;
  readonly range: RangeDto;
  readonly selectionRange: RangeDto;
  readonly children: ModuleSymbolDto[];
}

export type ModuleSymbolKind =
  | 'function'
  | 'method'
  | 'variable'
  | 'constant'
  | 'namespace'
  | 'property'
  | 'field';

export interface PositionDto {
  readonly line: number;
  readonly character: number;
}

export interface RangeDto {
  readonly start: PositionDto;
  readonly end: PositionDto;
}

export interface ActiveDocumentInfo {
  readonly uri: string;
  readonly fileName: string;
  readonly languageId: string;
}

export type DynamicPanelState =
  | { readonly kind: 'empty'; readonly message?: string }
  | {
      readonly kind: 'module-structure';
      readonly document: ActiveDocumentInfo;
      readonly symbols: ModuleSymbolDto[];
      readonly loading?: boolean;
    }
  | {
      readonly kind: 'properties';
      readonly view: PropertiesViewState;
    };
