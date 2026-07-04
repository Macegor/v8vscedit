import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ObjectXmlReader } from '../../infra/xml/ObjectXmlReader';

const EXAMPLE_CF_220 = path.resolve(__dirname, '../../../example/2.20/src/cf');

// Реальный документ содержит табличную часть "Товары" с реквизитами Цена/Количество/Сумма,
// у которых текстуально СОВПАДАЕТ Type-блок (decimal(10,3)) — см. example/2.20. Такой блок
// подходит для проверки, что мутатор целится по диапазону, а не бьёт первое совпадение.
const DOCUMENT_WITH_DUPLICATE_TYPES = path.join(EXAMPLE_CF_220, 'Documents', 'ПриходТовара.xml');
// Корневой SessionParameter: targetKind='SessionParameter' — isRootTypeTargetKind, targetXml
// равен всему файлу, normalizeTypedFieldProperties к нему не применяется (только Attribute/
// AddressingAttribute/Dimension/Resource/Constant/CommonAttribute) — удобная фикстура для
// проверки идемпотентности мутатора без побочной перестройки типозависимых свойств.
const SESSION_PARAMETER_XML = path.join(EXAMPLE_CF_220, 'SessionParameters', 'ТекущийПользователь.xml');

suite('ObjectXmlReader — мутация по диапазону, а не по значению (X2)', () => {
  test('updateTypeInObject меняет тип ВТОРОЙ колонки ТЧ с текстуально совпадающим Type-блоком; первая нетронута; BOM/EOL сохранены', () => {
    const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-x2-column-'));
    const xmlPath = path.join(configRoot, 'ПриходТовара.xml');
    const originalXml = fs.readFileSync(DOCUMENT_WITH_DUPLICATE_TYPES, 'utf-8');
    fs.writeFileSync(xmlPath, originalXml, 'utf-8');

    // Инвариант №12 требует сохранения формата исходника — фикстура обязана быть
    // BOM+CRLF, иначе тест на сохранение формата ничего не проверяет.
    assert.strictEqual(originalXml.charCodeAt(0), 0xfeff, 'фикстура должна начинаться с BOM');
    assert.ok(originalXml.includes('\r\n'), 'фикстура должна использовать CRLF');

    const reader = new ObjectXmlReader();
    const ok = reader.updateTypeInObject(xmlPath, {
      targetKind: 'Column',
      targetName: 'Количество',
      tabularSectionName: 'Товары',
      typeInnerXml: '<v8:Type>xs:string</v8:Type>',
    });
    assert.strictEqual(ok, true);

    const updatedXml = fs.readFileSync(xmlPath, 'utf-8');
    const objectInfo = reader.read(xmlPath);
    const tabularSection = objectInfo?.children.find((child) => child.tag === 'TabularSection' && child.name === 'Товары');
    assert.ok(tabularSection, 'табличная часть "Товары" не найдена после мутации');

    // Перечитываем XML заново (не доверяем побочным эффектам одного прохода парсера)
    // и сверяем срезом: тип "Цена" должен остаться decimal, тип "Количество" — стать string.
    const priceType = /<Name>Цена<\/Name>[\s\S]*?<Type>([\s\S]*?)<\/Type>/.exec(updatedXml)?.[1] ?? '';
    const quantityType = /<Name>Количество<\/Name>[\s\S]*?<Type>([\s\S]*?)<\/Type>/.exec(updatedXml)?.[1] ?? '';
    const sumType = /<Name>Сумма<\/Name>[\s\S]*?<Type>([\s\S]*?)<\/Type>/.exec(updatedXml)?.[1] ?? '';

    assert.ok(priceType.includes('xs:decimal'), 'реквизит "Цена" не должен был измениться');
    assert.ok(sumType.includes('xs:decimal'), 'реквизит "Сумма" не должен был измениться');
    assert.ok(quantityType.includes('xs:string'), 'реквизит "Количество" должен был получить новый тип');
    assert.ok(!quantityType.includes('xs:decimal'), 'реквизит "Количество" не должен сохранить старый тип');

    // Инвариант №12: BOM и CRLF исходника сохранены после мутации.
    assert.strictEqual(updatedXml.charCodeAt(0), 0xfeff, 'BOM должен быть сохранён после мутации');
    assert.ok(updatedXml.includes('\r\n'), 'CRLF должен быть сохранён после мутации');
  });

  test('updateTypeInObject адресует диапазон, а не текст: две ТЧ с одноимённой колонкой и совпадающим содержимым — меняется только целевая', () => {
    // Временная фикстура эмулирует повреждение выгрузки при копировании табличной части
    // в Конфигураторе (колонка "Количество" продублирована в двух ТЧ с одинаковым uuid
    // и одинаковым Type-блоком). targetXml для колонки текстуально совпадает в обеих ТЧ —
    // xml.replace(targetXml, ...) по значению обязан заменить именно во ВТОРОЙ ТЧ,
    // а не в первой попавшейся текстуальной копии.
    const attributeBlock = [
      '\t\t\t\t\t<Attribute uuid="dup00000-0000-0000-0000-000000000000">\r',
      '\t\t\t\t\t\t<Properties>\r',
      '\t\t\t\t\t\t\t<Name>Количество</Name>\r',
      '\t\t\t\t\t\t\t<Type>\r',
      '\t\t\t\t\t\t\t\t<v8:Type>xs:decimal</v8:Type>\r',
      '\t\t\t\t\t\t\t</Type>\r',
      '\t\t\t\t\t\t</Properties>\r',
      '\t\t\t\t\t</Attribute>\r',
    ].join('\n');

    const xml = [
      '﻿<?xml version="1.0" encoding="UTF-8"?>\r',
      '<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" xmlns:v8="http://v8.1c.ru/8.1/data/core" version="2.20">\r',
      '\t<Document uuid="11111111-1111-1111-1111-111111111111">\r',
      '\t\t<Properties>\r',
      '\t\t\t<Name>Документ1</Name>\r',
      '\t\t</Properties>\r',
      '\t\t<ChildObjects>\r',
      '\t\t\t<TabularSection uuid="22222222-2222-2222-2222-222222222222">\r',
      '\t\t\t\t<Properties>\r',
      '\t\t\t\t\t<Name>Товары</Name>\r',
      '\t\t\t\t</Properties>\r',
      '\t\t\t\t<ChildObjects>\r',
      attributeBlock,
      '\t\t\t\t</ChildObjects>\r',
      '\t\t\t</TabularSection>\r',
      '\t\t\t<TabularSection uuid="33333333-3333-3333-3333-333333333333">\r',
      '\t\t\t\t<Properties>\r',
      '\t\t\t\t\t<Name>ТоварыВозврат</Name>\r',
      '\t\t\t\t</Properties>\r',
      '\t\t\t\t<ChildObjects>\r',
      attributeBlock,
      '\t\t\t\t</ChildObjects>\r',
      '\t\t\t</TabularSection>\r',
      '\t\t</ChildObjects>\r',
      '\t</Document>\r',
      '</MetaDataObject>\r',
    ].join('\n');

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-x2-duplicate-ts-'));
    const xmlPath = path.join(root, 'Документ1.xml');
    fs.writeFileSync(xmlPath, xml, 'utf-8');

    const reader = new ObjectXmlReader();
    const ok = reader.updateTypeInObject(xmlPath, {
      targetKind: 'Column',
      targetName: 'Количество',
      tabularSectionName: 'ТоварыВозврат',
      typeInnerXml: '<v8:Type>xs:string</v8:Type>',
    });
    assert.strictEqual(ok, true);

    const updatedXml = fs.readFileSync(xmlPath, 'utf-8');
    const tabularSections = [...updatedXml.matchAll(/<TabularSection uuid="[^"]*">[\s\S]*?<\/TabularSection>/g)]
      .map((match) => match[0]);
    assert.strictEqual(tabularSections.length, 2);

    const tovaryBlock = tabularSections.find((block) => block.includes('<Name>Товары</Name>'));
    const vozvratBlock = tabularSections.find((block) => block.includes('<Name>ТоварыВозврат</Name>'));
    assert.ok(tovaryBlock);
    assert.ok(vozvratBlock);

    const tovaryType = /<Type>([\s\S]*?)<\/Type>/.exec(tovaryBlock)?.[1] ?? '';
    const vozvratType = /<Type>([\s\S]*?)<\/Type>/.exec(vozvratBlock)?.[1] ?? '';

    assert.ok(tovaryType.includes('xs:decimal'), 'ТЧ "Товары" не должна была измениться');
    assert.ok(vozvratType.includes('xs:string'), 'ТЧ "ТоварыВозврат" должна получить новый тип');

    assert.strictEqual(updatedXml.charCodeAt(0), 0xfeff, 'BOM должен быть сохранён после мутации');
    assert.ok(updatedXml.includes('\r\n'), 'CRLF должен быть сохранён после мутации');
  });

  test('updateTypeInObject: Column без tabularSectionName — targetRange не строится, возвращает false и не трогает файл', () => {
    const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-x2-column-no-ts-'));
    const xmlPath = path.join(configRoot, 'ПриходТовара.xml');
    const originalXml = fs.readFileSync(DOCUMENT_WITH_DUPLICATE_TYPES, 'utf-8');
    fs.writeFileSync(xmlPath, originalXml, 'utf-8');

    const reader = new ObjectXmlReader();
    const ok = reader.updateTypeInObject(xmlPath, {
      targetKind: 'Column',
      targetName: 'Количество',
      // tabularSectionName намеренно не передан — Column без секции не может быть адресован.
      typeInnerXml: '<v8:Type>xs:string</v8:Type>',
    });
    assert.strictEqual(ok, false);
    assert.strictEqual(fs.readFileSync(xmlPath, 'utf-8'), originalXml, 'файл не должен измениться');
  });

  test('updateTypeInObject: колонка с несуществующим именем в существующей ТЧ — targetRange не найден, возвращает false', () => {
    const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-x2-column-missing-'));
    const xmlPath = path.join(configRoot, 'ПриходТовара.xml');
    const originalXml = fs.readFileSync(DOCUMENT_WITH_DUPLICATE_TYPES, 'utf-8');
    fs.writeFileSync(xmlPath, originalXml, 'utf-8');

    const reader = new ObjectXmlReader();
    const ok = reader.updateTypeInObject(xmlPath, {
      targetKind: 'Column',
      targetName: 'НесуществующаяКолонка',
      tabularSectionName: 'Товары',
      typeInnerXml: '<v8:Type>xs:string</v8:Type>',
    });
    assert.strictEqual(ok, false);
    assert.strictEqual(fs.readFileSync(xmlPath, 'utf-8'), originalXml, 'файл не должен измениться');
  });

  test('updateTypeInObject: дочерний элемент с несуществующим именем (не Column) — findChildMetaElementRange возвращает null, false', () => {
    const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-x2-attribute-missing-'));
    const xmlPath = path.join(configRoot, 'ПриходТовара.xml');
    const originalXml = fs.readFileSync(DOCUMENT_WITH_DUPLICATE_TYPES, 'utf-8');
    fs.writeFileSync(xmlPath, originalXml, 'utf-8');

    const reader = new ObjectXmlReader();
    const ok = reader.updateTypeInObject(xmlPath, {
      targetKind: 'Attribute',
      targetName: 'НесуществующийРеквизит',
      typeInnerXml: '<v8:Type>xs:string</v8:Type>',
    });
    assert.strictEqual(ok, false);
    assert.strictEqual(fs.readFileSync(xmlPath, 'utf-8'), originalXml, 'файл не должен измениться');
  });

  test('updatePropertyInObject: Column без tabularSectionName — targetRange не строится, возвращает false и не трогает файл', () => {
    const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-x2-prop-column-no-ts-'));
    const xmlPath = path.join(configRoot, 'ПриходТовара.xml');
    const originalXml = fs.readFileSync(DOCUMENT_WITH_DUPLICATE_TYPES, 'utf-8');
    fs.writeFileSync(xmlPath, originalXml, 'utf-8');

    const reader = new ObjectXmlReader();
    const ok = reader.updatePropertyInObject(xmlPath, {
      targetKind: 'Column',
      targetName: 'Количество',
      propertyKey: 'Synonym',
      valueKind: 'localizedString',
      value: 'Кол-во',
    });
    assert.strictEqual(ok, false);
    assert.strictEqual(fs.readFileSync(xmlPath, 'utf-8'), originalXml, 'файл не должен измениться');
  });

  test('updatePropertyInObject: несуществующий StandardAttribute — extractStandardAttributeXml не находит блок, возвращает false', () => {
    const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-x2-prop-standard-missing-'));
    const xmlPath = path.join(configRoot, 'ПриходТовара.xml');
    const originalXml = fs.readFileSync(DOCUMENT_WITH_DUPLICATE_TYPES, 'utf-8');
    fs.writeFileSync(xmlPath, originalXml, 'utf-8');

    const reader = new ObjectXmlReader();
    const ok = reader.updatePropertyInObject(xmlPath, {
      targetKind: 'StandardAttribute',
      targetName: 'НесуществующийСтандартныйРеквизит',
      propertyKey: 'Synonym',
      valueKind: 'localizedString',
      value: 'Что-то',
    });
    assert.strictEqual(ok, false);
    assert.strictEqual(fs.readFileSync(xmlPath, 'utf-8'), originalXml, 'файл не должен измениться');
  });

  test('ИСПРАВЛЕНО (было РЕГРЕССИЯ QA): updateTypeInObject идемпотентен на CRLF-файле — сравнение EOL-нечувствительно', () => {
    // Дефект: сравнение `updatedXml === xml` в updateTypeInObject выполняется ДО
    // writeTextFilePreservingBomAndEol, а typeBlock строится с "голыми" \n
    // (indentTypeInner/updateTypeInElement), тогда как xml, прочитанный из CRLF-файла,
    // содержит \r\n. Строковое сравнение по байтам считает файл "изменившимся" на
    // КАЖДОМ вызове с одинаковым typeInnerXml, даже когда реальных изменений нет.
    // ЦЕЛЬ (контракт): сравнение должно быть EOL-нечувствительным — повторный вызов
    // с тем же typeInnerXml на CRLF-файле обязан вернуть false и не трогать файл на диске.
    const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-x2-idempotent-'));
    const xmlPath = path.join(configRoot, 'ТекущийПользователь.xml');
    const originalXml = fs.readFileSync(SESSION_PARAMETER_XML, 'utf-8');
    fs.writeFileSync(xmlPath, originalXml, 'utf-8');

    const reader = new ObjectXmlReader();
    const firstChange = reader.updateTypeInObject(xmlPath, {
      targetKind: 'SessionParameter',
      targetName: 'ТекущийПользователь',
      typeInnerXml: '<v8:Type>xs:string</v8:Type>',
    });
    assert.strictEqual(firstChange, true, 'первое применение должно реально поменять тип');

    const afterFirst = fs.readFileSync(xmlPath, 'utf-8');
    const statAfterFirst = fs.statSync(xmlPath);

    const secondChange = reader.updateTypeInObject(xmlPath, {
      targetKind: 'SessionParameter',
      targetName: 'ТекущийПользователь',
      typeInnerXml: '<v8:Type>xs:string</v8:Type>',
    });

    // КРАСНЫЙ: сейчас secondChange === true (баг), контракт требует false —
    // повторное применение уже установленного типа не является реальным изменением.
    assert.strictEqual(secondChange, false, 'повторное применение того же typeInnerXml на CRLF-файле не должно считаться изменением');

    const afterSecond = fs.readFileSync(xmlPath, 'utf-8');
    assert.strictEqual(afterSecond, afterFirst, 'файл не должен перезаписываться при идемпотентном вызове (побайтовое совпадение)');

    // mtime — дополнительный сигнал отсутствия лишней записи; сравниваем байты как
    // основной критерий (см. комментарий выше), mtime — если платформа не флейкает.
    const statAfterSecond = fs.statSync(xmlPath);
    assert.strictEqual(statAfterSecond.mtimeMs, statAfterFirst.mtimeMs, 'идемпотентный вызов не должен перезаписывать файл (mtime не изменился)');
  });

  test('РЕГРЕССИЯ НЕ ДОПУЩЕНА: updateTypeInObject реальное изменение типа всё ещё возвращает true и сохраняет BOM+CRLF', () => {
    // Контроль от переусердствовавшего фикса: если сравнение станет EOL-нечувствительным
    // не только к разделителям строк, но и "проглотит" реальные семантические изменения —
    // это тоже баг. Реальное изменение типа (string → number) обязано остаться true.
    const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-x2-real-change-'));
    const xmlPath = path.join(configRoot, 'ТекущийПользователь.xml');
    const originalXml = fs.readFileSync(SESSION_PARAMETER_XML, 'utf-8');
    fs.writeFileSync(xmlPath, originalXml, 'utf-8');

    const reader = new ObjectXmlReader();
    const changed = reader.updateTypeInObject(xmlPath, {
      targetKind: 'SessionParameter',
      targetName: 'ТекущийПользователь',
      typeInnerXml: '<v8:Type>xs:string</v8:Type>',
    });
    assert.strictEqual(changed, true, 'реальное изменение типа (Catalog-ссылка → строка) обязано считаться изменением');

    const updatedXml = fs.readFileSync(xmlPath, 'utf-8');
    assert.strictEqual(updatedXml.charCodeAt(0), 0xfeff, 'BOM должен сохраниться после реального изменения');
    assert.ok(updatedXml.includes('\r\n'), 'CRLF должен сохраниться после реального изменения');
    assert.ok(updatedXml.includes('xs:string'), 'новый тип должен быть записан');
  });

  test('updatePropertyInObject: дочерний элемент с несуществующим именем (не Column/StandardAttribute) — findChildMetaElementRange null, false', () => {
    const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-x2-prop-attribute-missing-'));
    const xmlPath = path.join(configRoot, 'ПриходТовара.xml');
    const originalXml = fs.readFileSync(DOCUMENT_WITH_DUPLICATE_TYPES, 'utf-8');
    fs.writeFileSync(xmlPath, originalXml, 'utf-8');

    const reader = new ObjectXmlReader();
    const ok = reader.updatePropertyInObject(xmlPath, {
      targetKind: 'TabularSection',
      targetName: 'НесуществующаяТЧ',
      propertyKey: 'Synonym',
      valueKind: 'localizedString',
      value: 'Что-то',
    });
    assert.strictEqual(ok, false);
    assert.strictEqual(fs.readFileSync(xmlPath, 'utf-8'), originalXml, 'файл не должен измениться');
  });

  test('updatePropertyInObject: повторное применение уже установленного значения — идемпотентно, возвращает false и не трогает файл', () => {
    const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-x2-prop-idempotent-'));
    const xmlPath = path.join(configRoot, 'ПриходТовара.xml');
    const originalXml = fs.readFileSync(DOCUMENT_WITH_DUPLICATE_TYPES, 'utf-8');
    fs.writeFileSync(xmlPath, originalXml, 'utf-8');

    const reader = new ObjectXmlReader();
    const firstChange = reader.updatePropertyInObject(xmlPath, {
      targetKind: 'TabularSection',
      targetName: 'Товары',
      propertyKey: 'Synonym',
      valueKind: 'localizedString',
      value: 'Товарные позиции',
    });
    assert.strictEqual(firstChange, true, 'первое применение должно реально поменять синоним');

    const afterFirst = fs.readFileSync(xmlPath, 'utf-8');
    const secondChange = reader.updatePropertyInObject(xmlPath, {
      targetKind: 'TabularSection',
      targetName: 'Товары',
      propertyKey: 'Synonym',
      valueKind: 'localizedString',
      value: 'Товарные позиции',
    });
    assert.strictEqual(secondChange, false, 'повторное применение того же значения не должно считаться изменением');
    assert.strictEqual(fs.readFileSync(xmlPath, 'utf-8'), afterFirst, 'файл не должен измениться при идемпотентном вызове');
  });

  test('ИСПРАВЛЕНО (аналог IDMP для updatePropertyInObject): вставка НОВОГО metadataReferenceList на CRLF-файле идемпотентна при повторном вызове', () => {
    // Табличная часть "Товары" не содержит InputByString (это свойство корневого
    // документа) — targetRange найден, propsInner не содержит тег => appendPropertyAtEnd,
    // а buildPropertyValueBlock для непустого metadataReferenceList собирает блок через
    // `.join('\n')` (голый LF), как и typeBlock в updateTypeInElement. На CRLF-файле это
    // воспроизводит тот же класс бага: повторный вызов с тем же значением обязан быть
    // идемпотентным (false), а не считаться изменением на каждый вызов.
    const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-x2-prop-insert-idempotent-'));
    const xmlPath = path.join(configRoot, 'ПриходТовара.xml');
    const originalXml = fs.readFileSync(DOCUMENT_WITH_DUPLICATE_TYPES, 'utf-8');
    fs.writeFileSync(xmlPath, originalXml, 'utf-8');
    assert.ok(originalXml.includes('\r\n'), 'фикстура должна использовать CRLF');

    const reader = new ObjectXmlReader();
    const insertValue = ['Document.ПриходТовара.StandardAttribute.Number'];

    const firstChange = reader.updatePropertyInObject(xmlPath, {
      targetKind: 'TabularSection',
      targetName: 'Товары',
      propertyKey: 'InputByString',
      valueKind: 'metadataReferenceList',
      value: insertValue,
    });
    assert.strictEqual(firstChange, true, 'первая вставка нового свойства должна считаться изменением');

    const afterFirst = fs.readFileSync(xmlPath, 'utf-8');
    const statAfterFirst = fs.statSync(xmlPath);

    const secondChange = reader.updatePropertyInObject(xmlPath, {
      targetKind: 'TabularSection',
      targetName: 'Товары',
      propertyKey: 'InputByString',
      valueKind: 'metadataReferenceList',
      value: insertValue,
    });

    // КРАСНЫЙ: сейчас secondChange === true из-за EOL-нечувствительного сравнения
    // "по значению" (LF во вставленном блоке vs CRLF остального файла).
    assert.strictEqual(secondChange, false, 'повторная вставка того же metadataReferenceList не должна считаться изменением');

    const afterSecond = fs.readFileSync(xmlPath, 'utf-8');
    assert.strictEqual(afterSecond, afterFirst, 'файл не должен перезаписываться при идемпотентном вызове');

    const statAfterSecond = fs.statSync(xmlPath);
    assert.strictEqual(statAfterSecond.mtimeMs, statAfterFirst.mtimeMs, 'идемпотентный вызов не должен перезаписывать файл (mtime не изменился)');

    assert.strictEqual(afterFirst.charCodeAt(0), 0xfeff, 'BOM должен сохраниться после вставки');
    assert.ok(afterFirst.includes('\r\n'), 'CRLF должен сохраниться после вставки');
  });
});
