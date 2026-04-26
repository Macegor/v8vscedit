import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigurationChangeDetector } from '../../infra/fs/ConfigurationChangeDetector';
import { MetadataXmlCreator, ObjectXmlReader } from '../../infra/xml';
import { buildTypedFieldProperties } from '../../ui/views/properties/PropertyBuilder';

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
    assert.ok(xml.includes('<PasswordMode>false</PasswordMode>'));
    assert.ok(xml.includes('<FillChecking>DontCheck</FillChecking>'));
    assert.ok(xml.includes('<ChoiceFoldersAndItems>Items</ChoiceFoldersAndItems>'));
    assert.ok(xml.includes('<QuickChoice>Auto</QuickChoice>'));
    assert.ok(xml.includes('<CreateOnInput>Auto</CreateOnInput>'));
    assert.ok(xml.includes('<ChoiceHistoryOnInput>Auto</ChoiceHistoryOnInput>'));
    assert.ok(xml.includes('<Indexing>DontIndex</Indexing>'));
    assert.ok(xml.includes('<FullTextSearch>Use</FullTextSearch>'));
    assert.ok(xml.includes('<DataHistory>Use</DataHistory>'));
  });

  test('при смене типа реквизита перестраивает типозависимые свойства и сохраняет общие значения', () => {
    const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-meta-cf-'));
    fs.writeFileSync(path.join(configRoot, 'Configuration.xml'), buildConfigXml(), 'utf-8');
    const creator = new MetadataXmlCreator();
    const root = creator.addRootObject({ configRoot, kind: 'Catalog', name: 'Товары' });
    assert.strictEqual(root.success, true);

    const xmlPath = path.join(configRoot, 'Catalogs', 'Товары.xml');
    const attr = creator.addChildElement({ ownerObjectXmlPath: xmlPath, childTag: 'Attribute', name: 'Комментарий' });
    assert.strictEqual(attr.success, true);

    let xml = fs.readFileSync(xmlPath, 'utf-8');
    xml = xml
      .replace('<MultiLine>false</MultiLine>', '<MultiLine>true</MultiLine>')
      .replace('<FillChecking>DontCheck</FillChecking>', '<FillChecking>ShowError</FillChecking>')
      .replace('<DataHistory>Use</DataHistory>', '<DataHistory>DontUse</DataHistory>')
      .replace('<FillChecking>ShowError</FillChecking>', '<LegacyProperty>old</LegacyProperty>\n\t\t\t<FillChecking>ShowError</FillChecking>');
    fs.writeFileSync(xmlPath, xml, 'utf-8');

    const changed = new ObjectXmlReader().updateTypeInObject(xmlPath, {
      targetKind: 'Attribute',
      targetName: 'Комментарий',
      typeInnerXml: [
        '<v8:Type>xs:decimal</v8:Type>',
        '<v8:NumberQualifiers>',
        '\t<v8:Digits>15</v8:Digits>',
        '\t<v8:FractionDigits>2</v8:FractionDigits>',
        '\t<v8:AllowedSign>Any</v8:AllowedSign>',
        '</v8:NumberQualifiers>',
      ].join('\n'),
    });

    assert.strictEqual(changed, true);
    const nextXml = fs.readFileSync(xmlPath, 'utf-8');
    assert.ok(nextXml.includes('<v8:Type>xs:decimal</v8:Type>'));
    assert.ok(!nextXml.includes('<MultiLine>true</MultiLine>'));
    assert.ok(!nextXml.includes('<PasswordMode>false</PasswordMode>'));
    assert.ok(!nextXml.includes('<LegacyProperty>old</LegacyProperty>'));
    assert.ok(nextXml.includes('<MarkNegatives>false</MarkNegatives>'));
    assert.ok(nextXml.includes('<RoundingMode>Round15as20</RoundingMode>'));
    assert.ok(nextXml.includes('<FillChecking>ShowError</FillChecking>'));
    assert.ok(nextXml.includes('<DataHistory>DontUse</DataHistory>'));

    const refChanged = new ObjectXmlReader().updateTypeInObject(xmlPath, {
      targetKind: 'Attribute',
      targetName: 'Комментарий',
      typeInnerXml: '<v8:Type xmlns:d5p1="http://v8.1c.ru/8.1/data/enterprise/current-config">d5p1:DocumentRef.ЗаказПокупателя</v8:Type>',
    });

    assert.strictEqual(refChanged, true);
    const refXml = fs.readFileSync(xmlPath, 'utf-8');
    assert.ok(refXml.includes('d5p1:DocumentRef.ЗаказПокупателя'));
    assert.ok(!refXml.includes('<RoundingMode>Round15as20</RoundingMode>'));
    assert.ok(refXml.includes('<ChoiceParameterLinks/>'));
    assert.ok(refXml.includes('<ChoiceParameters/>'));
    assert.ok(refXml.includes('<ChoiceForm/>'));
    assert.ok(refXml.includes('<LinkByType/>'));
    assert.ok(refXml.includes('<FillChecking>ShowError</FillChecking>'));
    assert.ok(refXml.includes('<DataHistory>DontUse</DataHistory>'));
  });

  test('панель свойств не показывает строковые свойства для ссылочного реквизита', () => {
    const props = buildTypedFieldProperties([
      '<Attribute uuid="00000000-0000-0000-0000-000000000000">',
      '\t<Properties>',
      '\t\t<Name>Действие</Name>',
      '\t\t<Synonym/>',
      '\t\t<Comment/>',
      '\t\t<Type>',
      '\t\t\t<v8:Type xmlns:d5p1="http://v8.1c.ru/8.1/data/enterprise/current-config">d5p1:DocumentRef.ев_Действие</v8:Type>',
      '\t\t</Type>',
      '\t\t<PasswordMode>false</PasswordMode>',
      '\t\t<MultiLine>false</MultiLine>',
      '\t\t<ExtendedEdit>false</ExtendedEdit>',
      '\t\t<FillChecking>DontCheck</FillChecking>',
      '\t\t<ChoiceFoldersAndItems>Items</ChoiceFoldersAndItems>',
      '\t\t<ChoiceParameterLinks/>',
      '\t\t<ChoiceParameters/>',
      '\t\t<ChoiceForm/>',
      '\t\t<LinkByType/>',
      '\t</Properties>',
      '</Attribute>',
    ].join('\n'));
    const keys = props.map((item) => item.key);
    assert.ok(!keys.includes('PasswordMode'));
    assert.ok(!keys.includes('MultiLine'));
    assert.ok(!keys.includes('ExtendedEdit'));
    assert.ok(keys.includes('ChoiceFoldersAndItems'));
    assert.ok(keys.includes('FillChecking'));
  });

  test('панель свойств объединяет свойства всех типов составного реквизита', () => {
    const props = buildTypedFieldProperties([
      '<Attribute uuid="00000000-0000-0000-0000-000000000000">',
      '\t<Properties>',
      '\t\t<Name>Действие</Name>',
      '\t\t<Synonym/>',
      '\t\t<Comment/>',
      '\t\t<Type>',
      '\t\t\t<v8:Type>xs:string</v8:Type>',
      '\t\t\t<v8:Type xmlns:d5p1="http://v8.1c.ru/8.1/data/enterprise/current-config">d5p1:DocumentRef.ев_Действие</v8:Type>',
      '\t\t\t<v8:StringQualifiers>',
      '\t\t\t\t<v8:Length>10</v8:Length>',
      '\t\t\t\t<v8:AllowedLength>Variable</v8:AllowedLength>',
      '\t\t\t</v8:StringQualifiers>',
      '\t\t</Type>',
      '\t\t<PasswordMode>false</PasswordMode>',
      '\t\t<MultiLine>false</MultiLine>',
      '\t\t<ExtendedEdit>false</ExtendedEdit>',
      '\t\t<FillChecking>DontCheck</FillChecking>',
      '\t\t<ChoiceFoldersAndItems>Items</ChoiceFoldersAndItems>',
      '\t\t<ChoiceParameterLinks/>',
      '\t\t<ChoiceParameters/>',
      '\t\t<ChoiceForm/>',
      '\t\t<LinkByType/>',
      '\t</Properties>',
      '</Attribute>',
    ].join('\n'));
    const keys = props.map((item) => item.key);
    assert.ok(keys.includes('PasswordMode'));
    assert.ok(keys.includes('MultiLine'));
    assert.ok(keys.includes('ExtendedEdit'));
    assert.ok(keys.includes('ChoiceParameterLinks'));
    assert.ok(keys.includes('ChoiceParameters'));
    assert.ok(keys.includes('ChoiceForm'));
    assert.ok(keys.includes('LinkByType'));
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
