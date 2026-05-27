import * as vscode from 'vscode';

/**
 * Расширенный DocumentSymbol с полем documentation (комментарий перед объявлением).
 * VSCode-нативный DocumentSymbol не поддерживает документацию,
 * но нам нужно показать комментарий в подсказке в кастомной панели.
 */
export interface BslDocumentSymbol extends vscode.DocumentSymbol {
  documentation?: string;
  children: BslDocumentSymbol[];
}

/**
 * Источает символы модуля 1С (BSL) на основе регулярных выражений:
 * — Процедуры/Функции (с поддержкой Экспорт и директив компиляции)
 * — Объявления переменных (Перем)
 * — Регионы (#Область / #КонецОбласти, #Region / #EndRegion) с вложенностью
 *
 * Дополнительно собирает блок `//`-комментариев непосредственно перед
 * Процедурой/Функцией и кладёт его в поле `documentation`.
 */
export class BslDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
  provideDocumentSymbols(document: vscode.TextDocument): BslDocumentSymbol[] {
    const lines = document.getText().split(/\r?\n/);
    const root: BslDocumentSymbol[] = [];
    const regionStack: BslDocumentSymbol[] = [];

    const procRe = /^\s*(Процедура|Функция|Procedure|Function)\s+([A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё0-9_]*)\s*\(([^)]*)\)\s*(Экспорт|Export)?/i;
    const procEndRe = /^\s*(КонецПроцедуры|КонецФункции|EndProcedure|EndFunction)\b/i;
    const varRe = /^\s*Перем\s+([A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё0-9_,\s]*)\s*(Экспорт|Export)?\s*;/i;
    const regionStartRe = /^\s*#(Область|Region)\s+(.+?)\s*$/i;
    const regionEndRe = /^\s*#(КонецОбласти|EndRegion)\b/i;
    const directiveRe = /^\s*&[A-Za-zА-Яа-яЁё]/;
    const commentRe = /^\s*\/\/(.*)$/;

    let currentRoutine: BslDocumentSymbol | undefined;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      const regionMatch = regionStartRe.exec(line);
      if (regionMatch) {
        const name = regionMatch[2].trim();
        const range = new vscode.Range(i, 0, i, line.length);
        const symbol: BslDocumentSymbol = Object.assign(
          new vscode.DocumentSymbol(name, 'Область', vscode.SymbolKind.Namespace, range, range),
          { documentation: undefined as string | undefined, children: [] as BslDocumentSymbol[] }
        );
        this.appendSymbol(regionStack, root, symbol);
        regionStack.push(symbol);
        continue;
      }

      if (regionEndRe.test(line)) {
        const region = regionStack.pop();
        if (region) {
          region.range = new vscode.Range(region.range.start, new vscode.Position(i, line.length));
        }
        continue;
      }

      const procMatch = procRe.exec(line);
      if (procMatch && !currentRoutine) {
        const keyword = procMatch[1];
        const name = procMatch[2];
        const params = procMatch[3].trim();
        const isExport = Boolean(procMatch[4]);
        const isFunction = /Функция|Function/i.test(keyword);
        const kind = isFunction ? vscode.SymbolKind.Function : vscode.SymbolKind.Method;
        const detail = `${params ? `(${params})` : '()'}${isExport ? ' Экспорт' : ''}`;
        const headerRange = new vscode.Range(i, 0, i, line.length);
        const nameStart = line.indexOf(name);
        const selectionRange = nameStart >= 0
          ? new vscode.Range(i, nameStart, i, nameStart + name.length)
          : headerRange;
        const documentation = this.collectLeadingComment(lines, i, directiveRe, commentRe);
        const symbol: BslDocumentSymbol = Object.assign(
          new vscode.DocumentSymbol(name, detail, kind, headerRange, selectionRange),
          { documentation, children: [] as BslDocumentSymbol[] }
        );
        currentRoutine = symbol;
        this.appendSymbol(regionStack, root, symbol);
        continue;
      }

      if (currentRoutine && procEndRe.test(line)) {
        currentRoutine.range = new vscode.Range(
          currentRoutine.range.start,
          new vscode.Position(i, line.length)
        );
        currentRoutine = undefined;
        continue;
      }

      if (!currentRoutine) {
        const varMatch = varRe.exec(line);
        if (varMatch) {
          const names = varMatch[1].split(',').map((part) => part.trim()).filter(Boolean);
          for (const name of names) {
            const nameOnly = name.replace(/\s+/g, ' ').split(/\s+/)[0];
            const idx = line.indexOf(nameOnly);
            const selectionRange = idx >= 0
              ? new vscode.Range(i, idx, i, idx + nameOnly.length)
              : new vscode.Range(i, 0, i, line.length);
            const symbol: BslDocumentSymbol = Object.assign(
              new vscode.DocumentSymbol(
                nameOnly,
                'Перем',
                vscode.SymbolKind.Variable,
                new vscode.Range(i, 0, i, line.length),
                selectionRange
              ),
              { documentation: undefined as string | undefined, children: [] as BslDocumentSymbol[] }
            );
            this.appendSymbol(regionStack, root, symbol);
          }
        }
      }
    }

    return root;
  }

  /**
   * Собирает блок `//`-комментариев непосредственно перед строкой объявления.
   * Пропускает строки с директивами компиляции (`&НаКлиенте` и т.п.) — они идут
   * между комментарием и заголовком и не должны разрывать документацию.
   */
  private collectLeadingComment(
    lines: readonly string[],
    declarationLine: number,
    directiveRe: RegExp,
    commentRe: RegExp
  ): string | undefined {
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

  private appendSymbol(
    regionStack: readonly BslDocumentSymbol[],
    root: BslDocumentSymbol[],
    symbol: BslDocumentSymbol
  ): void {
    if (regionStack.length > 0) {
      regionStack[regionStack.length - 1].children.push(symbol);
    } else {
      root.push(symbol);
    }
  }
}
