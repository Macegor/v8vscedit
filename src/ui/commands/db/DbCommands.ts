import * as vscode from 'vscode';
import { CommandServices } from '../_shared';
import { runDbClientFromWorkspace } from './DbRunCommandRunner';

/** Регистрирует команды запуска 1С из настроек рабочей области. */
export function registerDbCommands(
  context: vscode.ExtensionContext,
  services: CommandServices
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('v8vscedit.runThinClient', async () => {
      await runDbClientFromWorkspace(services.workspaceFolder, services.outputChannel, { mode: 'ENTERPRISE' });
    }),

    vscode.commands.registerCommand('v8vscedit.runConfigurator', async () => {
      await runDbClientFromWorkspace(services.workspaceFolder, services.outputChannel, { mode: 'DESIGNER' });
    })
  );
}
