import * as vscode from 'vscode';
import { Container } from './Container';
import { registerBslSurroundCommands } from './ui/commands/snippets/BslSurroundCommands';

/**
 * Точка входа VS Code-расширения. Намеренно тонкая: вся логика сборки
 * зависимостей вынесена в {@link Container} (композиционный корень).
 * См. `AGENTS.md` раздел «Composition root».
 */
let container: Container | undefined;

/** Публичный API расширения. Используется E2E-тестами для доступа к Container. */
export interface ExtensionApi {
  readonly container: Container;
}

export function activate(context: vscode.ExtensionContext): ExtensionApi | undefined {
  registerBslSurroundCommands(context, () => container?.lspManager);

  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return undefined;
  }
  container = Container.bootstrap(context, folders[0]);
  return { container };
}

export function deactivate(): Promise<void> | undefined {
  return container?.deactivate();
}
