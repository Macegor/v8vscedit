import * as vscode from 'vscode';
import { Node } from 'web-tree-sitter';
import { BslParserService } from './BslParserService';

/**
 * Провайдер диагностик BSL на основе ошибок парсера tree-sitter.
 */
export class BslDiagnosticsProvider implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection('bsl');
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly parser: BslParserService, context: vscode.ExtensionContext) {
    context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.languageId === 'bsl') {
          this.scheduleDiagnostics(e.document);
        }
      }),
      vscode.workspace.onDidOpenTextDocument((doc) => {
        if (doc.languageId === 'bsl') {
          this.scheduleDiagnostics(doc);
        }
      }),
      vscode.workspace.onDidCloseTextDocument((doc) => {
        this.collection.delete(doc.uri);
      }),
      this.collection,
    );
  }

  /** Планирует пересчёт диагностик с дебаунсом. */
  private scheduleDiagnostics(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    const existing = this.timers.get(key);
    if (existing) {
      clearTimeout(existing);
    }
    const handle = setTimeout(() => this.updateDiagnostics(document).catch(() => undefined), 500);
    this.timers.set(key, handle);
  }

  private async updateDiagnostics(document: vscode.TextDocument): Promise<void> {
    await this.parser.ensureInit();
    const tree = this.parser.parse(document);
    const diagnostics: vscode.Diagnostic[] = [];
    this.collectErrors(tree.rootNode, document, diagnostics);
    this.collection.set(document.uri, diagnostics);
  }

  /**
   * Рекурсивно собирает ERROR‑узлы tree-sitter в диагностические сообщения VS Code.
   * При нахождении ERROR-узла не уходит рекурсивно внутрь него — это предотвращает
   * каскад ложных ошибок для вложенных токенов. isMissing-узлы игнорируются,
   * так как они являются артефактами восстановления парсера и порождают ложные срабатывания.
   */
  private collectErrors(node: Node, _doc: vscode.TextDocument, out: vscode.Diagnostic[]): void {
    if (node.isError) {
      const range = new vscode.Range(
        node.startPosition.row,
        node.startPosition.column,
        node.endPosition.row,
        node.endPosition.column,
      );
      // Пропускаем однострочные ERROR-узлы длиной 0–1 символ — это артефакты парсера
      const isTrivial =
        node.startPosition.row === node.endPosition.row &&
        node.endPosition.column - node.startPosition.column <= 1;
      if (!isTrivial) {
        out.push(new vscode.Diagnostic(range, 'Синтаксическая ошибка', vscode.DiagnosticSeverity.Error));
      }
      // Не рекурсируем внутрь ERROR-узла — иначе каждый дочерний токен даёт ложную ошибку
      return;
    }

    for (const child of node.children) {
      if (child) {
        this.collectErrors(child, _doc, out);
      }
    }
  }

  dispose(): void {
    this.collection.dispose();
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }
}
