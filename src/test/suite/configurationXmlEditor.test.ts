import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigurationXmlEditor } from '../../infra/xml/ConfigurationXmlEditor';

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

  test('Развёртывает самозакрывающийся <DefaultRoles/> при добавлении роли', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-cfg-'));
    const configPath = path.join(dir, 'Configuration.xml');
    fs.writeFileSync(
      configPath,
      `<?xml version="1.0" encoding="utf-8"?>
<MetaDataObject>
  <Configuration>
    <Properties>
      <Name>Тест</Name>
      <ScriptVariant>Russian</ScriptVariant>
      <DefaultRoles/>
    </Properties>
    <ChildObjects/>
  </Configuration>
</MetaDataObject>`,
      'utf-8'
    );
    const editor = new ConfigurationXmlEditor();
    const added = editor.addDefaultRole(configPath, 'БазовыеПрава');
    assert.strictEqual(added.success, true);
    assert.strictEqual(added.changed, true);
    const after = fs.readFileSync(configPath, 'utf-8');
    assert.ok(!/\<DefaultRoles\s*\/\>/.test(after), 'остался self-closing блок');
    assert.ok(after.includes('<xr:Item xsi:type="xr:MDObjectRef">Role.БазовыеПрава</xr:Item>'));

    const cleared = editor.setDefaultRoles(configPath, []);
    assert.strictEqual(cleared.success, true);
    const empty = fs.readFileSync(configPath, 'utf-8');
    assert.ok(/\<DefaultRoles\s*\/\>/.test(empty), 'после очистки блок должен схлопнуться');
  });

  test('modifyConfigurationProperty с multiEnum DefaultRoles переиспользует setDefaultRoles', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-cfg-'));
    const configPath = path.join(dir, 'Configuration.xml');
    fs.writeFileSync(
      configPath,
      `<?xml version="1.0" encoding="utf-8"?>
<MetaDataObject>
  <Configuration>
    <Properties>
      <Name>Тест</Name>
      <DefaultRoles/>
    </Properties>
    <ChildObjects/>
  </Configuration>
</MetaDataObject>`,
      'utf-8'
    );
    const editor = new ConfigurationXmlEditor();
    const result = editor.modifyConfigurationProperty(configPath, 'DefaultRoles', ['Role.Один', 'Два'], 'multiEnum');
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.changed, true);
    const saved = fs.readFileSync(configPath, 'utf-8');
    assert.ok(saved.includes('<xr:Item xsi:type="xr:MDObjectRef">Role.Один</xr:Item>'));
    assert.ok(saved.includes('<xr:Item xsi:type="xr:MDObjectRef">Role.Два</xr:Item>'));
    assert.ok(!/\<DefaultRoles\>Role\.Один,Role\.Два/.test(saved), 'не должно сериализоваться как scalar строка');
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
    <ChildObjects>
      <SessionParameter>ТекущийПользователь</SessionParameter>
    </ChildObjects>
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
    assert.ok(saved.includes('<SessionParameter>ТекущийПользователь</SessionParameter>'));
  });

  test('Изменяет список владельцев справочника', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-catalog-'));
    const catalogPath = path.join(dir, 'Клиенты.xml');
    fs.writeFileSync(
      catalogPath,
      `<?xml version="1.0" encoding="utf-8"?>
<MetaDataObject>
  <Catalog>
    <Properties>
      <Name>Клиенты</Name>
      <Owners/>
      <SubordinationUse>ToItems</SubordinationUse>
    </Properties>
  </Catalog>
</MetaDataObject>`,
      'utf-8'
    );
    const editor = new ConfigurationXmlEditor();
    const addRes = editor.modifyObjectProperty(catalogPath, {
      targetKind: 'Self',
      targetName: 'Клиенты',
      propertyKey: 'Owners',
      valueKind: 'metadataReferenceList',
      value: ['Catalog.Контрагенты', 'Catalog.Партнеры'],
    });
    assert.strictEqual(addRes.success, true);
    let saved = fs.readFileSync(catalogPath, 'utf-8');
    assert.ok(saved.includes('<xr:Item xsi:type="xr:MDObjectRef">Catalog.Контрагенты</xr:Item>'));
    assert.ok(saved.includes('<xr:Item xsi:type="xr:MDObjectRef">Catalog.Партнеры</xr:Item>'));

    const removeRes = editor.modifyObjectProperty(catalogPath, {
      targetKind: 'Self',
      targetName: 'Клиенты',
      propertyKey: 'Owners',
      valueKind: 'metadataReferenceList',
      value: [],
    });
    assert.strictEqual(removeRes.success, true);
    saved = fs.readFileSync(catalogPath, 'utf-8');
    assert.ok(saved.includes('<Owners/>'));
  });

  test('Изменяет списки полей через xr:Field', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-catalog-'));
    const catalogPath = path.join(dir, 'Клиенты.xml');
    fs.writeFileSync(
      catalogPath,
      `<?xml version="1.0" encoding="utf-8"?>
<MetaDataObject>
  <Catalog>
    <Properties>
      <Name>Клиенты</Name>
      <InputByString/>
      <DataLockFields/>
    </Properties>
  </Catalog>
</MetaDataObject>`,
      'utf-8'
    );
    const editor = new ConfigurationXmlEditor();
    const result = editor.modifyObjectProperty(catalogPath, {
      targetKind: 'Self',
      targetName: 'Клиенты',
      propertyKey: 'InputByString',
      valueKind: 'metadataFieldList',
      value: ['Catalog.Клиенты.StandardAttribute.Code', 'Catalog.Клиенты.StandardAttribute.Description'],
    });
    assert.strictEqual(result.success, true);
    let saved = fs.readFileSync(catalogPath, 'utf-8');
    assert.ok(saved.includes('<xr:Field>Catalog.Клиенты.StandardAttribute.Code</xr:Field>'));
    assert.ok(saved.includes('<xr:Field>Catalog.Клиенты.StandardAttribute.Description</xr:Field>'));
    assert.ok(!saved.includes('<xr:Item'));

    const lockResult = editor.modifyObjectProperty(catalogPath, {
      targetKind: 'Self',
      targetName: 'Клиенты',
      propertyKey: 'DataLockFields',
      valueKind: 'metadataFieldList',
      value: ['Catalog.Клиенты.Attribute.Организация'],
    });
    assert.strictEqual(lockResult.success, true);
    saved = fs.readFileSync(catalogPath, 'utf-8');
    assert.ok(saved.includes('<DataLockFields>'));
    assert.ok(saved.includes('<xr:Field>Catalog.Клиенты.Attribute.Организация</xr:Field>'));
    assert.ok(!saved.includes('<xr:Item'));
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
      <Catalog>ДругойСправочник</Catalog>
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
    assert.ok(cfg.includes('<Catalog>ДругойСправочник</Catalog>'));
    assert.ok(cfg.includes('<Catalog>Партнеры</Catalog>'));
  });
});
