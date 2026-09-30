import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildMetadataTypeInnerXml, buildMetadataTypeItem, ensureDefaultQualifiers, parseMetadataType } from '../../ui/views/properties/MetadataTypeService';
import { ObjectXmlReader } from '../../infra/xml/ObjectXmlReader';

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

  /**
   * Ссылочный тип в корневом XML объекта метаданных пишется префиксом `cfg:`.
   * Правило снято с эталона сканом контрпримеров, а не выведено из схемы:
   * 27 847 корней `MetaDataObject` в `example/2.20` и `example/2.21` (cf и cfe) —
   * у 100% объявлен `xmlns:cfg`, и все ссылочные типы платформенных выгрузок несут
   * именно `cfg:` (18 953 `cfg:CatalogRef`, 7 455 `cfg:DocumentRef`, 6 193 `cfg:EnumRef`).
   * Форма `dNpM:` с инлайн-объявлением того же URI встречается только в макетах СКД
   * и XDTO, где корневого объявления `cfg` нет, — там она каноничная и не трогается.
   * Раньше генератор писал инлайн-форму: XML-эквивалентно, но давало вечный дифф
   * с платформенной выгрузкой на каждом объекте со ссылочным реквизитом.
   */
  test('Ссылочный тип пишется префиксом cfg, без инлайн-объявления неймспейса', () => {
    for (const canonical of ['CatalogRef.Номенклатура', 'DocumentRef.ЗаказПокупателя', 'EnumRef.СтавкиНДС']) {
      const inner = buildMetadataTypeInnerXml({
        items: [buildMetadataTypeItem(canonical)],
        presentation: '',
        rawInnerXml: '',
      });
      assert.strictEqual(inner, `<v8:Type>cfg:${canonical}</v8:Type>`, canonical);
      assert.ok(!inner.includes('xmlns:d5p1'), `${canonical}: инлайн-объявление неймспейса вернулось`);
    }
  });

  /**
   * Разбор обязан понимать ОБЕ формы: в реальных выгрузках уже лежат файлы,
   * записанные прежней версией расширения (инлайн `d5p1:`), и ломать их чтение
   * нельзя. Ось записи и ось чтения здесь разные — сужается только запись.
   */
  test('Разбор понимает и cfg:, и инлайн-форму d5p1: — сужается только запись', () => {
    const viaCfg = parseMetadataType('<v8:Type>cfg:CatalogRef.Номенклатура</v8:Type>');
    const viaInline = parseMetadataType(
      '<v8:Type xmlns:d5p1="http://v8.1c.ru/8.1/data/enterprise/current-config">d5p1:CatalogRef.Номенклатура</v8:Type>'
    );
    assert.strictEqual(viaCfg.items[0].canonical, 'CatalogRef.Номенклатура');
    assert.strictEqual(viaInline.items[0].canonical, 'CatalogRef.Номенклатура');
  });

  test('Собирает XML внутренности блока Type', () => {
    const inner = buildMetadataTypeInnerXml({
      items: [
        { canonical: 'Number', display: 'Число', group: 'primitive' },
        { canonical: 'String', display: 'Строка', group: 'primitive' },
        { canonical: 'Date', display: 'Дата', group: 'primitive' },
        { canonical: 'DefinedType.Контакт', display: 'ОпределяемыйТип.Контакт', group: 'defined' },
      ],
      numberQualifiers: { digits: 15, fractionDigits: 2, allowedSign: 'Any' },
      stringQualifiers: { length: 25, allowedLength: 'Fixed' },
      dateQualifiers: { dateFractions: 'Date' },
      presentation: 'Число, ОпределяемыйТип.Контакт',
      rawInnerXml: '',
    });

    assert.ok(inner.includes('<v8:Type>xs:decimal</v8:Type>'));
    assert.ok(inner.includes('<v8:TypeSet>cfg:DefinedType.Контакт</v8:TypeSet>'));
    assert.ok(inner.includes('\t<v8:Digits>15</v8:Digits>'));
    assert.ok(inner.includes('\t<v8:Length>25</v8:Length>'));
    assert.ok(inner.includes('\t<v8:DateFractions>Date</v8:DateFractions>'));
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

    const changed = new ObjectXmlReader().updateTypeInObject(xmlPath, {
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

    const changed = new ObjectXmlReader().updateTypeInObject(xmlPath, {
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
