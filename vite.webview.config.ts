import fs from 'node:fs';
import path from 'node:path';
import vue from '@vitejs/plugin-vue';
import { defineConfig, type Plugin } from 'vite';
import type { OutputBundle, OutputChunk } from 'vite';
import { aliases, type WebviewManifest } from './vite.shared';

const entries = {
  ai: 'src-ui/apps/ai/main.ts',
  environment: 'src-ui/apps/environment/main.ts',
  standalone: 'src-ui/apps/standalone/main.ts',
  'tree-search': 'src-ui/apps/tree-search/main.ts',
  'repository-connection': 'src-ui/apps/repository-connection/main.ts',
  'repository-commit': 'src-ui/apps/repository-commit/main.ts',
  properties: 'src-ui/apps/properties/main.ts',
  subsystem: 'src-ui/apps/subsystem/main.ts',
  universal: 'src-ui/apps/universal/main.ts',
};

function webviewManifestPlugin(): Plugin {
  let manifest: WebviewManifest = {};
  let cssAssets: string[] = [];

  return {
    name: 'v8vscedit-webview-manifest',
    generateBundle(_options, bundle: OutputBundle) {
      manifest = {};
      cssAssets = Object.values(bundle)
        .filter((item) => item.type === 'asset' && item.fileName.endsWith('.css'))
        .map((item) => item.fileName)
        .sort();
      const entryById = new Map(
        Object.entries(entries).map(([name, file]) => [path.resolve(file), name])
      );

      for (const item of Object.values(bundle)) {
        if (item.type !== 'chunk' || !item.isEntry || !item.facadeModuleId) {
          continue;
        }

        const entry = entryById.get(path.resolve(item.facadeModuleId));
        if (!entry) {
          continue;
        }

        manifest[entry] = {
          script: item.fileName,
          styles: getEntryCss(entry, item, cssAssets),
        };
      }
    },
    closeBundle() {
      const outDir = path.resolve('dist/ui');

      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(
        path.join(outDir, 'manifest.json'),
        `${JSON.stringify(manifest, null, 2)}\n`,
        'utf-8'
      );
    },
  };
}

interface OutputChunkWithCss extends OutputChunk {
  readonly viteMetadata?: {
    readonly importedCss?: Set<string>;
  };
}

function getChunkCss(chunk: OutputChunk): readonly string[] {
  return Array.from((chunk as OutputChunkWithCss).viteMetadata?.importedCss ?? []).sort();
}

function getEntryCss(entry: string, chunk: OutputChunk, allCss: readonly string[]): readonly string[] {
  const directCss = new Set(getChunkCss(chunk));
  const otherEntryCssNames = new Set(
    Object.keys(entries)
      .filter((name) => name !== entry)
      .map((name) => `${name}.css`)
  );
  for (const asset of allCss) {
    const fileName = path.basename(asset);
    if (fileName === `${entry}.css` || !otherEntryCssNames.has(fileName)) {
      directCss.add(asset);
    }
  }
  return Array.from(directCss).sort();
}

export default defineConfig({
  base: './',
  resolve: {
    alias: aliases,
  },
  plugins: [vue({
    template: {
      compilerOptions: {
        // vscode-elements — веб-компоненты, не компилировать как Vue-компоненты
        isCustomElement: (tag) => tag.startsWith('vscode-'),
      },
    },
  }), webviewManifestPlugin()],
  build: {
    target: 'es2020',
    outDir: 'dist/ui',
    emptyOutDir: false,
    sourcemap: true,
    rollupOptions: {
      input: entries,
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
