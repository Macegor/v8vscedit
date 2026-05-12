import * as vscode from 'vscode';
import { WebviewAssetManifestReader } from './WebviewAssetManifest';
import { createWebviewNonce } from './WebviewNonce';
import type { VueWebviewHtmlOptions } from './_types';

export class WebviewHtmlFactory {
  constructor(private readonly extensionUri: vscode.Uri) {}

  renderVueWebviewHtml(options: Omit<VueWebviewHtmlOptions, 'extensionUri'>): string {
    const nonce = createWebviewNonce();
    const manifest = new WebviewAssetManifestReader(this.extensionUri).getEntry(options.entry);
    const scriptUri = this.toWebviewUri(options.webview, manifest.script);
    const styleLinks = manifest.styles
      .map((style) => `<link rel="stylesheet" href="${this.toWebviewUri(options.webview, style)}" />`)
      .join('\n  ');
    const initialState = JSON.stringify({
      viewKind: options.viewKind,
      state: options.initialState ?? null,
    }).replace(/</g, '\\u003c');
    const csp = this.buildCsp(options, nonce);

    return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  ${styleLinks}
  <title>${escapeHtml(options.title)}</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" type="application/json" id="v8vscedit-initial-state">${initialState}</script>
  <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private toWebviewUri(webview: vscode.Webview, assetPath: string): string {
    return webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'ui', ...assetPath.split('/'))
    ).toString();
  }

  private buildCsp(options: Omit<VueWebviewHtmlOptions, 'extensionUri'>, nonce: string): string {
    const imageSrc = options.csp?.allowImages ? ` img-src ${options.webview.cspSource} data:;` : '';
    const styleSrc = options.csp?.allowStyles === false
      ? ''
      : ` style-src ${options.webview.cspSource};`;
    return `default-src 'none';${imageSrc}${styleSrc} script-src ${options.webview.cspSource} 'nonce-${nonce}';`;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
