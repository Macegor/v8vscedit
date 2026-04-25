import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MetadataXmlCreator, MetadataXmlRemover } from '../../infra/xml';

suite('metadataXmlRemover', () => {
  test('блокирует удаление корневого объекта при найденных ссылках', () => {
    const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-remove-cf-'));
    fs.writeFileSync(path.join(configRoot, 'Configuration.xml'), buildConfigXml(), 'utf-8');
    fs.mkdirSync(path.join(configRoot, 'Documents'), { recursive: true });
    fs.writeFileSync(
      path.join(configRoot, 'Documents', 'Заказ.xml'),
      '<MetaDataObject><Document><Properties><Type>CatalogRef.Товары</Type></Properties></Document></MetaDataObject>',
      'utf-8'
    );

    const creator = new MetadataXmlCreator();
    assert.strictEqual(creator.addRootObject({ configRoot, kind: 'Catalog', name: 'Товары' }).success, true);

    const remover = new MetadataXmlRemover();
    const result = remover.removeRootObject({ configRoot, kind: 'Catalog', name: 'Товары' });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.references.length, 1);
    assert.ok(fs.existsSync(path.join(configRoot, 'Catalogs', 'Товары.xml')));
  });

  test('принудительно удаляет корневой объект, регистрацию и ссылки из подсистем', () => {
    const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-remove-cf-'));
    fs.writeFileSync(path.join(configRoot, 'Configuration.xml'), buildConfigXml(), 'utf-8');
    fs.mkdirSync(path.join(configRoot, 'Subsystems'), { recursive: true });
    const subsystemPath = path.join(configRoot, 'Subsystems', 'Продажи.xml');
    fs.writeFileSync(
      subsystemPath,
      '<MetaDataObject><Subsystem><Properties><Content><xr:Item xsi:type="xr:MDObjectRef">Catalog.Товары</xr:Item></Content></Properties></Subsystem></MetaDataObject>',
      'utf-8'
    );

    const creator = new MetadataXmlCreator();
    assert.strictEqual(creator.addRootObject({ configRoot, kind: 'Catalog', name: 'Товары' }).success, true);

    const remover = new MetadataXmlRemover();
    const result = remover.removeRootObject({ configRoot, kind: 'Catalog', name: 'Товары', force: true });

    assert.strictEqual(result.success, true);
    assert.ok(!fs.existsSync(path.join(configRoot, 'Catalogs', 'Товары.xml')));
    assert.ok(!fs.existsSync(path.join(configRoot, 'Catalogs', 'Товары')));
    assert.ok(!fs.readFileSync(path.join(configRoot, 'Configuration.xml'), 'utf-8').includes('<Catalog>Товары</Catalog>'));
    assert.ok(!fs.readFileSync(subsystemPath, 'utf-8').includes('Catalog.Товары'));
  });

  test('удаляет дочерний элемент и вспомогательные файлы формы', () => {
    const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-remove-cf-'));
    fs.writeFileSync(path.join(configRoot, 'Configuration.xml'), buildConfigXml(), 'utf-8');
    const creator = new MetadataXmlCreator();
    assert.strictEqual(creator.addRootObject({ configRoot, kind: 'Catalog', name: 'Товары' }).success, true);
    const xmlPath = path.join(configRoot, 'Catalogs', 'Товары.xml');
    assert.strictEqual(creator.addChildElement({ ownerObjectXmlPath: xmlPath, childTag: 'Form', name: 'ФормаЭлемента' }).success, true);

    const formDir = path.join(configRoot, 'Catalogs', 'Товары', 'Forms', 'ФормаЭлемента');
    assert.ok(fs.existsSync(formDir));

    const remover = new MetadataXmlRemover();
    const result = remover.removeChildElement({ ownerObjectXmlPath: xmlPath, childTag: 'Form', name: 'ФормаЭлемента' });

    assert.strictEqual(result.success, true);
    assert.ok(!fs.readFileSync(xmlPath, 'utf-8').includes('<Name>ФормаЭлемента</Name>'));
    assert.ok(!fs.existsSync(formDir));
  });

  test('удаляет только выбранный реквизит из нескольких однотипных элементов', () => {
    const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-remove-cf-'));
    fs.writeFileSync(path.join(configRoot, 'Configuration.xml'), buildConfigXml(), 'utf-8');
    const creator = new MetadataXmlCreator();
    assert.strictEqual(creator.addRootObject({ configRoot, kind: 'Catalog', name: 'Товары' }).success, true);
    const xmlPath = path.join(configRoot, 'Catalogs', 'Товары.xml');
    assert.strictEqual(creator.addChildElement({ ownerObjectXmlPath: xmlPath, childTag: 'Attribute', name: 'Первый' }).success, true);
    assert.strictEqual(creator.addChildElement({ ownerObjectXmlPath: xmlPath, childTag: 'Attribute', name: 'Второй' }).success, true);
    assert.strictEqual(creator.addChildElement({ ownerObjectXmlPath: xmlPath, childTag: 'Attribute', name: 'Третий' }).success, true);

    const remover = new MetadataXmlRemover();
    const result = remover.removeChildElement({ ownerObjectXmlPath: xmlPath, childTag: 'Attribute', name: 'Второй' });

    assert.strictEqual(result.success, true);
    const xml = fs.readFileSync(xmlPath, 'utf-8');
    assert.ok(xml.includes('<Name>Первый</Name>'));
    assert.ok(!xml.includes('<Name>Второй</Name>'));
    assert.ok(xml.includes('<Name>Третий</Name>'));
  });
});

function buildConfigXml(): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<MetaDataObject>
  <Configuration>
    <Properties>
      <Name>ТестоваяКонфигурация</Name>
      <Synonym/>
    </Properties>
    <ChildObjects/>
  </Configuration>
</MetaDataObject>`;
}
