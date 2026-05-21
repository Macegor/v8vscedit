import * as vscode from 'vscode';
import type { MetadataNode } from '../../tree/TreeNode';
import type { CommandServices } from '../_shared';

export function registerMetadataReportCommands(
  context: vscode.ExtensionContext,
  services: CommandServices
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('v8vscedit.metadata.info', async (node: MetadataNode | undefined) => {
      await showMetadataInfo(node, services);
    }),
    vscode.commands.registerCommand('v8vscedit.metadata.validate', async (node: MetadataNode | undefined) => {
      await validateMetadata(node, services);
    })
  );
}

async function showMetadataInfo(node: MetadataNode | undefined, services: CommandServices): Promise<void> {
  const xmlPath = resolveObjectXmlPath(node);
  if (!xmlPath) {
    await vscode.window.showWarningMessage('Выберите объект метаданных или его дочерний элемент.');
    return;
  }
  const result = services.metadataInfoService.read({ objectPath: xmlPath, mode: 'full', limit: 1000 });
  await openReport(`Структура: ${result.kind}.${result.name}`, result.lines.join('\n'));
}

async function validateMetadata(node: MetadataNode | undefined, services: CommandServices): Promise<void> {
  const xmlPath = resolveObjectXmlPath(node);
  if (!xmlPath) {
    await vscode.window.showWarningMessage('Выберите объект метаданных или его дочерний элемент.');
    return;
  }
  const result = services.metadataValidationService.validate({ objectPath: xmlPath, detailed: true, maxErrors: 100 });
  await openReport(`Валидация объекта: ${result.errors} ошибок`, result.lines.join('\n'));
}

async function openReport(title: string, content: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({
    language: 'plaintext',
    content: `${title}\n${'='.repeat(title.length)}\n\n${content}\n`,
  });
  await vscode.window.showTextDocument(doc);
}

function resolveObjectXmlPath(node: MetadataNode | undefined): string | undefined {
  if (!node) {
    return undefined;
  }
  if (node.metaContext?.ownerObjectXmlPath) {
    return node.metaContext.ownerObjectXmlPath;
  }
  if (!node.xmlPath) {
    return undefined;
  }
  if (node.nodeKind === 'configuration' || node.nodeKind === 'extension') {
    return undefined;
  }
  return node.xmlPath;
}
