import { Parser, Language, Tree, Point } from 'web-tree-sitter';
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Сервис парсера BSL на базе tree-sitter.
 * Отвечает за ленивую инициализацию и кэш деревьев по URI документа.
 */
export class BslParserService implements vscode.Disposable {
  private parser!: Parser;
  private readonly trees = new Map<string, Tree>();
  private initPromise: Promise<void> | null = null;

  constructor(private readonly context: vscode.ExtensionContext) {}

  /**
   * Лениво инициализирует парсер и загружает WASM‑грамматику.
   * Должен быть вызван перед первым parse().
   */
  ensureInit(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.doInit();
    }
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    const tsWasm = path.join(this.context.extensionPath, 'dist', 'tree-sitter.wasm');
    await Parser.init({ locateFile: () => tsWasm });

    this.parser = new Parser();

    const bslWasm = path.join(this.context.extensionPath, 'dist', 'tree-sitter-bsl.wasm');
    const lang = await Language.load(bslWasm);
    this.parser.setLanguage(lang);
  }

  /**
   * Парсит документ с использованием инкрементального обновления дерева.
   * Освобождает WASM-память предыдущего дерева если оно больше не нужно.
   */
  parse(document: vscode.TextDocument): Tree {
    const uri = document.uri.toString();
    const previous = this.trees.get(uri) ?? undefined;
    const tree = this.parser.parse(document.getText(), previous);
    if (!tree) {
      throw new Error(`Не удалось разобрать документ: ${uri}`);
    }
    // Освобождаем WASM-память старого дерева, чтобы не было утечки
    if (previous && previous !== tree) {
      previous.delete();
    }
    this.trees.set(uri, tree);
    return tree;
  }

  /**
   * Применяет инкрементальные правки к кэшированному дереву.
   * Вызывать при каждом onDidChangeTextDocument — это позволяет
   * tree-sitter переиспользовать дерево при следующем parse().
   */
  editTree(uri: string, changes: readonly vscode.TextDocumentContentChangeEvent[]): void {
    const tree = this.trees.get(uri);
    if (!tree || changes.length === 0) {
      return;
    }
    for (const change of changes) {
      tree.edit({
        startIndex: change.rangeOffset,
        oldEndIndex: change.rangeOffset + change.rangeLength,
        newEndIndex: change.rangeOffset + change.text.length,
        startPosition: toPoint(change.range.start),
        oldEndPosition: toPoint(change.range.end),
        newEndPosition: computeNewEnd(toPoint(change.range.start), change.text),
      });
    }
  }

  /**
   * Инвалидирует кэш дерева по URI документа (при закрытии файла).
   */
  invalidate(uri: string): void {
    const tree = this.trees.get(uri);
    if (tree) {
      tree.delete();
      this.trees.delete(uri);
    }
  }

  dispose(): void {
    for (const tree of this.trees.values()) {
      tree.delete();
    }
    this.trees.clear();
  }
}

/** Конвертирует позицию VS Code в Point tree-sitter. */
function toPoint(position: vscode.Position): Point {
  return { row: position.line, column: position.character };
}

/**
 * Вычисляет конечную позицию после вставки текста.
 * Нужно для корректного tree.edit() при многострочных правках.
 */
function computeNewEnd(startPoint: Point, newText: string): Point {
  const lines = newText.split('\n');
  if (lines.length === 1) {
    return { row: startPoint.row, column: startPoint.column + newText.length };
  }
  return { row: startPoint.row + lines.length - 1, column: lines[lines.length - 1].length };
}
