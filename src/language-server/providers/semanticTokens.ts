import { Node } from 'web-tree-sitter';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { BslParserService } from '../BslParserService';

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
  'annotation',
  'preprocessor',
] as const;

export const BSL_TOKEN_MODIFIERS = ['declaration'] as const;

type TokenType = (typeof BSL_TOKEN_TYPES)[number];

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

const PREPROC_TYPES = new Set([
  'PREPROC_IF_KEYWORD', 'PREPROC_ELSIF_KEYWORD', 'PREPROC_ELSE_KEYWORD',
  'PREPROC_ENDIF_KEYWORD', 'PREPROC_REGION_KEYWORD', 'PREPROC_ENDREGION_KEYWORD',
  'preproc',
]);

/**
 * Построитель LSP семантических токенов с дельта-кодированием.
 * Токены добавляются в произвольном порядке, сортировка выполняется в build().
 */
class LspSemanticTokensBuilder {
  private readonly tokens: {
    line: number;
    char: number;
    length: number;
    type: number;
    mods: number;
  }[] = [];

  push(
    line: number,
    char: number,
    length: number,
    tokenTypeIndex: number,
    tokenModifiers: number,
  ): void {
    this.tokens.push({ line, char, length, type: tokenTypeIndex, mods: tokenModifiers });
  }

  build(): number[] {
    this.tokens.sort((a, b) => (a.line !== b.line ? a.line - b.line : a.char - b.char));
    const data: number[] = [];
    let prevLine = 0;
    let prevChar = 0;

    for (const t of this.tokens) {
      const deltaLine = t.line - prevLine;
      const deltaChar = deltaLine === 0 ? t.char - prevChar : t.char;
      data.push(deltaLine, deltaChar, t.length, t.type, t.mods);
      prevLine = t.line;
      prevChar = t.char;
    }

    return data;
  }
}

/** Вычисляет семантические токены документа и возвращает закодированный массив LSP. */
export async function provideSemanticTokens(
  document: TextDocument,
  parserService: BslParserService,
): Promise<number[]> {
  await parserService.ensureInit();
  const tree = parserService.parse(document.getText(), document.uri, document.version);
  const builder = new LspSemanticTokensBuilder();
  const emitted = new Set<number>();

  walkNode(tree.rootNode, builder, emitted);
  return builder.build();
}

function emit(
  node: Node,
  type: TokenType,
  builder: LspSemanticTokensBuilder,
  emitted: Set<number>,
  withDeclaration = false,
): void {
  // semantic tokens не поддерживают многострочные диапазоны
  if (node.startPosition.row !== node.endPosition.row) {
    return;
  }
  emitted.add(node.id);
  const length = node.endPosition.column - node.startPosition.column;
  if (length <= 0) {
    return;
  }
  const typeIndex = BSL_TOKEN_TYPES.indexOf(type);
  const mods = withDeclaration ? 1 : 0; // declaration = бит 0
  builder.push(node.startPosition.row, node.startPosition.column, length, typeIndex, mods);
}

function walkNode(node: Node, builder: LspSemanticTokensBuilder, emitted: Set<number>): void {
  if (emitted.has(node.id)) {
    return;
  }

  const t = node.type;

  if (t === 'line_comment') { emit(node, 'comment', builder, emitted); return; }
  if (t === 'string') {
    // Обычные однострочные строки подсвечиваем целиком,
    // многострочные — по частям string_content на каждой строке.
    if (node.startPosition.row === node.endPosition.row) {
      emit(node, 'string', builder, emitted);
    } else {
      for (const child of node.children) {
        if (child?.type === 'string_content') {
          emit(child, 'string', builder, emitted);
        }
      }
    }
    return;
  }

  if (t === 'number') { emit(node, 'number', builder, emitted); return; }
  // Дата-литерал 'YYYYMMDD' — отдаём как string, чтобы цвет совпадал с TextMate-правилом для '...'
  if (t === 'date') { emit(node, 'string', builder, emitted); return; }
  if (KEYWORD_TYPES.has(t)) { emit(node, 'keyword', builder, emitted); return; }
  if (PREPROC_TYPES.has(t)) { emit(node, 'preprocessor', builder, emitted); return; }
  if (t === 'annotation') { emit(node, 'annotation', builder, emitted); return; }
  if (t === 'operator') { emit(node, 'operator', builder, emitted); return; }
  if (t === 'property') { emit(node, 'property', builder, emitted); return; }

  if (t === 'procedure_definition' || t === 'function_definition') {
    const nameNode = node.childForFieldName('name');
    if (nameNode) { emit(nameNode, 'function', builder, emitted, true); }
  } else if (t === 'method_call') {
    const nameNode = node.childForFieldName('name');
    if (nameNode) { emit(nameNode, 'method', builder, emitted); }
  } else if (t === 'parameter') {
    const nameNode = node.childForFieldName('name');
    if (nameNode) { emit(nameNode, 'parameter', builder, emitted, true); }
  } else if (t === 'var_definition' || t === 'var_statement') {
    for (const child of node.childrenForFieldName('var_name')) {
      if (child) { emit(child, 'variable', builder, emitted, true); }
    }
  } else if (t === 'new_expression') {
    const typeNode = node.childForFieldName('type');
    if (typeNode) { emit(typeNode, 'class', builder, emitted); }
  } else if (t === 'identifier') {
    emit(node, 'variable', builder, emitted);
    return;
  }

  for (const child of node.children) {
    if (child && !emitted.has(child.id)) {
      walkNode(child, builder, emitted);
    }
  }
}
