import * as vscode from 'vscode';
import type { MetaKind } from '../../../domain/MetaTypes';
import type { MetadataNode } from '../../tree/TreeNode';
import type { OwnershipTag } from '../../../domain/Ownership';
import type { IconDto } from './iconDto';
import { buildMetaIconDto } from './iconDto';

/**
 * DTO узла дерева метаданных для отправки в webview.
 */
export interface TreeNodeDto {
  readonly id: string;
  readonly key: string;
  readonly label: string;
  readonly description?: string;
  readonly icon?: IconDto;
  readonly kind?: string;
  readonly ownership?: 'own' | 'borrowed' | 'unknown';
  readonly hasChildren: boolean;
  readonly loaded: boolean;
  readonly children?: TreeNodeDto[];
  readonly actions: TreeNodeActionDto[];
  readonly defaultCommand?: string;
}

export interface TreeNodeActionDto {
  readonly id: string;
  readonly label: string;
  readonly icon?: IconDto;
  readonly command: string;
  readonly enabled?: boolean;
}

/**
 * Преобразует MetadataNode в TreeNodeDto для отправки в webview.
 */
export function buildTreeNodeDto(
  node: MetadataNode,
  webview: vscode.Webview,
  extensionUri: vscode.Uri
): TreeNodeDto {
  const metaKind = node.model.nodeKind as MetaKind | undefined;
  const icon = metaKind
    ? buildMetaIconDto(metaKind, webview, extensionUri)
    : undefined;

  return {
    id: node.id ?? node.model.label,
    key: node.model.label,
    label: typeof node.label === 'string' ? node.label : node.model.label,
    description: typeof node.description === 'string' ? node.description : undefined,
    icon,
    kind: node.contextValue,
    ownership: mapOwnership(node.model.ownershipTag),
    hasChildren: node.collapsibleState !== vscode.TreeItemCollapsibleState.None,
    loaded: true,
    actions: [],
    defaultCommand: node.command?.command,
  };
}

function mapOwnership(ownershipTag?: OwnershipTag): 'own' | 'borrowed' | 'unknown' {
  if (!ownershipTag) {
    return 'unknown';
  }
  return ownershipTag === 'OWN' ? 'own' : 'borrowed';
}
