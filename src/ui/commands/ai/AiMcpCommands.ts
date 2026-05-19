import * as vscode from 'vscode';
import type { CommandServices } from '../_shared';

export function registerAiMcpCommands(
  context: vscode.ExtensionContext,
  services: CommandServices
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('v8vscedit.openAiSettings', () => {
      services.aiMcpViewProvider?.show();
    })
  );
}
