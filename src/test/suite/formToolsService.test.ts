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
