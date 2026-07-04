import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DataCompositionSchemaService } from '../../infra/xml/DataCompositionSchemaService';

const EXAMPLE_CF_221 = path.resolve(__dirname, '../../../example/2.21/src/cf');

// Реальная фикстура из выгрузки: отчёт "Запасы" содержит одновременно dataSetLink,
// несколько settingsVariant и DataSetUnion. Используется только чтобы задокументировать
// форму реальных СКД-выгрузок 1С: dataSetLink здесь хранит связь как sourceExpression/
// destinationExpression НАПРЯМУЮ, без обёртки <field> (в отличие от того, что генерирует
// buildDataSetLinkXml нашего сервиса — см. следующий тест). Сами мутаторы работают с
// "плоским" форматом, который генерирует compile(), поэтому для операций edit() ниже
// строим схему через service.compile(), как это уже делает mxlSkdServices.test.ts.
const REAL_SKD_WITH_UNION_AND_VARIANTS = path.join(
  EXAMPLE_CF_221,
  'Reports',
  'Запасы',
  'Templates',
  'ОсновнаяСхемаКомпоновкиДанных',
  'Ext',
  'Template.xml'
);

suite('DataCompositionSchemaService — корректность мутаторов при вложенности (M1) и прицельный rename (M3)', () => {
  test('документирует реальную форму СКД-выгрузки: dataSetLink без обёртки field, несколько settingsVariant, DataSetUnion присутствует', () => {
    const xml = fs.readFileSync(REAL_SKD_WITH_UNION_AND_VARIANTS, 'utf-8');
    assert.ok(xml.includes('<dataSetLink>'), 'ожидался dataSetLink в реальной выгрузке');
    assert.ok(/<dataSetLink>[\s\S]*?<sourceExpression>/.test(xml), 'dataSetLink должен содержать sourceExpression');
    assert.ok(xml.includes('DataSetUnion'), 'ожидался DataSetUnion в реальной выгрузке (union-набор данных)');
    assert.ok((xml.match(/<settingsVariant>/g) ?? []).length >= 2, 'ожидалось несколько settingsVariant');
  });

  test('add-dataSetLink не путает dataSetLink.field с dataSet.field: modify-field одноимённого поля меняет только dataSet, dataSetLink остаётся прежним', () => {
    // dataSetLink и dataSet после add-dataSetLink оба содержат текст "Товар" в поле field —
    // dataSet.field как <dataPath>/<field>, dataSetLink.field как <sourceExpression>/<destinationExpression>.
    // Мутатор modify-field обязан менять только дерево конкретного dataSet (по диапазону),
    // не задевая dataSetLink, даже если оба содержат одноимённый текст "Товар".
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-skd-nesting-'));
    const templatePath = path.join(root, 'Схема', 'Ext', 'Template.xml');
    const service = new DataCompositionSchemaService();

    service.compile({
      outputPath: templatePath,
      definition: {
        dataSets: [
          { name: 'НаборДанных1', query: 'ВЫБРАТЬ 1 КАК Товар', fields: ['Товар: string'] },
          { name: 'НаборДанных2', query: 'ВЫБРАТЬ 1 КАК Товар', fields: ['Товар: string'] },
        ],
      },
    });
    service.edit({
      templatePath,
      operation: 'add-dataSetLink',
      value: 'НаборДанных1 > НаборДанных2 on Товар = Товар',
    });

    const before = fs.readFileSync(templatePath, 'utf-8');
    assert.ok(before.includes('<sourceExpression>Товар</sourceExpression>'));

    service.edit({
      templatePath,
      operation: 'modify-field',
      value: 'Товар [Артикул товара]: string',
      dataSet: 'НаборДанных1',
    });

    const after = fs.readFileSync(templatePath, 'utf-8');
    // dataSet.НаборДанных1.field получил новый title — подтверждает, что modify-field применился.
    assert.ok(after.includes('<v8:content>Артикул товара</v8:content>'), 'modify-field должен был применить title к целевому набору');
    // dataSetLink не должен быть задет операцией над dataSet.
    assert.ok(after.includes('<sourceExpression>Товар</sourceExpression>'), 'dataSetLink.field не должен быть тронут modify-field');
    assert.ok(after.includes('<destinationExpression>Товар</destinationExpression>'), 'dataSetLink.field не должен быть тронут modify-field');
  });

  test('modify-filter второго settingsVariant с идентичной структурой первого не меняет первый вариант', () => {
    // Оба варианта построены из одинаковых selection/filter/structure — единственное
    // отличие внутри settings-блока после редактирования должно появиться у "Второй".
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-skd-variants-'));
    const templatePath = path.join(root, 'Схема', 'Ext', 'Template.xml');
    const service = new DataCompositionSchemaService();

    service.compile({
      outputPath: templatePath,
      definition: {
        dataSets: [{ name: 'НаборДанных1', query: 'ВЫБРАТЬ 1 КАК Товар', fields: ['Товар: string'] }],
        settingsVariants: [
          { name: 'Первый', selection: ['Товар'], filter: ['Товар = _'], structure: 'details' },
          { name: 'Второй', selection: ['Товар'], filter: ['Товар = _'], structure: 'details' },
        ],
      },
    });

    service.edit({ templatePath, operation: 'modify-filter', value: 'Товар = Иванов', variant: 'Второй' });

    const xml = fs.readFileSync(templatePath, 'utf-8');
    const variants = [...xml.matchAll(/<settingsVariant>[\s\S]*?<\/settingsVariant>/g)].map((match) => match[0]);
    assert.strictEqual(variants.length, 2);

    const first = variants.find((block) => block.includes('<name>Первый</name>')) ?? '';
    const second = variants.find((block) => block.includes('<name>Второй</name>')) ?? '';

    assert.ok(!first.includes('<right>'), 'первый вариант не должен получить значение фильтра');
    assert.ok(second.includes('<right>Иванов</right>'), 'второй вариант должен получить изменённое значение фильтра');
  });
});

suite('DataCompositionSchemaService — rename-parameter должен быть прицельным (M3)', () => {
  test('rename-parameter меняет <name> параметра и ссылки &Имя, но НЕ трогает dataPath/field/значение фильтра с тем же текстом', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-skd-rename-'));
    const templatePath = path.join(root, 'Схема', 'Ext', 'Template.xml');
    const service = new DataCompositionSchemaService();

    service.compile({
      outputPath: templatePath,
      definition: {
        dataSets: [{
          name: 'НаборДанных1',
          // Ссылка на параметр `&Товар` в тексте запроса — именно её rename обязан
          // переименовать (в XML хранится как `&amp;Товар`). Кириллическое имя — тот
          // случай, где `\b`-граница не срабатывает.
          query: 'ВЫБРАТЬ Товары.Ссылка КАК Товар ИЗ Справочник.Товары КАК Товары ГДЕ Товары.Наименование = &Товар',
          fields: ['Товар [Товар]: CatalogRef.Товары'],
        }],
        parameters: ['Товар: CatalogRef.Товары'],
        settingsVariants: [{ name: 'Основной', selection: ['Товар'], filter: ['Товар = _'], structure: 'details' }],
      },
    });

    const edit = service.edit({ templatePath, operation: 'rename-parameter', value: 'Товар => Продукт' });
    assert.strictEqual(edit.warnings.length, 0);

    const xml = fs.readFileSync(templatePath, 'utf-8');

    // Параметр переименован.
    const parameterBlock = /<parameter>[\s\S]*?<\/parameter>/.exec(xml)?.[0] ?? '';
    assert.ok(parameterBlock.includes('<name>Продукт</name>'), 'имя параметра должно стать "Продукт"');

    // dataPath и field набора данных — это ссылка на поле результата запроса, а не на параметр:
    // переименование параметра НЕ должно их менять.
    const fieldBlock = /<field xsi:type="DataSetFieldField">[\s\S]*?<\/field>/.exec(xml)?.[0] ?? '';
    assert.ok(fieldBlock.includes('<dataPath>Товар</dataPath>'), 'dataPath поля набора данных не должен измениться при rename-parameter');
    assert.ok(fieldBlock.includes('<field>Товар</field>'), 'field поля набора данных не должен измениться при rename-parameter');

    // Значение фильтра варианта настроек — тоже не параметр, а обычное значение поля.
    const filterBlock = /<filter>[\s\S]*?<\/filter>/.exec(xml)?.[0] ?? '';
    assert.ok(filterBlock.includes('<left>Товар</left>'), 'поле фильтра не должно измениться при rename-parameter');

    // Ссылка на параметр в тексте запроса (`&amp;Товар`) ДОЛЖНА быть переименована —
    // это ключевая часть ТЗ M3, ломавшаяся на кириллице из-за `\b`.
    const queryBlock = /<query>[\s\S]*?<\/query>/.exec(xml)?.[0] ?? '';
    assert.ok(queryBlock.includes('&amp;Продукт'), 'ссылка на параметр &Товар в запросе должна стать &Продукт');
    assert.ok(!queryBlock.includes('&amp;Товар'), 'старой ссылки &Товар в запросе остаться не должно');
    // При этом псевдоним поля `КАК Товар` (не ссылка на параметр) не должен пострадать.
    assert.ok(queryBlock.includes('КАК Товар '), 'псевдоним поля "КАК Товар" не должен переименовываться');
  });
});
