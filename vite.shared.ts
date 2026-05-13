import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const rootDir = path.dirname(fileURLToPath(import.meta.url));

export const aliases = {
  '@ui': path.resolve(rootDir, 'src-ui'),
  '@ui-shared': path.resolve(rootDir, 'src-ui/shared'),
};

export const nodeExternal = [
  'vscode',
  '@vscode/test-electron',
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
];

export interface WebviewManifestEntry {
  readonly script: string;
  readonly styles: readonly string[];
}

export type WebviewManifest = Record<string, WebviewManifestEntry>;
