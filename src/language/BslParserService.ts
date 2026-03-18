import { Parser, Language, Tree } from 'web-tree-sitter';
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
   */
  parse(document: vscode.TextDocument): Tree {
    const uri = document.uri.toString();
    const previous = this.trees.get(uri) ?? undefined;
    const tree = this.parser.parse(document.getText(), previous);
    if (!tree) {
      throw new Error(`Не удалось разобрать документ: ${uri}`);
    }
    this.trees.set(uri, tree);
    return tree;
  }

  /**
   * Инвалидирует кэш дерева по URI документа.
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
