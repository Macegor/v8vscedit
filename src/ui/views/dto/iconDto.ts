import * as vscode from 'vscode';
import type { MetaKind } from '../../../domain/MetaTypes';
import { META_TYPES } from '../../../domain/MetaTypes';

/**
 * DTO для иконки, передаваемой в webview.
 * Не содержит vscode.Uri — только строки URI через webview.asWebviewUri.
 */
export interface IconDto {
  readonly kind: 'codicon' | 'metadata' | 'asset' | 'none';
  readonly name?: string;
  readonly lightUri?: string;
  readonly darkUri?: string;
  readonly ariaLabel?: string;
}

/**
 * Строит IconDto для типа метаданных.
 * Иконка берётся из META_TYPES[kind].icon и преобразуется в webview-URI.
 */
export function buildMetaIconDto(
  kind: MetaKind,
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  ariaLabel?: string
): IconDto {
  const metaDef = META_TYPES[kind];
  const iconName = metaDef.icon;
  if (!iconName) {
    return { kind: 'none', ariaLabel };
  }
  const lightUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'src', 'icons', 'light', `${iconName}.svg`)
  ).toString();
  const darkUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'src', 'icons', 'dark', `${iconName}.svg`)
  ).toString();

  return {
    kind: 'metadata',
    name: iconName,
    lightUri,
    darkUri,
    ariaLabel: ariaLabel ?? metaDef.label,
  };
}

/**
 * Строит IconDto для codicon.
 */
export function buildCodiconIconDto(name: string, ariaLabel?: string): IconDto {
  return { kind: 'codicon', name, ariaLabel };
}

/**
 * Строит пустую иконку (none).
 */
export function buildEmptyIconDto(): IconDto {
  return { kind: 'none' };
}
