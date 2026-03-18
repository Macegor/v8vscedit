import * as vscode from 'vscode';
import { Node } from 'web-tree-sitter';
import { BslParserService } from '../BslParserService';

/**
 * Провайдер подсказок при наведении для BSL.
 * Ищет в AST определение процедуры/функции под курсором
 * и отображает её сигнатуру с параметрами.
 */
export class BslHoverProvider implements vscode.HoverProvider {
  constructor(private readonly parser: BslParserService) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Hover | null> {
    const wordRange = document.getWordRangeAtPosition(position, /[\wа-яА-ЯёЁ_]+/);
    if (!wordRange) {
      return null;
    }
    const word = document.getText(wordRange);

    await this.parser.ensureInit();
    const tree = this.parser.parse(document);

    const defNode = this.findDefinition(tree.rootNode, word);
    if (!defNode) {
      return null;
    }

    const markdown = this.buildHoverMarkdown(defNode, document);
    return new vscode.Hover(markdown, wordRange);
  }

  /** Ищет определение процедуры/функции с заданным именем в AST. */
  private findDefinition(root: Node, name: string): Node | null {
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

  /** Строит MarkdownString с сигнатурой процедуры/функции. */
  private buildHoverMarkdown(node: Node, _document: vscode.TextDocument): vscode.MarkdownString {
    const isFunction = node.type === 'function_definition';
    const kind = isFunction ? 'Функция' : 'Процедура';

    const nameNode = node.childForFieldName('name');
    const name = nameNode ? nameNode.text : '';

    const paramsNode = node.childForFieldName('parameters');
    const params = paramsNode ? this.buildParamsString(paramsNode) : '';

    const exportNode = node.childForFieldName('export');
    const exportSuffix = exportNode ? ' Экспорт' : '';

    // Ищем аннотацию-сиблинг выше по дереву
    let annotation = '';
    const parent = node.parent;
    if (parent) {
      const siblings = parent.namedChildren.filter((n): n is Node => n !== null);
      const idx = siblings.indexOf(node);
      if (idx > 0) {
        const prev = siblings[idx - 1];
        if (prev.type === 'annotation') {
          annotation = `\n\n${prev.text}`;
        }
      }
    }

    const md = new vscode.MarkdownString();
    md.appendCodeblock(`${kind} ${name}(${params})${exportSuffix}${annotation}`, 'bsl');
    return md;
  }

  private buildParamsString(paramsNode: Node): string {
    const parts: string[] = [];
    for (const param of paramsNode.namedChildren) {
      if (!param || param.type !== 'parameter') {
        continue;
      }
      let text = '';
      const valNode = param.childForFieldName('val');
      if (valNode) {
        text += 'Знач ';
      }
      const nameNode = param.childForFieldName('name');
      if (nameNode) {
        text += nameNode.text;
      }
      const defaultNode = param.childForFieldName('default_value');
      if (defaultNode) {
        text += ` = ${defaultNode.text}`;
      }
      parts.push(text);
    }
    return parts.join(', ');
  }
}
