import * as vscode from 'vscode';

/**
 * Регистрирует три команды-индикатора поддержки, привязанные к inline-кнопкам
 * дерева метаданных: они лишь выводят сообщение пользователю.
 */
export function registerSupportIndicatorCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('v8vscedit.support.none', () => {
      vscode.window.showInformationMessage('Объект не на поддержке.');
    }),
    vscode.commands.registerCommand('v8vscedit.support.editable', () => {
      vscode.window.showInformationMessage('Объект на поддержке. Редактирование разрешено.');
    }),
    vscode.commands.registerCommand('v8vscedit.support.locked', () => {
      vscode.window.showWarningMessage('Объект на поддержке. Редактирование запрещено.');
    }),
  );
}
