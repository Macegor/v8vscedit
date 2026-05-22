import * as vscode from 'vscode';
import { ensureTextTemplateContentPath, readTemplateTypeFromXml, resolveTextTemplateContentPath } from '../../../infra/xml';
import { MetadataNode } from '../../tree/TreeNode';
import type { CommandServices, NodeArg } from '../_shared';
import { setEditorReadonly } from './OpenXmlCommand';

/** Регистрирует команду открытия редактируемого содержимого макета. */
export function registerOpenTemplateContentCommand(
  context: vscode.ExtensionContext,
  services: CommandServices
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('v8vscedit.openTemplateContent', async (node: NodeArg) => {
      if (!node.xmlPath) {
        return;
      }

      if (readTemplateTypeFromXml(node.xmlPath) !== 'TextDocument') {
        await vscode.window.showWarningMessage('Редактирование по клику доступно только для макетов типа "Текстовый документ".');
        return;
      }

      const templateName = getNodeLabel(node);
      const existingContentPath = resolveTextTemplateContentPath(node.xmlPath, templateName);
      const contentPath = existingContentPath ?? ensureTextTemplateContentPath(node.xmlPath, templateName);
      if (!existingContentPath) {
        services.suppressConfigurationReloadForFiles([contentPath]);
        services.markChangedConfigurationByFiles([contentPath]);
        services.refreshActionsView();
      }

      const editor = await vscode.window.showTextDocument(vscode.Uri.file(contentPath), {
        preview: false,
      });
      const supportLocked = services.supportService?.isLocked(node.xmlPath) ?? false;
      const repositoryLocked = services.repositoryService.isEditRestricted(node.xmlPath);
      if (supportLocked || repositoryLocked) {
        await setEditorReadonly(editor);
      }
    })
  );
}

function getNodeLabel(node: NodeArg): string | undefined {
  if (node instanceof MetadataNode) {
    return node.textLabel;
  }
  if (typeof node.label === 'string') {
    return node.label;
  }
  return undefined;
}
