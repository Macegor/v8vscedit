/**
 * Тесты пакетного MCP-инструмента `v8vscedit_set_properties`.
 *
 * Проверяют поведение метода `McpPropertyService.setProperties`:
 *  - happy-path: несколько валидных свойств одного узла применяются
 *    последовательно, накопленный `changedFiles` непустой;
 *  - частичный сбой: невалидное enum-значение попадает в `failed`,
 *    остальные свойства всё равно записываются;
 *  - полный сбой: при всех невалидных значениях `changedFiles` пуст
 *    и XML не меняется;
 *  - дедупликация `changedFiles`: повторная запись в один и тот же файл
 *    не порождает дубликаты в итоговом массиве.
 *
 * Тесты не поднимают `V8McpServer` целиком — батч-логика живёт в
 * `McpPropertyService`, а tool в `V8McpServer` — её тонкий адаптер.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ConfigurationXmlEditor } from '../../infra/xml';
import { MetadataXmlCreator } from '../../infra/xml/MetadataXmlCreator';
import { MetadataNode } from '../../ui/tree/TreeNode';
import { McpPropertyService } from '../../ui/mcp/McpPropertyService';

suite('McpPropertyService.setProperties', () => {
  test('happy-path: применяет несколько свойств одного справочника за один вызов', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-mcp-set-props-happy-'));
    try {
      const xmlPath = setupCatalog(root, 'Контрагенты');
      const node = createCatalogNode(xmlPath, 'Контрагенты');
      const service = new McpPropertyService(new ConfigurationXmlEditor());

      const result = service.setProperties(node, {
        Synonym: 'Контрагенты — все',
        Comment: 'Пакетная правка',
        CheckUnique: false,
      });

      assert.strictEqual(result.applied.length, 3, 'все три свойства должны примениться');
      assert.strictEqual(result.failed.length, 0, 'неудач быть не должно');
      assert.ok(result.changedFiles.length > 0, 'changedFiles должен быть непустым');
      const applyKeys = result.applied.map((item) => item.propertyKey);
      assert.deepStrictEqual(applyKeys, ['Synonym', 'Comment', 'CheckUnique'], 'порядок применения совпадает с порядком properties');

      const saved = fs.readFileSync(xmlPath, 'utf-8');
      assert.ok(saved.includes('<v8:content>Контрагенты — все</v8:content>'), 'синоним записан');
      assert.ok(saved.includes('<v8:content>Пакетная правка</v8:content>'), 'комментарий записан как локализованная строка');
      assert.ok(saved.includes('<CheckUnique>false</CheckUnique>'), 'булево свойство записано');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('частичный сбой: валидные свойства применяются, невалидное попадает в failed', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-mcp-set-props-partial-'));
    try {
      const xmlPath = setupCatalog(root, 'Партнёры');
      const node = createCatalogNode(xmlPath, 'Партнёры');
      const service = new McpPropertyService(new ConfigurationXmlEditor());

      const result = service.setProperties(node, {
        Synonym: 'Партнёры (батч)',
        EditType: 'НетТакогоВарианта',
        Comment: 'Частичный сбой',
      });

      assert.strictEqual(result.applied.length, 2, 'должны примениться два валидных свойства');
      assert.strictEqual(result.failed.length, 1, 'одно свойство должно упасть');
      assert.strictEqual(result.failed[0].propertyKey, 'EditType');
      assert.ok(result.failed[0].message.includes('Недопустимое значение'), 'сообщение об ошибке содержит причину');
      assert.ok(result.changedFiles.length > 0, 'успешные правки должны попасть в changedFiles');

      const saved = fs.readFileSync(xmlPath, 'utf-8');
      assert.ok(saved.includes('<v8:content>Партнёры (батч)</v8:content>'));
      assert.ok(saved.includes('<v8:content>Частичный сбой</v8:content>'));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('все значения невалидны: applied пуст, changedFiles пуст, XML не меняется', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-mcp-set-props-all-bad-'));
    try {
      const xmlPath = setupCatalog(root, 'Клиенты');
      const before = fs.readFileSync(xmlPath, 'utf-8');
      const node = createCatalogNode(xmlPath, 'Клиенты');
      const service = new McpPropertyService(new ConfigurationXmlEditor());

      const result = service.setProperties(node, {
        EditType: 'НеВалидно',
        CheckUnique: 'не_булево',
        UnknownProperty: 'whatever',
      });

      assert.strictEqual(result.applied.length, 0);
      assert.strictEqual(result.failed.length, 3);
      assert.strictEqual(result.changedFiles.length, 0);
      assert.strictEqual(fs.readFileSync(xmlPath, 'utf-8'), before, 'XML должен остаться нетронутым');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('changedFiles накапливаются без дубликатов при правках одного файла', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-mcp-set-props-dedup-'));
    try {
      const xmlPath = setupCatalog(root, 'Города');
      const node = createCatalogNode(xmlPath, 'Города');
      const service = new McpPropertyService(new ConfigurationXmlEditor());

      const result = service.setProperties(node, {
        Synonym: 'Города (1)',
        Comment: 'Первая правка',
        CheckUnique: false,
        Autonumbering: false,
      });

      assert.strictEqual(result.failed.length, 0);
      assert.ok(result.applied.length >= 2, 'минимум два свойства должны примениться');
      const fileCount = new Set(result.changedFiles).size;
      assert.strictEqual(
        result.changedFiles.length,
        fileCount,
        'changedFiles не должен содержать дубликатов'
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

function setupCatalog(root: string, name: string): string {
  fs.writeFileSync(path.join(root, 'Configuration.xml'), buildConfigXml(), 'utf-8');
  const creator = new MetadataXmlCreator();
  const created = creator.addRootObject({ configRoot: root, kind: 'Catalog', name });
  assert.strictEqual(created.success, true, 'справочник должен создаться');
  return path.join(root, 'Catalogs', `${name}.xml`);
}

function createCatalogNode(xmlPath: string, label: string): MetadataNode {
  return new MetadataNode({
    label,
    nodeKind: 'Catalog',
    xmlPath,
  }, vscode.TreeItemCollapsibleState.None);
}

function buildConfigXml(): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<MetaDataObject>',
    '  <Configuration>',
    '    <Properties>',
    '      <Name>Тест</Name>',
    '      <Synonym/>',
    '      <Comment/>',
    '    </Properties>',
    '    <ChildObjects/>',
    '  </Configuration>',
    '</MetaDataObject>',
  ].join('\n');
}
