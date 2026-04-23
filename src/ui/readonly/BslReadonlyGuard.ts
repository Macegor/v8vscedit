import * as path from 'path';
import * as vscode from 'vscode';
import { SupportInfoService } from '../../infra/support/SupportInfoService';

/**
 * Отвечает за перевод BSL-файлов в readonly, если соответствующий объект
 * находится на поддержке с запретом редактирования.
 *
 * Для URI схемы `onec://` readonly обеспечивается через возвращаемые из
 * `FileSystemProvider.stat()` права. Для схемы `file://` VS Code не умеет
 * автоматически учитывать признак поддержки, поэтому приходится ловить
 * открытие документа и вызывать команду workbench-а.
 */
export class BslReadonlyGuard {
  constructor(
    private readonly supportService: SupportInfoService,
    private readonly log: vscode.OutputChannel
  ) {}

  /** Подписывается на события редактора. Возвращает регистрируемые disposables */
  register(): vscode.Disposable {
    return vscode.workspace.onDidOpenTextDocument(async (doc) => {
      if (doc.uri.scheme !== 'file') {
        return;
      }
      if (!doc.fileName.toLowerCase().endsWith('.bsl')) {
        return;
      }
      if (!this.supportService.isLocked(doc.fileName)) {
        return;
      }

      this.log.appendLine(`[readonly] Блокировка file:// BSL: ${path.basename(doc.fileName)}`);

      const watcher = vscode.window.onDidChangeVisibleTextEditors(async (editors) => {
        const editor = editors.find(
          (e) => e.document.uri.toString() === doc.uri.toString()
        );
        if (!editor) {
          return;
        }
        watcher.dispose();
        await vscode.window.showTextDocument(editor.document, {
          viewColumn: editor.viewColumn,
          preserveFocus: false,
        });
        await vscode.commands.executeCommand('workbench.action.files.setActiveEditorReadonlyInSession');
      });
      setTimeout(() => watcher.dispose(), 5000);
    });
  }
}
