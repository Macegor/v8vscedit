import * as vscode from 'vscode';
import { AddMetadataTarget, MetaTreeNodeContext, MetadataNode, NodeKind } from '../TreeNode';
import { CommandId, NodeDescriptor } from './_types';

/** Параметры создания узла с применением дескриптора */
export interface BuildNodeParams {
  label: string;
  kind: NodeKind;
  collapsibleState: vscode.TreeItemCollapsibleState;
  xmlPath?: string;
  childrenLoader?: () => MetadataNode[];
  ownershipTag?: 'OWN' | 'BORROWED';
  hidePropertiesCommand?: boolean;
  /** Контекст для свойств дочерних узлов иерархии объекта метаданных */
  metaContext?: MetaTreeNodeContext;
  addMetadataTarget?: AddMetadataTarget;
  canRemoveMetadata?: boolean;
}

/**
 * Создаёт `MetadataNode` и применяет к нему настройки из `NodeDescriptor`
 * (команда по клику и т.п.).
 */
export function buildNode(descriptor: NodeDescriptor | undefined, params: BuildNodeParams): MetadataNode {
  const node = new MetadataNode({
    label: params.label,
    nodeKind: params.kind,
    xmlPath: params.xmlPath,
    childrenLoader: params.childrenLoader,
    ownershipTag: params.ownershipTag,
    hidePropertiesCommand: params.hidePropertiesCommand,
    metaContext: params.metaContext,
    addMetadataTarget: params.addMetadataTarget,
    canRemoveMetadata: params.canRemoveMetadata,
  }, params.collapsibleState);

  if (descriptor?.singleClickCommand) {
    node.command = mapCommand(descriptor.singleClickCommand, node);
  }

  return node;
}

/** Преобразует логический идентификатор команды в `vscode.Command` */
function mapCommand(commandId: CommandId, node: MetadataNode): vscode.Command {
  switch (commandId) {
    case 'openXmlFile':
      return {
        command: 'v8vscedit.openXmlFile',
        title: 'Открыть XML',
        arguments: [node],
      };
    case 'openObjectModule':
      return {
        command: 'v8vscedit.openObjectModule',
        title: 'Открыть модуль объекта',
        arguments: [node],
      };
    case 'openManagerModule':
      return {
        command: 'v8vscedit.openManagerModule',
        title: 'Открыть модуль менеджера',
        arguments: [node],
      };
    case 'openConstantModule':
      return {
        command: 'v8vscedit.openConstantModule',
        title: 'Открыть модуль константы',
        arguments: [node],
      };
    case 'openFormModule':
      return {
        command: 'v8vscedit.openFormModule',
        title: 'Открыть модуль формы',
        arguments: [node],
      };
    case 'openCommandModule':
      return {
        command: 'v8vscedit.openCommandModule',
        title: 'Открыть модуль команды',
        arguments: [node],
      };
    case 'openServiceModule':
      return {
        command: 'v8vscedit.openServiceModule',
        title: 'Открыть модуль сервиса',
        arguments: [node],
      };
    case 'openCommonModuleCode':
      return {
        command: 'v8vscedit.openCommonModuleCode',
        title: 'Открыть модуль общего модуля',
        arguments: [node],
      };
    default: {
      // Защита от несовпадений перечисления и реализации
      return {
        command: 'v8vscedit.openXmlFile',
        title: 'Открыть XML',
        arguments: [node],
      };
    }
  }
}

