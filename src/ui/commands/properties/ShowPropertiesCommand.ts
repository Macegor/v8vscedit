import * as vscode from 'vscode';
import type { MetadataNode } from '../../tree/TreeNode';
import type { CommandServices } from '../_shared';

/**
 * Регистрирует команды панели свойств:
 *  - `showProperties` — переключает динамическую панель в режим «Свойства» (одиночный клик).
 *  - `openSubsystemEditor` — открывает полноценный редактор подсистемы (двойной клик).
 */
export function registerShowPropertiesCommand(
  context: vscode.ExtensionContext,
  services: CommandServices
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('v8vscedit.showProperties', (node: MetadataNode | undefined) => {
      if (!node) {
        return;
      }
      services.dynamicPanelController.showProperties(node);
    }),
    vscode.commands.registerCommand('v8vscedit.openSubsystemEditor', (node: MetadataNode | undefined) => {
      if (node?.nodeKind !== 'Subsystem') {
        return;
      }
      services.subsystemEditorViewProvider.show(node.textLabel, node.xmlPath ?? '');
    })
  );
}
