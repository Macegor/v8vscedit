import * as vscode from 'vscode';
import type { MetadataNode } from '../../tree/TreeNode';
import type { CommandServices } from '../_shared';

export function registerConfigurationReportCommands(
  context: vscode.ExtensionContext,
  services: CommandServices
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('v8vscedit.configuration.info', async (node: MetadataNode | undefined) => {
      await showConfigurationInfo(node, services);
    }),
    vscode.commands.registerCommand('v8vscedit.configuration.validate', async (node: MetadataNode | undefined) => {
      await validateConfiguration(node, services);
    })
  );
}

async function showConfigurationInfo(node: MetadataNode | undefined, services: CommandServices): Promise<void> {
  const configPath = resolveConfigPath(node);
  if (!configPath) {
    await vscode.window.showWarningMessage('Выберите корень конфигурации или расширения.');
    return;
  }
  const result = services.configurationInfoService.read({ configPath, mode: 'full', limit: 1000 });
  await openReport(`Информация: ${result.name}`, result.lines.join('\n'));
}

async function validateConfiguration(node: MetadataNode | undefined, services: CommandServices): Promise<void> {
  const configPath = resolveConfigPath(node);
  if (!configPath) {
    await vscode.window.showWarningMessage('Выберите корень конфигурации или расширения.');
    return;
  }
  const result = services.configurationValidationService.validate({ configPath, detailed: true, maxErrors: 100 });
  await openReport(`Валидация: ${result.errors} ошибок`, result.lines.join('\n'));
}

async function openReport(title: string, content: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({
    language: 'plaintext',
    content: `${title}\n${'='.repeat(title.length)}\n\n${content}\n`,
  });
  await vscode.window.showTextDocument(doc);
}

function resolveConfigPath(node: MetadataNode | undefined): string | undefined {
  if (!node?.xmlPath) {
    return undefined;
  }
  if (node.nodeKind === 'configuration' || node.nodeKind === 'extension') {
    return node.xmlPath;
  }
  return undefined;
}
