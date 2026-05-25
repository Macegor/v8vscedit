import * as vscode from 'vscode';
import type { MetadataNode } from '../../tree/TreeNode';
import type { CommandServices } from '../_shared';

export function registerRoleRightsCommands(
  context: vscode.ExtensionContext,
  services: CommandServices
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('v8vscedit.role.info', async (node: MetadataNode | undefined) => {
      await showRoleInfo(node, services);
    }),
    vscode.commands.registerCommand('v8vscedit.role.validate', async (node: MetadataNode | undefined) => {
      await validateRole(node, services);
    })
  );
}

async function showRoleInfo(node: MetadataNode | undefined, services: CommandServices): Promise<void> {
  const rolePath = resolveRolePath(node);
  if (!rolePath) {
    await vscode.window.showWarningMessage('Выберите роль.');
    return;
  }
  const result = services.roleRightsService.info({ rightsPath: rolePath, limit: 1000 });
  await openReport(`Права роли: ${result.name}`, result.lines.join('\n'));
}

async function validateRole(node: MetadataNode | undefined, services: CommandServices): Promise<void> {
  const rolePath = resolveRolePath(node);
  if (!rolePath) {
    await vscode.window.showWarningMessage('Выберите роль.');
    return;
  }
  const result = services.roleRightsService.validate({ rightsPath: rolePath, detailed: true, maxErrors: 100 });
  await openReport(`Валидация роли: ${String(result.errors)} ошибок`, result.lines.join('\n'));
}

async function openReport(title: string, content: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({
    language: 'plaintext',
    content: `${title}\n${'='.repeat(title.length)}\n\n${content}\n`,
  });
  await vscode.window.showTextDocument(doc);
}

function resolveRolePath(node: MetadataNode | undefined): string | undefined {
  if (!node?.xmlPath || node.nodeKind !== 'Role') {
    return undefined;
  }
  return node.xmlPath;
}
