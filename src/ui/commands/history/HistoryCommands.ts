import * as vscode from 'vscode';
import type { CommandServices } from '../_shared';

/**
 * Регистрирует команду открытия панели «История» (граф истории git по объектам 1С).
 */
export function registerHistoryCommands(
  context: vscode.ExtensionContext,
  services: CommandServices
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('v8vscedit.history.open', () => {
      services.historyGraphViewProvider.open();
    })
  );
}
