import * as path from 'path';
import * as vscode from 'vscode';
import type { RepositoryService } from '../../infra/repository/RepositoryService';
import type { SupportInfoService } from '../../infra/support/SupportInfoService';

/**
 * Переводит file:// BSL-файлы в readonly, если редактирование запрещено
 * поддержкой или объект не захвачен в хранилище.
 */
export class BslReadonlyGuard {
  // Отслеживает документы, для которых readonly-статус уже применён в этой
  // сессии, — синхронный путь и fallback-watcher в `register()` теоретически
  // могут пересечься для одного и того же документа (например, при split-editor:
  // документ становится видимым сразу в нескольких группах). `WeakSet` по
  // идентичности `TextDocument`: при реальном закрытии и повторном открытии
  // файла VS Code создаёт новый объект документа — трекинг для него сбрасывается
  // сам собой, readonly-статус применится заново (это корректно и нужно).
  private readonly appliedTo = new WeakSet<vscode.TextDocument>();

  constructor(
    private readonly supportService: SupportInfoService,
    private readonly repositoryService: RepositoryService,
    private readonly log: vscode.OutputChannel
  ) {}

  /** Подписывается на открытия BSL-файлов и помечает редактор readonly в текущей сессии. */
  register(): vscode.Disposable {
    return vscode.workspace.onDidOpenTextDocument(async (doc) => {
      if (doc.uri.scheme !== 'file') {
        return;
      }
      if (!doc.fileName.toLowerCase().endsWith('.bsl')) {
        return;
      }

      const supportLocked = this.supportService.isLocked(doc.fileName);
      const repositoryLocked = this.repositoryService.isEditRestricted(doc.fileName);
      if (!supportLocked && !repositoryLocked) {
        return;
      }

      this.log.appendLine(`[readonly] Блокировка file:// BSL: ${path.basename(doc.fileName)}`);

      // Типичный случай: к моменту открытия редактор уже видим. Ставим readonly
      // синхронно, не дожидаясь события смены видимых редакторов.
      const visibleEditor = vscode.window.visibleTextEditors.find(
        (item) => item.document.uri.toString() === doc.uri.toString()
      );
      if (visibleEditor) {
        await this.applyReadonly(visibleEditor);
        return;
      }

      // Запасной путь: редактор может стать видимым позже (например, открытие в фоне).
      const watcher = vscode.window.onDidChangeVisibleTextEditors(async (editors) => {
        const editor = editors.find((item) => item.document.uri.toString() === doc.uri.toString());
        if (!editor) {
          return;
        }

        watcher.dispose();
        await this.applyReadonly(editor);
      });

      setTimeout(() => {
        watcher.dispose();
      }, 5_000);
    });
  }

  /** Делает указанный видимый редактор readonly в текущей сессии. */
  private async applyReadonly(editor: vscode.TextEditor): Promise<void> {
    if (this.appliedTo.has(editor.document)) {
      return;
    }
    this.appliedTo.add(editor.document);

    // `preserveFocus: true` — редактор становится активным (это всё, что нужно
    // команде ниже: она применяется к `window.activeTextEditor`), но фокус
    // клавиатуры не отбирается у текущего фокуса (например, у webview-панели
    // навигатора с открытым контекстным меню). До этой правки `false` безусловно
    // перехватывал фокус на каждое (пере)применение readonly-статуса, включая
    // фоновые срабатывания через `onDidChangeVisibleTextEditors` — см. issue #4.
    await vscode.window.showTextDocument(editor.document, {
      viewColumn: editor.viewColumn,
      preserveFocus: true,
    });
    await vscode.commands.executeCommand('workbench.action.files.setActiveEditorReadonlyInSession');
  }
}
