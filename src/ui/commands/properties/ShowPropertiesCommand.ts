import * as vscode from 'vscode';
import { MetadataNode } from '../../tree/TreeNode';
import { CommandServices } from '../_shared';

/** Регистрирует команду показа панели свойств. */
export function registerShowPropertiesCommand(
  context: vscode.ExtensionContext,
  services: CommandServices
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('v8vscedit.showProperties', (node: MetadataNode | undefined) => {
      if (!node) {
        return;
      }
      if (node.nodeKind === 'Subsystem') {
        services.subsystemEditorViewProvider.show(node);
        return;
      }
      services.propertiesViewProvider.show(node);
    })
  );
}
