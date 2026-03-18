import * as vscode from 'vscode';
import { Node } from 'web-tree-sitter';
import { BslParserService } from '../BslParserService';

/**
 * Провайдер символов документа BSL.
 * Отображает процедуры и функции в Outline и хлебных крошках.
 */
export class BslDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
  constructor(private readonly parser: BslParserService) {}

  async provideDocumentSymbols(document: vscode.TextDocument): Promise<vscode.DocumentSymbol[]> {
    await this.parser.ensureInit();
    const tree = this.parser.parse(document);
    return this.extractSymbols(tree.rootNode, document);
  }

  private extractSymbols(root: Node, document: vscode.TextDocument): vscode.DocumentSymbol[] {
    const symbols: vscode.DocumentSymbol[] = [];

    const children = root.namedChildren.filter((n): n is Node => n !== null);

    for (let i = 0; i < children.length; i++) {
      const node = children[i];
      const t = node.type;
      if (t !== 'procedure_definition' && t !== 'function_definition') {
        continue;
      }

      const nameNode = node.childForFieldName('name');
      if (!nameNode) {
        continue;
      }

      const nameRange = new vscode.Range(
        nameNode.startPosition.row,
        nameNode.startPosition.column,
        nameNode.endPosition.row,
        nameNode.endPosition.column,
      );

      const fullRange = new vscode.Range(
        node.startPosition.row,
        node.startPosition.column,
        node.endPosition.row,
        node.endPosition.column,
      );

      // Аннотация-сиблинг перед узлом — директива &НаКлиенте и т.п.
      let detail = '';
      if (i > 0) {
        const prev = children[i - 1];
        if (prev.type === 'annotation') {
          detail = document.getText(
            new vscode.Range(
              prev.startPosition.row,
              prev.startPosition.column,
              prev.endPosition.row,
              prev.endPosition.column,
            ),
          );
        }
      }

      const sym = new vscode.DocumentSymbol(
        nameNode.text,
        detail,
        vscode.SymbolKind.Function,
        fullRange,
        nameRange,
      );

      sym.children = this.extractVarSymbols(node, document);
      symbols.push(sym);
    }

    return symbols;
  }

  private extractVarSymbols(procNode: Node, document: vscode.TextDocument): vscode.DocumentSymbol[] {
    const vars: vscode.DocumentSymbol[] = [];

    const collectVars = (node: Node): void => {
      if (node.type === 'var_statement' || node.type === 'var_definition') {
        for (const child of node.namedChildren) {
          if (child && child.type === 'var_name') {
            const range = new vscode.Range(
              child.startPosition.row,
              child.startPosition.column,
              child.endPosition.row,
              child.endPosition.column,
            );
            vars.push(
              new vscode.DocumentSymbol(
                document.getText(range),
                '',
                vscode.SymbolKind.Variable,
                range,
                range,
              ),
            );
          }
        }
      }
      for (const c of node.namedChildren) {
        if (c) {
          collectVars(c);
        }
      }
    };

    collectVars(procNode);
    return vars;
  }
}
