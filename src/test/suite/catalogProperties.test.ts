import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { ObjectXmlReader } from '../../infra/xml/ObjectXmlReader';
import { ensureStandardAttributeXml } from '../../infra/xml/XmlUtils';
import { buildRootMetaObjectProperties } from '../../ui/views/properties/PropertyBuilder';
import type { EnumPropertyValue, LocalizedStringValue, MetadataReferenceListValue } from '../../ui/views/properties/_types';

const EXAMPLE_CFE = path.resolve(process.cwd(), 'example/src/cfe/EVOLC');
const objectReader = new ObjectXmlReader();

suite('Properties — справочник', () => {
  test('Показывает свойства справочника по разделам конфигуратора', () => {
    const xml = fs.readFileSync(path.join(EXAMPLE_CFE, 'Catalogs', 'ев_КлиентыПартнеров.xml'), 'utf-8');
    const props = buildRootMetaObjectProperties(xml, 'Catalog');

    const keys = props.map((item) => item.key);
    assert.ok(keys.includes('Hierarchical'), 'Hierarchical не найден');
    assert.ok(keys.includes('Owners'), 'Owners не найден');
    assert.ok(keys.includes('DescriptionLength'), 'DescriptionLength не найден');
    assert.ok(keys.includes('DefaultFolderForm'), 'DefaultFolderForm не найден');
    assert.ok(keys.includes('InputByString'), 'InputByString не найден');
    assert.ok(keys.includes('UseStandardCommands'), 'UseStandardCommands не найден');
    assert.ok(keys.includes('BasedOn'), 'BasedOn не найден');
    assert.ok(keys.includes('PredefinedDataUpdate'), 'PredefinedDataUpdate не найден');
    assert.ok(!keys.includes('Characteristics'), 'Characteristics не должен выводиться в свойствах справочника');

    const owners = props.find((item) => item.key === 'Owners');
    assert.ok(owners, 'Owners не найден');
    assert.strictEqual(owners.readonly, false);
    assert.strictEqual(owners.section, 'Владельцы');
    assert.strictEqual(owners.kind, 'metadataReferenceList');
    assert.deepStrictEqual((owners.value as MetadataReferenceListValue).items, [
      { canonical: 'Catalog.Контрагенты', display: 'Справочники.Контрагенты' },
    ]);

    const codeType = props.find((item) => item.key === 'CodeType');
    assert.ok(codeType, 'CodeType не найден');
    assert.strictEqual(codeType.kind, 'enum');
    assert.strictEqual((codeType.value as EnumPropertyValue).currentLabel, 'Строка');
    assert.strictEqual(codeType.section, 'Данные');

    const autonumbering = props.find((item) => item.key === 'Autonumbering');
    assert.ok(autonumbering, 'Autonumbering не найден');
    assert.strictEqual(autonumbering.section, 'Нумерация');

    const inputByString = props.find((item) => item.key === 'InputByString');
    assert.ok(inputByString, 'InputByString не найден');
    assert.strictEqual(inputByString.readonly, false);
    assert.strictEqual(inputByString.section, 'Поле ввода');
    assert.strictEqual(inputByString.kind, 'metadataReferenceList');
    assert.deepStrictEqual((inputByString.value as MetadataReferenceListValue).items, [
      {
        canonical: 'Catalog.ев_КлиентыПартнеров.StandardAttribute.Code',
        display: 'Код',
      },
      {
        canonical: 'Catalog.ев_КлиентыПартнеров.StandardAttribute.Description',
        display: 'Наименование',
      },
    ]);

    const basedOn = props.find((item) => item.key === 'BasedOn');
    assert.ok(basedOn, 'BasedOn не найден');
    assert.strictEqual(basedOn.section, 'Ввод на основании');
    assert.strictEqual(basedOn.readonly, false);
    assert.strictEqual(basedOn.kind, 'metadataReferenceList');

    const dataLockFields = props.find((item) => item.key === 'DataLockFields');
    assert.ok(dataLockFields, 'DataLockFields не найден');
    assert.strictEqual(dataLockFields.section, 'Прочее');
    assert.strictEqual(dataLockFields.readonly, false);
    assert.strictEqual(dataLockFields.kind, 'metadataReferenceList');

    const dataLockControlMode = props.find((item) => item.key === 'DataLockControlMode');
    assert.ok(dataLockControlMode, 'DataLockControlMode не найден');
    assert.strictEqual(dataLockControlMode.section, 'Служебное');

    const editType = props.find((item) => item.key === 'EditType');
    assert.ok(editType, 'EditType не найден');
    assert.strictEqual(editType.section, 'Данные');

    const fullTextSearch = props.find((item) => item.key === 'FullTextSearch');
    assert.ok(fullTextSearch, 'FullTextSearch не найден');
    assert.strictEqual(fullTextSearch.section, 'Прочее');

    const dataHistory = props.find((item) => item.key === 'DataHistory');
    assert.ok(dataHistory, 'DataHistory не найден');
    assert.strictEqual(dataHistory.section, 'Прочее');

    const objectPresentation = props.find((item) => item.key === 'ObjectPresentation');
    assert.ok(objectPresentation, 'ObjectPresentation не найден');
    assert.strictEqual(objectPresentation.kind, 'localizedString');
    assert.strictEqual(objectPresentation.title, 'Представление объекта');
    assert.strictEqual(objectPresentation.section, 'Основные');
    assert.strictEqual((objectPresentation.value as LocalizedStringValue).presentation, 'Клиент партнера');

    const listPresentation = props.find((item) => item.key === 'ListPresentation');
    assert.ok(listPresentation, 'ListPresentation не найден');
    assert.strictEqual(listPresentation.kind, 'localizedString');
    assert.strictEqual(listPresentation.title, 'Представление списка');
    assert.strictEqual(listPresentation.section, 'Основные');
    assert.strictEqual((listPresentation.value as LocalizedStringValue).presentation, 'Клиенты партнеров');
  });

  test('Показывает стандартные реквизиты корневого объекта с русскими представлениями', () => {
    const objectInfo = objectReader.read(path.join(process.cwd(), 'example/src/cf/Catalogs/ПачкаДокументовДСВ_1ПрисоединенныеФайлы.xml'));

    const standardAttributes = objectInfo?.children.filter((item) => item.tag === 'StandardAttribute') ?? [];
    assert.ok(standardAttributes.length > 0, 'Стандартные реквизиты не найдены');
    assert.deepStrictEqual(
      standardAttributes.slice(0, 3).map((item) => ({ name: item.name, presentation: item.presentation })),
      [
        { name: 'PredefinedDataName', presentation: 'Имя предопределенных данных' },
        { name: 'Predefined', presentation: 'Предопределенный' },
        { name: 'Ref', presentation: 'Ссылка' },
      ]
    );
  });

  test('Выводит стандартные реквизиты из поля ввода по строке, если блока StandardAttributes нет', () => {
    const objectInfo = objectReader.read(path.join(EXAMPLE_CFE, 'Catalogs', 'ев_КлиентыПартнеров.xml'));

    const standardAttributes = objectInfo?.children.filter((item) => item.tag === 'StandardAttribute') ?? [];
    assert.deepStrictEqual(
      standardAttributes.map((item) => ({ name: item.name, presentation: item.presentation })),
      [
        { name: 'PredefinedDataName', presentation: 'Имя предопределенных данных' },
        { name: 'Predefined', presentation: 'Предопределенный' },
        { name: 'Ref', presentation: 'Ссылка' },
        { name: 'DeletionMark', presentation: 'Пометка удаления' },
        { name: 'IsFolder', presentation: 'Это группа' },
        { name: 'Owner', presentation: 'Владелец' },
        { name: 'Parent', presentation: 'Родитель' },
        { name: 'Description', presentation: 'Наименование' },
        { name: 'Code', presentation: 'Код' },
      ]
    );
  });

  test('Материализует стандартный реквизит при открытии свойств', () => {
    const filePath = path.join(EXAMPLE_CFE, 'Catalogs', 'ев_КлиентыПартнеров.xml');
    const original = fs.readFileSync(filePath, 'utf-8');
    try {
      assert.ok(!original.includes('<StandardAttributes>'), 'Фикстура уже содержит StandardAttributes');
      const materialized = ensureStandardAttributeXml(filePath, 'Code', 'Catalog');
      assert.ok(materialized, 'XML стандартного реквизита не создан');

      const saved = fs.readFileSync(filePath, 'utf-8');
      assert.ok(saved.includes('<StandardAttributes>'));
      assert.ok(saved.includes('<xr:StandardAttribute name="Code">'));
      assert.ok(saved.includes('<xr:Indexing>Index</xr:Indexing>'));
    } finally {
      fs.writeFileSync(filePath, original, 'utf-8');
    }
  });
});
