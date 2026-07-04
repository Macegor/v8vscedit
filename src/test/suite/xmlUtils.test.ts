import * as assert from 'assert';
import {
  buildLocalizedTag,
  escapeRegExp,
  escapeXmlAttribute,
  escapeXmlText,
  extractChildMetaElementsXml,
  extractColumnsXmlFromTabularSection,
  findChildElementRangeInBlock,
  findChildElementsFullXmlInBlock,
  findChildMetaElementRange,
  findColumnRangeInTabularSection,
  hasDirectChildElementNameInBlock,
  // Целевой единый unescapeXml (контракт X2): по проекту рассыпаны 4 идентичные
  // копии (DataCompositionSchemaService, SubsystemXmlService, CommandInterfaceService,
  // MxlTemplateService) — ни одна не декодирует &apos;/&#39;. Канонический вариант должен
  // жить здесь, в XmlUtils.ts, рядом с escapeXmlText/escapeXmlAttribute.
  // На момент написания теста экспорта ещё нет — это часть красного: импорт не скомпилируется,
  // пока unescapeXml не появится в XmlUtils.
  unescapeXml,
} from '../../infra/xml/XmlUtils';

suite('XmlUtils — escapeRegExp (единый, дедупликация 5a-1)', () => {
  test('экранирует все спецсимволы regexp', () => {
    assert.strictEqual(escapeRegExp('.*+?^${}()|[]\\'), '\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\');
  });

  test('обычные символы не изменяются', () => {
    assert.strictEqual(escapeRegExp('Контрагенты_123'), 'Контрагенты_123');
  });

  test('экранированное имя используется как литерал внутри RegExp', () => {
    // Имя с точкой (сегмент пути 1С) не должно трактоваться как «любой символ».
    const name = 'Справочники.Контрагенты';
    const re = new RegExp(`^${escapeRegExp(name)}$`);
    assert.ok(re.test('Справочники.Контрагенты'));
    assert.ok(!re.test('СправочникиXКонтрагенты'));
  });
});

suite('XmlUtils — buildLocalizedTag (единый с флагом, дедупликация 5a-2)', () => {
  test('дефолт: непустой текст → полный блок с v8:content', () => {
    const result = buildLocalizedTag('\t', 'Title', 'Заголовок');
    assert.strictEqual(
      result,
      ['\t<Title>', '\t\t<v8:item>', '\t\t\t<v8:lang>ru</v8:lang>',
       '\t\t\t<v8:content>Заголовок</v8:content>', '\t\t</v8:item>', '\t</Title>'].join('\n')
    );
  });

  test('дефолт (формы): пустой текст → всё равно полный блок, НЕ самозакрывающийся', () => {
    const result = buildLocalizedTag('\t', 'Title', '');
    assert.ok(result.includes('<v8:content></v8:content>'));
    assert.ok(!result.includes('<Title/>'));
  });

  test('emptyAsSelfClosing: пустой текст → <tag/>', () => {
    assert.strictEqual(
      buildLocalizedTag('\t\t\t', 'Synonym', '', { emptyAsSelfClosing: true }),
      '\t\t\t<Synonym/>'
    );
  });

  test('emptyAsSelfClosing с непустым текстом → полный блок', () => {
    const result = buildLocalizedTag('\t\t\t', 'Synonym', 'Имя', { emptyAsSelfClosing: true });
    assert.ok(result.includes('<v8:content>Имя</v8:content>'));
    assert.ok(!result.includes('<Synonym/>'));
  });

  test('текст экранируется как значение атрибута (& → &amp;)', () => {
    const result = buildLocalizedTag('', 'Title', 'A & B');
    assert.ok(result.includes('<v8:content>A &amp; B</v8:content>'));
  });
});

suite('XmlUtils — unescapeXml (единый, контракт X2)', () => {
  test('декодирует все 5 предопределённых сущностей XML', () => {
    assert.strictEqual(unescapeXml('&lt;'), '<');
    assert.strictEqual(unescapeXml('&gt;'), '>');
    assert.strictEqual(unescapeXml('&amp;'), '&');
    assert.strictEqual(unescapeXml('&quot;'), '"');
    assert.strictEqual(unescapeXml('&apos;'), "'");
  });

  test('декодирует числовую сущность &#39; в апостроф', () => {
    // &#39; — числовая форма апострофа, которую иногда пишет платформа вместо &apos;.
    assert.strictEqual(unescapeXml('&#39;'), "'");
  });

  test('&amp; декодируется ПОСЛЕДНИМ — нет двойного декодирования', () => {
    // Если сначала раскрыть &lt;/&gt;/&quot;/&apos;, а потом &amp; — буквальная строка
    // "&amp;lt;" (то есть литерал "&lt;" в исходном XML) НЕ должна превратиться в "<".
    // Порядок замен в реализации имеет значение: &amp; обязан быть последним.
    assert.strictEqual(unescapeXml('&amp;lt;'), '&lt;');
    assert.strictEqual(unescapeXml('&amp;quot;'), '&quot;');
    assert.strictEqual(unescapeXml('&amp;apos;'), '&apos;');
  });

  test('round-trip: значение с одинарной и двойной кавычкой через escape→unescape возвращает исходное', () => {
    const original = `Значение с 'апострофом' и "кавычками"`;
    assert.strictEqual(unescapeXml(escapeXmlText(original)), original);
    assert.strictEqual(unescapeXml(escapeXmlAttribute(original)), original);
  });
});

// Реальная структура блока <ChildObjects> объекта метаданных: две табличные части,
// у второй — своя вложенная колонка с ИМЕНЕМ, совпадающим с колонкой первой ТЧ.
// Используется для проверки как happy-path, так и негативных веток (элемент/имя не найдены)
// трёх новых депт-аварных range-локаторов (контракт X2).
const OBJECT_XML = [
  '<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" xmlns:v8="http://v8.1c.ru/8.1/data/core" version="2.21">',
  '\t<Document uuid="11111111-1111-1111-1111-111111111111">',
  '\t\t<Properties>',
  '\t\t\t<Name>Документ1</Name>',
  '\t\t</Properties>',
  '\t\t<ChildObjects>',
  '\t\t\t<TabularSection uuid="22222222-2222-2222-2222-222222222222">',
  '\t\t\t\t<Properties>',
  '\t\t\t\t\t<Name>Товары</Name>',
  '\t\t\t\t</Properties>',
  '\t\t\t\t<ChildObjects>',
  '\t\t\t\t\t<Attribute uuid="aaaaaaaa-0000-0000-0000-000000000001">',
  '\t\t\t\t\t\t<Properties>',
  '\t\t\t\t\t\t\t<Name>Количество</Name>',
  '\t\t\t\t\t\t</Properties>',
  '\t\t\t\t\t</Attribute>',
  '\t\t\t\t</ChildObjects>',
  '\t\t\t</TabularSection>',
  '\t\t\t<TabularSection uuid="33333333-3333-3333-3333-333333333333">',
  '\t\t\t\t<Properties>',
  '\t\t\t\t\t<Name>ТоварыВозврат</Name>',
  '\t\t\t\t</Properties>',
  '\t\t\t\t<ChildObjects>',
  '\t\t\t\t\t<Attribute uuid="aaaaaaaa-0000-0000-0000-000000000002">',
  '\t\t\t\t\t\t<Properties>',
  '\t\t\t\t\t\t\t<Name>Количество</Name>',
  '\t\t\t\t\t\t</Properties>',
  '\t\t\t\t\t</Attribute>',
  '\t\t\t\t</ChildObjects>',
  '\t\t\t</TabularSection>',
  '\t\t</ChildObjects>',
  '\t</Document>',
  '</MetaDataObject>',
].join('\n');

suite('XmlUtils — findChildElementRangeInBlock (контракт X2, депт-аварный range-локатор)', () => {
  function childObjectsInner(): string {
    const range = /<ChildObjects>([\s\S]*)<\/ChildObjects>\s*<\/Document>/.exec(OBJECT_XML);
    if (!range) {
      throw new Error('верхний ChildObjects должен быть найден в тестовой фикстуре');
    }
    return range[1];
  }

  test('находит диапазон второй ТЧ по имени; срез содержит именно её узел', () => {
    const block = childObjectsInner();
    const range = findChildElementRangeInBlock(block, 'TabularSection', 'ТоварыВозврат');
    if (!range) {
      throw new Error('диапазон ТЧ "ТоварыВозврат" должен быть найден');
    }
    const slice = block.slice(range.start, range.end);
    assert.ok(slice.includes('<Name>ТоварыВозврат</Name>'));
    assert.ok(!slice.includes('<Name>Товары</Name>' + '\n\t\t\t\t</Properties>') || slice.includes('ТоварыВозврат'));
  });

  test('элемент с искомым тегом есть, но имя не совпадает ни у одного — возвращает null', () => {
    const block = childObjectsInner();
    const range = findChildElementRangeInBlock(block, 'TabularSection', 'НесуществующаяТЧ');
    assert.strictEqual(range, null);
  });

  test('тег, которого нет в блоке вовсе — возвращает null (цикл findDirectElementRanges пуст)', () => {
    const block = childObjectsInner();
    const range = findChildElementRangeInBlock(block, 'Form', 'ЛюбаяФорма');
    assert.strictEqual(range, null);
  });

  test('прямой потомок с искомым тегом не содержит <Name> (нет Properties/Name) — пропускается, возвращает null', () => {
    const block = [
      '<Attribute uuid="bbbbbbbb-0000-0000-0000-000000000001">',
      '<SomethingElse/>',
      '</Attribute>',
    ].join('\n');
    const range = findChildElementRangeInBlock(block, 'Attribute', 'Любое');
    assert.strictEqual(range, null);
  });
});

suite('XmlUtils — findChildMetaElementRange (контракт X2, абсолютный диапазон в полном XML)', () => {
  test('находит абсолютный диапазон дочернего объекта из верхнего ChildObjects', () => {
    const range = findChildMetaElementRange(OBJECT_XML, 'TabularSection', 'ТоварыВозврат');
    if (!range) {
      throw new Error('диапазон ТЧ "ТоварыВозврат" должен быть найден');
    }
    const slice = OBJECT_XML.slice(range.start, range.end);
    assert.ok(slice.includes('<Name>ТоварыВозврат</Name>'));
    assert.ok(slice.startsWith('<TabularSection'));
  });

  test('верхнего <ChildObjects> нет вовсе — возвращает null', () => {
    const xmlWithoutChildObjects = '<MetaDataObject><Document><Properties><Name>Документ1</Name></Properties></Document></MetaDataObject>';
    const range = findChildMetaElementRange(xmlWithoutChildObjects, 'TabularSection', 'Товары');
    assert.strictEqual(range, null);
  });

  test('<ChildObjects> есть, но искомого имени внутри нет — возвращает null', () => {
    const range = findChildMetaElementRange(OBJECT_XML, 'TabularSection', 'НесуществующаяТЧ');
    assert.strictEqual(range, null);
  });
});

suite('XmlUtils — findColumnRangeInTabularSection (контракт X2, абсолютный диапазон колонки)', () => {
  test('находит абсолютный диапазон колонки именно во ВТОРОЙ ТЧ, а не в первой с тем же именем колонки', () => {
    const range = findColumnRangeInTabularSection(OBJECT_XML, 'ТоварыВозврат', 'Количество');
    if (!range) {
      throw new Error('диапазон колонки "Количество" в "ТоварыВозврат" должен быть найден');
    }
    const slice = OBJECT_XML.slice(range.start, range.end);
    assert.ok(slice.includes('aaaaaaaa-0000-0000-0000-000000000002'), 'должна быть найдена колонка ИМЕННО второй ТЧ');
    assert.ok(!slice.includes('aaaaaaaa-0000-0000-0000-000000000001'), 'колонка первой ТЧ не должна попасть в диапазон');
  });

  test('искомой табличной части не существует — возвращает null', () => {
    const range = findColumnRangeInTabularSection(OBJECT_XML, 'НесуществующаяТЧ', 'Количество');
    assert.strictEqual(range, null);
  });

  test('табличная часть найдена, но у неё нет собственного вложенного <ChildObjects> — возвращает null', () => {
    const xmlWithEmptySection = [
      '<MetaDataObject>',
      '<Document>',
      '<ChildObjects>',
      '<TabularSection>',
      '<Properties><Name>ПустаяТЧ</Name></Properties>',
      '</TabularSection>',
      '</ChildObjects>',
      '</Document>',
      '</MetaDataObject>',
    ].join('\n');
    const range = findColumnRangeInTabularSection(xmlWithEmptySection, 'ПустаяТЧ', 'Количество');
    assert.strictEqual(range, null);
  });

  test('табличная часть и вложенный ChildObjects есть, но искомой колонки среди них нет — возвращает null', () => {
    const range = findColumnRangeInTabularSection(OBJECT_XML, 'Товары', 'НесуществующаяКолонка');
    assert.strictEqual(range, null);
  });
});

// Общий блок верхнего <ChildObjects> — фикстура для проверки всех потребителей
// приватного генератора iterateDirectChildrenWithName (дедупликация 5a-3).
function topChildObjectsInner(): string {
  const range = /<ChildObjects>([\s\S]*)<\/ChildObjects>\s*<\/Document>/.exec(OBJECT_XML);
  if (!range) {
    throw new Error('верхний ChildObjects должен быть найден в тестовой фикстуре');
  }
  return range[1];
}

suite('XmlUtils — hasDirectChildElementNameInBlock (потребитель iterateDirectChildrenWithName, 5a-3)', () => {
  test('находит существующий прямой дочерний элемент по <Name> — true', () => {
    assert.strictEqual(hasDirectChildElementNameInBlock(topChildObjectsInner(), 'TabularSection', 'ТоварыВозврат'), true);
  });

  test('элемента с таким именем нет — false', () => {
    assert.strictEqual(hasDirectChildElementNameInBlock(topChildObjectsInner(), 'TabularSection', 'НесуществующаяТЧ'), false);
  });

  test('fallback: у прямого потомка нет <Name> — имя берётся из всего текста узла', () => {
    const block = [
      '<Attribute uuid="cccccccc-0000-0000-0000-000000000001">',
      '<Ref>СправочникСсылка.Тест</Ref>',
      '</Attribute>',
    ].join('\n');
    // Нет тега <Name>, поэтому имя — это весь текст узла (fallback-ветка).
    assert.strictEqual(hasDirectChildElementNameInBlock(block, 'Attribute', 'СправочникСсылка.Тест'), true);
  });
});

suite('XmlUtils — findChildElementsFullXmlInBlock (потребитель iterateDirectChildrenWithName, 5a-3)', () => {
  test('возвращает все прямые дочерние элементы тега с их именами и полным XML', () => {
    const items = findChildElementsFullXmlInBlock(topChildObjectsInner(), 'TabularSection');
    assert.strictEqual(items.length, 2);
    assert.deepStrictEqual(items.map((item) => item.name), ['Товары', 'ТоварыВозврат']);
    assert.ok(items[1].xml.includes('aaaaaaaa-0000-0000-0000-000000000002'));
  });

  test('тега в блоке нет вовсе — пустой список', () => {
    assert.deepStrictEqual(findChildElementsFullXmlInBlock(topChildObjectsInner(), 'Form'), []);
  });

  test('прямой потомок без <Name> пропускается (фильтр по nameNode)', () => {
    const block = [
      '<Attribute uuid="dddddddd-0000-0000-0000-000000000001">',
      '<SomethingElse/>',
      '</Attribute>',
    ].join('\n');
    assert.deepStrictEqual(findChildElementsFullXmlInBlock(block, 'Attribute'), []);
  });
});

suite('XmlUtils — extractChildMetaElementsXml / extractColumnsXmlFromTabularSection (5a-3)', () => {
  test('extractChildMetaElementsXml возвращает обе табличные части из главного ChildObjects', () => {
    const items = extractChildMetaElementsXml(OBJECT_XML, 'TabularSection');
    assert.deepStrictEqual(items.map((item) => item.name), ['Товары', 'ТоварыВозврат']);
  });

  test('extractChildMetaElementsXml: верхнего ChildObjects нет — пустой список', () => {
    const xmlWithoutChildObjects = '<MetaDataObject><Document><Properties><Name>Документ1</Name></Properties></Document></MetaDataObject>';
    assert.deepStrictEqual(extractChildMetaElementsXml(xmlWithoutChildObjects, 'TabularSection'), []);
  });

  test('extractColumnsXmlFromTabularSection возвращает колонки конкретной табличной части', () => {
    const columns = extractColumnsXmlFromTabularSection(OBJECT_XML, 'ТоварыВозврат');
    assert.strictEqual(columns.length, 1);
    assert.strictEqual(columns[0].name, 'Количество');
    assert.ok(columns[0].xml.includes('aaaaaaaa-0000-0000-0000-000000000002'));
  });

  test('extractColumnsXmlFromTabularSection: табличной части не существует — пустой список', () => {
    assert.deepStrictEqual(extractColumnsXmlFromTabularSection(OBJECT_XML, 'НесуществующаяТЧ'), []);
  });

  test('extractColumnsXmlFromTabularSection: табличная часть без вложенного ChildObjects — пустой список', () => {
    const xmlWithEmptySection = [
      '<MetaDataObject>',
      '<Document>',
      '<ChildObjects>',
      '<TabularSection>',
      '<Properties><Name>ПустаяТЧ</Name></Properties>',
      '</TabularSection>',
      '</ChildObjects>',
      '</Document>',
      '</MetaDataObject>',
    ].join('\n');
    assert.deepStrictEqual(extractColumnsXmlFromTabularSection(xmlWithEmptySection, 'ПустаяТЧ'), []);
  });
});
