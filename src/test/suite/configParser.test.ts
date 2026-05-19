import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigXmlReader } from '../../infra/xml/ConfigXmlReader';
import { ObjectXmlReader } from '../../infra/xml/ObjectXmlReader';

const EXAMPLE_CFE = path.resolve(__dirname, '../../../example/src/cfe/EVOLC');
const EXAMPLE_CF = path.resolve(__dirname, '../../../example/src/cf');
const configReader = new ConfigXmlReader();
const objectReader = new ObjectXmlReader();

suite('ConfigParser — Configuration.xml', () => {
  test('Парсит имя и namePrefix расширения EVOLC', () => {
    const info = configReader.read(path.join(EXAMPLE_CFE, 'Configuration.xml'));
    assert.strictEqual(info.name, 'EVOLC');
    assert.strictEqual(info.kind, 'cfe');
    assert.strictEqual(info.namePrefix, 'ев_');
  });

  test('Парсит имя и версию основной конфигурации', () => {
    const info = configReader.read(path.join(EXAMPLE_CF, 'Configuration.xml'));
    assert.strictEqual(info.kind, 'cf');
    assert.ok(info.name.length > 0, 'Имя конфигурации пустое');
    assert.ok(info.version.length > 0, 'Версия конфигурации пустая');
  });

  test('ChildObjects расширения содержит Документ ев_Заказ', () => {
    const info = configReader.read(path.join(EXAMPLE_CFE, 'Configuration.xml'));
    const docs = info.childObjects.get('Document') ?? [];
    assert.ok(docs.includes('ев_Заказ'), `ев_Заказ не найден в Document: ${docs.join(', ')}`);
  });

  test('ChildObjects расширения содержит заимствованный Справочник Контрагенты', () => {
    const info = configReader.read(path.join(EXAMPLE_CFE, 'Configuration.xml'));
    const cats = info.childObjects.get('Catalog') ?? [];
    assert.ok(cats.includes('Контрагенты'), `Контрагенты не найдены в Catalog: ${cats.join(', ')}`);
  });
});

suite('ConfigParser — объекты метаданных', () => {
  test('Парсит реквизиты документа ев_Заказ', () => {
    const xmlPath = path.join(EXAMPLE_CFE, 'Documents', 'ев_Заказ.xml');
    const info = objectReader.read(xmlPath);
    assert.ok(info, 'ObjectInfo не получен');
    assert.strictEqual(info.tag, 'Document');
    assert.strictEqual(info.name, 'ев_Заказ');
    const attrs = info.children.filter((c) => c.tag === 'Attribute');
    assert.ok(attrs.length > 0, 'Реквизиты не найдены');
  });

  test('Парсит формы документа ев_Заказ', () => {
    const xmlPath = path.join(EXAMPLE_CFE, 'Documents', 'ев_Заказ.xml');
    const info = objectReader.read(xmlPath);
    assert.ok(info);
    const forms = info.children.filter((c) => c.tag === 'Form');
    assert.ok(forms.length >= 2, `Ожидалось минимум 2 формы, найдено ${String(forms.length)}`);
    assert.ok(forms.some((f) => f.name === 'ФормаЗаказа'), 'Форма ФормаЗаказа не найдена');
  });

  test('Парсит значения перечисления ев_ВидыРолейУчастников', () => {
    const xmlPath = path.join(EXAMPLE_CFE, 'Enums', 'ев_ВидыРолейУчастников.xml');
    const info = objectReader.read(xmlPath);
    assert.ok(info);
    const values = info.children.filter((c) => c.tag === 'EnumValue');
    assert.ok(values.length > 0, 'Значения перечисления не найдены');
    assert.ok(values.some((v) => v.name === 'Автор'), 'Значение Автор не найдено');
  });

  test('Парсит измерения и ресурсы регистра ев_УчастникиЗаказа', () => {
    const xmlPath = path.join(EXAMPLE_CFE, 'InformationRegisters', 'ев_УчастникиЗаказа.xml');
    const info = objectReader.read(xmlPath);
    assert.ok(info);
    assert.strictEqual(info.tag, 'InformationRegister');
    const dims = info.children.filter((c) => c.tag === 'Dimension');
    const res = info.children.filter((c) => c.tag === 'Resource');
    assert.ok(dims.length > 0, 'Измерения не найдены');
    assert.ok(res.length > 0, 'Ресурсы не найдены');
  });

  test('Добавляет стандартные реквизиты, если у корневого объекта нет Properties', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-object-reader-'));
    const xmlPath = path.join(dir, 'Catalog.xml');
    fs.writeFileSync(
      xmlPath,
      '<MetaDataObject><Catalog></Catalog></MetaDataObject>',
      'utf-8'
    );

    const info = objectReader.read(xmlPath);
    assert.ok(info);
    const standard = info.children.filter((child) => child.tag === 'StandardAttribute');
    assert.ok(standard.some((child) => child.name === 'Code'));
    assert.ok(standard.some((child) => child.presentation === 'Наименование'));
  });
});
