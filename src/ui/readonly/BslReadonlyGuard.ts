import * as path from 'path';
import * as vscode from 'vscode';
import type { RepositoryService } from '../../infra/repository/RepositoryService';
import type { SupportInfoService } from '../../infra/support/SupportInfoService';

/**
 * Переводит file:// BSL-файлы в readonly, если редактирование запрещено
 * поддержкой или объект не захвачен в хранилище.
 */
export class BslReadonlyGuard {
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
    await vscode.window.showTextDocument(editor.document, {
      viewColumn: editor.viewColumn,
      preserveFocus: false,
    });
    await vscode.commands.executeCommand('workbench.action.files.setActiveEditorReadonlyInSession');
  }
}
