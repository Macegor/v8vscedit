import * as assert from 'assert';
import { registerFormInObjectXml } from '../../infra/xml/form/FormAddService';
import { directChildObjectsTagSequence } from './support/childObjectsCorpus';

/**
 * T-13 — `FormAddService.registerFormInObjectXml` содержит СВОЁ, отдельное от
 * `childElementBuilders.addChildToObjectXml` правило позиционирования формы
 * (регекс `insertBefore = /(\n\s*<(?:Template|TabularSection)>)/`), причём
 * ЧАСТИЧНО МЁРТВОЕ: `<TabularSection>` в реальных файлах ВСЕГДА несёт атрибут
 * `uuid="…"` (`<TabularSection uuid="…">`), поэтому буквальный `<TabularSection>`
 * без атрибутов не матчится НИКОГДА — регекс фактически реагирует только на
 * простые ссылки `<Template>Имя</Template>` (без атрибутов). Чтобы не зависеть
 * от этой случайности, фикстуры ниже используют завершающим существующим
 * элементом `<Command>` (ПОЛНЫЙ блок, с `uuid`) — он НИКОГДА не матчится дохлым
 * регексом, поэтому текущая реализация детерминированно уходит в ветку
 * «дописать в конец» и надёжно проваливает тест там, где канон требует
 * позиции НЕ в конце.
 */

function buildOwnerFixture(rootTag: string, childrenXmlLines: readonly string[], indent = '\t\t\t'): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" version="2.21">`,
    `\t<${rootTag} uuid="00000000-0000-0000-0000-000000000000">`,
    '\t\t<Properties>',
    '\t\t\t<Name>Тест</Name>',
    '\t\t</Properties>',
    '\t\t<ChildObjects>',
    ...childrenXmlLines.map((line) => `${indent}${line}`),
    '\t\t</ChildObjects>',
    `\t</${rootTag}>`,
    '</MetaDataObject>',
    '',
  ].join('\n');
}

function attributeBlock(tag: string, uuid: string, name: string): string {
  return `<${tag} uuid="${uuid}"><Properties><Name>${name}</Name></Properties></${tag}>`;
}

function tabularSectionBlock(uuid: string, name: string): string {
  return `<TabularSection uuid="${uuid}"><Properties><Name>${name}</Name></Properties><ChildObjects/></TabularSection>`;
}

function commandBlock(uuid: string, name: string): string {
  return `<Command uuid="${uuid}"><Properties><Name>${name}</Name></Properties></Command>`;
}

suite('FormAddService.registerFormInObjectXml — T-13: канон позиции формы по виду владельца', () => {
  test('Document: форма встаёт МЕЖДУ Attribute и TabularSection (канон: Attribute < Form < TabularSection < Command)', () => {
    const xml = buildOwnerFixture('Document', [
      attributeBlock('Attribute', '11111111-1111-1111-1111-111111111111', 'Реквизит1'),
      tabularSectionBlock('22222222-2222-2222-2222-222222222222', 'ТЧ1'),
      commandBlock('33333333-3333-3333-3333-333333333333', 'Команда1'),
    ]);
    const result = registerFormInObjectXml(xml, 'НоваяФорма');
    assert.deepStrictEqual(directChildObjectsTagSequence(result, 'Document'), ['Attribute', 'Form', 'TabularSection', 'Command']);
  });

  test('Catalog: форма встаёт ПОСЛЕ TabularSection и ДО Command (канон: Attribute < TabularSection < Form < Template < Command)', () => {
    const xml = buildOwnerFixture('Catalog', [
      attributeBlock('Attribute', '11111111-1111-1111-1111-111111111111', 'Реквизит1'),
      tabularSectionBlock('22222222-2222-2222-2222-222222222222', 'ТЧ1'),
      commandBlock('33333333-3333-3333-3333-333333333333', 'Команда1'),
    ]);
    const result = registerFormInObjectXml(xml, 'НоваяФорма');
    assert.deepStrictEqual(directChildObjectsTagSequence(result, 'Catalog'), ['Attribute', 'TabularSection', 'Form', 'Command']);
  });

  test('Task: форма встаёт ДО AddressingAttribute (канон: Attribute < TabularSection < Form < AddressingAttribute < Command)', () => {
    const xml = buildOwnerFixture('Task', [
      tabularSectionBlock('11111111-1111-1111-1111-111111111111', 'ТЧ1'),
      attributeBlock('AddressingAttribute', '22222222-2222-2222-2222-222222222222', 'Адресация1'),
      commandBlock('33333333-3333-3333-3333-333333333333', 'Команда1'),
    ]);
    const result = registerFormInObjectXml(xml, 'НоваяФорма');
    assert.deepStrictEqual(directChildObjectsTagSequence(result, 'Task'), ['TabularSection', 'Form', 'AddressingAttribute', 'Command']);
  });

  test('InformationRegister: форма встаёт ПОСЛЕ Dimension (канон: Resource < Attribute < Dimension < Form < Command)', () => {
    const xml = buildOwnerFixture('InformationRegister', [
      attributeBlock('Resource', '11111111-1111-1111-1111-111111111111', 'Рес1'),
      attributeBlock('Attribute', '22222222-2222-2222-2222-222222222222', 'Рекв1'),
      attributeBlock('Dimension', '33333333-3333-3333-3333-333333333333', 'Изм1'),
      commandBlock('44444444-4444-4444-4444-444444444444', 'Команда1'),
    ]);
    const result = registerFormInObjectXml(xml, 'НоваяФорма');
    assert.deepStrictEqual(directChildObjectsTagSequence(result, 'InformationRegister'), ['Resource', 'Attribute', 'Dimension', 'Form', 'Command']);
  });

  test('пустой <ChildObjects/> — форма становится единственным элементом (регресс, уже работает)', () => {
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" version="2.21">',
      '\t<Catalog uuid="00000000-0000-0000-0000-000000000000">',
      '\t\t<Properties><Name>Тест</Name></Properties>',
      '\t\t<ChildObjects/>',
      '\t</Catalog>',
      '</MetaDataObject>',
      '',
    ].join('\n');
    const result = registerFormInObjectXml(xml, 'НоваяФорма');
    assert.deepStrictEqual(directChildObjectsTagSequence(result, 'Catalog'), ['Form']);
    assert.ok(result.includes('<Form>НоваяФорма</Form>'));
  });

  test('повторный вызов (форма уже зарегистрирована) — xml возвращается БЕЗ ИЗМЕНЕНИЙ (регресс, уже работает)', () => {
    const xml = buildOwnerFixture('Catalog', [
      tabularSectionBlock('11111111-1111-1111-1111-111111111111', 'ТЧ1'),
      '<Form>СуществующаяФорма</Form>',
    ]);
    const result = registerFormInObjectXml(xml, 'СуществующаяФорма');
    assert.strictEqual(result, xml, 'при уже зарегистрированной форме xml не должен меняться вовсе');
  });

  test('отсутствие <ChildObjects> в XML владельца → throw (регресс, уже работает)', () => {
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" version="2.21">',
      '\t<Catalog uuid="00000000-0000-0000-0000-000000000000">',
      '\t\t<Properties><Name>Тест</Name></Properties>',
      '\t</Catalog>',
      '</MetaDataObject>',
      '',
    ].join('\n');
    assert.throws(() => registerFormInObjectXml(xml, 'НоваяФорма'), /Не найден ChildObjects/);
  });

  test('отступ, отличный от "\\t\\t\\t" (2 пробела) — новая строка формы использует ОТСТУП ФАЙЛА, а не захардкоженный "\\t\\t\\t"', () => {
    const xml = buildOwnerFixture('Catalog', [
      tabularSectionBlock('11111111-1111-1111-1111-111111111111', 'ТЧ1'),
      commandBlock('22222222-2222-2222-2222-222222222222', 'Команда1'),
    ], '  ');
    const result = registerFormInObjectXml(xml, 'НоваяФорма');
    assert.ok(
      result.includes('\n  <Form>НоваяФорма</Form>'),
      'строка формы обязана иметь тот же отступ (2 пробела), что и остальные дети ChildObjects этого файла'
    );
    assert.ok(!result.includes('\t\t\t<Form>НоваяФорма</Form>'), 'не должен использоваться захардкоженный табуляционный отступ на файле с иным стилем');
  });
});
