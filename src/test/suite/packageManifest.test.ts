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

  test('пути из contributes.snippets существуют и содержат JSON-сниппеты', () => {
    const manifest = readJson('package.json') as { contributes?: { snippets?: { language?: string; path?: string }[] } };
    const snippets = manifest.contributes?.snippets ?? [];

    assert.ok(snippets.length > 0, 'В package.json нет snippet contribution');
    for (const snippet of snippets) {
      assert.strictEqual(snippet.language, 'bsl');
      assert.ok(snippet.path, 'У snippet contribution не указан path');
      const snippetPath = path.join(ROOT, snippet.path);
      assert.ok(
        fs.existsSync(snippetPath),
        `Не найден файл сниппетов: ${snippet.path}`
      );

      const content = readJson(snippet.path);
      assert.ok(
        content && typeof content === 'object' && Object.keys(content).length > 0,
        `Файл сниппетов пустой: ${snippet.path}`
      );

      for (const prefix of collectSnippetPrefixes(content)) {
        assert.match(prefix, /^\p{Lu}[\p{L}\p{N}]*$/u, `Префикс сниппета должен быть CamelCase: ${prefix}`);
      }
    }
  });

  test('меню окружения BSL ссылается на объявленные команды', () => {
    const manifest = readJson('package.json') as {
      contributes?: {
        commands?: { command?: string }[];
        menus?: Record<string, { command?: string; submenu?: string; when?: string }[]>;
        submenus?: { id?: string; label?: string }[];
      };
    };
    const contributes = manifest.contributes;
    const declaredCommands = new Set((contributes?.commands ?? []).map((item) => item.command));
    const declaredSubmenus = new Set((contributes?.submenus ?? []).map((item) => item.id));

    assert.ok(declaredSubmenus.has('v8vscedit.bslSurroundMenu'), 'Не объявлено подменю Окружить');

    const editorMenu = contributes?.menus?.['editor/context'] ?? [];
    assert.ok(
      editorMenu.some((item) => item.submenu === 'v8vscedit.bslSurroundMenu' && item.when?.includes('editorLangId == bsl')),
      'Подменю Окружить не добавлено в контекстное меню BSL-редактора'
    );

    const surroundItems = contributes?.menus?.['v8vscedit.bslSurroundMenu'] ?? [];
    assert.ok(surroundItems.length > 0, 'Подменю Окружить пустое');
    for (const item of surroundItems) {
      assert.ok(item.command, 'Пункт подменю Окружить должен быть командой');
      assert.ok(declaredCommands.has(item.command), `Команда не объявлена: ${item.command}`);
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

function collectSnippetPrefixes(content: unknown): string[] {
  if (!content || typeof content !== 'object') {
    return [];
  }

  const prefixes: string[] = [];
  for (const snippet of Object.values(content as Record<string, unknown>)) {
    if (!snippet || typeof snippet !== 'object') {
      continue;
    }

    const prefix = (snippet as Record<string, unknown>).prefix;
    if (typeof prefix === 'string') {
      prefixes.push(prefix);
    } else if (Array.isArray(prefix)) {
      prefixes.push(...prefix.filter((item): item is string => typeof item === 'string'));
    }
  }

  return prefixes;
}
