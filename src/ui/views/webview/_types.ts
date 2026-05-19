import type * as vscode from 'vscode';

export interface WebviewCspOptions {
  readonly allowImages?: boolean;
  readonly allowStyles?: boolean;
}

export interface VueWebviewHtmlOptions {
  readonly webview: vscode.Webview;
  readonly extensionUri: vscode.Uri;
  readonly title: string;
  readonly entry: string;
  readonly viewKind: string;
  readonly initialState?: unknown;
  readonly csp?: WebviewCspOptions;
}

export interface WebviewAssetManifestEntry {
  readonly script: string;
  readonly styles: readonly string[];
}

export type WebviewAssetManifest = Record<string, WebviewAssetManifestEntry>;
