import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigurationChangeDetector } from '../../infra/fs/ConfigurationChangeDetector';
import { MetadataXmlCreator } from '../../infra/xml';

suite('metadataXmlCreator', () => {
  test('создаёт корневой объект и сохраняет изменённость после пересборки meta-кэша', () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-meta-project-'));
    const configRoot = path.join(projectRoot, 'src', 'cf');
    fs.mkdirSync(configRoot, { recursive: true });
    fs.writeFileSync(path.join(configRoot, 'Configuration.xml'), buildConfigXml(), 'utf-8');

    const entry = { rootPath: configRoot, kind: 'cf' as const };
    const detector = new ConfigurationChangeDetector(projectRoot);
    detector.ensureCaches([entry]);

    const creator = new MetadataXmlCreator();
    const result = creator.addRootObject({ configRoot, kind: 'Catalog', name: 'Товары' });
    assert.strictEqual(result.success, true);
    assert.ok(fs.existsSync(path.join(configRoot, 'Catalogs', 'Товары.xml')));
    assert.ok(fs.existsSync(path.join(configRoot, 'Catalogs', 'Товары', 'Ext', 'ObjectModule.bsl')));

    fs.rmSync(path.join(projectRoot, '.v8vscedit', 'meta'), { recursive: true, force: true });
    detector.ensureCaches([entry]);
    const changed = detector.detect([entry]);
    assert.strictEqual(changed.length, 1);
    assert.ok(changed[0].changedFilesCount > 0);
  });

  test('добавляет реквизит и колонку табличной части без внешних скриптов', () => {
    const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-meta-cf-'));
    fs.writeFileSync(path.join(configRoot, 'Configuration.xml'), buildConfigXml(), 'utf-8');
    const creator = new MetadataXmlCreator();
    const root = creator.addRootObject({ configRoot, kind: 'Catalog', name: 'Товары' });
    assert.strictEqual(root.success, true);

    const xmlPath = path.join(configRoot, 'Catalogs', 'Товары.xml');
    const attr = creator.addChildElement({ ownerObjectXmlPath: xmlPath, childTag: 'Attribute', name: 'Артикул' });
    const ts = creator.addChildElement({ ownerObjectXmlPath: xmlPath, childTag: 'TabularSection', name: 'Цены' });
    const column = creator.addChildElement({
      ownerObjectXmlPath: xmlPath,
      childTag: 'Column',
      tabularSectionName: 'Цены',
      name: 'Цена',
    });

    assert.strictEqual(attr.success, true);
    assert.strictEqual(ts.success, true);
    assert.strictEqual(column.success, true);
    const xml = fs.readFileSync(xmlPath, 'utf-8');
    assert.ok(xml.includes('<Name>Артикул</Name>'));
    assert.ok(xml.includes('<Name>Цены</Name>'));
    assert.ok(xml.includes('<Name>Цена</Name>'));
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
