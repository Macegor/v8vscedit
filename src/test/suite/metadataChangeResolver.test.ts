import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
// ВЕХА 1 «Изменения метаданных», компонент №3 плана: чистый резолвер
// «абсолютный путь файла → часть объекта метаданных». Модуль ещё не создан.
import { resolveFilePart } from '../../infra/git/MetadataChangeResolver';
import { canonicalRootPath } from '../../domain/CanonicalNames';

/**
 * Все тест-кейсы построены на РЕАЛЬНЫХ путях выгрузки из `example/2.21`.
 * `resolveFilePart` — чистая функция по СТРОКЕ пути: обращения к fs не
 * требуется (и часть кейсов ниже намеренно указывает на несуществующие
 * файлы — удалённые/ещё не выгруженные формы), поэтому фикстуры используются
 * напрямую, без копирования во временный каталог.
 */
const CF_ROOT = path.resolve(__dirname, '../../../example/2.21/src/cf');
const CFE_ROOT = path.resolve(__dirname, '../../../example/2.21/src/cfe/EVOLC');

suite('MetadataChangeResolver — resolveFilePart на реальной выгрузке', () => {
  test('плоский корневой XML свойств (Catalogs/Валюты.xml)', () => {
    const abs = path.join(CF_ROOT, 'Catalogs', 'Валюты.xml');
    assert.ok(fs.existsSync(abs), 'фикстура должна существовать');

    const result = resolveFilePart(CF_ROOT, abs);
    assert.ok(result, 'ожидался разобранный результат');
    assert.strictEqual(result.rootKind, 'Catalog');
    assert.strictEqual(result.rootName, 'Валюты');
    assert.strictEqual(result.part, 'objectProperties');
    assert.strictEqual(result.partLabel, 'Свойства');
    assert.strictEqual(result.canonicalOwnerPath, canonicalRootPath('Catalog', 'Валюты'));
  });

  test('глубокий корневой XML свойств (<Folder>/<Name>/<Name>.xml) — путь сконструирован, т.к. в фикстурах выгрузка только плоская, но резолвер обязан понимать и эту форму по строке пути', () => {
    const abs = path.join(CF_ROOT, 'Catalogs', 'ГлубокийСправочник', 'ГлубокийСправочник.xml');

    const result = resolveFilePart(CF_ROOT, abs);
    assert.ok(result, 'ожидался разобранный результат');
    assert.strictEqual(result.rootKind, 'Catalog');
    assert.strictEqual(result.rootName, 'ГлубокийСправочник');
    assert.strictEqual(result.part, 'objectProperties');
    assert.strictEqual(result.canonicalOwnerPath, canonicalRootPath('Catalog', 'ГлубокийСправочник'));
  });

  test('Ext/ObjectModule.bsl → part=module, slot=Object', () => {
    const abs = path.join(CF_ROOT, 'Catalogs', 'Валюты', 'Ext', 'ObjectModule.bsl');
    assert.ok(fs.existsSync(abs));

    const result = resolveFilePart(CF_ROOT, abs);
    assert.ok(result);
    assert.strictEqual(result.part, 'module');
    assert.strictEqual(result.slot, 'Object');
    assert.strictEqual(result.rootKind, 'Catalog');
    assert.strictEqual(result.rootName, 'Валюты');
    assert.strictEqual(result.canonicalOwnerPath, canonicalRootPath('Catalog', 'Валюты'));
  });

  test('Ext/ManagerModule.bsl → part=module, slot=Manager', () => {
    const abs = path.join(CF_ROOT, 'Catalogs', 'Валюты', 'Ext', 'ManagerModule.bsl');
    assert.ok(fs.existsSync(abs));

    const result = resolveFilePart(CF_ROOT, abs);
    assert.ok(result);
    assert.strictEqual(result.part, 'module');
    assert.strictEqual(result.slot, 'Manager');
  });

  test('Ext/RecordSetModule.bsl регистра накопления → part=module, slot=RecordSet', () => {
    const abs = path.join(CF_ROOT, 'AccumulationRegisters', 'БонусныеБаллы', 'Ext', 'RecordSetModule.bsl');
    assert.ok(fs.existsSync(abs));

    const result = resolveFilePart(CF_ROOT, abs);
    assert.ok(result);
    assert.strictEqual(result.part, 'module');
    assert.strictEqual(result.slot, 'RecordSet');
    assert.strictEqual(result.rootKind, 'AccumulationRegister');
    assert.strictEqual(result.rootName, 'БонусныеБаллы');
  });

  test('неоднозначный Ext/Module.bsl под CommonModules/ → slot=CommonModule (дизамбигуация по META_TYPES[kind].modules)', () => {
    const abs = path.join(CF_ROOT, 'CommonModules', 'GoogleПереводчик', 'Ext', 'Module.bsl');
    assert.ok(fs.existsSync(abs));

    const result = resolveFilePart(CF_ROOT, abs);
    assert.ok(result);
    assert.strictEqual(result.part, 'module');
    assert.strictEqual(result.slot, 'CommonModule');
    assert.strictEqual(result.rootKind, 'CommonModule');
    assert.strictEqual(result.rootName, 'GoogleПереводчик');
  });

  test('неоднозначный Ext/Module.bsl под HTTPServices/ → slot=Service', () => {
    const abs = path.join(CF_ROOT, 'HTTPServices', 'Chatbot', 'Ext', 'Module.bsl');
    assert.ok(fs.existsSync(abs));

    const result = resolveFilePart(CF_ROOT, abs);
    assert.ok(result);
    assert.strictEqual(result.part, 'module');
    assert.strictEqual(result.slot, 'Service');
    assert.strictEqual(result.rootKind, 'HTTPService');
    assert.strictEqual(result.rootName, 'Chatbot');
  });

  test('неоднозначный Ext/Module.bsl под WebServices/ → slot=Service', () => {
    const abs = path.join(CF_ROOT, 'WebServices', 'DMILService', 'Ext', 'Module.bsl');
    assert.ok(fs.existsSync(abs));

    const result = resolveFilePart(CF_ROOT, abs);
    assert.ok(result);
    assert.strictEqual(result.part, 'module');
    assert.strictEqual(result.slot, 'Service');
    assert.strictEqual(result.rootKind, 'WebService');
    assert.strictEqual(result.rootName, 'DMILService');
  });

  test('Ext/Form/Module.bsl под CommonForms/ → slot=CommonForm', () => {
    const abs = path.join(CF_ROOT, 'CommonForms', 'АЛКОВводРеквизитовОП', 'Ext', 'Form', 'Module.bsl');
    assert.ok(fs.existsSync(abs));

    const result = resolveFilePart(CF_ROOT, abs);
    assert.ok(result);
    assert.strictEqual(result.part, 'module');
    assert.strictEqual(result.slot, 'CommonForm');
    assert.strictEqual(result.rootKind, 'CommonForm');
    assert.strictEqual(result.rootName, 'АЛКОВводРеквизитовОП');
  });

  test('глубокая форма объекта Forms/<Имя>/Ext/Form/Module.bsl → slot=ChildForm, childName=<Имя>', () => {
    const abs = path.join(CF_ROOT, 'Catalogs', 'Контрагенты', 'Forms', 'ФормаСписка', 'Ext', 'Form', 'Module.bsl');
    assert.ok(fs.existsSync(abs));

    const result = resolveFilePart(CF_ROOT, abs);
    assert.ok(result);
    assert.strictEqual(result.part, 'module');
    assert.strictEqual(result.slot, 'ChildForm');
    assert.strictEqual(result.childName, 'ФормаСписка');
    assert.strictEqual(result.rootKind, 'Catalog');
    assert.strictEqual(result.rootName, 'Контрагенты');
    assert.strictEqual(result.canonicalOwnerPath, canonicalRootPath('Catalog', 'Контрагенты'));
  });

  test('Forms/<Имя>/Ext/Form.xml → part=form (описание формы, не модуль)', () => {
    const abs = path.join(CF_ROOT, 'Catalogs', 'Контрагенты', 'Forms', 'ФормаСписка', 'Ext', 'Form.xml');
    assert.ok(fs.existsSync(abs));

    const result = resolveFilePart(CF_ROOT, abs);
    assert.ok(result);
    assert.strictEqual(result.part, 'form');
    assert.strictEqual(result.childName, 'ФормаСписка');
    assert.strictEqual(result.rootKind, 'Catalog');
    assert.strictEqual(result.rootName, 'Контрагенты');
  });

  test('Commands/<Имя>/Ext/CommandModule.bsl → slot=ChildCommand, childName=<Имя>', () => {
    const abs = path.join(CF_ROOT, 'Catalogs', 'Контрагенты', 'Commands', 'Покупатели', 'Ext', 'CommandModule.bsl');
    assert.ok(fs.existsSync(abs));

    const result = resolveFilePart(CF_ROOT, abs);
    assert.ok(result);
    assert.strictEqual(result.part, 'module');
    assert.strictEqual(result.slot, 'ChildCommand');
    assert.strictEqual(result.childName, 'Покупатели');
  });

  test('Templates/<Имя>/Ext/Template.xml → part=template, childName=<Имя>', () => {
    const abs = path.join(CF_ROOT, 'Catalogs', 'Контрагенты', 'Templates', 'ЗагрузкаИзФайла', 'Ext', 'Template.xml');
    assert.ok(fs.existsSync(abs));

    const result = resolveFilePart(CF_ROOT, abs);
    assert.ok(result);
    assert.strictEqual(result.part, 'template');
    assert.strictEqual(result.childName, 'ЗагрузкаИзФайла');
  });

  test('Ext/Help.xml → part=help', () => {
    const abs = path.join(CF_ROOT, 'Catalogs', 'Валюты', 'Ext', 'Help.xml');
    assert.ok(fs.existsSync(abs));

    const result = resolveFilePart(CF_ROOT, abs);
    assert.ok(result);
    assert.strictEqual(result.part, 'help');
    assert.strictEqual(result.rootKind, 'Catalog');
    assert.strictEqual(result.rootName, 'Валюты');
  });

  test('удалённый файл: путь-строка на несуществующую форму разбирается корректно (без обращения к fs)', () => {
    const abs = path.join(CF_ROOT, 'Catalogs', 'Контрагенты', 'Forms', 'НесуществующаяФорма', 'Ext', 'Form', 'Module.bsl');
    assert.strictEqual(fs.existsSync(abs), false, 'файл не должен существовать — сценарий удаления');

    const result = resolveFilePart(CF_ROOT, abs);
    assert.ok(result, 'резолвер обязан разобрать путь по строке даже для удалённого файла');
    assert.strictEqual(result.part, 'module');
    assert.strictEqual(result.slot, 'ChildForm');
    assert.strictEqual(result.childName, 'НесуществующаяФорма');
    assert.strictEqual(result.rootKind, 'Catalog');
    assert.strictEqual(result.rootName, 'Контрагенты');
  });

  test('нераспознанный подпуть внутри каталога объекта → part=raw, rawRelPath заполнен', () => {
    const abs = path.join(CF_ROOT, 'Catalogs', 'Валюты', 'НеизвестнаяОбласть', 'файл.bin');

    const result = resolveFilePart(CF_ROOT, abs);
    assert.ok(result);
    assert.strictEqual(result.part, 'raw');
    assert.strictEqual(result.rootKind, 'Catalog');
    assert.strictEqual(result.rootName, 'Валюты');
    assert.ok(result.rawRelPath, 'rawRelPath должен быть заполнен');
    assert.ok(result.rawRelPath.includes('НеизвестнаяОбласть'));
    assert.ok(result.rawRelPath.includes('файл.bin'));
  });

  test('top-level Configuration.xml → null (не относится ни к одному объекту)', () => {
    const abs = path.join(CF_ROOT, 'Configuration.xml');
    assert.strictEqual(resolveFilePart(CF_ROOT, abs), null);
  });

  test('top-level ConfigDumpInfo.xml → null', () => {
    const abs = path.join(CF_ROOT, 'ConfigDumpInfo.xml');
    assert.strictEqual(resolveFilePart(CF_ROOT, abs), null);
  });

  test('файл вне configRoot (rel начинается с "..") → null', () => {
    const abs = path.resolve(CF_ROOT, '..', 'README.md');
    assert.strictEqual(resolveFilePart(CF_ROOT, abs), null);
  });

  test('нераспознанная папка верхнего уровня (не из META_TYPES.folder) → null', () => {
    const abs = path.join(CF_ROOT, 'НеизвестнаяПапка', 'Объект.xml');
    assert.strictEqual(resolveFilePart(CF_ROOT, abs), null);
  });

  test('файл сразу в известной папке выгрузки, но не «<Имя>.xml» (плоский случай, не .xml) → null', () => {
    // Ветка «parts.length === 2», отличная от корневого XML: сторонний файл
    // (не описание объекта) лежит прямо в Catalogs/, минуя каталог объекта.
    const abs = path.join(CF_ROOT, 'Catalogs', 'ПостороннийФайл.bin');
    assert.strictEqual(resolveFilePart(CF_ROOT, abs), null);
  });

  test('Forms/ без имени формы (голая папка) → part=raw', () => {
    const abs = path.join(CF_ROOT, 'Catalogs', 'Валюты', 'Forms');
    const result = resolveFilePart(CF_ROOT, abs);
    assert.ok(result);
    assert.strictEqual(result.part, 'raw');
  });

  test('Forms/<Имя>/<нераспознанный файл> → part=raw (не Ext/Form.xml и не модуль формы)', () => {
    const abs = path.join(CF_ROOT, 'Catalogs', 'Контрагенты', 'Forms', 'ФормаСписка', 'Ext', 'Template.xml');
    const result = resolveFilePart(CF_ROOT, abs);
    assert.ok(result);
    assert.strictEqual(result.part, 'raw');
    assert.ok(result.rawRelPath?.includes('ФормаСписка'));
  });

  test('Commands/ без имени команды (голая папка) → part=raw', () => {
    const abs = path.join(CF_ROOT, 'Catalogs', 'Контрагенты', 'Commands');
    const result = resolveFilePart(CF_ROOT, abs);
    assert.ok(result);
    assert.strictEqual(result.part, 'raw');
  });

  test('Commands/<Имя>/<нераспознанный файл> → part=raw (не CommandModule.bsl)', () => {
    const abs = path.join(CF_ROOT, 'Catalogs', 'Контрагенты', 'Commands', 'Покупатели', 'Ext', 'Form.xml');
    const result = resolveFilePart(CF_ROOT, abs);
    assert.ok(result);
    assert.strictEqual(result.part, 'raw');
  });

  test('Templates/ без имени макета (голая папка) → part=raw', () => {
    const abs = path.join(CF_ROOT, 'Catalogs', 'Контрагенты', 'Templates');
    const result = resolveFilePart(CF_ROOT, abs);
    assert.ok(result);
    assert.strictEqual(result.part, 'raw');
  });

  test('Templates/<Имя>/<нераспознанный файл> → part=raw (не Ext/Template.xml)', () => {
    const abs = path.join(CF_ROOT, 'Catalogs', 'Контрагенты', 'Templates', 'ЗагрузкаИзФайла', 'Ext', 'Form.xml');
    const result = resolveFilePart(CF_ROOT, abs);
    assert.ok(result);
    assert.strictEqual(result.part, 'raw');
  });

  test('Ext/<нераспознанный файл> (не Help.xml и не известный модуль) → part=raw', () => {
    const abs = path.join(CF_ROOT, 'Catalogs', 'Валюты', 'Ext', 'СлужебныйФайл.bin');
    const result = resolveFilePart(CF_ROOT, abs);
    assert.ok(result);
    assert.strictEqual(result.part, 'raw');
    assert.ok(result.rawRelPath?.includes('СлужебныйФайл.bin'));
  });

  test('неоднозначный Ext/Module.bsl под типом без META_TYPES.modules (WSReferences) → дизамбигуация не находит слот, part=raw', () => {
    // WSReference не имеет BSL-модулей вовсе (META_TYPES.WSReference.modules
    // не задан) — резолвер обязан не падать на `?? []`, а корректно не найти
    // ни одного подходящего слота среди кандидатов ['Service','CommonModule'].
    const abs = path.join(CF_ROOT, 'WSReferences', 'КакаяТоWSСсылка', 'Ext', 'Module.bsl');
    const result = resolveFilePart(CF_ROOT, abs);
    assert.ok(result);
    assert.strictEqual(result.part, 'raw');
    assert.strictEqual(result.rootKind, 'WSReference');
  });

  test('cfe-путь под src/cfe/EVOLC резолвится относительно своего configRoot', () => {
    const abs = path.join(CFE_ROOT, 'Catalogs', 'ев_РабочийПроцесс', 'Ext', 'ObjectModule.bsl');
    assert.ok(fs.existsSync(abs));

    const result = resolveFilePart(CFE_ROOT, abs);
    assert.ok(result);
    assert.strictEqual(result.part, 'module');
    assert.strictEqual(result.slot, 'Object');
    assert.strictEqual(result.rootKind, 'Catalog');
    assert.strictEqual(result.rootName, 'ев_РабочийПроцесс');
    assert.strictEqual(result.canonicalOwnerPath, canonicalRootPath('Catalog', 'ев_РабочийПроцесс'));
  });
});
