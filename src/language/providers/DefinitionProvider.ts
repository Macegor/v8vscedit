import * as vscode from 'vscode';
import { Node } from 'web-tree-sitter';
import { BslParserService } from '../BslParserService';

/**
 * Провайдер перехода к определению для BSL.
 * Сначала ищет в текущем документе, затем — по всем *.bsl файлам воркспейса.
 * Кэширует результаты по имени символа и инвалидирует при изменении файлов.
 */
export class BslDefinitionProvider implements vscode.DefinitionProvider {
  private readonly cache = new Map<string, vscode.Location>();
  private readonly watcher: vscode.FileSystemWatcher;

  constructor(private readonly parser: BslParserService) {
    this.watcher = vscode.workspace.createFileSystemWatcher('**/*.bsl');
    this.watcher.onDidChange(() => this.cache.clear());
    this.watcher.onDidCreate(() => this.cache.clear());
    this.watcher.onDidDelete(() => this.cache.clear());
  }

  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Location | null> {
    const wordRange = document.getWordRangeAtPosition(position, /[\wа-яА-ЯёЁ_]+/);
    if (!wordRange) {
      return null;
    }
    const word = document.getText(wordRange);

    await this.parser.ensureInit();

    // 1. Поиск в текущем документе
    const localLoc = this.findInDocument(document, word);
    if (localLoc) {
      return localLoc;
    }

    // 2. Кэш
    const cached = this.cache.get(word.toLowerCase());
    if (cached) {
      return cached;
    }

    // 3. Поиск по всем BSL-файлам воркспейса
    const files = await vscode.workspace.findFiles('**/*.bsl', '**/node_modules/**');
    for (const uri of files) {
      if (uri.toString() === document.uri.toString()) {
        continue;
      }
      const loc = await this.findInFile(uri, word);
      if (loc) {
        this.cache.set(word.toLowerCase(), loc);
        return loc;
      }
    }

    return null;
  }

  private findInDocument(document: vscode.TextDocument, name: string): vscode.Location | null {
    let root: Node;
    try {
      root = this.parser.parse(document).rootNode;
    } catch {
      return null;
    }

    const node = this.findDefinitionNode(root, name);
    if (!node) {
      return null;
    }

    const nameNode = node.childForFieldName('name');
    if (!nameNode) {
      return null;
    }

    const range = new vscode.Range(
      nameNode.startPosition.row,
      nameNode.startPosition.column,
      nameNode.endPosition.row,
      nameNode.endPosition.column,
    );

    return new vscode.Location(document.uri, range);
  }

  private async findInFile(uri: vscode.Uri, name: string): Promise<vscode.Location | null> {
    let document: vscode.TextDocument;
    try {
      document = await vscode.workspace.openTextDocument(uri);
    } catch {
      return null;
    }
    return this.findInDocument(document, name);
  }

  private findDefinitionNode(root: Node, name: string): Node | null {
    for (const node of root.namedChildren) {
      if (!node) {
        continue;
      }
      const t = node.type;
      if (t !== 'procedure_definition' && t !== 'function_definition') {
        continue;
      }
      const nameNode = node.childForFieldName('name');
      if (nameNode && nameNode.text.toLowerCase() === name.toLowerCase()) {
        return node;
      }
    }
    return null;
  }

  dispose(): void {
    this.watcher.dispose();
    this.cache.clear();
  }
}
