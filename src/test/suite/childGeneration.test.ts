import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getMetaFolder, type MetaKind } from '../../domain/MetaTypes';
import { MetadataXmlCreator } from '../../infra/xml/MetadataXmlCreator';
import { MetadataXmlRemover } from '../../infra/xml/MetadataXmlRemover';
import { ObjectXmlReader } from '../../infra/xml/ObjectXmlReader';
import { getTypedFieldPropertyKeys } from '../../infra/xml/TypedFieldPropertyRules';

/**
 * Генерация дочерних элементов под загрузку в 1С. Каждый инвариант здесь пойман
 * E2E-матрицей на реальной базе 2.20 (см. `test/e2e/generatorLifecycle.e2e.ts`)
 * и зафиксирован как быстрый unit без платформы.
 */

function makeCatalog(): { configRoot: string; ownerXml: string } {
  const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8-child-'));
  fs.writeFileSync(
    path.join(configRoot, 'Configuration.xml'),
    '<?xml version="1.0" encoding="utf-8"?>\n<MetaDataObject version="2.20">\n\t<Configuration>\n\t\t<Properties>\n\t\t\t<Name>Тест</Name>\n\t\t\t<Synonym/>\n\t\t</Properties>\n\t\t<ChildObjects/>\n\t</Configuration>\n</MetaDataObject>',
    'utf-8'
  );
  const result = new MetadataXmlCreator().addRootObject({ configRoot, kind: 'Catalog', name: 'Тест' });
  assert.strictEqual(result.success, true, result.errors.join('; '));
  return { configRoot, ownerXml: path.join(configRoot, 'Catalogs', 'Тест.xml') };
}

/** Создаёт объект произвольного вида на временной выгрузке 2.20 и возвращает путь его XML. */
function makeObject(kind: MetaKind): { configRoot: string; ownerXml: string } {
  const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8-child-'));
  fs.writeFileSync(
    path.join(configRoot, 'Configuration.xml'),
    '<?xml version="1.0" encoding="utf-8"?>\n<MetaDataObject version="2.20">\n\t<Configuration>\n\t\t<Properties>\n\t\t\t<Name>Тест</Name>\n\t\t\t<Synonym/>\n\t\t</Properties>\n\t\t<ChildObjects/>\n\t</Configuration>\n</MetaDataObject>',
    'utf-8'
  );
  const result = new MetadataXmlCreator().addRootObject({ configRoot, kind, name: 'Р' });
  assert.strictEqual(result.success, true, result.errors.join('; '));
  return { configRoot, ownerXml: path.join(configRoot, getMetaFolder(kind) ?? '', 'Р.xml') };
}

/** XML блока первого измерения/ресурса указанного тега внутри владельца. */
function firstChildBlock(ownerXml: string, tag: 'Dimension' | 'Resource'): string {
  const xml = fs.readFileSync(ownerXml, 'utf-8');
  const m = new RegExp(`<${tag} uuid=[\\s\\S]*?</${tag}>`).exec(xml);
  assert.ok(m, `блок ${tag} не найден`);
  return m[0];
}

suite('Генерация дочерних элементов — контракт формата 1С', () => {
  test('Форма: простая ссылка <Form>Имя</Form> + отдельный дескриптор Forms/Имя.xml', () => {
    const { configRoot, ownerXml } = makeCatalog();
    const r = new MetadataXmlCreator().addChildElement({ ownerObjectXmlPath: ownerXml, childTag: 'Form', name: 'ФормаЭлемента' });
    assert.strictEqual(r.success, true, r.errors.join('; '));

    const xml = fs.readFileSync(ownerXml, 'utf-8');
    assert.ok(xml.includes('<Form>ФормаЭлемента</Form>'), 'форма должна быть простой ссылкой');
    assert.ok(!xml.includes('<Form uuid='), 'внутри ChildObjects не должно быть блока <Form uuid=…>');

    const descriptor = path.join(configRoot, 'Catalogs', 'Тест', 'Forms', 'ФормаЭлемента.xml');
    assert.ok(fs.existsSync(descriptor), 'должен быть создан дескриптор Forms/Имя.xml');
    const descXml = fs.readFileSync(descriptor, 'utf-8');
    assert.ok(descXml.includes('<Form uuid='), 'дескриптор — MetaDataObject с блоком Form');
    assert.ok(descXml.includes('<FormType>Managed</FormType>'));
    assert.ok(descXml.includes('app:ApplicationUsePurpose'), 'дескриптор содержит UsePurposes');

    assert.ok(new ObjectXmlReader().read(ownerXml), 'владелец остаётся well-formed');
  });

  test('Форма: содержимое Ext/Form.xml без <Group> и без pal (иначе XDTO на 2.20)', () => {
    const { configRoot, ownerXml } = makeCatalog();
    new MetadataXmlCreator().addChildElement({ ownerObjectXmlPath: ownerXml, childTag: 'Form', name: 'Ф' });
    const content = fs.readFileSync(path.join(configRoot, 'Catalogs', 'Тест', 'Forms', 'Ф', 'Ext', 'Form.xml'), 'utf-8');
    assert.ok(content.includes('<AutoCommandBar name="ФормаКоманднаяПанель" id="-1"/>'));
    assert.ok(content.includes('<Attributes/>'));
    assert.ok(!content.includes('<Group>'), 'корневого <Group> в форме быть не должно');
    assert.ok(!content.includes('xmlns:pal='), 'префикс pal в форме 2.20 не нужен');
  });

  test('Команда: полный блок с непустой группой командного интерфейса', () => {
    const { ownerXml } = makeCatalog();
    const r = new MetadataXmlCreator().addChildElement({ ownerObjectXmlPath: ownerXml, childTag: 'Command', name: 'МояКоманда' });
    assert.strictEqual(r.success, true, r.errors.join('; '));
    const xml = fs.readFileSync(ownerXml, 'utf-8');
    assert.ok(xml.includes('<Command uuid='), 'команда — полный блок с uuid');
    assert.ok(xml.includes('<Group>FormCommandBarImportant</Group>'), 'группа должна быть непустой');
    assert.ok(xml.includes('<ParameterUseMode>Single</ParameterUseMode>'));
    assert.ok(xml.includes('<ModifiesData>false</ModifiesData>'));
    assert.ok(xml.includes('<OnMainServerUnavalableBehavior>Auto</OnMainServerUnavalableBehavior>'));
  });

  test('Колонка ТЧ: без FillFromFillingValue/FillValue', () => {
    const { ownerXml } = makeCatalog();
    const creator = new MetadataXmlCreator();
    assert.strictEqual(creator.addChildElement({ ownerObjectXmlPath: ownerXml, childTag: 'TabularSection', name: 'ТЧ' }).success, true);
    assert.strictEqual(creator.addChildElement({ ownerObjectXmlPath: ownerXml, childTag: 'Column', name: 'Кол', tabularSectionName: 'ТЧ' }).success, true);

    const xml = fs.readFileSync(ownerXml, 'utf-8');
    const ts = /<TabularSection uuid=[\s\S]*?<\/TabularSection>/.exec(xml);
    assert.ok(ts, 'блок табличной части найден');
    assert.ok(!ts[0].includes('FillFromFillingValue'), 'у колонки не должно быть FillFromFillingValue');
    assert.ok(!ts[0].includes('FillValue'), 'у колонки не должно быть FillValue');
  });

  test('getTypedFieldPropertyKeys: Column исключает свойства заполнения, Attribute — нет', () => {
    const attribute = getTypedFieldPropertyKeys('Attribute', '');
    const column = getTypedFieldPropertyKeys('Column', '');
    assert.ok(attribute.includes('FillFromFillingValue') && attribute.includes('FillValue'));
    assert.ok(!column.includes('FillFromFillingValue') && !column.includes('FillValue'));
  });

  test('getTypedFieldPropertyKeys: измерение/ресурс зависят от типа регистра', () => {
    const irDim = getTypedFieldPropertyKeys('Dimension', '', 'InformationRegister');
    const accDim = getTypedFieldPropertyKeys('Dimension', '', 'AccumulationRegister');
    const irRes = getTypedFieldPropertyKeys('Resource', '', 'InformationRegister');
    // Измерение ИР: Master/MainFilter/TypeReductionMode, без UseInTotals.
    assert.ok(irDim.includes('Master') && irDim.includes('MainFilter') && irDim.includes('TypeReductionMode'));
    assert.ok(!irDim.includes('UseInTotals'));
    // Измерение РН: UseInTotals, без Master/Fill*/DataHistory.
    assert.ok(accDim.includes('UseInTotals'));
    assert.ok(!accDim.includes('Master') && !accDim.includes('FillFromFillingValue') && !accDim.includes('DataHistory'));
    // Ресурс ИР: без Balance/AccountingFlag/UseInTotals.
    assert.ok(!irRes.includes('Balance') && !irRes.includes('AccountingFlag') && !irRes.includes('UseInTotals'));
  });

  test('РегистрСведений: измерение без UseInTotals, ресурс без Balance и QuickChoice≠Auto', () => {
    const { ownerXml } = makeObject('InformationRegister');
    const creator = new MetadataXmlCreator();
    assert.strictEqual(creator.addChildElement({ ownerObjectXmlPath: ownerXml, childTag: 'Dimension', name: 'Изм' }).success, true);
    assert.strictEqual(creator.addChildElement({ ownerObjectXmlPath: ownerXml, childTag: 'Resource', name: 'Рес' }).success, true);

    const dim = firstChildBlock(ownerXml, 'Dimension');
    assert.ok(!dim.includes('<UseInTotals>'), 'у измерения ИР не должно быть UseInTotals');
    assert.ok(dim.includes('<Master>') && dim.includes('<TypeReductionMode>'));

    const res = firstChildBlock(ownerXml, 'Resource');
    assert.ok(!res.includes('<Balance>') && !res.includes('<AccountingFlag>'), 'у ресурса ИР нет Balance/AccountingFlag');
    assert.ok(res.includes('<QuickChoice>DontUse</QuickChoice>'), 'ресурс ИР: QuickChoice=DontUse (не Auto)');
    assert.ok(res.includes('<CreateOnInput>Use</CreateOnInput>'), 'ресурс ИР: CreateOnInput=Use (не Auto)');
  });

  test('РегистрНакопления: измерение с UseInTotals и без свойств заполнения', () => {
    const { ownerXml } = makeObject('AccumulationRegister');
    assert.strictEqual(new MetadataXmlCreator().addChildElement({ ownerObjectXmlPath: ownerXml, childTag: 'Dimension', name: 'Изм' }).success, true);
    const dim = firstChildBlock(ownerXml, 'Dimension');
    assert.ok(dim.includes('<UseInTotals>'), 'у измерения РН должен быть UseInTotals');
    assert.ok(!dim.includes('<FillFromFillingValue>') && !dim.includes('<FillValue>') && !dim.includes('<DataHistory>'));
  });

  test('Remover: удаление формы стирает и дескриптор Forms/Имя.xml, и папку', () => {
    const { configRoot, ownerXml } = makeCatalog();
    new MetadataXmlCreator().addChildElement({ ownerObjectXmlPath: ownerXml, childTag: 'Form', name: 'Ф' });
    const descriptor = path.join(configRoot, 'Catalogs', 'Тест', 'Forms', 'Ф.xml');
    const formDir = path.join(configRoot, 'Catalogs', 'Тест', 'Forms', 'Ф');
    assert.ok(fs.existsSync(descriptor) && fs.existsSync(formDir));

    const r = new MetadataXmlRemover().removeChildElement({ ownerObjectXmlPath: ownerXml, childTag: 'Form', name: 'Ф' });
    assert.strictEqual(r.success, true, r.errors.join('; '));
    assert.ok(!fs.existsSync(descriptor), 'дескриптор формы удалён');
    assert.ok(!fs.existsSync(formDir), 'папка формы удалена');
    assert.ok(!fs.readFileSync(ownerXml, 'utf-8').includes('<Form>Ф</Form>'), 'ссылка на форму убрана');
  });
});
