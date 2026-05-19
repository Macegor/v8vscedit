import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../..');

suite('Package manifest', () => {
  test('пути из contributes.grammars существуют в проекте', () => {
    const manifest = readJson('package.json') as { contributes?: { grammars?: { path?: string }[] } };
    const grammars = manifest.contributes?.grammars ?? [];

    assert.ok(grammars.length > 0, 'В package.json нет grammar contribution');
    for (const grammar of grammars) {
      assert.ok(grammar.path, 'У grammar contribution не указан path');
      assert.ok(
        fs.existsSync(path.join(ROOT, grammar.path)),
        `Не найден файл грамматики: ${grammar.path}`
      );
    }
  });

  test('внешние зависимости node-бандла не вырезаются из VSIX', () => {
    const ignore = fs.readFileSync(path.join(ROOT, '.vscodeignore'), 'utf-8');

    for (const dependency of ['ssh2', 'asn1', 'bcrypt-pbkdf', 'safer-buffer', 'tweetnacl']) {
      assert.match(ignore, new RegExp(`!node_modules/${dependency}/\\*\\*`));
    }
  });

  test('прямые webview-импорты указаны как прямые зависимости', () => {
    const manifest = readJson('package.json') as { dependencies?: Record<string, string> };

    assert.ok(manifest.dependencies?.['@vscode/codicons'], '@vscode/codicons нужен для universal webview');
  });
});

function readJson(relativePath: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf-8')) as unknown;
}
