import * as path from 'path';
import * as vscode from 'vscode';
import { ChildTag } from '../../../domain/ChildTag';
import { buildMetadataCacheScopeKey, saveMetadataCacheForEntry } from '../../../infra/cache/MetadataCache';
import { getObjectLocationFromXml } from '../../../infra/fs/ObjectLocation';
import { parseConfigXml } from '../../../infra/xml';
import { MetadataNode } from '../../tree/TreeNode';
import { CommandServices } from '../_shared';

export function registerRemoveMetadataCommand(
  context: vscode.ExtensionContext,
  services: CommandServices
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('v8vscedit.removeMetadata', async (node: MetadataNode | undefined) => {
      await removeMetadata(node, services);
    })
  );
}

async function removeMetadata(node: MetadataNode | undefined, services: CommandServices): Promise<void> {
  if (!node?.xmlPath || !node.canRemoveMetadata) {
    await vscode.window.showErrorMessage('Для выбранного узла нельзя удалить метаданные.');
    return;
  }

  const confirmed = await vscode.window.showWarningMessage(
    `Удалить "${node.textLabel}"? Изменение затронет XML-выгрузку и связанные файлы объекта.`,
    { modal: true },
    'Удалить'
  );
  if (confirmed !== 'Удалить') {
    return;
  }

  const result = node.metaContext
    ? services.metadataXmlRemover.removeChildElement({
      ownerObjectXmlPath: node.metaContext.ownerObjectXmlPath ?? node.xmlPath,
      childTag: toRemoveChildTag(node.nodeKind),
      name: node.textLabel,
      tabularSectionName: node.metaContext.tabularSectionName,
    })
    : services.metadataXmlRemover.removeRootObject({
      configRoot: getObjectLocationFromXml(node.xmlPath).configRoot,
      kind: node.nodeKind,
      name: node.textLabel,
    });

  if (!result.success && result.references.length > 0 && !node.metaContext) {
    await offerForcedRemove(node, services, result.references.length);
    return;
  }

  if (!result.success) {
    await vscode.window.showErrorMessage(`Не удалось удалить метаданные: ${result.errors.join('\n')}`);
    return;
  }

  await finishRemove(node, services, result.changedFiles, result.warnings);
}

async function offerForcedRemove(
  node: MetadataNode,
  services: CommandServices,
  referenceCount: number
): Promise<void> {
  if (!node.xmlPath) {
    return;
  }
  const picked = await vscode.window.showWarningMessage(
    `Найдены ссылки на "${node.textLabel}": ${referenceCount}. Удаление может оставить битые ссылки.`,
    { modal: true },
    'Удалить принудительно'
  );
  if (picked !== 'Удалить принудительно') {
    return;
  }

  const loc = getObjectLocationFromXml(node.xmlPath);
  const result = services.metadataXmlRemover.removeRootObject({
    configRoot: loc.configRoot,
    kind: node.nodeKind,
    name: node.textLabel,
    force: true,
  });
  if (!result.success) {
    await vscode.window.showErrorMessage(`Не удалось удалить метаданные: ${result.errors.join('\n')}`);
    return;
  }
  await finishRemove(node, services, result.changedFiles, [
    ...result.warnings,
    `Объект удалён принудительно, найдено ссылок: ${result.references.length}.`,
  ]);
}

async function finishRemove(
  node: MetadataNode,
  services: CommandServices,
  changedFiles: string[],
  warnings: string[]
): Promise<void> {
  for (const warning of warnings) {
    services.outputChannel.appendLine(`[remove-metadata][warn] ${warning}`);
  }
  for (const changedFile of changedFiles) {
    services.outputChannel.appendLine(`[remove-metadata] ${changedFile}`);
  }

  services.suppressConfigurationReloadForFiles(changedFiles);
  rebuildCacheForNode(node, services);
  services.treeProvider.refresh();
  services.markChangedConfigurationByFiles(changedFiles);
  services.refreshActionsView();
  void vscode.window.showInformationMessage(`Метаданные "${node.textLabel}" удалены.`);
}

function rebuildCacheForNode(node: MetadataNode, services: CommandServices): void {
  const ownerXmlPath = node.metaContext?.ownerObjectXmlPath ?? node.xmlPath;
  if (!ownerXmlPath) {
    return;
  }
  const configRoot = getObjectLocationFromXml(ownerXmlPath).configRoot;
  const entry = services.treeProvider
    .getEntries()
    .find((item) => path.resolve(item.rootPath).toLowerCase() === path.resolve(configRoot).toLowerCase());
  if (!entry) {
    return;
  }

  const info = parseConfigXml(path.join(entry.rootPath, 'Configuration.xml'));
  const scopeKey = buildMetadataCacheScopeKey(entry, info);
  saveMetadataCacheForEntry(services.workspaceFolder.uri.fsPath, scopeKey, entry);
}

function toRemoveChildTag(kind: string): ChildTag | 'Column' {
  if (
    kind === 'Attribute' ||
    kind === 'AddressingAttribute' ||
    kind === 'TabularSection' ||
    kind === 'Form' ||
    kind === 'Command' ||
    kind === 'Template' ||
    kind === 'Dimension' ||
    kind === 'Resource' ||
    kind === 'EnumValue' ||
    kind === 'Column'
  ) {
    return kind;
  }
  throw new Error(`Неподдерживаемый дочерний тип для удаления: ${kind}`);
}
