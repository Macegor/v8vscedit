import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ExternalObjectService } from '../../infra/xml';

/**
 * Байт-в-байт характеризация ExternalObjectService ДО дробления на подфайлы
 * (src/infra/xml/external/*). Инвариант проекта: любой рефактор генератора XML
 * обязан предваряться golden-тестом, фиксирующим полный текст каждого файла,
 * а не подстроки. Эти тесты — страховочная сеть: они должны остаться зелёными
 * после дробления, иначе рефактор изменил поведение, а не только структуру кода.
 *
 * Единственный источник недетерминизма — crypto.randomUUID() внутри newUuid().
 * uuid-атрибуты содержимого не участвуют в бизнес-контракте (валидируются только
 * формой GUID_PATTERN), поэтому перед сравнением с эталоном они нормализуются
 * в плейсхолдер "<UUID>" через regex — единственная точка, где допустима
 * не-точная строка; весь остальной текст (переводы строк, отступы, BOM,
 * самозакрытие тегов) сравнивается буквально.
 */
const UUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;

function readNormalized(filePath: string): string {
  return fs.readFileSync(filePath, 'utf-8').replace(UUID_RE, '<UUID>');
}

suite('ExternalObjectService — байт-golden характеризация (предусловие дробления на infra/xml/external/*)', () => {
  test('createExternalDataProcessor: полный байтовый эталон XML объекта и ObjectModule.bsl', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-golden-epf-'));
    const service = new ExternalObjectService();
    service.createExternalDataProcessor({ name: 'ТестоваяОбработка', synonym: 'Тестовая обработка', outputDir: root });

    const objectXml = path.join(root, 'ТестоваяОбработка.xml');
    const modulePath = path.join(root, 'ТестоваяОбработка', 'Ext', 'ObjectModule.bsl');

    const expectedObjectXml = '﻿<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" xmlns:app="http://v8.1c.ru/8.2/managed-application/core" xmlns:cfg="http://v8.1c.ru/8.1/data/enterprise/current-config" xmlns:cmi="http://v8.1c.ru/8.2/managed-application/cmi" xmlns:ent="http://v8.1c.ru/8.1/data/enterprise" xmlns:lf="http://v8.1c.ru/8.2/managed-application/logform" xmlns:style="http://v8.1c.ru/8.1/data/ui/style" xmlns:sys="http://v8.1c.ru/8.1/data/ui/fonts/system" xmlns:v8="http://v8.1c.ru/8.1/data/core" xmlns:v8ui="http://v8.1c.ru/8.1/data/ui" xmlns:web="http://v8.1c.ru/8.1/data/ui/colors/web" xmlns:win="http://v8.1c.ru/8.1/data/ui/colors/windows" xmlns:xen="http://v8.1c.ru/8.3/xcf/enums" xmlns:xpr="http://v8.1c.ru/8.3/xcf/predef" xmlns:xr="http://v8.1c.ru/8.3/xcf/readable" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" version="2.17">\n'
      + '\t<ExternalDataProcessor uuid="<UUID>">\n'
      + '\t\t<InternalInfo>\n'
      + '\t\t\t<xr:ContainedObject>\n'
      + '\t\t\t\t<xr:ClassId><UUID></xr:ClassId>\n'
      + '\t\t\t\t<xr:ObjectId><UUID></xr:ObjectId>\n'
      + '\t\t\t</xr:ContainedObject>\n'
      + '\t\t\t<xr:GeneratedType name="ExternalDataProcessorObject.ТестоваяОбработка" category="Object">\n'
      + '\t\t\t\t<xr:TypeId><UUID></xr:TypeId>\n'
      + '\t\t\t\t<xr:ValueId><UUID></xr:ValueId>\n'
      + '\t\t\t</xr:GeneratedType>\n'
      + '\t\t</InternalInfo>\n'
      + '\t\t<Properties>\n'
      + '\t\t\t<Name>ТестоваяОбработка</Name>\n'
      + '\t\t\t<Synonym>\n'
      + '\t\t\t\t<v8:item>\n'
      + '\t\t\t\t\t<v8:lang>ru</v8:lang>\n'
      + '\t\t\t\t\t<v8:content>Тестовая обработка</v8:content>\n'
      + '\t\t\t\t</v8:item>\n'
      + '\t\t\t</Synonym>\n'
      + '\t\t\t<Comment/>\n'
      + '\t\t\t<DefaultForm/>\n'
      + '\t\t\t<AuxiliaryForm/>\n'
      + '\t\t</Properties>\n'
      + '\t\t<ChildObjects/>\n'
      + '\t</ExternalDataProcessor>\n'
      + '</MetaDataObject>\n';
    assert.strictEqual(readNormalized(objectXml), expectedObjectXml);

    const expectedObjectModule = '﻿#Область ОписаниеПеременных\n'
      + '\n'
      + '#КонецОбласти\n'
      + '\n'
      + '#Область ПрограммныйИнтерфейс\n'
      + '\n'
      + '#КонецОбласти\n'
      + '\n'
      + '#Область СлужебныеПроцедурыИФункции\n'
      + '\n'
      + '#КонецОбласти\n';
    assert.strictEqual(fs.readFileSync(modulePath, 'utf-8'), expectedObjectModule);
  });

  test('createExternalReport (withSkd): полный байтовый эталон XML отчёта, ObjectModule.bsl, дескриптора и тела СКД-шаблона', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-golden-erf-'));
    const service = new ExternalObjectService();
    service.createExternalReport({ name: 'ТестовыйОтчет', synonym: 'Тестовый отчет', outputDir: root, withSkd: true });

    const objectXml = path.join(root, 'ТестовыйОтчет.xml');
    const modulePath = path.join(root, 'ТестовыйОтчет', 'Ext', 'ObjectModule.bsl');
    const skdDescriptor = path.join(root, 'ТестовыйОтчет', 'Templates', 'ОсновнаяСхемаКомпоновкиДанных.xml');
    const skdBody = path.join(root, 'ТестовыйОтчет', 'Templates', 'ОсновнаяСхемаКомпоновкиДанных', 'Ext', 'Template.xml');

    const expectedObjectXml = '﻿<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" xmlns:app="http://v8.1c.ru/8.2/managed-application/core" xmlns:cfg="http://v8.1c.ru/8.1/data/enterprise/current-config" xmlns:cmi="http://v8.1c.ru/8.2/managed-application/cmi" xmlns:ent="http://v8.1c.ru/8.1/data/enterprise" xmlns:lf="http://v8.1c.ru/8.2/managed-application/logform" xmlns:style="http://v8.1c.ru/8.1/data/ui/style" xmlns:sys="http://v8.1c.ru/8.1/data/ui/fonts/system" xmlns:v8="http://v8.1c.ru/8.1/data/core" xmlns:v8ui="http://v8.1c.ru/8.1/data/ui" xmlns:web="http://v8.1c.ru/8.1/data/ui/colors/web" xmlns:win="http://v8.1c.ru/8.1/data/ui/colors/windows" xmlns:xen="http://v8.1c.ru/8.3/xcf/enums" xmlns:xpr="http://v8.1c.ru/8.3/xcf/predef" xmlns:xr="http://v8.1c.ru/8.3/xcf/readable" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" version="2.17">\n'
      + '\t<ExternalReport uuid="<UUID>">\n'
      + '\t\t<InternalInfo>\n'
      + '\t\t\t<xr:ContainedObject>\n'
      + '\t\t\t\t<xr:ClassId><UUID></xr:ClassId>\n'
      + '\t\t\t\t<xr:ObjectId><UUID></xr:ObjectId>\n'
      + '\t\t\t</xr:ContainedObject>\n'
      + '\t\t\t<xr:GeneratedType name="ExternalReportObject.ТестовыйОтчет" category="Object">\n'
      + '\t\t\t\t<xr:TypeId><UUID></xr:TypeId>\n'
      + '\t\t\t\t<xr:ValueId><UUID></xr:ValueId>\n'
      + '\t\t\t</xr:GeneratedType>\n'
      + '\t\t</InternalInfo>\n'
      + '\t\t<Properties>\n'
      + '\t\t\t<Name>ТестовыйОтчет</Name>\n'
      + '\t\t\t<Synonym>\n'
      + '\t\t\t\t<v8:item>\n'
      + '\t\t\t\t\t<v8:lang>ru</v8:lang>\n'
      + '\t\t\t\t\t<v8:content>Тестовый отчет</v8:content>\n'
      + '\t\t\t\t</v8:item>\n'
      + '\t\t\t</Synonym>\n'
      + '\t\t\t<Comment/>\n'
      + '\t\t\t<DefaultForm/>\n'
      + '\t\t\t<AuxiliaryForm/>\n'
      + '\t\t\t<MainDataCompositionSchema>ExternalReport.ТестовыйОтчет.Template.ОсновнаяСхемаКомпоновкиДанных</MainDataCompositionSchema>\n'
      + '\t\t\t<DefaultSettingsForm/>\n'
      + '\t\t\t<AuxiliarySettingsForm/>\n'
      + '\t\t\t<DefaultVariantForm/>\n'
      + '\t\t\t<VariantsStorage/>\n'
      + '\t\t\t<SettingsStorage/>\n'
      + '\t\t</Properties>\n'
      + '\t\t<ChildObjects>\n'
      + '\t\t\t<Template>ОсновнаяСхемаКомпоновкиДанных</Template>\n'
      + '\t\t</ChildObjects>\n'
      + '\t</ExternalReport>\n'
      + '</MetaDataObject>\n';
    assert.strictEqual(readNormalized(objectXml), expectedObjectXml);

    const expectedObjectModule = '﻿#Область ОписаниеПеременных\n'
      + '\n'
      + '#КонецОбласти\n'
      + '\n'
      + '#Область ПрограммныйИнтерфейс\n'
      + '\n'
      + '#КонецОбласти\n'
      + '\n'
      + '#Область СлужебныеПроцедурыИФункции\n'
      + '\n'
      + '#КонецОбласти\n';
    assert.strictEqual(fs.readFileSync(modulePath, 'utf-8'), expectedObjectModule);

    const expectedSkdDescriptor = '﻿<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" xmlns:app="http://v8.1c.ru/8.2/managed-application/core" xmlns:cfg="http://v8.1c.ru/8.1/data/enterprise/current-config" xmlns:cmi="http://v8.1c.ru/8.2/managed-application/cmi" xmlns:ent="http://v8.1c.ru/8.1/data/enterprise" xmlns:lf="http://v8.1c.ru/8.2/managed-application/logform" xmlns:style="http://v8.1c.ru/8.1/data/ui/style" xmlns:sys="http://v8.1c.ru/8.1/data/ui/fonts/system" xmlns:v8="http://v8.1c.ru/8.1/data/core" xmlns:v8ui="http://v8.1c.ru/8.1/data/ui" xmlns:web="http://v8.1c.ru/8.1/data/ui/colors/web" xmlns:win="http://v8.1c.ru/8.1/data/ui/colors/windows" xmlns:xen="http://v8.1c.ru/8.3/xcf/enums" xmlns:xpr="http://v8.1c.ru/8.3/xcf/predef" xmlns:xr="http://v8.1c.ru/8.3/xcf/readable" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" version="2.17">\n'
      + '\t<Template uuid="<UUID>">\n'
      + '\t\t<Properties>\n'
      + '\t\t\t<Name>ОсновнаяСхемаКомпоновкиДанных</Name>\n'
      + '\t\t\t<Synonym>\n'
      + '\t\t\t\t<v8:item>\n'
      + '\t\t\t\t\t<v8:lang>ru</v8:lang>\n'
      + '\t\t\t\t\t<v8:content>Основная схема компоновки данных</v8:content>\n'
      + '\t\t\t\t</v8:item>\n'
      + '\t\t\t</Synonym>\n'
      + '\t\t\t<Comment/>\n'
      + '\t\t\t<TemplateType>DataCompositionSchema</TemplateType>\n'
      + '\t\t</Properties>\n'
      + '\t</Template>\n'
      + '</MetaDataObject>\n';
    assert.strictEqual(readNormalized(skdDescriptor), expectedSkdDescriptor);

    const expectedSkdBody = '﻿<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<DataCompositionSchema xmlns="http://v8.1c.ru/8.1/data-composition-system/schema"\n'
      + '\t\txmlns:dcscom="http://v8.1c.ru/8.1/data-composition-system/common"\n'
      + '\t\txmlns:dcscor="http://v8.1c.ru/8.1/data-composition-system/core"\n'
      + '\t\txmlns:dcsset="http://v8.1c.ru/8.1/data-composition-system/settings"\n'
      + '\t\txmlns:v8="http://v8.1c.ru/8.1/data/core"\n'
      + '\t\txmlns:v8ui="http://v8.1c.ru/8.1/data/ui"\n'
      + '\t\txmlns:xs="http://www.w3.org/2001/XMLSchema"\n'
      + '\t\txmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n'
      + '\t<dataSource>\n'
      + '\t\t<name>ИсточникДанных1</name>\n'
      + '\t\t<dataSourceType>Local</dataSourceType>\n'
      + '\t</dataSource>\n'
      + '</DataCompositionSchema>\n';
    assert.strictEqual(fs.readFileSync(skdBody, 'utf-8'), expectedSkdBody);
  });

  test('addHelp: полный байтовый эталон Ext/Help.xml (с версией формата) и Ext/Help/ru.html', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-golden-help-'));
    const service = new ExternalObjectService();
    service.createExternalDataProcessor({ name: 'ОбработкаСпоСправкой', synonym: 'Обработка со справкой', outputDir: root });

    const objectXml = path.join(root, 'ОбработкаСпоСправкой.xml');
    service.addHelp({ objectPath: objectXml, lang: 'ru' });

    const helpXml = path.join(root, 'ОбработкаСпоСправкой', 'Ext', 'Help.xml');
    const helpHtml = path.join(root, 'ОбработкаСпоСправкой', 'Ext', 'Help', 'ru.html');

    // Версия формата справки берётся из detectFormatVersion — при отсутствии
    // родительского Configuration.xml в дереве временного каталога используется
    // дефолт "2.17" (SCAFFOLD_FORMAT_VERSION), как и в самом XML объекта.
    const expectedHelpXml = '﻿<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<Help xmlns="http://v8.1c.ru/8.3/xcf/extrnprops" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" version="2.17">\n'
      + '\t<Page>ru</Page>\n'
      + '</Help>\n';
    assert.strictEqual(fs.readFileSync(helpXml, 'utf-8'), expectedHelpXml);

    // buildHelpHtml не добавляет завершающий перевод строки — writeNewTextFile
    // только приписывает BOM, поэтому эталон обязан заканчиваться без "\n".
    const expectedHelpHtml = '﻿<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.0 Transitional//EN">\n'
      + '<html>\n'
      + '<head>\n'
      + '    <meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>\n'
      + '    <link rel="stylesheet" type="text/css" href="v8help://service_book/service_style"/>\n'
      + '</head>\n'
      + '<body>\n'
      + '    <h1>ОбработкаСпоСправкой</h1>\n'
      + '    <p>Описание.</p>\n'
      + '</body>\n'
      + '</html>';
    assert.strictEqual(fs.readFileSync(helpHtml, 'utf-8'), expectedHelpHtml);
  });

  test('initBspRegistration + addBspCommand (ПечатнаяФорма, с targets): полный байтовый эталон модуля объекта', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-golden-bsp-print-'));
    const service = new ExternalObjectService();
    service.createExternalDataProcessor({ name: 'ПечатьЗаказаGolden', outputDir: root });

    const objectXml = path.join(root, 'ПечатьЗаказаGolden.xml');
    const modulePath = path.join(root, 'ПечатьЗаказаGolden', 'Ext', 'ObjectModule.bsl');

    service.initBspRegistration({
      objectPath: objectXml,
      kind: 'ПечатнаяФорма',
      targets: ['Документ.ЗаказПокупателя'],
    });
    service.addBspCommand({
      objectPath: objectXml,
      identifier: 'ПечатьСводки',
      presentation: 'Печать сводки',
    });

    // Репрезентативный вид с targets: регистрация добавляет назначение и печатный
    // обработчик-заглушку (buildPrintProcedureStub), addBspCommand — второй пункт
    // меню и печатную ветку (ensurePrintHandler/buildPrintBranch).
    const expected = '﻿#Область ОписаниеПеременных\n'
      + '\n'
      + '#КонецОбласти\n'
      + '\n'
      + '#Область ПрограммныйИнтерфейс\n'
      + '\n'
      + 'Функция СведенияОВнешнейОбработке() Экспорт\n'
      + '\n'
      + '\tМетаданныеОбработки = Метаданные();\n'
      + '\n'
      + '\tПараметрыРегистрации = ДополнительныеОтчетыИОбработки.СведенияОВнешнейОбработке("2.2.2.1");\n'
      + '\tПараметрыРегистрации.Вид    = ДополнительныеОтчетыИОбработкиКлиентСервер.ВидОбработкиПечатнаяФорма();\n'
      + '\tПараметрыРегистрации.Версия = "1.0";\n'
      + '\n'
      + '\tПараметрыРегистрации.Назначение.Добавить("Документ.ЗаказПокупателя");\n'
      + '\n'
      + '\tНоваяКоманда = ПараметрыРегистрации.Команды.Добавить();\n'
      + '\tНоваяКоманда.Представление        = МетаданныеОбработки.Представление();\n'
      + '\tНоваяКоманда.Идентификатор        = МетаданныеОбработки.Имя;\n'
      + '\tНоваяКоманда.Использование        = ДополнительныеОтчетыИОбработкиКлиентСервер.ТипКомандыВызовСерверногоМетода();\n'
      + '\tНоваяКоманда.ПоказыватьОповещение = Ложь;\n'
      + '\tНоваяКоманда.Модификатор = "ПечатьMXL";\n'
      + '\tНоваяКоманда = ПараметрыРегистрации.Команды.Добавить();\n'
      + '\tНоваяКоманда.Представление        = НСтр("ru = \'Печать сводки\'");\n'
      + '\tНоваяКоманда.Идентификатор        = "ПечатьСводки";\n'
      + '\tНоваяКоманда.Использование        = ДополнительныеОтчетыИОбработкиКлиентСервер.ТипКомандыВызовСерверногоМетода();\n'
      + '\tНоваяКоманда.ПоказыватьОповещение = Ложь;\n'
      + '\tНоваяКоманда.Модификатор = "ПечатьMXL";\n'
      + '\n'
      + '\n'
      + '\tВозврат ПараметрыРегистрации;\n'
      + '\n'
      + 'КонецФункции\n'
      + '\n'
      + 'Процедура Печать(МассивОбъектов, КоллекцияПечатныхФорм, ОбъектыПечати, ПараметрыВывода) Экспорт\n'
      + '\n'
      + '\t// TODO: Реализация\n'
      + '\n'
      + '\tПечатнаяФорма = УправлениеПечатью.СведенияОПечатнойФорме(КоллекцияПечатныхФорм, "ПечатьСводки");\n'
      + '\tЕсли ПечатнаяФорма <> Неопределено Тогда\n'
      + '\t\tПечатнаяФорма.ТабличныйДокумент = СформироватьПечатьСводки(МассивОбъектов, ОбъектыПечати);\n'
      + '\t\tПечатнаяФорма.СинонимМакета = НСтр("ru = \'Печать сводки\'");\n'
      + '\tКонецЕсли;\n'
      + '\n'
      + 'КонецПроцедуры\n'
      + '\n'
      + '#КонецОбласти\n'
      + '\n'
      + '#Область СлужебныеПроцедурыИФункции\n'
      + '\n'
      + '#КонецОбласти\n';
    assert.strictEqual(fs.readFileSync(modulePath, 'utf-8'), expected);
  });

  test('initBspRegistration + addBspCommand (ДополнительнаяОбработка, без targets): полный байтовый эталон модуля объекта', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-golden-bsp-noargs-'));
    const service = new ExternalObjectService();
    service.createExternalDataProcessor({ name: 'ДопОбработкаGolden', outputDir: root });

    const objectXml = path.join(root, 'ДопОбработкаGolden.xml');
    const modulePath = path.join(root, 'ДопОбработкаGolden', 'Ext', 'ObjectModule.bsl');

    service.initBspRegistration({ objectPath: objectXml, kind: 'ДополнительнаяОбработка' });
    service.addBspCommand({
      objectPath: objectXml,
      identifier: 'ВыполнитьОбработку',
      presentation: 'Выполнить обработку',
      commandType: 'ВызовСерверногоМетода',
    });

    // Репрезентативный вид без targets (ДополнительнаяОбработка не требует
    // назначения) — регистрация не содержит блока "Назначение.Добавить", а
    // серверная команда вставляется через ensureServerCommandHandler в новую
    // процедуру ВыполнитьКоманду с двумя аргументами (нецелевой вид).
    const expected = '﻿#Область ОписаниеПеременных\n'
      + '\n'
      + '#КонецОбласти\n'
      + '\n'
      + '#Область ПрограммныйИнтерфейс\n'
      + '\n'
      + 'Функция СведенияОВнешнейОбработке() Экспорт\n'
      + '\n'
      + '\tМетаданныеОбработки = Метаданные();\n'
      + '\n'
      + '\tПараметрыРегистрации = ДополнительныеОтчетыИОбработки.СведенияОВнешнейОбработке("2.2.2.1");\n'
      + '\tПараметрыРегистрации.Вид    = ДополнительныеОтчетыИОбработкиКлиентСервер.ВидОбработкиДополнительнаяОбработка();\n'
      + '\tПараметрыРегистрации.Версия = "1.0";\n'
      + '\n'
      + '\tНоваяКоманда = ПараметрыРегистрации.Команды.Добавить();\n'
      + '\tНоваяКоманда.Представление        = МетаданныеОбработки.Представление();\n'
      + '\tНоваяКоманда.Идентификатор        = МетаданныеОбработки.Имя;\n'
      + '\tНоваяКоманда.Использование        = ДополнительныеОтчетыИОбработкиКлиентСервер.ТипКомандыОткрытиеФормы();\n'
      + '\tНоваяКоманда.ПоказыватьОповещение = Ложь;\n'
      + '\tНоваяКоманда = ПараметрыРегистрации.Команды.Добавить();\n'
      + '\tНоваяКоманда.Представление        = НСтр("ru = \'Выполнить обработку\'");\n'
      + '\tНоваяКоманда.Идентификатор        = "ВыполнитьОбработку";\n'
      + '\tНоваяКоманда.Использование        = ДополнительныеОтчетыИОбработкиКлиентСервер.ТипКомандыВызовСерверногоМетода();\n'
      + '\tНоваяКоманда.ПоказыватьОповещение = Ложь;\n'
      + '\n'
      + '\tВозврат ПараметрыРегистрации;\n'
      + '\n'
      + 'КонецФункции\n'
      + '\n'
      + 'Процедура ВыполнитьКоманду(ИдентификаторКоманды, ПараметрыВыполненияКоманды) Экспорт\n'
      + '\n'
      + '\tЕсли ИдентификаторКоманды = "ВыполнитьОбработку" Тогда\n'
      + '\t\t// TODO: Реализация ВыполнитьОбработку\n'
      + '\tКонецЕсли;\n'
      + '\n'
      + 'КонецПроцедуры\n'
      + '\n'
      + '#КонецОбласти\n'
      + '\n'
      + '#Область СлужебныеПроцедурыИФункции\n'
      + '\n'
      + '#КонецОбласти\n';
    assert.strictEqual(fs.readFileSync(modulePath, 'utf-8'), expected);
  });
});
