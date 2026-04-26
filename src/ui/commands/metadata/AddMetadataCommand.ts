import * as path from 'path';
import * as vscode from 'vscode';
import { ChildTag } from '../../../domain/ChildTag';
import { getMetaLabel } from '../../../domain/MetaTypes';
import { updateMetadataCacheAfterAdd } from '../../../infra/cache/MetadataCache';
import { getObjectLocationFromXml } from '../../../infra/fs/MetaPathResolver';
import { AddMetadataTarget, MetadataNode } from '../../tree/TreeNode';
import { CommandServices } from '../_shared';

export function registerAddMetadataCommand(
  context: vscode.ExtensionContext,
  services: CommandServices
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('v8vscedit.addMetadata', async (node: MetadataNode | undefined) => {
      await addMetadata(node, services);
    })
  );
}

async function addMetadata(node: MetadataNode | undefined, services: CommandServices): Promise<void> {
  const target = node?.addMetadataTarget;
  if (!target) {
    await vscode.window.showErrorMessage('Для выбранного узла нельзя добавить метаданные.');
    return;
  }

  const repositoryTarget = target.kind === 'root'
    ? services.repositoryService.resolveTargetByConfigRoot(target.configRoot)
    : services.repositoryService.resolveTargetByXmlPath(target.ownerObjectXmlPath);
  const ownerObjectXmlPath = target.kind === 'child' ? target.ownerObjectXmlPath : undefined;
  if (repositoryTarget && services.repositoryService.isMetadataEditRestricted(repositoryTarget, ownerObjectXmlPath)) {
    await vscode.window.showErrorMessage(
      target.kind === 'root'
        ? 'Добавление запрещено: корень конфигурации или расширения не захвачен в хранилище.'
        : 'Добавление запрещено: объект не захвачен в хранилище.'
    );
    return;
  }

  const name = await promptName(target);
  if (!name) {
    return;
  }

  const result = target.kind === 'root'
    ? services.metadataXmlCreator.addRootObject({
      configRoot: target.configRoot,
      kind: target.targetKind,
      name,
    })
    : services.metadataXmlCreator.addChildElement({
      ownerObjectXmlPath: target.ownerObjectXmlPath,
      childTag: target.childTag,
      name,
      tabularSectionName: target.tabularSectionName,
    });

  if (!result.success) {
    await vscode.window.showErrorMessage(`Не удалось добавить метаданные: ${result.errors.join('\n')}`);
    return;
  }

  for (const warning of result.warnings) {
    services.outputChannel.appendLine(`[add-metadata][warn] ${warning}`);
  }
  for (const changedFile of result.changedFiles) {
    services.outputChannel.appendLine(`[add-metadata] ${changedFile}`);
  }

  services.suppressConfigurationReloadForFiles(result.changedFiles);

  const entry = findTargetEntry(target, services);
  if (entry) {
    const cacheUpdate = updateMetadataCacheAfterAdd(
      services.workspaceFolder.uri.fsPath,
      entry,
      target,
      name
    );
    if (!cacheUpdate.updatedPartially) {
      services.outputChannel.appendLine('[add-metadata][warn] Частичное обновление кэша не удалось, кэш конфигурации пересобран.');
    }
    if (!services.treeProvider.refreshNodeFromCache(node, cacheUpdate.snapshot)) {
      services.treeProvider.refresh();
    }
  } else {
    services.outputChannel.appendLine('[add-metadata][warn] Не удалось найти конфигурацию для частичного обновления кэша.');
    await services.reloadEntries();
  }

  services.markChangedConfigurationByFiles(result.changedFiles);
  services.refreshActionsView();
  void vscode.window.showInformationMessage(`Метаданные "${name}" добавлены.`);
}

async function promptName(target: AddMetadataTarget): Promise<string | undefined> {
  const defaultValue = target.kind === 'root' && target.configKind === 'cfe'
    ? target.namePrefix ?? ''
    : '';
  const label = target.kind === 'root'
    ? getMetaLabel(target.targetKind)
    : getChildLabel(target.childTag);
  const raw = await vscode.window.showInputBox({
    title: `Добавить: ${label}`,
    prompt: 'Введите имя нового элемента метаданных',
    value: defaultValue,
    validateInput: (value) => validateMetadataName(value),
  });
  if (raw === undefined) {
    return undefined;
  }
  let name = raw.trim();
  if (target.kind === 'root' && target.configKind === 'cfe' && target.namePrefix && !name.startsWith(target.namePrefix)) {
    name = `${target.namePrefix}${name}`;
  }
  return name;
}

function validateMetadataName(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'Введите имя.';
  }
  if (!/^[\p{L}][\p{L}\p{Nd}_]*$/u.test(trimmed)) {
    return 'Имя должно начинаться с буквы и содержать только буквы, цифры и подчёркивание.';
  }
  return undefined;
}

function findTargetEntry(target: AddMetadataTarget, services: CommandServices) {
  const configRoot = target.kind === 'root'
    ? target.configRoot
    : getObjectLocationFromXml(target.ownerObjectXmlPath).configRoot;
  const normalizedConfigRoot = path.resolve(configRoot).toLowerCase();
  return services.treeProvider
    .getEntries()
    .find((entry) => path.resolve(entry.rootPath).toLowerCase() === normalizedConfigRoot);
}

function getChildLabel(childTag: ChildTag | 'Column'): string {
  switch (childTag) {
    case 'Attribute':
      return 'Реквизит';
    case 'AddressingAttribute':
      return 'Реквизит адресации';
    case 'TabularSection':
      return 'Табличная часть';
    case 'Form':
      return 'Форма';
    case 'Command':
      return 'Команда';
    case 'Template':
      return 'Макет';
    case 'Dimension':
      return 'Измерение';
    case 'Resource':
      return 'Ресурс';
    case 'EnumValue':
      return 'Значение перечисления';
    case 'Column':
      return 'Колонка';
    default:
      return 'Элемент';
  }
}
