import * as vscode from 'vscode';
import type { ActiveDocumentInfo, ModuleSymbolDto, ModuleSymbolKind, RangeDto } from '../_types';

/** Языки, для которых отображается структура модуля. */
const BSL_LANGUAGES = new Set(['bsl', 'os']);

/**
 * Собирает иерархию символов активного BSL-документа через
 * стандартную команду VSCode `vscode.executeDocumentSymbolProvider`.
 * Запросы дебаунсятся, чтобы не дёргать LSP на каждое нажатие.
 */
export class ModuleStructureContextHandler {
  private debounceHandle: NodeJS.Timeout | undefined;

  constructor(
    private readonly onSymbols: (info: ActiveDocumentInfo, symbols: ModuleSymbolDto[]) => void,
    private readonly onLoading: (info: ActiveDocumentInfo) => void
  ) {}

  /** Признак: документ относится к языку, для которого мы рисуем структуру модуля. */
  static isSupported(document: vscode.TextDocument | undefined): boolean {
    return Boolean(document && BSL_LANGUAGES.has(document.languageId));
  }

  /** Запросить структуру для документа (с дебаунсом). */
  schedule(document: vscode.TextDocument, immediate = false): void {
    this.cancel();
    const info = this.toInfo(document);
    this.onLoading(info);

    const run = (): void => {
      this.debounceHandle = undefined;
      void this.fetch(document, info);
    };

    if (immediate) {
      run();
    } else {
      this.debounceHandle = setTimeout(run, 200);
    }
  }

  cancel(): void {
    if (this.debounceHandle) {
      clearTimeout(this.debounceHandle);
      this.debounceHandle = undefined;
    }
  }

  dispose(): void {
    this.cancel();
  }

  private async fetch(document: vscode.TextDocument, info: ActiveDocumentInfo): Promise<void> {
    try {
      const result = await vscode.commands.executeCommand<vscode.DocumentSymbol[] | vscode.SymbolInformation[] | undefined>(
        'vscode.executeDocumentSymbolProvider',
        document.uri
      );
      const symbols = this.toDtos(result ?? []);
      this.onSymbols(info, symbols);
    } catch {
      this.onSymbols(info, []);
    }
  }

  private toInfo(document: vscode.TextDocument): ActiveDocumentInfo {
    return {
      uri: document.uri.toString(),
      fileName: document.fileName,
      languageId: document.languageId,
    };
  }

  private toDtos(
    items: readonly (vscode.DocumentSymbol | vscode.SymbolInformation)[]
  ): ModuleSymbolDto[] {
    return items
      .map((item) => this.toDto(item))
      .sort((left, right) => left.range.start.line - right.range.start.line);
  }

  private toDto(item: vscode.DocumentSymbol | vscode.SymbolInformation): ModuleSymbolDto {
    if ('range' in item) {
      // DocumentSymbol
      return {
        name: item.name,
        detail: item.detail,
        kind: this.toKindDto(item.kind),
        range: this.toRangeDto(item.range),
        selectionRange: this.toRangeDto(item.selectionRange),
        children: this.toDtos(item.children),
      };
    }
    // SymbolInformation
    return {
      name: item.name,
      kind: this.toKindDto(item.kind),
      range: this.toRangeDto(item.location.range),
      selectionRange: this.toRangeDto(item.location.range),
      children: [],
    };
  }

  private toKindDto(kind: vscode.SymbolKind): ModuleSymbolKind {
    switch (kind) {
      case vscode.SymbolKind.Function:
        return 'function';
      case vscode.SymbolKind.Method:
      case vscode.SymbolKind.Constructor:
        return 'method';
      case vscode.SymbolKind.Variable:
      case vscode.SymbolKind.Object:
        return 'variable';
      case vscode.SymbolKind.Constant:
        return 'constant';
      case vscode.SymbolKind.Namespace:
      case vscode.SymbolKind.Module:
      case vscode.SymbolKind.Package:
        return 'namespace';
      case vscode.SymbolKind.Property:
        return 'property';
      case vscode.SymbolKind.Field:
        return 'field';
      default:
        return 'variable';
    }
  }

  private toRangeDto(range: vscode.Range): RangeDto {
    return {
      start: { line: range.start.line, character: range.start.character },
      end: { line: range.end.line, character: range.end.character },
    };
  }
}
