import * as vscode from 'vscode';
import { CommandServices } from '../_shared';

/** Регистрирует команду открытия XML с учётом блокировки поддержки. */
export function registerOpenXmlCommand(
  context: vscode.ExtensionContext,
  services: CommandServices
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('v8vscedit.openXmlFile', async (node: { xmlPath?: string }) => {
      if (!node?.xmlPath) {
        return;
      }

      const editor = await vscode.window.showTextDocument(vscode.Uri.file(node.xmlPath), {
        preview: false,
      });
      if (services.supportService?.isLocked(node.xmlPath)) {
        await setEditorReadonly(editor);
      }
    })
  );
}

export async function setEditorReadonly(editor: vscode.TextEditor): Promise<void> {
  await vscode.window.showTextDocument(editor.document, { viewColumn: editor.viewColumn });
  await vscode.commands.executeCommand('workbench.action.files.setActiveEditorReadonlyInSession');
}
