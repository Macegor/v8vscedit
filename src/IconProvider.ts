import * as vscode from 'vscode';
import { NodeKind } from './MetadataNode';
import { getIconUris } from './nodes/presentation/icon';

/**
 * Тонкая обёртка над подсистемой отображения иконок узлов.
 * Сохраняет прежний интерфейс для `MetadataTreeProvider`.
 */
export function getIconPath(
  nodeKind: NodeKind,
  ownershipTag: 'OWN' | 'BORROWED' | undefined,
  extensionUri: vscode.Uri
): { light: vscode.Uri; dark: vscode.Uri } {
  return getIconUris(nodeKind, ownershipTag, extensionUri);
}
