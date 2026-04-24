import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigurationXmlEditor } from '../../infra/xml';

suite('configurationXmlEditor', () => {
  test('Изменяет свойства Configuration.xml и роли по умолчанию', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-cfg-'));
    const configPath = path.join(dir, 'Configuration.xml');
    fs.writeFileSync(
      configPath,
      `<?xml version="1.0" encoding="utf-8"?>
<MetaDataObject>
  <Configuration>
    <Properties>
      <Name>Тест</Name>
      <Version>1.0</Version>
      <Synonym>
        <v8:item><v8:lang>ru</v8:lang><v8:content>Старое</v8:content></v8:item>
      </Synonym>
      <DefaultRoles>
        <xr:Item xsi:type="xr:MDObjectRef">Role.СтаршаяРоль</xr:Item>
      </DefaultRoles>
    </Properties>
    <ChildObjects></ChildObjects>
  </Configuration>
</MetaDataObject>`,
      'utf-8'
    );
    const editor = new ConfigurationXmlEditor();
    const r1 = editor.modifyConfigurationProperty(configPath, 'Version', '2.0', 'scalar');
    const r2 = editor.modifyConfigurationProperty(configPath, 'Synonym', 'Новое', 'localized');
    const r3 = editor.setDefaultRoles(configPath, ['НоваяРоль']);

    assert.strictEqual(r1.success, true);
    assert.strictEqual(r2.success, true);
    assert.strictEqual(r3.success, true);
    const saved = fs.readFileSync(configPath, 'utf-8');
    assert.ok(saved.includes('<Version>2.0</Version>'));
    assert.ok(saved.includes('<v8:content>Новое</v8:content>'));
    assert.ok(saved.includes('Role.НоваяРоль'));
  });

  test('Добавляет и удаляет объект из ChildObjects', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-cfg-'));
    fs.mkdirSync(path.join(dir, 'Catalogs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'Catalogs', 'Клиенты.xml'), '<MetaDataObject />', 'utf-8');
    const configPath = path.join(dir, 'Configuration.xml');
    fs.writeFileSync(
      configPath,
      `<?xml version="1.0" encoding="utf-8"?>
<MetaDataObject>
  <Configuration>
    <Properties><Name>Тест</Name></Properties>
    <ChildObjects></ChildObjects>
  </Configuration>
</MetaDataObject>`,
      'utf-8'
    );
    const editor = new ConfigurationXmlEditor();
    const addRes = editor.addChildObject(configPath, 'Catalog.Клиенты');
    const delRes = editor.removeChildObject(configPath, 'Catalog.Клиенты');
    assert.strictEqual(addRes.success, true);
    assert.strictEqual(delRes.success, true);
    const saved = fs.readFileSync(configPath, 'utf-8');
    assert.ok(!saved.includes('<Catalog>Клиенты</Catalog>'));
  });

  test('Переименовывает корневой объект и обновляет Configuration.xml', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-cfg-'));
    const catalogs = path.join(dir, 'Catalogs');
    fs.mkdirSync(catalogs, { recursive: true });
    const oldXmlPath = path.join(catalogs, 'Контрагенты.xml');
    fs.writeFileSync(
      oldXmlPath,
      `<?xml version="1.0" encoding="utf-8"?>
<MetaDataObject><Catalog><Properties><Name>Контрагенты</Name></Properties></Catalog></MetaDataObject>`,
      'utf-8'
    );
    const configPath = path.join(dir, 'Configuration.xml');
    fs.writeFileSync(
      configPath,
      `<?xml version="1.0" encoding="utf-8"?>
<MetaDataObject>
  <Configuration>
    <Properties><Name>Тест</Name></Properties>
    <ChildObjects>
      <Catalog>Контрагенты</Catalog>
    </ChildObjects>
  </Configuration>
</MetaDataObject>`,
      'utf-8'
    );
    const editor = new ConfigurationXmlEditor();
    const result = editor.renameMetadataObject(oldXmlPath, 'Catalog', 'Партнеры');
    assert.strictEqual(result.success, true);
    assert.ok(fs.existsSync(path.join(catalogs, 'Партнеры.xml')));
    const cfg = fs.readFileSync(configPath, 'utf-8');
    assert.ok(cfg.includes('<Catalog>Партнеры</Catalog>'));
  });
});
