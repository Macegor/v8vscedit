import { Parser, Language, Tree } from 'web-tree-sitter';
import * as path from 'path';

/**
 * Сервис парсера BSL для LSP-сервера.
 * Не зависит от VS Code API — использует __dirname для поиска WASM.
 * Кэширует деревья по URI + версии документа.
 */
export class BslParserService {
  private parser!: Parser;
  private initPromise: Promise<void> | null = null;
  private readonly cache = new Map<string, { version: number; tree: Tree }>();

  ensureInit(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.doInit();
    }
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    const tsWasm = path.join(__dirname, 'tree-sitter.wasm');
    await Parser.init({ locateFile: () => tsWasm });

    this.parser = new Parser();

    const bslWasm = path.join(__dirname, 'tree-sitter-bsl.wasm');
    const lang = await Language.load(bslWasm);
    this.parser.setLanguage(lang);
  }

  /**
   * Возвращает AST документа. Если версия не изменилась — возвращает кэш.
   * version = -1 означает разовый парсинг без кэширования.
   */
  /**
   * Возвращает AST документа. Если версия не изменилась — возвращает кэш.
   * version = -1 означает разовый парсинг без кэширования.
   */
  parse(text: string, uri: string, version = -1): Tree {
    const cached = this.cache.get(uri);

    // Cache-hit: версия совпадает — отдаём кешированное дерево
    if (cached && version !== -1 && cached.version === version) {
      return cached.tree;
    }

    const newTree = this.parser.parse(text);

    if (!newTree || !newTree.rootNode) {
      if (newTree) { newTree.delete(); }
      if (cached) { return cached.tree; }
      throw new Error(`Не удалось разобрать документ: ${uri}`);
    }

    // При version=-1 (провайдеры без версии) НЕ трогаем кеш:
    // нельзя удалять закешированное дерево — оно используется semantic tokens.
    if (version !== -1) {
      if (cached) {
        cached.tree.delete();
      }
      this.cache.set(uri, { version, tree: newTree });
    }

    return newTree;
  }

  /** Освобождает кэш конкретного документа. */
  invalidate(uri: string): void {
    const cached = this.cache.get(uri);
    if (cached) {
      cached.tree.delete();
      this.cache.delete(uri);
    }
  }

  dispose(): void {
    for (const entry of this.cache.values()) {
      entry.tree.delete();
    }
    this.cache.clear();
  }
}
