import type { PropertiesViewState } from './property';

/** Символ модуля (зеркало vscode.DocumentSymbol, сериализуемый). */
export interface ModuleSymbolDto {
  readonly name: string;
  readonly detail?: string;
  readonly kind: ModuleSymbolKind;
  readonly range: RangeDto;
  readonly selectionRange: RangeDto;
  readonly children: ModuleSymbolDto[];
}

/** Подмножество vscode.SymbolKind, используемое в структуре BSL-модуля. */
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

/** Информация об активном файле в режиме структуры модуля. */
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
