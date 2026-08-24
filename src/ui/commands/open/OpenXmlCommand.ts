import * as vscode from 'vscode';
import type { CommandServices } from '../_shared';

/** Регистрирует команду открытия XML с учётом блокировки поддержки. */
export function registerOpenXmlCommand(
  context: vscode.ExtensionContext,
  services: CommandServices
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('v8vscedit.openXmlFile', async (
      node: { xmlPath?: string },
      options?: { preserveFocus?: boolean }
    ) => {
      if (!node.xmlPath) {
        return;
      }

      const editor = await vscode.window.showTextDocument(vscode.Uri.file(node.xmlPath), {
        preview: false,
        preserveFocus: options?.preserveFocus ?? false,
      });
      const supportLocked = services.supportService?.isLocked(node.xmlPath) ?? false;
      const repositoryLocked = services.repositoryService.isEditRestricted(node.xmlPath);
      if (supportLocked || repositoryLocked) {
        await setEditorReadonly(editor);
      }
    })
  );
}

/**
 * Ставит readonly-статус в сессии на уже открытый редактор.
 *
 * Issue #4: `showTextDocument` здесь и раньше вызывался без `preserveFocus`
 * (то есть с `false` по умолчанию) — это безусловно перехватывало фокус клавиатуры
 * повторно, сразу ПОСЛЕ того, как вызывающий код (`openModule`/`openXmlFile`) уже
 * корректно открыл документ со своим осмысленным `preserveFocus` (например,
 * `true` из `UniversalPanelViewProvider.selectNode` — открытие модуля из
 * контекстного меню/выделения узла НЕ должно отбирать фокус у навигатора).
 * `preserveFocus: true` здесь оправдан всегда: единственная цель повторного
 * `showTextDocument` — гарантировать `window.activeTextEditor` перед командой
 * ниже, а не менять фокус, уже корректно установленный вызывающим кодом.
 */
export async function setEditorReadonly(editor: vscode.TextEditor): Promise<void> {
  await vscode.window.showTextDocument(editor.document, { viewColumn: editor.viewColumn, preserveFocus: true });
  await vscode.commands.executeCommand('workbench.action.files.setActiveEditorReadonlyInSession');
}
