import * as vscode from 'vscode';
import { BslDocumentSymbolProvider, type BslDocumentSymbol } from '../../../../lsp/BslDocumentSymbolProvider';
import type { ActiveDocumentInfo, ModuleSymbolDto, ModuleSymbolKind, RangeDto } from '../_types';

/** Языки, для которых отображается структура модуля. */
const BSL_LANGUAGES = new Set(['bsl', 'os']);

/**
 * Собирает иерархию символов активного BSL-документа.
 *
 * Источник данных:
 *  1. Сначала пробуем `vscode.executeDocumentSymbolProvider` — он зовёт bsl-analyzer LSP,
 *     у которого есть полноценный AST и точные диапазоны.
 *  2. Если LSP молчит (ещё не запустился) — используем собственный regex-парсер.
 *
 * После получения символов добавляем поле `documentation` — парсим `//` комментарии
 * перед каждой Процедурой/Функцией прямо из исходника.
 */
export class ModuleStructureContextHandler {
  private debounceHandle: NodeJS.Timeout | undefined;
  private readonly fallbackProvider = new BslDocumentSymbolProvider();

  constructor(
    private readonly onSymbols: (info: ActiveDocumentInfo, symbols: ModuleSymbolDto[]) => void,
    private readonly onLoading: (info: ActiveDocumentInfo) => void
  ) {}

  static isSupported(document: vscode.TextDocument | undefined): boolean {
    return Boolean(document && BSL_LANGUAGES.has(document.languageId));
  }

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
    const lspSymbols = await this.queryLspSymbols(document);
    const rawSymbols = lspSymbols.length > 0
      ? lspSymbols
      : this.toFallbackSymbols(this.fallbackProvider.provideDocumentSymbols(document));

    const lines = document.getText().split(/\r?\n/);
    const enriched = this.enrichWithComments(rawSymbols, lines);
    this.onSymbols(info, this.toDtos(enriched));
  }

  /** Запрашивает структуру у зарегистрированных LSP-провайдеров. */
  private async queryLspSymbols(document: vscode.TextDocument): Promise<RawSymbol[]> {
    try {
      const result = await vscode.commands.executeCommand<vscode.DocumentSymbol[] | vscode.SymbolInformation[] | undefined>(
        'vscode.executeDocumentSymbolProvider',
        document.uri
      );
      if (!result || result.length === 0) {
        return [];
      }
      return result.map((item) => this.toRawFromVscode(item));
    } catch {
      return [];
    }
  }

  private toRawFromVscode(item: vscode.DocumentSymbol | vscode.SymbolInformation): RawSymbol {
    if ('range' in item) {
      return {
        name: item.name,
        detail: item.detail || undefined,
        kind: item.kind,
        range: item.range,
        selectionRange: item.selectionRange,
        children: item.children.map((child) => this.toRawFromVscode(child)),
      };
    }
    return {
      name: item.name,
      kind: item.kind,
      range: item.location.range,
      selectionRange: item.location.range,
      children: [],
    };
  }

  private toFallbackSymbols(symbols: readonly BslDocumentSymbol[]): RawSymbol[] {
    return symbols.map((item) => ({
      name: item.name,
      detail: item.detail || undefined,
      documentation: item.documentation,
      kind: item.kind,
      range: item.range,
      selectionRange: item.selectionRange,
      children: this.toFallbackSymbols(item.children),
    }));
  }

  /** Парсит `//` комментарии непосредственно перед методом и кладёт в documentation. */
  private enrichWithComments(symbols: readonly RawSymbol[], lines: readonly string[]): RawSymbol[] {
    return symbols.map((symbol) => {
      const documentation = symbol.documentation
        ?? (this.isMethodKind(symbol.kind) ? this.collectLeadingComment(lines, symbol.range.start.line) : undefined);
      return {
        ...symbol,
        documentation,
        children: this.enrichWithComments(symbol.children, lines),
      };
    });
  }

  private isMethodKind(kind: vscode.SymbolKind): boolean {
    return kind === vscode.SymbolKind.Function
      || kind === vscode.SymbolKind.Method
      || kind === vscode.SymbolKind.Constructor;
  }

  /**
   * Собирает блок `//`-комментариев непосредственно перед строкой `declarationLine`.
   * Пропускает строки с директивами компиляции (`&НаКлиенте`, `&НаСервере` и т.п.).
   */
  private collectLeadingComment(lines: readonly string[], declarationLine: number): string | undefined {
    const directiveRe = /^\s*&[A-Za-zА-Яа-яЁё]/;
    const commentRe = /^\s*\/\/(.*)$/;
    const comments: string[] = [];
    let line = declarationLine - 1;

    while (line >= 0 && directiveRe.test(lines[line])) {
      line -= 1;
    }
    while (line >= 0) {
      const match = commentRe.exec(lines[line]);
      if (!match) {
        break;
      }
      comments.push(match[1].replace(/^\s/, ''));
      line -= 1;
    }
    if (comments.length === 0) {
      return undefined;
    }
    return comments.reverse().join('\n').trim() || undefined;
  }

  private toInfo(document: vscode.TextDocument): ActiveDocumentInfo {
    return {
      uri: document.uri.toString(),
      fileName: document.fileName,
      languageId: document.languageId,
    };
  }

  private toDtos(items: readonly RawSymbol[]): ModuleSymbolDto[] {
    return items
      .map((item) => this.toDto(item))
      .sort((left, right) => left.range.start.line - right.range.start.line);
  }

  private toDto(item: RawSymbol): ModuleSymbolDto {
    return {
      name: item.name,
      detail: item.detail,
      documentation: item.documentation,
      kind: this.toKindDto(item.kind),
      range: this.toRangeDto(item.range),
      selectionRange: this.toRangeDto(item.selectionRange),
      children: this.toDtos(item.children),
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

interface RawSymbol {
  readonly name: string;
  readonly detail?: string;
  readonly documentation?: string;
  readonly kind: vscode.SymbolKind;
  readonly range: vscode.Range;
  readonly selectionRange: vscode.Range;
  readonly children: RawSymbol[];
}
