import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigurationXmlEditor } from '../../infra/xml/ConfigurationXmlEditor';

/**
 * T-15 — после переезда приватного массива порядка `Configuration.xml`
 * (`ConfigurationXmlEditor.sortChildObjects`, строки 384-392) в
 * `ChildObjectsOrder.ts` (`CONFIGURATION_CHILD_ORDER`) поведение
 * `ConfigurationXmlEditor.addChildObject` не должно измениться НИ БАЙТОМ.
 * Тест работает ТОЛЬКО через публичное поведение (не импортирует
 * `ChildObjectsOrder.ts` напрямую) — актуален и до, и после переноса массива.
 */
function newConfigXml(dir: string, childObjectsInner: string): string {
  const configPath = path.join(dir, 'Configuration.xml');
  fs.writeFileSync(
    configPath,
    `<?xml version="1.0" encoding="utf-8"?>\n<MetaDataObject>\n  <Configuration>\n    <Properties><Name>Тест</Name></Properties>\n    <ChildObjects>${childObjectsInner}</ChildObjects>\n  </Configuration>\n</MetaDataObject>`,
    'utf-8'
  );
  return configPath;
}

function makeObjectStub(dir: string, folder: string, name: string): void {
  fs.mkdirSync(path.join(dir, folder), { recursive: true });
  fs.writeFileSync(path.join(dir, folder, `${name}.xml`), '<MetaDataObject />', 'utf-8');
}

function readInnerChildTags(configPath: string): { type: string; name: string }[] {
  const xml = fs.readFileSync(configPath, 'utf-8');
  const inner = /<ChildObjects>([\s\S]*?)<\/ChildObjects>/.exec(xml)?.[1] ?? '';
  return Array.from(inner.matchAll(/<([A-Za-z][A-Za-z0-9]*)>([^<]+)<\/\1>/g)).map((m) => ({ type: m[1], name: m[2].trim() }));
}

suite('ConfigurationXmlEditor.addChildObject — T-15: сортировка ChildObjects Configuration.xml после переезда CONFIGURATION_CHILD_ORDER', () => {
  test('известные виды сортируются по заданному порядку типов, а НЕ по порядку добавления', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-cfgorder-'));
    makeObjectStub(dir, 'Documents', 'Заказ');
    makeObjectStub(dir, 'Catalogs', 'Клиенты');
    makeObjectStub(dir, 'Subsystems', 'ОсновнаяПодсистема');
    const configPath = newConfigXml(dir, '');

    const editor = new ConfigurationXmlEditor();
    // Специально добавляем в ОБРАТНОМ порядке относительно ожидаемого канона
    // (Document раньше Catalog раньше Subsystem по вызовам) — итог не должен
    // зависеть от порядка вызовов, только от таблицы типов.
    assert.strictEqual(editor.addChildObject(configPath, 'Document.Заказ').success, true);
    assert.strictEqual(editor.addChildObject(configPath, 'Catalog.Клиенты').success, true);
    assert.strictEqual(editor.addChildObject(configPath, 'Subsystem.ОсновнаяПодсистема').success, true);

    const entries = readInnerChildTags(configPath);
    assert.deepStrictEqual(
      entries,
      [
        { type: 'Subsystem', name: 'ОсновнаяПодсистема' },
        { type: 'Catalog', name: 'Клиенты' },
        { type: 'Document', name: 'Заказ' },
      ],
      'порядок в ChildObjects обязан соответствовать канону типов (Subsystem < Catalog < Document), а не порядку вызовов addChildObject'
    );
  });

  test('неизвестный (не входящий в канон) тип попадает В КОНЕЦ, после всех известных', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-cfgorder-'));
    makeObjectStub(dir, 'Catalogs', 'Клиенты');
    makeObjectStub(dir, 'ExternalDataSources', 'Прочее');
    const configPath = newConfigXml(dir, '');

    const editor = new ConfigurationXmlEditor();
    // ExternalDataSource НЕ входит в приватный массив sortChildObjects (см.
    // production-код) — ожидание: он попадает в конец списка независимо от
    // порядка вызовов.
    assert.strictEqual(editor.addChildObject(configPath, 'ExternalDataSource.Прочее').success, true);
    assert.strictEqual(editor.addChildObject(configPath, 'Catalog.Клиенты').success, true);

    const entries = readInnerChildTags(configPath);
    assert.deepStrictEqual(entries, [
      { type: 'Catalog', name: 'Клиенты' },
      { type: 'ExternalDataSource', name: 'Прочее' },
    ]);
  });

  test('внутри ОДНОГО вида элементы сортируются по имени (локаль ru)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-cfgorder-'));
    makeObjectStub(dir, 'Catalogs', 'Яблоки');
    makeObjectStub(dir, 'Catalogs', 'Апельсины');
    makeObjectStub(dir, 'Catalogs', 'Бананы');
    const configPath = newConfigXml(dir, '');

    const editor = new ConfigurationXmlEditor();
    assert.strictEqual(editor.addChildObject(configPath, 'Catalog.Яблоки').success, true);
    assert.strictEqual(editor.addChildObject(configPath, 'Catalog.Апельсины').success, true);
    assert.strictEqual(editor.addChildObject(configPath, 'Catalog.Бананы').success, true);

    const entries = readInnerChildTags(configPath);
    assert.deepStrictEqual(entries.map((e) => e.name), ['Апельсины', 'Бананы', 'Яблоки']);
  });
});
