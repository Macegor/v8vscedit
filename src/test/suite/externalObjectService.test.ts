import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ExternalObjectService } from '../../infra/xml';

suite('ExternalObjectService', () => {
  test('создаёт внешнюю обработку, добавляет справку и валидирует структуру', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-epf-'));
    const service = new ExternalObjectService();

    const created = service.createExternalDataProcessor({
      name: 'ПроверкаОбработки',
      synonym: 'Проверка обработки',
      outputDir: root,
    });

    const objectXml = path.join(root, 'ПроверкаОбработки.xml');
    const objectDir = path.join(root, 'ПроверкаОбработки');
    assert.ok(fs.existsSync(objectXml));
    assert.ok(fs.existsSync(path.join(objectDir, 'Ext', 'ObjectModule.bsl')));
    assert.ok(created.changedFiles.includes(objectXml));

    const formDescriptor = path.join(objectDir, 'Forms', 'ОсновнаяФорма.xml');
    fs.mkdirSync(path.dirname(formDescriptor), { recursive: true });
    fs.writeFileSync(formDescriptor, [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" version="2.17">',
      '\t<Form uuid="11111111-1111-1111-1111-111111111111">',
      '\t\t<Properties>',
      '\t\t\t<Name>ОсновнаяФорма</Name>',
      '\t\t\t<FormType>Managed</FormType>',
      '\t\t</Properties>',
      '\t</Form>',
      '</MetaDataObject>',
      '',
    ].join('\n'), 'utf-8');

    const help = service.addHelp({ objectPath: objectXml, lang: 'ru' });
    assert.ok(help.changedFiles.includes(path.join(objectDir, 'Ext', 'Help.xml')));
    assert.ok(help.changedFiles.includes(path.join(objectDir, 'Ext', 'Help', 'ru.html')));
    assert.ok(fs.readFileSync(formDescriptor, 'utf-8').includes('<IncludeHelpInContents>false</IncludeHelpInContents>'));

    const validation = service.validate({ objectPath: objectXml, detailed: true });
    assert.strictEqual(validation.errors, 0);
    assert.strictEqual(validation.type, 'ExternalDataProcessor');
  });

  test('создаёт внешний отчёт с основной СКД и проверяет ссылки', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-erf-'));
    const service = new ExternalObjectService();

    const created = service.createExternalReport({
      name: 'ОтчётСКД',
      synonym: 'Отчёт СКД',
      outputDir: root,
      withSkd: true,
    });

    const objectXml = path.join(root, 'ОтчётСКД.xml');
    const skdDescriptor = path.join(root, 'ОтчётСКД', 'Templates', 'ОсновнаяСхемаКомпоновкиДанных.xml');
    const skdBody = path.join(root, 'ОтчётСКД', 'Templates', 'ОсновнаяСхемаКомпоновкиДанных', 'Ext', 'Template.xml');
    assert.ok(created.changedFiles.includes(skdDescriptor));
    assert.ok(fs.existsSync(skdBody));

    const validation = service.validate({ objectPath: path.join(root, 'ОтчётСКД'), detailed: true });
    assert.strictEqual(validation.errors, 0);
    assert.strictEqual(validation.type, 'ExternalReport');
    assert.ok(validation.lines.some((line) => line.includes('Cross-references')));
  });

  test('добавляет регистрацию и команды БСП в модуль объекта', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-bsp-'));
    const service = new ExternalObjectService();
    service.createExternalDataProcessor({
      name: 'ПечатьЗаказа',
      outputDir: root,
    });
    const objectXml = path.join(root, 'ПечатьЗаказа.xml');
    const modulePath = path.join(root, 'ПечатьЗаказа', 'Ext', 'ObjectModule.bsl');

    const init = service.initBspRegistration({
      objectPath: objectXml,
      kind: 'ПечатнаяФорма',
      targets: ['Документ.ЗаказПокупателя'],
    });
    assert.deepStrictEqual(init.changedFiles, [modulePath]);

    service.addBspCommand({
      objectPath: objectXml,
      identifier: 'ПечатьСводки',
      presentation: 'Печать сводки',
    });

    const moduleText = fs.readFileSync(modulePath, 'utf-8');
    assert.ok(moduleText.includes('Функция СведенияОВнешнейОбработке() Экспорт'));
    assert.ok(moduleText.includes('ПараметрыРегистрации.Назначение.Добавить("Документ.ЗаказПокупателя");'));
    assert.ok(moduleText.includes('НоваяКоманда.Идентификатор        = "ПечатьСводки";'));
    assert.ok(moduleText.includes('СформироватьПечатьСводки(МассивОбъектов, ОбъектыПечати)'));
  });
});
