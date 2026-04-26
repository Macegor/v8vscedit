import * as path from 'path';
import * as vscode from 'vscode';
import { ChildTag } from '../../../domain/ChildTag';
import { buildMetadataCacheScopeKey, saveMetadataCacheForEntry } from '../../../infra/cache/MetadataCache';
import { getObjectLocationFromXml } from '../../../infra/fs/ObjectLocation';
import { SupportMode } from '../../../infra/support/SupportInfoService';
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

  const supportXmlPath = node.metaContext?.ownerObjectXmlPath ?? node.xmlPath;
  if (services.supportService?.getSupportMode(supportXmlPath) === SupportMode.Locked) {
    await vscode.window.showErrorMessage('Удаление запрещено: объект находится на поддержке с запретом редактирования.');
    return;
  }

  const confirmed = await vscode.window.showQuickPick(
    [
      {
        label: 'Отмена',
      },
      {
        label: 'Удалить',
        description: node.textLabel,
      },
    ],
    {
      placeHolder: `Удалить "${node.textLabel}"? Изменение затронет XML-выгрузку и связанные файлы объекта.`,
    }
  );
  if (confirmed?.label !== 'Удалить') {
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
    await vscode.window.showErrorMessage(buildReferenceBlockMessage(node, result.references));
    return;
  }

  if (!result.success) {
    await vscode.window.showErrorMessage(`Не удалось удалить метаданные: ${result.errors.join('\n')}`);
    return;
  }

  await finishRemove(node, services, result.changedFiles, result.warnings);
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

function buildReferenceBlockMessage(node: MetadataNode, references: { filePath: string; pattern: string }[]): string {
  const configRoot = node.xmlPath ? getObjectLocationFromXml(node.xmlPath).configRoot : undefined;
  const details = references
    .slice(0, 5)
    .map((reference) => {
      const filePath = configRoot
        ? path.relative(configRoot, reference.filePath).replace(/\\/g, '/')
        : reference.filePath;
      return `${filePath}: ${reference.pattern}`;
    });
  const tail = references.length > details.length ? `; ещё ${references.length - details.length}` : '';
  return `Удаление "${node.textLabel}" запрещено: найдены ссылки (${references.length}). ${details.join('; ')}${tail}`;
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
