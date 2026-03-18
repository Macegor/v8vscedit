import * as vscode from 'vscode';
import { Node } from 'web-tree-sitter';
import { BslParserService } from '../BslParserService';

const BLOCK_TYPES = new Set([
  'procedure_definition',
  'function_definition',
  'try_statement',
  'if_statement',
  'while_statement',
  'for_statement',
  'for_each_statement',
]);

/**
 * Провайдер сворачивания блоков BSL.
 * Создаёт диапазоны для процедур/функций, #Область, Попытка,
 * условий и циклов.
 */
export class BslFoldingRangeProvider implements vscode.FoldingRangeProvider {
  constructor(private readonly parser: BslParserService) {}

  async provideFoldingRanges(document: vscode.TextDocument): Promise<vscode.FoldingRange[]> {
    await this.parser.ensureInit();
    const tree = this.parser.parse(document);
    const ranges: vscode.FoldingRange[] = [];

    this.collectBlockRanges(tree.rootNode, ranges);
    this.collectRegionRanges(tree.rootNode, ranges);

    return ranges;
  }

  /** Рекурсивно собирает диапазоны для процедур, циклов и блоков try. */
  private collectBlockRanges(node: Node, ranges: vscode.FoldingRange[]): void {
    if (BLOCK_TYPES.has(node.type)) {
      const start = node.startPosition.row;
      const end = node.endPosition.row;
      if (end > start) {
        ranges.push(new vscode.FoldingRange(start, end, vscode.FoldingRangeKind.Region));
      }
    }

    for (const child of node.namedChildren) {
      if (child) {
        this.collectBlockRanges(child, ranges);
      }
    }
  }

  /** Обходит дерево и выстраивает пары #Область / #КонецОбласти в диапазоны. */
  private collectRegionRanges(root: Node, ranges: vscode.FoldingRange[]): void {
    const stack: number[] = [];

    const visit = (node: Node): void => {
      const t = node.type;

      if (t === 'preprocessor' || t === 'preproc') {
        const text = node.text.trim().toLowerCase();
        if (text.startsWith('#область') || text.startsWith('#region')) {
          stack.push(node.startPosition.row);
        } else if (text.startsWith('#конецобласти') || text.startsWith('#endregion')) {
          const startRow = stack.pop();
          if (startRow !== undefined) {
            ranges.push(
              new vscode.FoldingRange(startRow, node.endPosition.row, vscode.FoldingRangeKind.Region),
            );
          }
        }
      }

      for (const child of node.namedChildren) {
        if (child) {
          visit(child);
        }
      }
    };

    visit(root);
  }
}
