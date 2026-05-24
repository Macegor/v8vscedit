import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigurationScaffoldService, FormToolsService, MetadataXmlCreator } from '../../infra/xml';

suite('FormToolsService', () => {
  test('добавляет, анализирует, валидирует и удаляет форму объекта', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-form-'));
    new ConfigurationScaffoldService().createConfiguration({ name: 'Тест', outputDir: root });
    const creator = new MetadataXmlCreator();
    const addCatalog = creator.addRootObject({ configRoot: root, kind: 'Catalog', name: 'Товары' });
    assert.strictEqual(addCatalog.success, true);

    const objectPath = path.join(root, 'Catalogs', 'Товары.xml');
    const service = new FormToolsService();
    const added = service.addForm({
      objectPath,
      formName: 'ФормаЭлемента',
      purpose: 'Object',
      synonym: 'Форма элемента',
      setDefault: true,
    });

    const formXml = path.join(root, 'Catalogs', 'Товары', 'Forms', 'ФормаЭлемента', 'Ext', 'Form.xml');
    assert.ok(added.changedFiles.includes(formXml));
    assert.ok(fs.readFileSync(objectPath, 'utf-8').includes('<Form>ФормаЭлемента</Form>'));
    assert.ok(fs.readFileSync(objectPath, 'utf-8').includes('<DefaultObjectForm>Catalog.Товары.Form.ФормаЭлемента</DefaultObjectForm>'));

    const info = service.info({ formPath: formXml });
    assert.ok(info.attributes.some((attr) => attr.name === 'Объект' && attr.main));

    const validation = service.validate({ formPath: formXml, detailed: true });
    assert.strictEqual(validation.errors, 0);

    const removed = service.removeForm({ objectPath, formName: 'ФормаЭлемента' });
    assert.ok(removed.changedFiles.includes(objectPath));
    assert.ok(!fs.existsSync(path.join(root, 'Catalogs', 'Товары', 'Forms', 'ФормаЭлемента.xml')));
    assert.ok(!fs.readFileSync(objectPath, 'utf-8').includes('<Form>ФормаЭлемента</Form>'));
  });

  test('компилирует DSL формы и редактирует существующую форму', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-form-dsl-'));
    const formPath = path.join(root, 'Форма', 'Ext', 'Form.xml');
    const service = new FormToolsService();

    service.compile({
      outputPath: formPath,
      definition: {
        title: 'Загрузка из файла',
        events: { OnCreateAtServer: 'ПриСозданииНаСервере' },
        attributes: [
          { name: 'ИмяФайла', type: 'string(260)' },
          { name: 'ЗагружатьПервуюСтроку', type: 'boolean' },
        ],
        commands: [
          { name: 'Загрузить', action: 'ЗагрузитьОбработка' },
        ],
        elements: [
          { group: 'horizontal', name: 'ГруппаФайл', children: [
            { input: 'ИмяФайла', path: 'ИмяФайла', title: 'Файл', on: ['StartChoice'] },
            { check: 'ЗагружатьПервуюСтроку', path: 'ЗагружатьПервуюСтроку' },
          ] },
          { button: 'Загрузить', command: 'Загрузить', title: 'Загрузить' },
        ],
      },
    });

    service.edit({
      formPath,
      definition: {
        attributes: [{ name: 'Комментарий', type: 'string(200)' }],
        elements: [{ input: 'Комментарий', path: 'Комментарий', title: 'Комментарий' }],
        commands: [{ name: 'Очистить', action: 'ОчиститьОбработка' }],
      },
    });

    const info = service.info({ formPath, limit: 1000 });
    assert.ok(info.elements.some((el) => el.name === 'Комментарий'));
    assert.ok(info.commands.some((cmd) => cmd.name === 'Очистить'));

    const validation = service.validate({ formPath });
    assert.strictEqual(validation.errors, 0);
  });

  test('компилирует расширенный DSL: radio, autoCmdBar, table с колонками, properties', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-form-rich-'));
    const formPath = path.join(root, 'Форма', 'Ext', 'Form.xml');
    const service = new FormToolsService();

    service.compile({
      outputPath: formPath,
      definition: {
        title: 'Сложная форма',
        properties: { windowOpeningMode: 'LockOwnerWindow', width: 60 },
        events: { OnCreateAtServer: 'ПриСозданииНаСервере' },
        excludedCommands: ['Print'],
        attributes: [
          { name: 'Объект', type: 'DataProcessorObject.Тест', main: true },
          { name: 'СпособКурса', type: 'string(50)' },
          { name: 'Таблица', type: 'ValueTable', columns: [
            { name: 'Дата', type: 'date' },
            { name: 'Сумма', type: 'decimal(15,2)' },
          ] },
        ],
        commands: [
          { name: 'Загрузить', action: 'ЗагрузитьОбработка', shortcut: 'Ctrl+L' },
        ],
        elements: [
          { autoCmdBar: 'ФормаКоманднаяПанель', children: [
            { button: 'Загрузить', command: 'Загрузить', defaultButton: true },
          ] },
          { radio: 'СпособКурса', path: 'СпособКурса', radioButtonType: 'RadioButtons', columnsCount: 2, choiceList: [
            { value: true, presentation: 'Авто' },
            { value: false, presentation: { ru: 'Вручную', en: 'Manual' } },
          ] },
          { table: 'Таблица', path: 'Таблица', changeRowSet: true, columns: [
            { input: 'Дата', path: 'Таблица.Дата' },
            { input: 'Сумма', path: 'Таблица.Сумма' },
          ] },
        ],
      },
    });

    const xml = fs.readFileSync(formPath, 'utf-8');

    // autoCmdBar: главная панель должна получить ChildItems с кнопкой
    assert.match(xml, /<AutoCommandBar name="ФормаКоманднаяПанель" id="-1">[\s\S]*?<ChildItems>[\s\S]*?<Button[^>]*name="Загрузить"/);
    // radio: тип элемента, ChoiceList, ColumnsCount
    assert.match(xml, /<RadioButtonField[^>]*name="СпособКурса"[^>]*>/);
    assert.match(xml, /<ColumnsCount>2<\/ColumnsCount>/);
    assert.match(xml, /<RadioButtonType>RadioButtons<\/RadioButtonType>/);
    assert.match(xml, /<ChoiceList>/);
    // table: ChangeRowSet, AutoCommandBar внутри Table, колонки как InputField
    assert.match(xml, /<Table[^>]*name="Таблица"[\s\S]*?<ChangeRowSet>true<\/ChangeRowSet>/);
    assert.match(xml, /<AutoCommandBar name="ТаблицаКоманднаяПанель"/);
    // properties: WindowOpeningMode, Width, AutoTitle=false (по умолчанию при title)
    assert.match(xml, /<AutoTitle>false<\/AutoTitle>/);
    assert.match(xml, /<WindowOpeningMode>LockOwnerWindow<\/WindowOpeningMode>/);
    assert.match(xml, /<Width>60<\/Width>/);
    // excludedCommands: должны попасть в <CommandSet>
    assert.match(xml, /<CommandSet>[\s\S]*?<ExcludedCommand>Print<\/ExcludedCommand>/);
    // command получил Title (auto-generated из имени) + Shortcut
    assert.match(xml, /<Command name="Загрузить"[\s\S]*?<Title>[\s\S]*?<Shortcut>Ctrl\+L<\/Shortcut>/);
    // Тип атрибута Таблица — ValueTable с колонками
    assert.match(xml, /<v8:Type>v8:ValueTable<\/v8:Type>/);
    assert.match(xml, /<Column name="Дата"/);

    // info должен распознать иерархию и доп. сведения
    const info = service.info({ formPath, limit: 1000 });
    assert.ok(info.lines.some((l) => l.includes('[Radio]')), 'tree должен содержать [Radio]');
    assert.ok(info.lines.some((l) => l.includes('Properties:')), 'должны быть Properties:');
    assert.ok(info.lines.some((l) => l.includes('AutoCommandBar')), 'должен быть AutoCommandBar в отчёте');
    assert.ok(info.lines.some((l) => l.includes('Дата: date') || l.includes('Дата:date')), 'колонки ValueTable должны рендериться');

    // validate должен пройти без ошибок
    const validation = service.validate({ formPath, detailed: true });
    assert.strictEqual(validation.errors, 0, `validate должен пройти: ${validation.lines.join('\n')}`);
  });

  test('edit поддерживает after: вставляет элемент после named element', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-form-edit-after-'));
    const formPath = path.join(root, 'Форма', 'Ext', 'Form.xml');
    const service = new FormToolsService();
    service.compile({
      outputPath: formPath,
      definition: {
        elements: [
          { input: 'Поле1', path: 'Поле1' },
          { input: 'Поле2', path: 'Поле2' },
          { input: 'Поле3', path: 'Поле3' },
        ],
        attributes: [
          { name: 'Поле1', type: 'string' },
          { name: 'Поле2', type: 'string' },
          { name: 'Поле3', type: 'string' },
          { name: 'Вставка', type: 'string' },
        ],
      },
    });

    service.edit({
      formPath,
      definition: {
        after: 'Поле1',
        elements: [{ input: 'Вставка', path: 'Вставка' }],
      },
    });

    const xml = fs.readFileSync(formPath, 'utf-8');
    const idxField1 = xml.indexOf('name="Поле1"');
    const idxInsert = xml.indexOf('name="Вставка"');
    const idxField2 = xml.indexOf('name="Поле2"');
    assert.ok(idxField1 > 0 && idxInsert > 0 && idxField2 > 0, 'все элементы должны быть в XML');
    assert.ok(idxField1 < idxInsert, 'Вставка должна быть после Поле1');
    assert.ok(idxInsert < idxField2, 'Вставка должна быть до Поле2');
  });

  test('принимает синонимы Purpose: ItemForm, Element, ФормаЭлемента → Object', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-form-syn-'));
    new ConfigurationScaffoldService().createConfiguration({ name: 'Тест', outputDir: root });
    new MetadataXmlCreator().addRootObject({ configRoot: root, kind: 'Catalog', name: 'Товары' });
    const objectPath = path.join(root, 'Catalogs', 'Товары.xml');
    const service = new FormToolsService();
    // Все три варианта должны разрешиться в Object и создаться без ошибок
    service.addForm({ objectPath, formName: 'A1', purpose: 'ItemForm' });
    service.addForm({ objectPath, formName: 'A2', purpose: 'Element' });
    service.addForm({ objectPath, formName: 'A3', purpose: 'ФормаЭлемента' });
    service.addForm({ objectPath, formName: 'A4', purpose: 'ObjectForm' });
    service.addForm({ objectPath, formName: 'A5', purpose: 'Folder' });
    assert.ok(fs.existsSync(path.join(root, 'Catalogs', 'Товары', 'Forms', 'A1.xml')));
    assert.ok(fs.existsSync(path.join(root, 'Catalogs', 'Товары', 'Forms', 'A5.xml')));
    // Невалидный — должен бросить понятную ошибку
    assert.throws(() => service.addForm({ objectPath, formName: 'BAD', purpose: 'WTF' }), /Недопустимое назначение/);
  });

  test('autoFill заполняет форму элементами по метаданным справочника', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-form-auto-'));
    new ConfigurationScaffoldService().createConfiguration({ name: 'Тест', outputDir: root });
    const creator = new MetadataXmlCreator();
    creator.addRootObject({ configRoot: root, kind: 'Catalog', name: 'Контрагенты' });
    const objectPath = path.join(root, 'Catalogs', 'Контрагенты.xml');
    // Добавим реквизит ИНН для проверки авто-наполнения
    creator.addChildElement({
      ownerObjectXmlPath: objectPath,
      childTag: 'Attribute',
      name: 'ИНН',
    });

    const service = new FormToolsService();
    service.addForm({ objectPath, formName: 'ФормаЭлемента', purpose: 'Object' });

    const formXml = fs.readFileSync(path.join(root, 'Catalogs', 'Контрагенты', 'Forms', 'ФормаЭлемента', 'Ext', 'Form.xml'), 'utf-8');
    // Должно быть наполнение: Наименование + Код (по умолчанию у Catalog есть оба) + Объект.ИНН
    assert.match(formXml, /<DataPath>Объект\.Description<\/DataPath>/);
    assert.match(formXml, /<DataPath>Объект\.Code<\/DataPath>/);
    assert.match(formXml, /<DataPath>Объект\.ИНН<\/DataPath>/);
    // Должен быть основной реквизит
    assert.match(formXml, /<MainAttribute>true<\/MainAttribute>/);
  });

  test('autoFill для списка справочника создаёт DynamicList + колонки', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-form-list-'));
    new ConfigurationScaffoldService().createConfiguration({ name: 'Тест', outputDir: root });
    new MetadataXmlCreator().addRootObject({ configRoot: root, kind: 'Catalog', name: 'Товары' });
    const objectPath = path.join(root, 'Catalogs', 'Товары.xml');
    const service = new FormToolsService();
    service.addForm({ objectPath, formName: 'ФормаСписка', purpose: 'ФормаСписка' });
    const formXml = fs.readFileSync(path.join(root, 'Catalogs', 'Товары', 'Forms', 'ФормаСписка', 'Ext', 'Form.xml'), 'utf-8');
    assert.match(formXml, /<v8:Type>cfg:DynamicList<\/v8:Type>/);
    assert.match(formXml, /<MainTable>Catalog\.Товары<\/MainTable>/);
    assert.match(formXml, /<DataPath>Список\.Description<\/DataPath>/);
    assert.match(formXml, /<Table[^>]*name="Список"/);
  });

  test('autoFill=false оставляет пустой каркас (только основной реквизит)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-form-empty-'));
    new ConfigurationScaffoldService().createConfiguration({ name: 'Тест', outputDir: root });
    new MetadataXmlCreator().addRootObject({ configRoot: root, kind: 'Catalog', name: 'Товары' });
    const objectPath = path.join(root, 'Catalogs', 'Товары.xml');
    const service = new FormToolsService();
    service.addForm({ objectPath, formName: 'Ф1', purpose: 'Object', autoFill: false });
    const formXml = fs.readFileSync(path.join(root, 'Catalogs', 'Товары', 'Forms', 'Ф1', 'Ext', 'Form.xml'), 'utf-8');
    // Только основной реквизит, никаких полей по данным объекта
    assert.doesNotMatch(formXml, /<DataPath>Объект\.Description<\/DataPath>/);
    assert.doesNotMatch(formXml, /<DataPath>Объект\.Code<\/DataPath>/);
    assert.match(formXml, /<MainAttribute>true<\/MainAttribute>/);
  });

  test('добавляет форму внешней обработки тем же механизмом', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-epf-form-'));
    const externalXml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" xmlns:v8="http://v8.1c.ru/8.1/data/core" xmlns:app="http://v8.1c.ru/8.2/managed-application/core" version="2.17">',
      '\t<ExternalDataProcessor uuid="11111111-1111-1111-1111-111111111111">',
      '\t\t<Properties>',
      '\t\t\t<Name>Внешняя</Name>',
      '\t\t\t<DefaultForm/>',
      '\t\t</Properties>',
      '\t\t<ChildObjects/>',
      '\t</ExternalDataProcessor>',
      '</MetaDataObject>',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(root, 'Внешняя.xml'), externalXml, 'utf-8');

    const result = new FormToolsService().addForm({
      objectPath: path.join(root, 'Внешняя.xml'),
      formName: 'Форма',
      purpose: 'Object',
      setDefault: true,
    });

    assert.ok(result.changedFiles.some((file) => file.endsWith(path.join('Внешняя', 'Forms', 'Форма.xml'))));
    assert.ok(fs.readFileSync(path.join(root, 'Внешняя.xml'), 'utf-8').includes('ExternalDataProcessor.Внешняя.Form.Форма'));
  });
});
