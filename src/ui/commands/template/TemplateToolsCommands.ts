import * as vscode from 'vscode';
import { readTemplateTypeFromXml } from '../../../infra/xml';
import type { MetadataNode } from '../../tree/TreeNode';
import type { CommandServices } from '../_shared';

export function registerTemplateToolsCommands(
  context: vscode.ExtensionContext,
  services: CommandServices
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('v8vscedit.mxl.info', async (node: MetadataNode | undefined) => {
      await showMxlInfo(node, services);
    }),
    vscode.commands.registerCommand('v8vscedit.mxl.validate', async (node: MetadataNode | undefined) => {
      await validateMxl(node, services);
    }),
    vscode.commands.registerCommand('v8vscedit.skd.info', async (node: MetadataNode | undefined) => {
      await showSkdInfo(node, services);
    }),
    vscode.commands.registerCommand('v8vscedit.skd.validate', async (node: MetadataNode | undefined) => {
      await validateSkd(node, services);
    })
  );
}

async function showMxlInfo(node: MetadataNode | undefined, services: CommandServices): Promise<void> {
  const templatePath = resolveTemplateDescriptorPath(node);
  if (!templatePath) {
    await vscode.window.showWarningMessage('Выберите макет табличного документа.');
    return;
  }
  const result = services.mxlTemplateService.info({ templatePath, withText: true, limit: 1000 });
  await openReport(`MXL: ${result.name}`, result.lines.join('\n'));
}

async function validateMxl(node: MetadataNode | undefined, services: CommandServices): Promise<void> {
  const templatePath = resolveTemplateDescriptorPath(node);
  if (!templatePath) {
    await vscode.window.showWarningMessage('Выберите макет табличного документа.');
    return;
  }
  const result = services.mxlTemplateService.validate({ templatePath, detailed: true, maxErrors: 100 });
  await openReport(`Валидация MXL: ${result.errors} ошибок`, result.lines.join('\n'));
}

async function showSkdInfo(node: MetadataNode | undefined, services: CommandServices): Promise<void> {
  const templatePath = resolveTemplateDescriptorPath(node);
  if (!templatePath) {
    await vscode.window.showWarningMessage('Выберите макет СКД.');
    return;
  }
  const result = services.dataCompositionSchemaService.info({ templatePath, mode: 'full', limit: 1000 });
  await openReport('СКД: структура', result.lines.join('\n'));
}

async function validateSkd(node: MetadataNode | undefined, services: CommandServices): Promise<void> {
  const templatePath = resolveTemplateDescriptorPath(node);
  if (!templatePath) {
    await vscode.window.showWarningMessage('Выберите макет СКД.');
    return;
  }
  const result = services.dataCompositionSchemaService.validate({ templatePath, detailed: true, maxErrors: 100 });
  await openReport(`Валидация СКД: ${result.errors} ошибок`, result.lines.join('\n'));
}

async function openReport(title: string, content: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({
    language: 'plaintext',
    content: `${title}\n${'='.repeat(title.length)}\n\n${content}\n`,
  });
  await vscode.window.showTextDocument(doc);
}

function resolveTemplateDescriptorPath(node: MetadataNode | undefined): string | undefined {
  if (!node?.xmlPath || (node.nodeKind !== 'Template' && node.nodeKind !== 'CommonTemplate')) {
    return undefined;
  }
  return node.xmlPath;
}

export function isMxlTemplateNode(node: MetadataNode): boolean {
  return Boolean(node.xmlPath && (node.nodeKind === 'Template' || node.nodeKind === 'CommonTemplate') && readTemplateTypeFromXml(node.xmlPath) === 'SpreadsheetDocument');
}

export function isSkdTemplateNode(node: MetadataNode): boolean {
  return Boolean(node.xmlPath && (node.nodeKind === 'Template' || node.nodeKind === 'CommonTemplate') && readTemplateTypeFromXml(node.xmlPath) === 'DataCompositionSchema');
}
