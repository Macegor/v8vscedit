import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readDefinedTypeInnerXml, resolveConfigurationXml, stripXmlTags } from '../../infra/xml';
import { EventSubscriptionPropertyService } from '../../ui/views/properties/EventSubscriptionPropertyService';
import { parseMetadataType } from '../../ui/views/properties/MetadataTypeService';

const EXAMPLE_CF = path.resolve(__dirname, '../../../example/2.20/src/cf');
const DEFINED_TYPES_DIR = path.join(EXAMPLE_CF, 'DefinedTypes');
const CONFIG_XML_PATH = path.join(EXAMPLE_CF, 'Configuration.xml');

/**
 * A1 — EventSubscriptionPropertyService.ts:~287-407 нарушает границы слоёв:
 * `resolveConfigurationXml` (walk-up), `readDefinedTypeSourceValue` (fs.readFileSync)
 * и `stripXmlText` (regex) живут в ui/views/properties/, хотя это чистый файловый
 * доступ и текстовая утилита без vscode — место им в infra/.
 *
 * Находка при исследовании: walk-up к Configuration.xml УЖЕ вынесен в infra —
 * `resolveConfigurationXml` в src/infra/xml/PlatformTypeRegistry.ts (используется
 * TypeRegistryService.ts). EventSubscriptionPropertyService держит ВТОРУЮ, дословно
 * идентичную копию той же функции внутри себя (нарушение DRY) — фикс обязан удалить
 * дубликат и импортировать существующий infra/xml.resolveConfigurationXml, а НЕ
 * создавать новый.
 *
 * Настоящий тест фиксирует: (1) резолв Configuration.xml walk-up'ом от вложенного
 * пути реального объекта в example/2.20/src/cf; (2) чтение DefinedType inner-Type
 * через новую infra-функцию readDefinedTypeInnerXml; (3) защиту от циклов
 * DefinedType (self-ref не должен уйти в бесконечную рекурсию); (4) stripXmlTags
 * как канонический хелпер в infra/xml/XmlUtils (переименован из приватного
 * stripXmlText внутри EventSubscriptionPropertyService).
 */
suite('infra/xml — вынос чтения источников EventSubscription (A1)', () => {
  test('resolveConfigurationXml поднимается от вложенного XML-пути реального объекта к Configuration.xml (walk-up)', () => {
    // Берём реальный вложенный путь: example/2.20/src/cf/EventSubscriptions/ПриЗаписиКонтрагента.xml —
    // Configuration.xml лежит на 2 уровня выше (EventSubscriptions/ → cf/).
    const eventSubscriptionXmlPath = path.join(EXAMPLE_CF, 'EventSubscriptions', 'ПриЗаписиКонтрагента.xml');
    assert.ok(fs.existsSync(eventSubscriptionXmlPath), 'фикстура подписки на событие должна существовать');

    const resolved = resolveConfigurationXml(eventSubscriptionXmlPath);
    assert.strictEqual(resolved, CONFIG_XML_PATH, 'walk-up должен найти корневой Configuration.xml конфигурации');
  });

  test('resolveConfigurationXml поднимается от ГЛУБОКО вложенного пути (колонка табличной части документа)', () => {
    // Ещё более глубокая вложенность: Documents/<Doc>.xml — сам путь к файлу объекта,
    // а не гипотетический вложенный каталог, потому что колонки ТЧ не имеют отдельных
    // XML-файлов в выгрузке 1С (они — узлы внутри Documents/<Doc>.xml).
    const documentXmlPath = path.join(EXAMPLE_CF, 'Documents', 'ПриходТовара.xml');
    assert.ok(fs.existsSync(documentXmlPath));

    const resolved = resolveConfigurationXml(documentXmlPath);
    assert.strictEqual(resolved, CONFIG_XML_PATH);
  });

  test('resolveConfigurationXml возвращает null при отсутствии Configuration.xml на всём пути вверх', () => {
    const orphanDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-a1-orphan-'));
    const orphanXmlPath = path.join(orphanDir, 'Orphan.xml');
    fs.writeFileSync(orphanXmlPath, '<Orphan/>', 'utf-8');

    assert.strictEqual(resolveConfigurationXml(orphanXmlPath), null);
  });

  test('readDefinedTypeInnerXml читает реальный DefinedType (КонтактноеЛицо) и возвращает inner блока <Type>', () => {
    const definedTypeXmlPath = path.join(DEFINED_TYPES_DIR, 'КонтактноеЛицо.xml');
    assert.ok(fs.existsSync(definedTypeXmlPath), 'фикстура DefinedType.КонтактноеЛицо должна существовать');

    const inner = readDefinedTypeInnerXml(CONFIG_XML_PATH, 'КонтактноеЛицо');
    assert.ok(inner, 'inner блока <Type> должен быть найден');
    assert.ok(inner.includes('CatalogRef.Пользователи'), 'DefinedType.КонтактноеЛицо ссылается на CatalogRef.Пользователи');
    assert.ok(inner.includes('CatalogRef.Контрагенты'), 'DefinedType.КонтактноеЛицо ссылается на CatalogRef.Контрагенты');
  });

  test('readDefinedTypeInnerXml возвращает null для несуществующего DefinedType', () => {
    const inner = readDefinedTypeInnerXml(CONFIG_XML_PATH, 'НесуществующийТип');
    assert.strictEqual(inner, null);
  });

  test('readDefinedTypeInnerXml защищён от циклов: self-referencing DefinedType не должен бесконечно рекурсировать', () => {
    // Временная конфигурация: DefinedType "Циклический" ссылается сам на себя через
    // DefinedType.Циклический — воспроизводит реальный баг-сценарий повреждённой
    // выгрузки (или ошибки проектирования конфигурации). Защита от циклов — забота
    // ВЫЗЫВАЮЩЕЙ стороны (EventSubscriptionPropertyService.expandSourceKinds уже
    // использует Set<string> seenDefinedTypes), но infra-функция чтения обязана хотя бы
    // не падать и возвращать данные по одному прочтению — рекурсивное раскрытие
    // канонических типов остаётся на стороне UI-слоя (parseMetadataType).
    const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-a1-cycle-'));
    const definedTypesDir = path.join(configRoot, 'DefinedTypes');
    fs.mkdirSync(definedTypesDir, { recursive: true });
    fs.writeFileSync(path.join(configRoot, 'Configuration.xml'), '<MetaDataObject/>', 'utf-8');

    const cyclicXml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<MetaDataObject xmlns:v8="http://v8.1c.ru/8.1/data/core" xmlns:cfg="http://v8.1c.ru/8.1/data/enterprise/current-config">',
      '<DefinedType uuid="00000000-0000-0000-0000-000000000001">',
      '<Properties>',
      '<Name>Циклический</Name>',
      '<Type>',
      '<v8:TypeSet>cfg:DefinedType.Циклический</v8:TypeSet>',
      '</Type>',
      '</Properties>',
      '</DefinedType>',
      '</MetaDataObject>',
    ].join('\n');
    fs.writeFileSync(path.join(definedTypesDir, 'Циклический.xml'), cyclicXml, 'utf-8');

    const configXmlPath = path.join(configRoot, 'Configuration.xml');
    // Однократное чтение не должно рекурсировать само по себе (infra-функция не знает
    // про DefinedType-граф) — просто возвращает inner своего собственного <Type>.
    const inner = readDefinedTypeInnerXml(configXmlPath, 'Циклический');
    assert.ok(inner, 'inner должен быть прочитан даже если он содержит self-reference');
    assert.ok(inner.includes('DefinedType.Циклический'), 'self-reference должен быть виден вызывающей стороне для организации защиты от циклов');
  });

  test('readDefinedTypeInnerXml возвращает null, если DefinedTypes/<Имя>.xml существует, но не читается как файл (реальный EISDIR)', () => {
    // existsSync видит путь (это директория с расширением .xml — вырожденный, но
    // реальный случай повреждённой/самодельной выгрузки), а readFileSync бросает
    // EISDIR — покрывает catch-ветку без мока fs, на настоящей файловой системе.
    const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-a1-eisdir-'));
    const definedTypesDir = path.join(configRoot, 'DefinedTypes');
    fs.mkdirSync(definedTypesDir, { recursive: true });
    fs.writeFileSync(path.join(configRoot, 'Configuration.xml'), '<MetaDataObject/>', 'utf-8');
    fs.mkdirSync(path.join(definedTypesDir, 'Сломанный.xml'));

    const inner = readDefinedTypeInnerXml(path.join(configRoot, 'Configuration.xml'), 'Сломанный');
    assert.strictEqual(inner, null, 'ошибка чтения (EISDIR) должна гаситься и возвращать null, а не бросать исключение наружу');
  });

  test('stripXmlTags вырезает вложенные теги и оставляет текст (перенесённый stripXmlText из EventSubscriptionPropertyService)', () => {
    assert.strictEqual(stripXmlTags('<Handler>ОбработкаСобытия</Handler>'), 'ОбработкаСобытия');
    assert.strictEqual(stripXmlTags('  текст с пробелами  '), 'текст с пробелами');
    assert.strictEqual(stripXmlTags(''), '');
    assert.strictEqual(stripXmlTags('<a><b>вложенный</b></a>'), 'вложенный');
  });

  test('readDefinedTypeSourceValue (через getEventOptionsForSource): без sourceXmlPath resolveConfigurationXml не находит Configuration.xml — источник просто не раскрывается', () => {
    // sourceXmlPath=undefined => resolveConfigurationXml возвращает null внутри
    // readDefinedTypeSourceValue => DefinedType не раскрывается => expandedKinds пуст
    // => getEventOptionsForSource деградирует к полному EVENT_ORDER (аналогично
    // отсутствию источника вовсе), но НЕ бросает исключение.
    const service = new EventSubscriptionPropertyService();
    const source = parseMetadataType('<v8:TypeSet>cfg:DefinedType.ДокументыДляПодписки</v8:TypeSet>');

    const events = service.getEventOptionsForSource(source, undefined).map((option) => option.value);
    assert.ok(events.includes('BeforeWrite'), 'без резолва Configuration.xml должен вернуться полный список событий, а не упасть');
  });

  test('readDefinedTypeSourceValue: self-referencing DefinedType через реальный properties-путь не зацикливается (seenDefinedTypes)', () => {
    // В отличие от прямого теста readDefinedTypeInnerXml (однократное чтение),
    // здесь проверяется ЗАЩИТА ВЫЗЫВАЮЩЕЙ СТОРОНЫ: expandSourceKinds передаёт один
    // и тот же Set<string> seenDefinedTypes по рекурсии, поэтому повторное появление
    // "Циклический" во втором проходе обязано вернуть null (ветка seenDefinedTypes.has),
    // а не уйти в бесконечную рекурсию.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-a1-cycle-guard-'));
    fs.mkdirSync(path.join(root, 'DefinedTypes'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'Configuration.xml'),
      '<MetaDataObject><Configuration><Properties><Name>Тест</Name></Properties></Configuration></MetaDataObject>',
      'utf-8'
    );
    fs.writeFileSync(
      path.join(root, 'DefinedTypes', 'Циклический.xml'),
      [
        '<MetaDataObject>',
        '<DefinedType>',
        '<Properties>',
        '<Name>Циклический</Name>',
        '<Type>',
        '<v8:TypeSet>cfg:DefinedType.Циклический</v8:TypeSet>',
        '</Type>',
        '</Properties>',
        '</DefinedType>',
        '</MetaDataObject>',
      ].join('\n'),
      'utf-8'
    );
    const eventXmlPath = path.join(root, 'EventSubscriptions', 'Подписка.xml');

    const service = new EventSubscriptionPropertyService();
    const source = parseMetadataType('<v8:TypeSet>cfg:DefinedType.Циклический</v8:TypeSet>');

    const events = service.getEventOptionsForSource(source, eventXmlPath).map((option) => option.value);
    // Раскрытие ничего не дало (self-reference оборван защитой от циклов) =>
    // expandedKinds пуст => деградация к полному списку событий, без зависания теста.
    assert.ok(events.includes('BeforeWrite'), 'цикл должен быть оборван защитой seenDefinedTypes, а не зациклить вызов');
  });

  test('readDefinedTypeSourceValue: Configuration.xml найден, но DefinedTypes/<Имя>.xml отсутствует — источник не раскрывается', () => {
    // resolveConfigurationXml успешно резолвит корень, а readDefinedTypeInnerXml
    // возвращает null (нет файла DefinedTypes/НесуществующийИсточник.xml) — ветка
    // `inner === null` внутри readDefinedTypeSourceValue.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-a1-missing-definedtype-'));
    fs.mkdirSync(path.join(root, 'DefinedTypes'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'Configuration.xml'),
      '<MetaDataObject><Configuration><Properties><Name>Тест</Name></Properties></Configuration></MetaDataObject>',
      'utf-8'
    );
    const eventXmlPath = path.join(root, 'EventSubscriptions', 'Подписка.xml');

    const service = new EventSubscriptionPropertyService();
    const source = parseMetadataType('<v8:TypeSet>cfg:DefinedType.НесуществующийИсточник</v8:TypeSet>');

    const events = service.getEventOptionsForSource(source, eventXmlPath).map((option) => option.value);
    assert.ok(events.includes('BeforeWrite'), 'отсутствие файла DefinedType не должно ронять вызов — источник просто не раскрывается');
  });
});
