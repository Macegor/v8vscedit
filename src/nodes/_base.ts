import * as vscode from 'vscode';
import { MetadataNode, NodeKind } from '../MetadataNode';
import { CommandId, NodeDescriptor } from './_types';

/** Параметры создания узла с применением дескриптора */
export interface BuildNodeParams {
  label: string;
  kind: NodeKind;
  collapsibleState: vscode.TreeItemCollapsibleState;
  xmlPath?: string;
  childrenLoader?: () => MetadataNode[];
  ownershipTag?: 'OWN' | 'BORROWED';
}

/**
 * Создаёт `MetadataNode` и применяет к нему настройки из `NodeDescriptor`
 * (команда по клику и т.п.).
 */
export function buildNode(descriptor: NodeDescriptor | undefined, params: BuildNodeParams): MetadataNode {
  const node = new MetadataNode(
    params.label,
    params.kind,
    params.collapsibleState,
    params.xmlPath,
    params.childrenLoader,
    params.ownershipTag
  );

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
        command: '1cNavigator.openXmlFile',
        title: 'Открыть XML',
        arguments: [node],
      };
    case 'openObjectModule':
      return {
        command: '1cNavigator.openObjectModule',
        title: 'Открыть модуль объекта',
        arguments: [node],
      };
    case 'openManagerModule':
      return {
        command: '1cNavigator.openManagerModule',
        title: 'Открыть модуль менеджера',
        arguments: [node],
      };
    case 'openConstantModule':
      return {
        command: '1cNavigator.openConstantModule',
        title: 'Открыть модуль константы',
        arguments: [node],
      };
    case 'openFormModule':
      return {
        command: '1cNavigator.openFormModule',
        title: 'Открыть модуль формы',
        arguments: [node],
      };
    case 'openCommandModule':
      return {
        command: '1cNavigator.openCommandModule',
        title: 'Открыть модуль команды',
        arguments: [node],
      };
    case 'openServiceModule':
      return {
        command: '1cNavigator.openServiceModule',
        title: 'Открыть модуль сервиса',
        arguments: [node],
      };
    case 'openCommonModuleCode':
      return {
        command: '1cNavigator.openCommonModuleCode',
        title: 'Открыть модуль общего модуля',
        arguments: [node],
      };
    default: {
      // Защита от несовпадений перечисления и реализации
      return {
        command: '1cNavigator.openXmlFile',
        title: 'Открыть XML',
        arguments: [node],
      };
    }
  }
}

