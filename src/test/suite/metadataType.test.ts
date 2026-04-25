import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildMetadataTypeInnerXml, ensureDefaultQualifiers, parseMetadataType } from '../../ui/views/properties/MetadataTypeService';
import { updateObjectTypeProperty } from '../../infra/xml';

suite('metadataType', () => {
  test('Парсит составной тип и квалификаторы', () => {
    const inner = `
      <v8:Type>xs:string</v8:Type>
      <v8:Type xmlns:d5p1="http://v8.1c.ru/8.1/data/enterprise/current-config">d5p1:CatalogRef.Номенклатура</v8:Type>
      <v8:StringQualifiers>
        <v8:Length>50</v8:Length>
        <v8:AllowedLength>Variable</v8:AllowedLength>
      </v8:StringQualifiers>
    `;

    const parsed = parseMetadataType(inner);
    assert.strictEqual(parsed.items.length, 2);
    assert.strictEqual(parsed.items[0].canonical, 'String');
    assert.strictEqual(parsed.items[1].canonical, 'CatalogRef.Номенклатура');
    assert.strictEqual(parsed.stringQualifiers?.length, 50);
    assert.ok(parsed.presentation.includes('Строка'));
    assert.ok(parsed.presentation.includes('СправочникСсылка.Номенклатура'));
  });

  test('Собирает XML внутренности блока Type', () => {
    const inner = buildMetadataTypeInnerXml({
      items: [
        { canonical: 'Number', display: 'Число', group: 'primitive' },
        { canonical: 'DefinedType.Контакт', display: 'ОпределяемыйТип.Контакт', group: 'defined' },
      ],
      numberQualifiers: { digits: 15, fractionDigits: 2, allowedSign: 'Any' },
      presentation: 'Число, ОпределяемыйТип.Контакт',
      rawInnerXml: '',
    });

    assert.ok(inner.includes('<v8:Type>xs:decimal</v8:Type>'));
    assert.ok(inner.includes('<v8:TypeSet>cfg:DefinedType.Контакт</v8:TypeSet>'));
    assert.ok(inner.includes('<v8:Digits>15</v8:Digits>'));
  });

  test('Добавляет NumberQualifiers по умолчанию для Number', () => {
    const inner = buildMetadataTypeInnerXml(
      ensureDefaultQualifiers({
        items: [{ canonical: 'Number', display: 'Число', group: 'primitive' }],
        presentation: 'Число',
        rawInnerXml: '',
      })
    );

    assert.ok(inner.includes('<v8:Type>xs:decimal</v8:Type>'));
    assert.ok(inner.includes('<v8:NumberQualifiers>'));
    assert.ok(inner.includes('<v8:Digits>10</v8:Digits>'));
    assert.ok(inner.includes('<v8:FractionDigits>0</v8:FractionDigits>'));
    assert.ok(inner.includes('<v8:AllowedSign>Any</v8:AllowedSign>'));
  });

  test('Записывает новый тип в XML объекта', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-'));
    const xmlPath = path.join(dir, 'SessionParam.xml');
    fs.writeFileSync(
      xmlPath,
      `<?xml version="1.0" encoding="utf-8"?>
<MetaDataObject>
  <SessionParameter>
    <Properties>
      <Name>Тест</Name>
      <Type>
        <v8:Type>xs:string</v8:Type>
      </Type>
    </Properties>
  </SessionParameter>
</MetaDataObject>`,
      'utf-8'
    );

    const changed = updateObjectTypeProperty(xmlPath, {
      targetKind: 'SessionParameter',
      targetName: 'Тест',
      typeInnerXml: '<v8:Type>xs:boolean</v8:Type>',
    });

    assert.strictEqual(changed, true);
    const saved = fs.readFileSync(xmlPath, 'utf-8');
    assert.ok(saved.includes('<v8:Type>xs:boolean</v8:Type>'));
  });
  test('записывает тип реквизита рядом с самозакрывающимися тегами', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-'));
    const xmlPath = path.join(dir, 'Document.xml');
    fs.writeFileSync(
      xmlPath,
      `<?xml version="1.0" encoding="utf-8"?>
<MetaDataObject>
  <Document>
    <Properties>
      <Name>TestDocument</Name>
    </Properties>
    <ChildObjects>
      <Attribute uuid="00000000-0000-0000-0000-000000000001">
        <Properties>
          <Name>TargetAttribute</Name>
          <Comment/>
          <Type>
            <v8:Type>xs:string</v8:Type>
          </Type>
          <Format/>
        </Properties>
      </Attribute>
    </ChildObjects>
  </Document>
</MetaDataObject>`,
      'utf-8'
    );

    const changed = updateObjectTypeProperty(xmlPath, {
      targetKind: 'Attribute',
      targetName: 'TargetAttribute',
      typeInnerXml: '<v8:Type xmlns:d5p1="http://v8.1c.ru/8.1/data/enterprise/current-config">d5p1:DocumentRef.OtherDocument</v8:Type>',
    });

    assert.strictEqual(changed, true);
    const saved = fs.readFileSync(xmlPath, 'utf-8');
    assert.ok(saved.includes('d5p1:DocumentRef.OtherDocument'));
    assert.ok(saved.includes('<Comment/>'));
    assert.ok(saved.includes('<Format/>'));
  });
});
