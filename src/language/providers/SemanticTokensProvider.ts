import * as vscode from 'vscode';
import { Node } from 'web-tree-sitter';
import { BslParserService } from '../BslParserService';

/**
 * Все токены полностью формируются из AST tree-sitter.
 * TextMate-грамматика не используется — нет мерцания при загрузке WASM.
 *
 * Типы annotation и preprocessor — кастомные, маппируются
 * через semanticTokenScopes на стандартные TextMate-скоупы темы.
 */
export const BSL_TOKEN_TYPES = [
  'comment',
  'string',
  'keyword',
  'number',
  'operator',
  'function',
  'method',
  'variable',
  'parameter',
  'property',
  'class',
  'annotation',    // &НаКлиенте, &НаСервере, &Перед и т.п.
  'preprocessor',  // #Область, #Если и т.п.
] as const;

export const BSL_LEGEND = new vscode.SemanticTokensLegend(
  [...BSL_TOKEN_TYPES],
  ['declaration'],
);

type TokenType = (typeof BSL_TOKEN_TYPES)[number];

/**
 * Узлы дерева tree-sitter-bsl которые являются ключевыми словами BSL.
 * Генерируются через buildKeywords() в grammar.js.
 */
const KEYWORD_TYPES = new Set([
  'IF_KEYWORD', 'THEN_KEYWORD', 'ELSIF_KEYWORD', 'ELSE_KEYWORD', 'ENDIF_KEYWORD',
  'FOR_KEYWORD', 'EACH_KEYWORD', 'IN_KEYWORD', 'TO_KEYWORD', 'WHILE_KEYWORD',
  'DO_KEYWORD', 'ENDDO_KEYWORD', 'GOTO_KEYWORD', 'RETURN_KEYWORD',
  'BREAK_KEYWORD', 'CONTINUE_KEYWORD', 'PROCEDURE_KEYWORD', 'FUNCTION_KEYWORD',
  'ENDPROCEDURE_KEYWORD', 'ENDFUNCTION_KEYWORD', 'VAR_KEYWORD', 'EXPORT_KEYWORD',
  'VAL_KEYWORD', 'TRUE_KEYWORD', 'FALSE_KEYWORD', 'UNDEFINED_KEYWORD', 'NULL_KEYWORD',
  'TRY_KEYWORD', 'EXCEPT_KEYWORD', 'RAISE_KEYWORD', 'ENDTRY_KEYWORD',
  'ASYNC_KEYWORD', 'AWAIT_KEYWORD', 'NEW_KEYWORD',
  'ADDHANDLER_KEYWORD', 'REMOVEHANDLER_KEYWORD',
  'AND_KEYWORD', 'OR_KEYWORD', 'NOT_KEYWORD',
]);

/**
 * Узлы препроцессора: #Область, #Если и т.п.
 * Генерируются через buildKeywords() с префиксом PREPROC_.
 */
const PREPROC_TYPES = new Set([
  'PREPROC_IF_KEYWORD', 'PREPROC_ELSIF_KEYWORD', 'PREPROC_ELSE_KEYWORD',
  'PREPROC_ENDIF_KEYWORD', 'PREPROC_REGION_KEYWORD', 'PREPROC_ENDREGION_KEYWORD',
  'preproc', // #Вставка, #КонецВставки, #Удаление, #КонецУдаления
]);

export class BslSemanticTokensProvider implements vscode.DocumentSemanticTokensProvider {
  constructor(private readonly parser: BslParserService) {}

  async provideDocumentSemanticTokens(
    document: vscode.TextDocument,
  ): Promise<vscode.SemanticTokens> {
    await this.parser.ensureInit();
    const tree = this.parser.parse(document);
    const builder = new vscode.SemanticTokensBuilder(BSL_LEGEND);

    // emitted: набор id узлов уже выданных как именованные токены,
    // чтобы не эмитить повторно при общей рекурсии.
    const emitted = new Set<number>();

    this.walkNode(tree.rootNode, builder, emitted);
    return builder.build();
  }

  /**
   * Добавляет токен только если узел однострочный.
   * VS Code semantic tokens не поддерживают многострочные диапазоны.
   */
  private emit(
    node: Node,
    type: TokenType,
    builder: vscode.SemanticTokensBuilder,
    emitted: Set<number>,
    withDeclaration = false,
  ): void {
    if (node.startPosition.row !== node.endPosition.row) {
      return;
    }
    emitted.add(node.id);
    const range = new vscode.Range(
      node.startPosition.row,
      node.startPosition.column,
      node.endPosition.row,
      node.endPosition.column,
    );
    builder.push(range, type, withDeclaration ? ['declaration'] : []);
  }

  private walkNode(node: Node, builder: vscode.SemanticTokensBuilder, emitted: Set<number>): void {
    if (emitted.has(node.id)) {
      return;
    }

    const t = node.type;

    // ── Листовые узлы — эмитим и не рекурсируем ─────────────────────────────

    if (t === 'line_comment') {
      this.emit(node, 'comment', builder, emitted);
      return;
    }

    if (t === 'string') {
      this.emit(node, 'string', builder, emitted);
      return;
    }

    // Многострочные строки: каждый string_content — отдельный токен
    if (t === 'multiline_string') {
      for (const child of node.children) {
        if (child && child.type === 'string_content') {
          this.emit(child, 'string', builder, emitted);
        }
      }
      return;
    }

    if (t === 'number' || t === 'date') {
      this.emit(node, 'number', builder, emitted);
      return;
    }

    if (KEYWORD_TYPES.has(t)) {
      this.emit(node, 'keyword', builder, emitted);
      return;
    }

    if (PREPROC_TYPES.has(t)) {
      this.emit(node, 'preprocessor', builder, emitted);
      return;
    }

    // annotation: &НаКлиенте, &НаСервере, &Перед(…), &После(…) и т.п.
    // Грамматика: annotation токен включает только сам &Ключевое_слово,
    // а для &Перед/&После/&Вместо — ещё скобки со строкой.
    // Эмитируем только сам токен аннотации, внутреннюю строку пропускаем отдельно.
    if (t === 'annotation') {
      this.emit(node, 'annotation', builder, emitted);
      return;
    }

    if (t === 'operator') {
      this.emit(node, 'operator', builder, emitted);
      return;
    }

    // property — доступ через точку: Объект.Свойство
    if (t === 'property') {
      this.emit(node, 'property', builder, emitted);
      return;
    }

    // ── Структурные узлы — именуем поля, потом рекурсируем ──────────────────

    if (t === 'procedure_definition' || t === 'function_definition') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        this.emit(nameNode, 'function', builder, emitted, true);
      }
    } else if (t === 'method_call') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        this.emit(nameNode, 'method', builder, emitted);
      }
    } else if (t === 'parameter') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        this.emit(nameNode, 'parameter', builder, emitted, true);
      }
    } else if (t === 'var_definition' || t === 'var_statement') {
      for (const child of node.childrenForFieldName('var_name')) {
        if (child) {
          this.emit(child, 'variable', builder, emitted, true);
        }
      }
    } else if (t === 'new_expression') {
      const typeNode = node.childForFieldName('type');
      if (typeNode) {
        this.emit(typeNode, 'class', builder, emitted);
      }
    } else if (t === 'identifier') {
      // Идентификатор не захваченный выше — переменная или вызов
      this.emit(node, 'variable', builder, emitted);
      return;
    }

    // Рекурсия во все дочерние узлы (включая анонимные — keywords, пунктуация)
    for (const child of node.children) {
      if (child && !emitted.has(child.id)) {
        this.walkNode(child, builder, emitted);
      }
    }
  }
}
