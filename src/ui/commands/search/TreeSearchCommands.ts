import * as vscode from 'vscode';
import { CommandServices } from '../_shared';

/**
 * Регистрирует команды поиска по навигатору метаданных.
 */
export function registerTreeSearchCommands(
  context: vscode.ExtensionContext,
  services: CommandServices
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('v8vscedit.searchTree', () => {
      const input = vscode.window.createInputBox();
      const disposables: vscode.Disposable[] = [];
      input.title = 'Поиск в навигаторе';
      input.prompt = 'Фильтрация включается после ввода трёх символов';
      input.placeholder = 'Имя объекта метаданных';
      input.value = services.treeProvider.getSearchQuery();

      input.onDidChangeValue((value) => {
        applySearch(value, services);
      }, null, disposables);

      input.onDidAccept(() => {
        input.hide();
      }, null, disposables);

      input.onDidHide(() => {
        for (const disposable of disposables) {
          disposable.dispose();
        }
        input.dispose();
      }, null, disposables);

      input.show();
    }),
    vscode.commands.registerCommand('v8vscedit.clearTreeSearch', () => {
      applySearch('', services);
    })
  );
}

function applySearch(value: string, services: CommandServices): void {
  const query = value.trim();
  services.treeProvider.setSearchQuery(query);

  const hasSearch = query.length > 2;
  void vscode.commands.executeCommand('setContext', 'v8vscedit.hasTreeSearch', hasSearch);
  services.setTreeMessage(hasSearch ? `Поиск: ${query}` : undefined);
}
