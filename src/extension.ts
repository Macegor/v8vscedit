import * as vscode from 'vscode';
import { Container } from './Container';
import { FormEditorProvider } from './formEditor/FormEditorProvider';

/**
 * Точка входа VS Code-расширения. Намеренно тонкая: вся логика сборки
 * зависимостей вынесена в {@link Container} (композиционный корень).
 * См. `AGENTS.md` раздел «Composition root».
 */
let container: Container | undefined;

export function activate(context: vscode.ExtensionContext): void {
  // Визуальный редактор форм — регистрируется безусловно (не требует workspace)
  context.subscriptions.push(FormEditorProvider.register(context));

  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return;
  }
  container = Container.bootstrap(context, folders[0]);
}

export function deactivate(): Promise<void> | undefined {
  return container?.lspManager.stop();
}
