import * as vscode from 'vscode';
import type { MetadataNode } from '../../tree/TreeNode';
import type { CommandServices } from '../_shared';

export function registerSubsystemToolsCommands(
  context: vscode.ExtensionContext,
  services: CommandServices
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('v8vscedit.subsystem.info', async (node: MetadataNode | undefined) => {
      await showSubsystemInfo(node, services);
    }),
    vscode.commands.registerCommand('v8vscedit.subsystem.validate', async (node: MetadataNode | undefined) => {
      await validateSubsystem(node, services);
    }),
    vscode.commands.registerCommand('v8vscedit.interface.validate', async (node: MetadataNode | undefined) => {
      await validateCommandInterface(node, services);
    })
  );
}

async function showSubsystemInfo(node: MetadataNode | undefined, services: CommandServices): Promise<void> {
  const subsystemPath = resolveSubsystemPath(node);
  if (!subsystemPath) {
    await vscode.window.showWarningMessage('Выберите подсистему.');
    return;
  }
  const result = services.subsystemToolsService.info({ subsystemPath, mode: 'full', limit: 1000 });
  await openReport(`Подсистема: ${result.subsystem?.name ?? node?.textLabel ?? ''}`, result.lines.join('\n'));
}

async function validateSubsystem(node: MetadataNode | undefined, services: CommandServices): Promise<void> {
  const subsystemPath = resolveSubsystemPath(node);
  if (!subsystemPath) {
    await vscode.window.showWarningMessage('Выберите подсистему.');
    return;
  }
  const result = services.subsystemToolsService.validate({ subsystemPath, detailed: true, maxErrors: 100 });
  await openReport(`Валидация подсистемы: ${result.errors} ошибок`, result.lines.join('\n'));
}

async function validateCommandInterface(node: MetadataNode | undefined, services: CommandServices): Promise<void> {
  const subsystemPath = resolveSubsystemPath(node);
  if (!subsystemPath) {
    await vscode.window.showWarningMessage('Выберите подсистему.');
    return;
  }
  const subsystem = services.subsystemToolsService.info({ subsystemPath, mode: 'overview' }).subsystem;
  if (!subsystem?.commandInterfacePath) {
    await vscode.window.showInformationMessage('У подсистемы нет CommandInterface.xml.');
    return;
  }
  const result = services.commandInterfaceService.validate({ ciPath: subsystem.commandInterfacePath, detailed: true, maxErrors: 100 });
  await openReport(`Валидация командного интерфейса: ${result.errors} ошибок`, result.lines.join('\n'));
}

async function openReport(title: string, content: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({
    language: 'plaintext',
    content: `${title}\n${'='.repeat(title.length)}\n\n${content}\n`,
  });
  await vscode.window.showTextDocument(doc);
}

function resolveSubsystemPath(node: MetadataNode | undefined): string | undefined {
  if (!node?.xmlPath || node.nodeKind !== 'Subsystem') {
    return undefined;
  }
  return node.xmlPath;
}
