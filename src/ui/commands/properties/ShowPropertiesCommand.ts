import * as vscode from 'vscode';
import type { MetadataNode } from '../../tree/TreeNode';
import type { CommandServices } from '../_shared';

/**
 * Регистрирует команду показа свойств: переключает динамическую панель в режим «Свойства».
 * Для подсистем по-прежнему открывается отдельный редактор подсистемы.
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
      if (node.nodeKind === 'Subsystem') {
        services.subsystemEditorViewProvider.show(node.textLabel, node.xmlPath ?? '');
        return;
      }
      services.dynamicPanelController.showProperties(node);
    })
  );
}
