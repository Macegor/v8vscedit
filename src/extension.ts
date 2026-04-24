import * as vscode from 'vscode';
import { Container } from './Container';

/**
 * Точка входа VS Code-расширения. Намеренно тонкая: вся логика сборки
 * зависимостей вынесена в {@link Container} (композиционный корень).
 * См. `AGENTS.md` раздел «Composition root».
 */
let container: Container | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return;
  }
  container = await Container.bootstrap(context, folders[0]);
}

export function deactivate(): Promise<void> | undefined {
  return container?.lspManager.stop();
}
