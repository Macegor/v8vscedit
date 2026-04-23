import * as vscode from 'vscode';
import { NodeKind } from '../TreeNode';
import { getIconName } from './iconMap';

/**
 * Возвращает пару URI иконок для светлой и тёмной темы
 * с учётом признака заимствованного объекта.
 */
export function getIconUris(
  nodeKind: NodeKind,
  ownershipTag: 'OWN' | 'BORROWED' | undefined,
  extensionUri: vscode.Uri
): { light: vscode.Uri; dark: vscode.Uri } {
  const base = getIconName(nodeKind);
  const name = ownershipTag === 'BORROWED' ? `${base}-borrowed` : base;

  return {
    light: vscode.Uri.joinPath(extensionUri, 'src', 'icons', 'light', `${name}.svg`),
    dark: vscode.Uri.joinPath(extensionUri, 'src', 'icons', 'dark', `${name}.svg`),
  };
}

