import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildHashSnapshot,
  buildScopeKey,
  diffHashSnapshots,
  loadHashCache,
  saveHashCache,
} from '../../cli/core/hashCache';
import { collectConfigFiles } from '../../cli/commands/importGitChanges';

suite('HashCache', () => {
  test('diffHashSnapshots корректно определяет added/modified/deleted', () => {
    const previous = {
      schemaVersion: 1 as const,
      scopeKey: 'cf::test',
      generatedAt: '',
      files: {
        'Catalogs/Тест.xml': 'hash-old',
        'Documents/Удален.xml': 'hash-removed',
      },
    };
    const current = {
      schemaVersion: 1 as const,
      scopeKey: 'cf::test',
      generatedAt: '',
      files: {
        'Catalogs/Тест.xml': 'hash-new',
        'CommonModules/Новый.bsl': 'hash-added',
      },
    };
    const diff = diffHashSnapshots(previous, current);
    assert.deepStrictEqual(diff.added, ['CommonModules/Новый.bsl']);
    assert.deepStrictEqual(diff.modified, ['Catalogs/Тест.xml']);
    assert.deepStrictEqual(diff.deleted, ['Documents/Удален.xml']);
  });

  test('save/load кэша сохраняет snapshot', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8-hash-cache-'));
    try {
      const scopeKey = buildScopeKey('cf', path.join(tempRoot, 'src', 'cf'));
      const snapshot = {
        schemaVersion: 1 as const,
        scopeKey,
        generatedAt: new Date().toISOString(),
        files: { 'Catalogs/Тест.xml': 'hash-1' },
      };
      saveHashCache(tempRoot, snapshot);
      const loaded = loadHashCache(tempRoot, scopeKey);
      assert.strictEqual(loaded.scopeKey, snapshot.scopeKey);
      assert.strictEqual(loaded.files['Catalogs/Тест.xml'], 'hash-1');
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('buildHashSnapshot учитывает только xml/bsl без ConfigDumpInfo.xml', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8-hash-snapshot-'));
    try {
      fs.mkdirSync(path.join(tempRoot, 'Catalogs'), { recursive: true });
      fs.mkdirSync(path.join(tempRoot, 'CommonModules'), { recursive: true });
      fs.writeFileSync(path.join(tempRoot, 'Catalogs', 'Тест.xml'), '<xml/>', 'utf-8');
      fs.writeFileSync(path.join(tempRoot, 'CommonModules', 'Тест.bsl'), 'Процедура Тест() КонецПроцедуры', 'utf-8');
      fs.writeFileSync(path.join(tempRoot, 'ConfigDumpInfo.xml'), '<skip/>', 'utf-8');
      fs.writeFileSync(path.join(tempRoot, 'README.md'), '# skip', 'utf-8');

      const snapshot = buildHashSnapshot('cf::tmp', tempRoot);
      assert.ok(snapshot.files['Catalogs/Тест.xml']);
      assert.ok(snapshot.files['CommonModules/Тест.bsl']);
      assert.ok(!snapshot.files['ConfigDumpInfo.xml']);
      assert.ok(!snapshot.files['README.md']);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

suite('PartialLoadList', () => {
  test('collectConfigFiles добавляет Object.xml и файлы Ext для BSL', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8-load-list-'));
    try {
      const objectDir = path.join(tempRoot, 'Documents', 'Заказ');
      const extDir = path.join(objectDir, 'Ext');
      fs.mkdirSync(extDir, { recursive: true });
      fs.writeFileSync(path.join(objectDir, 'Заказ.xml'), '<xml/>', 'utf-8');
      fs.writeFileSync(path.join(extDir, 'ObjectModule.bsl'), 'Процедура Тест() КонецПроцедуры', 'utf-8');

      const list = collectConfigFiles(tempRoot, ['Documents/Заказ/Ext/ObjectModule.bsl'], false);
      assert.ok(list.includes('Documents/Заказ.xml'));
      assert.ok(list.includes('Documents/Заказ/Ext/ObjectModule.bsl'));
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
