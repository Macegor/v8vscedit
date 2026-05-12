import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { WebviewAssetManifest, WebviewAssetManifestEntry } from './_types';

export class WebviewAssetManifestReader {
  private manifest: WebviewAssetManifest | undefined;

  constructor(private readonly extensionUri: vscode.Uri) {}

  getEntry(entry: string): WebviewAssetManifestEntry {
    const manifest: Partial<WebviewAssetManifest> = this.readManifest();
    const asset = manifest[entry];
    if (!asset) {
      throw new Error(`Webview entry "${entry}" не найден в dist/ui/manifest.json`);
    }
    return asset;
  }

  private readManifest(): WebviewAssetManifest {
    if (this.manifest) {
      return this.manifest;
    }

    const manifestPath = vscode.Uri.joinPath(this.extensionUri, 'dist', 'ui', 'manifest.json').fsPath;
    const raw = fs.readFileSync(manifestPath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (!isManifest(parsed)) {
      throw new Error(`Некорректный manifest webview: ${path.basename(manifestPath)}`);
    }
    this.manifest = parsed;
    return parsed;
  }
}

function isManifest(value: unknown): value is WebviewAssetManifest {
  if (!isRecord(value)) {
    return false;
  }
  return Object.values(value).every((entry) =>
    isRecord(entry) &&
    typeof entry.script === 'string' &&
    Array.isArray(entry.styles) &&
    entry.styles.every((style) => typeof style === 'string')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
