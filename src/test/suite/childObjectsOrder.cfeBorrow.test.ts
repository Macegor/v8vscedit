import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CfeBorrowService } from '../../infra/cfe/CfeBorrowService';
import { directChildObjectsTagSequence } from './support/childObjectsCorpus';

/**
 * T-14 — `CfeBorrowService.registerChildInParentObject`/`registerFormInParentObject`
 * дописывают заимствованные элементы БЕЗУСЛОВНО в конец
 * (`xml.replace('</ChildObjects>', ...)`), без учёта канона позиции по виду
 * владельца — тот же класс дефекта, что и в `childElementBuilders`/
 * `FormAddService`, но в отдельном сервисе (заимствование в расширение).
 */

function newDirs(): { cfDir: string; extDir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-cfeborrow-'));
  const cfDir = path.join(root, 'cf');
  const extDir = path.join(root, 'ext');
  fs.mkdirSync(cfDir, { recursive: true });
  fs.mkdirSync(extDir, { recursive: true });
  // borrowObject() безусловно дописывает ссылку в Configuration.xml расширения
  // (ConfigurationXmlEditor.addChildObject) — без него чтение файла падает ENOENT.
  const extConfigXml = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<MetaDataObject version="2.21">',
    '\t<Configuration>',
    '\t\t<Properties><Name>Расширение</Name></Properties>',
    '\t\t<ChildObjects/>',
    '\t</Configuration>',
    '</MetaDataObject>',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(extDir, 'Configuration.xml'), extConfigXml, 'utf-8');
  return { cfDir, extDir };
}

function writeSourceInformationRegister(cfDir: string): void {
  const dir = path.join(cfDir, 'InformationRegisters');
  fs.mkdirSync(dir, { recursive: true });
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" version="2.21">',
    '\t<InformationRegister uuid="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa">',
    '\t\t<Properties><Name>КурсыВалют</Name></Properties>',
    '\t\t<ChildObjects>',
    '\t\t\t<Dimension uuid="11111111-1111-1111-1111-111111111111"><Properties><Name>Валюта</Name><Type><v8:Type>xs:string</v8:Type></Type></Properties></Dimension>',
    '\t\t\t<Resource uuid="22222222-2222-2222-2222-222222222222"><Properties><Name>Курс</Name><Type><v8:Type>xs:decimal</v8:Type></Type></Properties></Resource>',
    '\t\t</ChildObjects>',
    '\t</InformationRegister>',
    '</MetaDataObject>',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'КурсыВалют.xml'), xml, 'utf-8');
}

function writeSourceCatalogWithFormSource(cfDir: string): void {
  const dir = path.join(cfDir, 'Catalogs');
  fs.mkdirSync(dir, { recursive: true });
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" version="2.21">',
    '\t<Catalog uuid="bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb">',
    '\t\t<Properties><Name>Клиенты</Name></Properties>',
    '\t\t<ChildObjects>',
    '\t\t\t<Attribute uuid="33333333-3333-3333-3333-333333333333"><Properties><Name>ИНН</Name><Type><v8:Type>xs:string</v8:Type></Type></Properties></Attribute>',
    '\t\t\t<TabularSection uuid="44444444-4444-4444-4444-444444444444"><Properties><Name>Контакты</Name></Properties><ChildObjects/></TabularSection>',
    '\t\t</ChildObjects>',
    '\t</Catalog>',
    '</MetaDataObject>',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'Клиенты.xml'), xml, 'utf-8');

  const formsDir = path.join(dir, 'Клиенты', 'Forms');
  fs.mkdirSync(formsDir, { recursive: true });
  const formMetaXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" version="2.21">',
    '\t<Form uuid="55555555-5555-5555-5555-555555555555">',
    '\t\t<Properties><Name>ФормаСписка</Name><FormType>Managed</FormType></Properties>',
    '\t</Form>',
    '</MetaDataObject>',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(formsDir, 'ФормаСписка.xml'), formMetaXml, 'utf-8');
  const formExtDir = path.join(formsDir, 'ФормаСписка', 'Ext');
  fs.mkdirSync(formExtDir, { recursive: true });
  fs.writeFileSync(path.join(formExtDir, 'Form.xml'), '<?xml version="1.0" encoding="UTF-8"?>\n<Form version="2.21"><Items/></Form>\n', 'utf-8');
}

suite('CfeBorrowService — T-14: канон позиции заимствованных элементов', () => {
  test('InformationRegister: заимствование Dimension затем Resource — итог Resource ПЕРЕД Dimension (канон Resource < Dimension)', () => {
    const { cfDir, extDir } = newDirs();
    writeSourceInformationRegister(cfDir);
    const service = new CfeBorrowService();

    const r1 = service.borrowChild(cfDir, extDir, 'InformationRegister', 'КурсыВалют', 'Dimension', 'Валюта');
    assert.strictEqual(r1.alreadyBorrowed, false);
    const r2 = service.borrowChild(cfDir, extDir, 'InformationRegister', 'КурсыВалют', 'Resource', 'Курс');
    assert.strictEqual(r2.alreadyBorrowed, false);

    const extXml = fs.readFileSync(path.join(extDir, 'InformationRegisters', 'КурсыВалют.xml'), 'utf-8');
    assert.deepStrictEqual(directChildObjectsTagSequence(extXml, 'InformationRegister'), ['Resource', 'Dimension']);
  });

  test('Catalog: заимствование формы после Attribute/TabularSection — форма встаёт ПОСЛЕ TabularSection, а не внутрь вложенного <ChildObjects> табличной части (канон: Attribute < TabularSection < Form)', () => {
    const { cfDir, extDir } = newDirs();
    writeSourceCatalogWithFormSource(cfDir);
    const service = new CfeBorrowService();

    assert.strictEqual(service.borrowChild(cfDir, extDir, 'Catalog', 'Клиенты', 'Attribute', 'ИНН').alreadyBorrowed, false);
    assert.strictEqual(service.borrowChild(cfDir, extDir, 'Catalog', 'Клиенты', 'TabularSection', 'Контакты').alreadyBorrowed, false);
    assert.strictEqual(service.borrowForm(cfDir, extDir, 'Catalog', 'Клиенты', 'ФормаСписка').alreadyBorrowed, false);

    const extXml = fs.readFileSync(path.join(extDir, 'Catalogs', 'Клиенты.xml'), 'utf-8');
    // ЛОВУШКА, которую находит именно этот тест: `registerFormInParentObject`
    // использует `xml.replace('</ChildObjects>', ...)` — нежадный/наивный поиск
    // ПЕРВОГО в документе текстового `</ChildObjects>`. У заимствованной
    // TabularSection есть СОБСТВЕННЫЙ вложенный `<ChildObjects>` (под колонки),
    // и его закрывающий тег текстуально идёт РАНЬШЕ закрывающего тега владельца
    // Catalog — форма сегодня попадает ВНУТРЬ табличной части, а не на
    // верхний уровень объекта.
    const tabularSectionBlock = /<TabularSection uuid="[^"]*">[\s\S]*?<\/TabularSection>/.exec(extXml)?.[0] ?? '';
    assert.ok(!tabularSectionBlock.includes('<Form>ФормаСписка</Form>'), 'форма не должна попадать ВНУТРЬ вложенного <ChildObjects> табличной части владельца');
    assert.deepStrictEqual(directChildObjectsTagSequence(extXml, 'Catalog'), ['Attribute', 'TabularSection', 'Form']);
  });

  test('ветка <ChildObjects/> (самозакрытый) — первое заимствование в свежесозданный объект: работает (регресс)', () => {
    const { cfDir, extDir } = newDirs();
    writeSourceInformationRegister(cfDir);
    const service = new CfeBorrowService();
    const result = service.borrowChild(cfDir, extDir, 'InformationRegister', 'КурсыВалют', 'Resource', 'Курс');
    assert.strictEqual(result.alreadyBorrowed, false);
    const extXml = fs.readFileSync(path.join(extDir, 'InformationRegisters', 'КурсыВалют.xml'), 'utf-8');
    assert.deepStrictEqual(directChildObjectsTagSequence(extXml, 'InformationRegister'), ['Resource']);
  });

  test('нет <ChildObjects> в целевом XML владельца (уже заимствован, но файл повреждён) — заимствование ребёнка тихо не удаётся: alreadyBorrowed=true, files=[]', () => {
    const { cfDir, extDir } = newDirs();
    writeSourceInformationRegister(cfDir);
    const extObjDir = path.join(extDir, 'InformationRegisters');
    fs.mkdirSync(extObjDir, { recursive: true });
    // Владелец УЖЕ «заимствован» (файл существует — isObjectBorrowed вернёт true),
    // но без блока <ChildObjects> вовсе — намеренно повреждённый целевой файл.
    fs.writeFileSync(
      path.join(extObjDir, 'КурсыВалют.xml'),
      '<?xml version="1.0" encoding="UTF-8"?>\n<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" version="2.21">\n\t<InformationRegister uuid="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa">\n\t\t<Properties><Name>КурсыВалют</Name></Properties>\n\t</InformationRegister>\n</MetaDataObject>\n',
      'utf-8'
    );
    const service = new CfeBorrowService();
    const result = service.borrowChild(cfDir, extDir, 'InformationRegister', 'КурсыВалют', 'Resource', 'Курс');
    assert.deepStrictEqual(result, { alreadyBorrowed: true, files: [] });
  });

  test('повторное заимствование ТОГО ЖЕ ребёнка не дублирует запись', () => {
    const { cfDir, extDir } = newDirs();
    writeSourceInformationRegister(cfDir);
    const service = new CfeBorrowService();
    assert.strictEqual(service.borrowChild(cfDir, extDir, 'InformationRegister', 'КурсыВалют', 'Resource', 'Курс').alreadyBorrowed, false);
    const before = fs.readFileSync(path.join(extDir, 'InformationRegisters', 'КурсыВалют.xml'), 'utf-8');

    const result = service.borrowChild(cfDir, extDir, 'InformationRegister', 'КурсыВалют', 'Resource', 'Курс');
    assert.strictEqual(result.alreadyBorrowed, true, 'повторное заимствование обязано определяться как «уже заимствовано»');
    const after = fs.readFileSync(path.join(extDir, 'InformationRegisters', 'КурсыВалют.xml'), 'utf-8');
    assert.strictEqual(after, before, 'файл не должен измениться при повторном заимствовании');
  });

  test('повторное заимствование ТОЙ ЖЕ формы не дублирует запись', () => {
    const { cfDir, extDir } = newDirs();
    writeSourceCatalogWithFormSource(cfDir);
    const service = new CfeBorrowService();
    assert.strictEqual(service.borrowForm(cfDir, extDir, 'Catalog', 'Клиенты', 'ФормаСписка').alreadyBorrowed, false);
    const before = fs.readFileSync(path.join(extDir, 'Catalogs', 'Клиенты.xml'), 'utf-8');

    const result = service.borrowForm(cfDir, extDir, 'Catalog', 'Клиенты', 'ФормаСписка');
    assert.strictEqual(result.alreadyBorrowed, true);
    const after = fs.readFileSync(path.join(extDir, 'Catalogs', 'Клиенты.xml'), 'utf-8');
    assert.strictEqual(after, before);
  });
});
