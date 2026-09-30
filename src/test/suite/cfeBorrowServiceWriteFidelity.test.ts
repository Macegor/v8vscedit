import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { XMLValidator } from 'fast-xml-parser';
import { CfeBorrowService } from '../../infra/cfe/CfeBorrowService';
import { directChildObjectsTagSequence } from './support/childObjectsCorpus';

/**
 * Запрет №12 CLAUDE.md: любой редактор СУЩЕСТВУЮЩЕГО XML сохраняет BOM и стиль
 * переводов строк исходного файла. В `CfeBorrowService` семь `fs.writeFileSync`,
 * но нарушений ровно ТРИ — там, где перезаписывается уже существующий файл
 * владельца в расширении:
 *  - `registerChildInParentObject`, ветка замены текстовой ссылки
 *    `<Tag>Имя</Tag>` полным блоком (переменная `xml` переприсваивается
 *    ДО записи — «исходное содержимое» для писателя надо запомнить отдельной
 *    константой до `replace`);
 *  - `registerChildInParentObject`, ветка обычной вставки по канону;
 *  - `registerFormInParentObject`, вставка `<Form>`.
 * Остальные четыре создают НОВЫЙ файл (сохранять нечего): объектный XML,
 * дескриптор формы, `Form.xml`, пустой `Module.bsl`.
 *
 * Вставляемые блоки собираются с `\n`, поэтому в CRLF-файле без нормализации
 * оказывались бы одиночные `\n` — смешанные окончания строк.
 */

const STYLES: readonly { readonly label: string; readonly eol: '\n' | '\r\n'; readonly bom: boolean }[] = [
  { label: 'LF без BOM', eol: '\n', bom: false },
  { label: 'LF с BOM', eol: '\n', bom: true },
  { label: 'CRLF без BOM', eol: '\r\n', bom: false },
  { label: 'CRLF с BOM', eol: '\r\n', bom: true },
];

const NS = 'xmlns="http://v8.1c.ru/8.3/MDClasses" xmlns:v8="http://v8.1c.ru/8.1/data/core" xmlns:xr="http://v8.1c.ru/8.3/xcf/readable" version="2.21"';

/** Текст с заданными переводами строк и (необязательным) BOM — так платформа выгружает файлы. */
function styled(lf: string, style: { eol: string; bom: boolean }): string {
  return `${style.bom ? '\ufeff' : ''}${lf.replace(/\r?\n/g, style.eol)}`;
}

function newDirs(): { cfDir: string; extDir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-borrow-fidelity-'));
  const cfDir = path.join(root, 'cf');
  const extDir = path.join(root, 'ext');
  fs.mkdirSync(cfDir, { recursive: true });
  fs.mkdirSync(extDir, { recursive: true });
  fs.writeFileSync(path.join(extDir, 'Configuration.xml'), [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<MetaDataObject version="2.21">',
    '\t<Configuration>',
    '\t\t<Properties><Name>Расширение</Name></Properties>',
    '\t\t<ChildObjects/>',
    '\t</Configuration>',
    '</MetaDataObject>',
    '',
  ].join('\n'), 'utf-8');
  return { cfDir, extDir };
}

function writeSourceRegister(cfDir: string): void {
  const dir = path.join(cfDir, 'InformationRegisters');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'КурсыВалют.xml'), [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<MetaDataObject ${NS}>`,
    '\t<InformationRegister uuid="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa">',
    '\t\t<Properties><Name>КурсыВалют</Name></Properties>',
    '\t\t<ChildObjects>',
    '\t\t\t<Dimension uuid="11111111-1111-1111-1111-111111111111"><Properties><Name>Валюта</Name><Type><v8:Type>xs:string</v8:Type></Type></Properties></Dimension>',
    '\t\t\t<Resource uuid="22222222-2222-2222-2222-222222222222"><Properties><Name>Курс</Name><Type><v8:Type>xs:decimal</v8:Type></Type></Properties></Resource>',
    '\t\t</ChildObjects>',
    '\t</InformationRegister>',
    '</MetaDataObject>',
    '',
  ].join('\n'), 'utf-8');
}

function writeSourceCatalog(cfDir: string, withFormExt = true): void {
  const dir = path.join(cfDir, 'Catalogs');
  const formsDir = path.join(dir, 'Клиенты', 'Forms');
  fs.mkdirSync(formsDir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'Клиенты.xml'), [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<MetaDataObject ${NS}>`,
    '\t<Catalog uuid="bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb">',
    '\t\t<Properties><Name>Клиенты</Name></Properties>',
    '\t\t<ChildObjects>',
    '\t\t\t<Attribute uuid="33333333-3333-3333-3333-333333333333"><Properties><Name>ИНН</Name><Type><v8:Type>xs:string</v8:Type></Type></Properties></Attribute>',
    '\t\t\t<Form>ФормаСписка</Form>',
    '\t\t</ChildObjects>',
    '\t</Catalog>',
    '</MetaDataObject>',
    '',
  ].join('\n'), 'utf-8');
  fs.writeFileSync(path.join(formsDir, 'ФормаСписка.xml'), [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<MetaDataObject ${NS}>`,
    '\t<Form uuid="55555555-5555-5555-5555-555555555555">',
    '\t\t<Properties><Name>ФормаСписка</Name><FormType>Managed</FormType></Properties>',
    '\t</Form>',
    '</MetaDataObject>',
    '',
  ].join('\n'), 'utf-8');
  if (withFormExt) {
    const extDir = path.join(formsDir, 'ФормаСписка', 'Ext');
    fs.mkdirSync(extDir, { recursive: true });
    fs.writeFileSync(path.join(extDir, 'Form.xml'), '<?xml version="1.0" encoding="UTF-8"?>\n<Form version="2.21"><Items/></Form>\n', 'utf-8');
  }
}

/** Файл владельца в расширении: УЖЕ заимствован платформой (существует, в заданном стиле). */
function writeExtRegister(extDir: string, childObjectsLines: readonly string[], style: { eol: string; bom: boolean }): string {
  const dir = path.join(extDir, 'InformationRegisters');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'КурсыВалют.xml');
  fs.writeFileSync(file, styled([
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<MetaDataObject ${NS}>`,
    '\t<InformationRegister uuid="cccccccc-cccc-cccc-cccc-cccccccccccc">',
    '\t\t<Properties>',
    '\t\t\t<ObjectBelonging>Adopted</ObjectBelonging>',
    '\t\t\t<Name>КурсыВалют</Name>',
    '\t\t\t<ExtendedConfigurationObject>aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa</ExtendedConfigurationObject>',
    '\t\t</Properties>',
    '\t\t<ChildObjects>',
    ...childObjectsLines,
    '\t\t</ChildObjects>',
    '\t</InformationRegister>',
    '</MetaDataObject>',
    '',
  ].join('\n'), style), 'utf-8');
  return file;
}

function writeExtCatalog(extDir: string, style: { eol: string; bom: boolean }): string {
  const dir = path.join(extDir, 'Catalogs');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'Клиенты.xml');
  fs.writeFileSync(file, styled([
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<MetaDataObject ${NS}>`,
    '\t<Catalog uuid="dddddddd-dddd-dddd-dddd-dddddddddddd">',
    '\t\t<Properties>',
    '\t\t\t<ObjectBelonging>Adopted</ObjectBelonging>',
    '\t\t\t<Name>Клиенты</Name>',
    '\t\t\t<ExtendedConfigurationObject>bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb</ExtendedConfigurationObject>',
    '\t\t</Properties>',
    '\t\t<ChildObjects>',
    '\t\t\t<Attribute uuid="44444444-4444-4444-4444-444444444444"><Properties><Name>ИНН</Name></Properties></Attribute>',
    '\t\t</ChildObjects>',
    '\t</Catalog>',
    '</MetaDataObject>',
    '',
  ].join('\n'), style), 'utf-8');
  return file;
}

/** BOM сохранён ровно один раз (или отсутствует), а все переводы строк — одного стиля. */
function assertStyle(file: string, style: { eol: string; bom: boolean; label: string }): void {
  const bytes = fs.readFileSync(file);
  const hasBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  assert.strictEqual(hasBom, style.bom, `${style.label}: BOM ${style.bom ? 'потерян' : 'появился'}`);
  if (hasBom) {
    assert.ok(!(bytes[3] === 0xef && bytes[4] === 0xbb && bytes[5] === 0xbf), `${style.label}: BOM задвоен`);
  }
  const text = bytes.toString('utf-8');
  if (style.eol === '\r\n') {
    assert.ok(!/(?<!\r)\n/.test(text), `${style.label}: в CRLF-файле остался одиночный \\n (смешанные окончания)`);
  } else {
    assert.ok(!text.includes('\r'), `${style.label}: в LF-файле появился \\r`);
  }
  assert.strictEqual(XMLValidator.validate(text.replace(/^\ufeff/, '')), true, `${style.label}: результат не well-formed`);
}

suite('CfeBorrowService: запись сохраняет BOM и стиль EOL исходного файла (T-B1.18/19)', () => {
  for (const style of STYLES) {
    test(`[${style.label}] сайт «вставка по канону» (registerChildInParentObject): Dimension встаёт после Resource, стиль сохранён, повтор — байт-в-байт`, () => {
      const { cfDir, extDir } = newDirs();
      writeSourceRegister(cfDir);
      const file = writeExtRegister(extDir, [
        '\t\t\t<Resource uuid="22222222-2222-2222-2222-222222222222"><Properties><Name>Курс</Name></Properties></Resource>',
      ], style);
      const before = fs.readFileSync(file);

      const result = new CfeBorrowService().borrowChild(cfDir, extDir, 'InformationRegister', 'КурсыВалют', 'Dimension', 'Валюта');
      assert.strictEqual(result.alreadyBorrowed, false);
      assert.ok(!fs.readFileSync(file).equals(before), 'файл обязан измениться — вставка не выполнена');
      assertStyle(file, style);
      const xml = fs.readFileSync(file, 'utf-8');
      // Канон регистра сведений: Resource < Attribute < Dimension.
      assert.deepStrictEqual(directChildObjectsTagSequence(xml.replace(/^\ufeff/, ''), 'InformationRegister'), ['Resource', 'Dimension']);
      assert.ok(/<Dimension uuid="[^"]+">[\s\S]*<Name>Валюта<\/Name>/.test(xml), 'блок Dimension вставлен целиком');

      const afterFirst = fs.readFileSync(file);
      const again = new CfeBorrowService().borrowChild(cfDir, extDir, 'InformationRegister', 'КурсыВалют', 'Dimension', 'Валюта');
      assert.strictEqual(again.alreadyBorrowed, true);
      assert.ok(fs.readFileSync(file).equals(afterFirst), 'повторное заимствование изменило файл');
    });

    test(`[${style.label}] сайт «замена текстовой ссылки полным блоком» (registerChildInParentObject): ссылка заменена, стиль сохранён, повтор — байт-в-байт`, () => {
      const { cfDir, extDir } = newDirs();
      writeSourceRegister(cfDir);
      // Владелец уже знает измерение как голую ссылку `<Dimension>Валюта</Dimension>`
      // — заимствование обязано заменить её полным блоком с ExtendedConfigurationObject.
      const file = writeExtRegister(extDir, [
        '\t\t\t<Resource uuid="22222222-2222-2222-2222-222222222222"><Properties><Name>Курс</Name></Properties></Resource>',
        '\t\t\t<Dimension>Валюта</Dimension>',
      ], style);

      const result = new CfeBorrowService().borrowChild(cfDir, extDir, 'InformationRegister', 'КурсыВалют', 'Dimension', 'Валюта');
      assert.strictEqual(result.alreadyBorrowed, false);
      assertStyle(file, style);
      const xml = fs.readFileSync(file, 'utf-8');
      assert.ok(!xml.includes('<Dimension>Валюта</Dimension>'), 'голая ссылка должна быть заменена');
      assert.ok(/<Dimension uuid="[^"]+">[\s\S]*<ExtendedConfigurationObject>11111111-1111-1111-1111-111111111111<\/ExtendedConfigurationObject>/.test(xml), 'полный блок с ссылкой на исходный uuid');
      assert.deepStrictEqual(directChildObjectsTagSequence(xml.replace(/^\ufeff/, ''), 'InformationRegister'), ['Resource', 'Dimension']);

      const afterFirst = fs.readFileSync(file);
      const again = new CfeBorrowService().borrowChild(cfDir, extDir, 'InformationRegister', 'КурсыВалют', 'Dimension', 'Валюта');
      assert.strictEqual(again.alreadyBorrowed, true);
      assert.ok(fs.readFileSync(file).equals(afterFirst), 'повторное заимствование изменило файл');
    });

    test(`[${style.label}] сайт «регистрация формы» (registerFormInParentObject): <Form> встаёт после Attribute, стиль сохранён, повтор — байт-в-байт`, () => {
      const { cfDir, extDir } = newDirs();
      writeSourceCatalog(cfDir);
      const file = writeExtCatalog(extDir, style);
      const before = fs.readFileSync(file);

      const result = new CfeBorrowService().borrowForm(cfDir, extDir, 'Catalog', 'Клиенты', 'ФормаСписка');
      assert.strictEqual(result.alreadyBorrowed, false);
      assert.ok(!fs.readFileSync(file).equals(before), 'файл обязан измениться — форма не зарегистрирована');
      assertStyle(file, style);
      const xml = fs.readFileSync(file, 'utf-8');
      assert.deepStrictEqual(directChildObjectsTagSequence(xml.replace(/^\ufeff/, ''), 'Catalog'), ['Attribute', 'Form']);

      const afterFirst = fs.readFileSync(file);
      const again = new CfeBorrowService().borrowForm(cfDir, extDir, 'Catalog', 'Клиенты', 'ФормаСписка');
      assert.strictEqual(again.alreadyBorrowed, true);
      assert.ok(fs.readFileSync(file).equals(afterFirst), 'повторное заимствование формы изменило файл');
    });
  }

  test('форма уже значится в <ChildObjects> владельца, но файлов формы нет: файлы создаются, регистрация не дублируется, владелец не тронут', () => {
    const { cfDir, extDir } = newDirs();
    writeSourceCatalog(cfDir);
    const file = writeExtCatalog(extDir, STYLES[3]);
    const registered = fs.readFileSync(file, 'utf-8').replace('\t\t</ChildObjects>', '\t\t\t<Form>ФормаСписка</Form>\r\n\t\t</ChildObjects>');
    fs.writeFileSync(file, registered, 'utf-8');
    const before = fs.readFileSync(file);

    const result = new CfeBorrowService().borrowForm(cfDir, extDir, 'Catalog', 'Клиенты', 'ФормаСписка');
    assert.strictEqual(result.alreadyBorrowed, false);
    assert.ok(fs.existsSync(path.join(extDir, 'Catalogs', 'Клиенты', 'Forms', 'ФормаСписка.xml')));
    assert.ok(fs.readFileSync(file).equals(before), 'дубликат <Form> или лишняя перезапись владельца');
  });
});

suite('CfeBorrowService: создание НОВЫХ файлов не регрессировало (T-B1.20)', () => {
  test('borrowForm в чистое расширение: объектный XML, дескриптор формы, Form.xml с BaseForm, пустой Module.bsl, регистрация в Configuration.xml', () => {
    const { cfDir, extDir } = newDirs();
    writeSourceCatalog(cfDir);

    const result = new CfeBorrowService().borrowForm(cfDir, extDir, 'Catalog', 'Клиенты', 'ФормаСписка');
    assert.strictEqual(result.alreadyBorrowed, false);

    const objectXml = path.join(extDir, 'Catalogs', 'Клиенты.xml');
    const formMeta = path.join(extDir, 'Catalogs', 'Клиенты', 'Forms', 'ФормаСписка.xml');
    const formXml = path.join(extDir, 'Catalogs', 'Клиенты', 'Forms', 'ФормаСписка', 'Ext', 'Form.xml');
    const moduleBsl = path.join(extDir, 'Catalogs', 'Клиенты', 'Forms', 'ФормаСписка', 'Ext', 'Form', 'Module.bsl');
    for (const file of [objectXml, formMeta, formXml, moduleBsl, path.join(extDir, 'Configuration.xml')]) {
      assert.ok(result.files.includes(file), `не отражён в files: ${file}`);
      assert.ok(fs.existsSync(file), `не создан: ${file}`);
    }
    for (const file of [objectXml, formMeta, formXml]) {
      assert.strictEqual(XMLValidator.validate(fs.readFileSync(file, 'utf-8')), true, `${file}: не well-formed`);
    }
    assert.strictEqual(fs.readFileSync(moduleBsl, 'utf-8'), '', 'Module.bsl создаётся пустым');

    const objectText = fs.readFileSync(objectXml, 'utf-8');
    assert.ok(objectText.includes('<ObjectBelonging>Adopted</ObjectBelonging>'));
    assert.ok(objectText.includes('<ExtendedConfigurationObject>bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb</ExtendedConfigurationObject>'));
    assert.deepStrictEqual(directChildObjectsTagSequence(objectText, 'Catalog'), ['Form']);
    const metaText = fs.readFileSync(formMeta, 'utf-8');
    assert.ok(metaText.includes('<ExtendedConfigurationObject>55555555-5555-5555-5555-555555555555</ExtendedConfigurationObject>'));
    assert.ok(fs.readFileSync(formXml, 'utf-8').includes('<BaseForm version="2.21">'));
    assert.ok(fs.readFileSync(path.join(extDir, 'Configuration.xml'), 'utf-8').includes('<Catalog>Клиенты</Catalog>'));
  });

  test('исходная форма без Ext/Form.xml: создаётся только дескриптор формы, без Form.xml и Module.bsl', () => {
    const { cfDir, extDir } = newDirs();
    writeSourceCatalog(cfDir, false);

    const result = new CfeBorrowService().borrowForm(cfDir, extDir, 'Catalog', 'Клиенты', 'ФормаСписка');
    assert.strictEqual(result.alreadyBorrowed, false);
    const formDir = path.join(extDir, 'Catalogs', 'Клиенты', 'Forms');
    assert.ok(fs.existsSync(path.join(formDir, 'ФормаСписка.xml')));
    assert.ok(!fs.existsSync(path.join(formDir, 'ФормаСписка', 'Ext')));
    assert.ok(!result.files.some((f) => f.endsWith('Form.xml') || f.endsWith('Module.bsl')));
  });

  test('заимствование ребёнка в чистое расширение создаёт владельца и вставляет блок (без заранее существующего файла)', () => {
    const { cfDir, extDir } = newDirs();
    writeSourceRegister(cfDir);
    const result = new CfeBorrowService().borrowChild(cfDir, extDir, 'InformationRegister', 'КурсыВалют', 'Resource', 'Курс');
    assert.strictEqual(result.alreadyBorrowed, false);
    const xml = fs.readFileSync(path.join(extDir, 'InformationRegisters', 'КурсыВалют.xml'), 'utf-8');
    assert.deepStrictEqual(directChildObjectsTagSequence(xml, 'InformationRegister'), ['Resource']);
    assert.strictEqual(XMLValidator.validate(xml), true);
  });
});

suite('CfeBorrowService: ветки ошибок сохранили прежние тексты (T-B1.21)', () => {
  test('borrowObject: нет исходного XML', () => {
    const { cfDir, extDir } = newDirs();
    assert.throws(
      () => new CfeBorrowService().borrowObject(cfDir, extDir, 'Catalog', 'Нет'),
      new Error(`Исходный XML объекта не найден: ${path.join(cfDir, 'Catalogs', 'Нет')}`)
    );
  });

  test('borrowObject: неизвестный тип метаданных', () => {
    const { cfDir, extDir } = newDirs();
    assert.throws(
      () => new CfeBorrowService().borrowObject(cfDir, extDir, 'НесуществующийТип', 'X'),
      new Error('Неизвестный тип метаданных для заимствования: "НесуществующийТип"')
    );
  });

  test('borrowObject: в исходном XML нет UUID', () => {
    const { cfDir, extDir } = newDirs();
    const dir = path.join(cfDir, 'Catalogs');
    fs.mkdirSync(dir, { recursive: true });
    const source = path.join(dir, 'БезUuid.xml');
    fs.writeFileSync(source, `<?xml version="1.0" encoding="UTF-8"?>\n<MetaDataObject ${NS}>\n\t<Catalog>\n\t\t<Properties><Name>БезUuid</Name></Properties>\n\t</Catalog>\n</MetaDataObject>\n`, 'utf-8');
    assert.throws(
      () => new CfeBorrowService().borrowObject(cfDir, extDir, 'Catalog', 'БезUuid'),
      new Error(`Не удалось извлечь UUID из исходного XML: ${source}`)
    );
  });

  test('borrowForm: нет исходной формы', () => {
    const { cfDir, extDir } = newDirs();
    writeSourceCatalog(cfDir);
    assert.throws(
      () => new CfeBorrowService().borrowForm(cfDir, extDir, 'Catalog', 'Клиенты', 'НетТакой'),
      new Error(`Исходный XML формы не найден: ${path.join(cfDir, 'Catalogs', 'Клиенты', 'Forms', 'НетТакой')}`)
    );
  });

  test('borrowForm: в исходной форме нет UUID', () => {
    const { cfDir, extDir } = newDirs();
    writeSourceCatalog(cfDir);
    const formFile = path.join(cfDir, 'Catalogs', 'Клиенты', 'Forms', 'ФормаСписка.xml');
    fs.writeFileSync(formFile, `<?xml version="1.0" encoding="UTF-8"?>\n<MetaDataObject ${NS}>\n\t<Form>\n\t\t<Properties><Name>ФормаСписка</Name></Properties>\n\t</Form>\n</MetaDataObject>\n`, 'utf-8');
    assert.throws(
      () => new CfeBorrowService().borrowForm(cfDir, extDir, 'Catalog', 'Клиенты', 'ФормаСписка'),
      new Error(`Не удалось извлечь UUID из XML формы: ${formFile}`)
    );
  });

  test('borrowForm/borrowChild: неизвестный тип метаданных отклоняется тем же текстом, что и borrowObject', () => {
    const { cfDir, extDir } = newDirs();
    const message = 'Неизвестный тип метаданных для заимствования: "НесуществующийТип"';
    assert.throws(() => new CfeBorrowService().borrowForm(cfDir, extDir, 'НесуществующийТип', 'X', 'Ф'), new Error(message));
    assert.throws(() => new CfeBorrowService().borrowChild(cfDir, extDir, 'НесуществующийТип', 'X', 'Attribute', 'А'), new Error(message));
  });
});

suite('CfeBorrowService: дочерний тег без структурного блока (текстовая ссылка)', () => {
  // ВАЖНО про фикстуру. Ветка «текстовая ссылка уже есть, а полного блока для
  // замены нет» достижима только для тегов вне STRUCTURED_CHILD_TAGS
  // (`Template`, `Form`, …): для них buildBorrowedChildXml возвращает undefined
  // и в исходной конфигурации ничего не ищет. Для структурных тегов
  // (`Attribute`, `Dimension`, …) отсутствие элемента в источнике — это
  // исключение «Дочерний объект не найден в исходном XML», а не тихий выход.
  // В объекте расширения должна лежать именно ТЕКСТОВАЯ ссылка: полный блок
  // (с <Properties>) перехватил бы extractChildMetaElementXml раньше и тест
  // ушёл бы в соседнюю ветку.
  test('<Template> уже значится текстовой ссылкой: заимствование не меняет файл байт-в-байт и ничего не возвращает в files', () => {
    const { cfDir, extDir } = newDirs();
    const style = STYLES[3];
    const file = writeExtRegister(extDir, [
      '\t\t\t<Resource uuid="22222222-2222-2222-2222-222222222222"><Properties><Name>Курс</Name></Properties></Resource>',
      '\t\t\t<Template>Макет1</Template>',
    ], style);
    const before = fs.readFileSync(file);

    const result = new CfeBorrowService().borrowChild(cfDir, extDir, 'InformationRegister', 'КурсыВалют', 'Template', 'Макет1');

    assert.deepStrictEqual(result, { alreadyBorrowed: true, files: [] });
    assert.ok(fs.readFileSync(file).equals(before), 'файл владельца изменился, хотя ссылка на макет уже есть');
  });

  test('<Template> ещё нет в владельце: добавляется текстовой ссылкой после Resource, стиль CRLF+BOM сохранён', () => {
    const { cfDir, extDir } = newDirs();
    const style = STYLES[3];
    const file = writeExtRegister(extDir, [
      '\t\t\t<Resource uuid="22222222-2222-2222-2222-222222222222"><Properties><Name>Курс</Name></Properties></Resource>',
    ], style);

    const result = new CfeBorrowService().borrowChild(cfDir, extDir, 'InformationRegister', 'КурсыВалют', 'Template', 'Макет1');

    assert.deepStrictEqual(result, { alreadyBorrowed: false, files: [file] });
    assertStyle(file, style);
    const xml = fs.readFileSync(file, 'utf-8');
    assert.ok(xml.includes('<Template>Макет1</Template>'), 'текстовая ссылка на макет не добавлена');
    assert.deepStrictEqual(directChildObjectsTagSequence(xml.replace(/^\ufeff/, ''), 'InformationRegister'), ['Resource', 'Template']);
  });
});
