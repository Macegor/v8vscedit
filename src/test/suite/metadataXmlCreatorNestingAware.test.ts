import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MetadataXmlCreator } from '../../infra/xml/MetadataXmlCreator';

// Реальная фикстура с BOM+CRLF — существующий справочник "Контрагенты" из example/2.20,
// у которого есть реквизит "Регион". Используется для проверки инварианта №12
// (сохранение BOM/EOL) при добавлении реквизита с именем-подстрокой существующего.
const EXAMPLE_CATALOG_WITH_BOM_CRLF = path.resolve(
  __dirname,
  '../../../example/2.20/src/cf/Catalogs/Контрагенты.xml'
);

function buildConfigXml(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" version="2.20">',
    '\t<Configuration uuid="00000000-0000-0000-0000-000000000000">',
    '\t\t<Properties>',
    '\t\t\t<Name>ИмяКонфигурации</Name>',
    '\t\t\t<NamePrefix/>',
    '\t\t</Properties>',
    '\t\t<ChildObjects/>',
    '\t</Configuration>',
    '</MetaDataObject>',
    '',
  ].join('\n');
}

suite('MetadataXmlCreator — вставка дочерних элементов не путает блоки при вложенности/подстроках имён (M1)', () => {
  test('Attribute с именем — подстрокой имени существующего реквизита — вставляется как отдельный элемент, не подменяя существующий', () => {
    assert.strictEqual(EXAMPLE_CATALOG_WITH_BOM_CRLF.length > 0, true);
    const originalXml = fs.readFileSync(EXAMPLE_CATALOG_WITH_BOM_CRLF, 'utf-8');
    assert.strictEqual(originalXml.charCodeAt(0), 0xfeff, 'фикстура должна начинаться с BOM');
    assert.ok(originalXml.includes('\r\n'), 'фикстура должна использовать CRLF');
    assert.ok(originalXml.includes('<Name>Регион</Name>'), 'ожидался существующий реквизит "Регион"');

    const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-substr-catalog-'));
    fs.mkdirSync(path.join(configRoot, 'Catalogs'), { recursive: true });
    const xmlPath = path.join(configRoot, 'Catalogs', 'Контрагенты.xml');
    fs.writeFileSync(xmlPath, originalXml, 'utf-8');

    const creator = new MetadataXmlCreator();
    // "Регио" — подстрока существующего "Регион". Наивный regex-поиск по подстроке
    // без анкоринга на границу тега рискует найти существующий узел вместо вставки нового.
    const result = creator.addChildElement({ ownerObjectXmlPath: xmlPath, childTag: 'Attribute', name: 'Регио' });
    assert.strictEqual(result.success, true, `вставка не удалась: ${JSON.stringify(result)}`);

    const updatedXml = fs.readFileSync(xmlPath, 'utf-8');
    assert.ok(updatedXml.includes('<Name>Регион</Name>'), 'существующий реквизит "Регион" должен остаться');
    assert.ok(updatedXml.includes('<Name>Регио</Name>'), 'новый реквизит "Регио" должен быть добавлен');
    // Оба узла — РАЗНЫЕ Attribute-блоки, а не один переименованный.
    const attributeCount = (updatedXml.match(/<Attribute uuid="/g) ?? []).length;
    const originalAttributeCount = (originalXml.match(/<Attribute uuid="/g) ?? []).length;
    assert.strictEqual(attributeCount, originalAttributeCount + 1, 'должен добавиться ровно один новый Attribute-узел');

    // Инвариант №12: BOM и CRLF сохранены.
    assert.strictEqual(updatedXml.charCodeAt(0), 0xfeff, 'BOM должен быть сохранён после вставки');
    assert.ok(updatedXml.includes('\r\n'), 'CRLF должен быть сохранён после вставки');
  });

  test('добавление колонки во ВТОРУЮ табличную часть не путает её с одноимённой колонкой из ПЕРВОЙ ТЧ', () => {
    // findNamedChildBlock ищет `<TabularSection...>[\s\S]*?<Name>Имя</Name>[\s\S]*?</TabularSection>`
    // без учёта вложенности: если искомое имя ТЧ находится во ВТОРОЙ секции по счёту,
    // а совпадающее имя колонки уже есть в ПЕРВОЙ, non-greedy поиск может "перепрыгнуть"
    // через закрытие первой секции и решить, что колонка с таким именем уже существует
    // во второй ТЧ — хотя на самом деле она принадлежит первой.
    const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-two-ts-'));
    fs.writeFileSync(path.join(configRoot, 'Configuration.xml'), buildConfigXml(), 'utf-8');

    const creator = new MetadataXmlCreator();
    assert.strictEqual(creator.addRootObject({ configRoot, kind: 'Catalog', name: 'Товары' }).success, true);
    const xmlPath = path.join(configRoot, 'Catalogs', 'Товары.xml');

    assert.strictEqual(
      creator.addChildElement({ ownerObjectXmlPath: xmlPath, childTag: 'TabularSection', name: 'Упаковки' }).success,
      true
    );
    assert.strictEqual(
      creator.addChildElement({ ownerObjectXmlPath: xmlPath, childTag: 'TabularSection', name: 'Штрихкоды' }).success,
      true
    );

    assert.strictEqual(
      creator.addChildElement({
        ownerObjectXmlPath: xmlPath,
        childTag: 'Column',
        tabularSectionName: 'Упаковки',
        name: 'Наименование',
      }).success,
      true
    );

    // Колонка с ТЕМ ЖЕ именем в ДРУГОЙ табличной части — это отдельный, валидный элемент.
    const secondResult = creator.addChildElement({
      ownerObjectXmlPath: xmlPath,
      childTag: 'Column',
      tabularSectionName: 'Штрихкоды',
      name: 'Наименование',
    });
    assert.strictEqual(
      secondResult.success,
      true,
      `колонка "Наименование" в "Штрихкоды" должна была добавиться независимо от одноимённой в "Упаковки": ${JSON.stringify(secondResult)}`
    );

    const xml = fs.readFileSync(xmlPath, 'utf-8');
    const tabularSections = [...xml.matchAll(/<TabularSection uuid="[^"]*">[\s\S]*?<\/TabularSection>/g)]
      .map((match) => match[0]);
    assert.strictEqual(tabularSections.length, 2, 'ожидались ровно две табличные части');

    const upakovkiBlock = tabularSections.find((block) => block.includes('<Name>Упаковки</Name>')) ?? '';
    const shtrihkodyBlock = tabularSections.find((block) => block.includes('<Name>Штрихкоды</Name>')) ?? '';

    const upakovkiColumns = [...upakovkiBlock.matchAll(/<Attribute uuid="[^"]*">[\s\S]*?<Name>([^<]+)<\/Name>/g)].map((m) => m[1]);
    const shtrihkodyColumns = [...shtrihkodyBlock.matchAll(/<Attribute uuid="[^"]*">[\s\S]*?<Name>([^<]+)<\/Name>/g)].map((m) => m[1]);

    assert.deepStrictEqual(upakovkiColumns, ['Наименование'], 'ТЧ "Упаковки" должна содержать свою колонку');
    assert.deepStrictEqual(shtrihkodyColumns, ['Наименование'], 'ТЧ "Штрихкоды" должна получить свою собственную колонку');
  });
});
