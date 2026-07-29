import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MetadataValidationService, ObjectXmlReader } from '../../infra/xml';
import {
  buildTypedFieldPropertyBlocks,
  findDisallowedTypedFieldProperties,
  getDisplayTypedFieldPropertyKeys,
  getTypedFieldPropertyKeys,
  isTypedFieldControlledPropertyKey,
  normalizeTypedFieldPropertiesAfterTypeChange,
  toRegisterOwnerKind,
} from '../../infra/xml/TypedFieldPropertyRules';

const EXAMPLE_CF_2_21 = path.resolve(__dirname, '../../../example/2.21/src/cf');

const STRING_TYPE = [
  '<v8:Type>xs:string</v8:Type>',
  '<v8:StringQualifiers>',
  '\t<v8:Length>10</v8:Length>',
  '\t<v8:AllowedLength>Variable</v8:AllowedLength>',
  '</v8:StringQualifiers>',
].join('\n');

const NUMBER_TYPE = [
  '<v8:Type>xs:decimal</v8:Type>',
  '<v8:NumberQualifiers>',
  '\t<v8:Digits>15</v8:Digits>',
  '\t<v8:FractionDigits>0</v8:FractionDigits>',
  '\t<v8:AllowedSign>Any</v8:AllowedSign>',
  '</v8:NumberQualifiers>',
].join('\n');

suite('registerFieldProperties — состав свойств полей регистра при смене типа', () => {
  test('set_type измерения и ресурса РС не подмешивает свойства РН/РБ', () => {
    // Воспроизведение из очереди недочётов: add_information_register →
    // add_dimension → add_resource → set_type. После set_type платформа
    // отказывалась грузить конфигурацию: «Свойство UseInTotals не входит
    // в состав объекта метаданных Dimension».
    const xmlPath = writeRegisterXml('InformationRegister', 'ее_ТестБагРС');
    const reader = new ObjectXmlReader();

    assert.strictEqual(
      reader.updateTypeInObject(xmlPath, { targetKind: 'Dimension', targetName: 'Изм', typeInnerXml: STRING_TYPE }),
      true
    );
    assert.strictEqual(
      reader.updateTypeInObject(xmlPath, { targetKind: 'Resource', targetName: 'РесЧисло', typeInnerXml: NUMBER_TYPE }),
      true
    );

    const xml = fs.readFileSync(xmlPath, 'utf-8');
    for (const alien of ['UseInTotals', 'Balance', 'AccountingFlag', 'RoundingMode']) {
      assert.ok(!xml.includes(`<${alien}`), `свойство ${alien} не должно попадать в поля регистра сведений`);
    }
    // Ролевые свойства измерения РС при этом на месте.
    for (const own of ['Master', 'MainFilter', 'DenyIncompleteValues', 'TypeReductionMode']) {
      assert.ok(xml.includes(`<${own}`), `свойство ${own} измерения РС должно сохраняться`);
    }
  });

  test('set_type измерения и ресурса — состав ролевых свойств по всем видам регистров (end-to-end через updateTypeInObject)', () => {
    // Дополняет предыдущий сценарий остальными видами регистров: вид владельца
    // здесь определяется ИЗ КОРНЯ ФАЙЛА через detectNormalizedTypeOwnerTag внутри
    // самого updateTypeInObject, а не передаётся напрямую в
    // normalizeTypedFieldPropertiesAfterTypeChange — эту проводку нужно проверить
    // отдельно для АН/РБ, иначе регрессия детектора владельца прошла бы незамеченной.
    const cases: {
      owner: 'InformationRegister' | 'AccumulationRegister' | 'AccountingRegister';
      dimensionExpected: string[];
      dimensionForbidden: string[];
      resourceExpected: string[];
      resourceForbidden: string[];
    }[] = [
      {
        owner: 'InformationRegister',
        dimensionExpected: ['Master', 'MainFilter', 'DenyIncompleteValues', 'TypeReductionMode'],
        dimensionForbidden: ['UseInTotals', 'Balance', 'AccountingFlag', 'ExtDimensionAccountingFlag', 'RoundingMode'],
        resourceExpected: [],
        resourceForbidden: ['Balance', 'AccountingFlag', 'ExtDimensionAccountingFlag', 'UseInTotals', 'RoundingMode'],
      },
      {
        owner: 'AccumulationRegister',
        dimensionExpected: ['DenyIncompleteValues', 'UseInTotals'],
        dimensionForbidden: [
          'Master', 'MainFilter', 'TypeReductionMode', 'Balance', 'AccountingFlag', 'RoundingMode',
          'FillFromFillingValue', 'FillValue', 'DataHistory',
        ],
        resourceExpected: [],
        resourceForbidden: [
          'Balance', 'AccountingFlag', 'UseInTotals', 'RoundingMode',
          'FillFromFillingValue', 'FillValue', 'DataHistory', 'Indexing',
        ],
      },
      {
        owner: 'AccountingRegister',
        dimensionExpected: ['DenyIncompleteValues', 'Balance', 'AccountingFlag'],
        dimensionForbidden: [
          'UseInTotals', 'Master', 'MainFilter', 'TypeReductionMode', 'ExtDimensionAccountingFlag', 'RoundingMode',
          'FillFromFillingValue', 'FillValue', 'DataHistory',
        ],
        resourceExpected: ['Balance', 'AccountingFlag', 'ExtDimensionAccountingFlag'],
        resourceForbidden: [
          'UseInTotals', 'Master', 'MainFilter', 'TypeReductionMode', 'RoundingMode',
          'FillFromFillingValue', 'FillValue', 'DataHistory', 'Indexing',
        ],
      },
    ];

    for (const item of cases) {
      const xmlPath = writeRegisterXml(item.owner, `ее_ТестМатрица${item.owner}`);
      const reader = new ObjectXmlReader();

      assert.strictEqual(
        reader.updateTypeInObject(xmlPath, { targetKind: 'Dimension', targetName: 'Изм', typeInnerXml: STRING_TYPE }),
        true,
        `${item.owner}: set_type измерения не применился`
      );
      assert.strictEqual(
        reader.updateTypeInObject(xmlPath, { targetKind: 'Resource', targetName: 'РесЧисло', typeInnerXml: NUMBER_TYPE }),
        true,
        `${item.owner}: set_type ресурса не применился`
      );

      const xml = fs.readFileSync(xmlPath, 'utf-8');
      const dimensionXml = extractElementBlock(xml, 'Dimension');
      const resourceXml = extractElementBlock(xml, 'Resource');

      for (const key of item.dimensionExpected) {
        assert.ok(dimensionXml.includes(`<${key}`), `${item.owner}.Dimension: ожидалось свойство ${key}`);
      }
      for (const key of item.dimensionForbidden) {
        assert.ok(!dimensionXml.includes(`<${key}`), `${item.owner}.Dimension: свойство ${key} недопустимо`);
      }
      for (const key of item.resourceExpected) {
        assert.ok(resourceXml.includes(`<${key}`), `${item.owner}.Resource: ожидалось свойство ${key}`);
      }
      for (const key of item.resourceForbidden) {
        assert.ok(!resourceXml.includes(`<${key}`), `${item.owner}.Resource: свойство ${key} недопустимо`);
      }
    }
  });

  test('set_type восстанавливает уже испорченный XML регистра сведений', () => {
    const xmlPath = writeRegisterXml('InformationRegister', 'ее_ТестРемонт', {
      dimensionExtra: '\t\t\t\t<UseInTotals>false</UseInTotals>',
      resourceExtra: '\t\t\t\t<Balance>false</Balance>\n\t\t\t\t<RoundingMode>Round15as20</RoundingMode>',
    });
    const reader = new ObjectXmlReader();

    reader.updateTypeInObject(xmlPath, { targetKind: 'Dimension', targetName: 'Изм', typeInnerXml: STRING_TYPE });
    reader.updateTypeInObject(xmlPath, { targetKind: 'Resource', targetName: 'РесЧисло', typeInnerXml: NUMBER_TYPE });

    const xml = fs.readFileSync(xmlPath, 'utf-8');
    assert.ok(!xml.includes('<UseInTotals'));
    assert.ok(!xml.includes('<Balance'));
    assert.ok(!xml.includes('<RoundingMode'));
  });

  test('set_type проставляет тип измерению без <Type> и с самозакрытым <Type/>', () => {
    // Так выглядят измерения, у которых тип ещё не задан: платформа пишет
    // самозакрытый тег, а вручную созданный XML может не содержать его вовсе.
    for (const typeTag of ['\t\t\t\t\t<Type/>', '']) {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-empty-type-'));
      fs.mkdirSync(path.join(root, 'InformationRegisters'), { recursive: true });
      const xmlPath = path.join(root, 'InformationRegisters', 'ее_БезТипа.xml');
      fs.writeFileSync(xmlPath, [
        '<MetaDataObject xmlns:v8="http://v8.1c.ru/8.1/data/core" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" version="2.21">',
        '\t<InformationRegister uuid="99999999-9999-9999-9999-999999999999">',
        '\t\t<Properties>',
        '\t\t\t<Name>ее_БезТипа</Name>',
        '\t\t</Properties>',
        '\t\t<ChildObjects>',
        '\t\t\t<Dimension uuid="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa">',
        '\t\t\t\t<Properties>',
        '\t\t\t\t\t<Name>Изм</Name>',
        '\t\t\t\t\t<Comment/>',
        ...(typeTag ? [typeTag] : []),
        '\t\t\t\t</Properties>',
        '\t\t\t</Dimension>',
        '\t\t</ChildObjects>',
        '\t</InformationRegister>',
        '</MetaDataObject>',
      ].join('\n'), 'utf-8');

      assert.strictEqual(
        new ObjectXmlReader().updateTypeInObject(xmlPath, {
          targetKind: 'Dimension',
          targetName: 'Изм',
          typeInnerXml: STRING_TYPE,
        }),
        true
      );

      const xml = fs.readFileSync(xmlPath, 'utf-8');
      assert.ok(xml.includes('<v8:Type>xs:string</v8:Type>'));
      assert.ok(xml.includes('<Master'), 'ролевые свойства измерения РС достраиваются');
      assert.ok(!xml.includes('<UseInTotals'));
    }
  });

  test('смена Source/CommandParameterType состав свойств не перестраивает', () => {
    // Нормализация свойств применима только к <Type>: у подписки на событие и
    // общей команды меняется другое свойство, и вид владельца на него не влияет.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-non-type-'));
    fs.mkdirSync(path.join(root, 'EventSubscriptions'), { recursive: true });
    const subscriptionPath = path.join(root, 'EventSubscriptions', 'ПриЗаписи.xml');
    fs.writeFileSync(subscriptionPath, [
      '<MetaDataObject xmlns:v8="http://v8.1c.ru/8.1/data/core" version="2.21">',
      '\t<EventSubscription uuid="77777777-7777-7777-7777-777777777777">',
      '\t\t<Properties>',
      '\t\t\t<Name>ПриЗаписи</Name>',
      '\t\t\t<Source/>',
      '\t\t</Properties>',
      '\t</EventSubscription>',
      '</MetaDataObject>',
    ].join('\n'), 'utf-8');

    fs.mkdirSync(path.join(root, 'CommonCommands'), { recursive: true });
    const commandPath = path.join(root, 'CommonCommands', 'Печать.xml');
    fs.writeFileSync(commandPath, [
      '<MetaDataObject xmlns:v8="http://v8.1c.ru/8.1/data/core" version="2.21">',
      '\t<CommonCommand uuid="88888888-8888-8888-8888-888888888888">',
      '\t\t<Properties>',
      '\t\t\t<Name>Печать</Name>',
      '\t\t\t<Comment/>',
      '\t\t</Properties>',
      '\t</CommonCommand>',
      '</MetaDataObject>',
    ].join('\n'), 'utf-8');

    const reader = new ObjectXmlReader();
    const typeXml = '<v8:Type xmlns:d5p1="http://v8.1c.ru/8.1/data/enterprise/current-config">d5p1:CatalogRef.Товары</v8:Type>';

    assert.strictEqual(
      reader.updateTypeInObject(subscriptionPath, {
        targetKind: 'EventSubscription',
        targetName: 'ПриЗаписи',
        propertyName: 'Source',
        typeInnerXml: typeXml,
      }),
      true
    );
    const subscriptionXml = fs.readFileSync(subscriptionPath, 'utf-8');
    assert.ok(subscriptionXml.includes('<Source>'));
    assert.ok(!subscriptionXml.includes('<PasswordMode'));

    assert.strictEqual(
      reader.updateTypeInObject(commandPath, {
        targetKind: 'CommonCommand',
        targetName: 'Печать',
        propertyName: 'CommandParameterType',
        typeInnerXml: typeXml,
      }),
      true
    );
    const commandXml = fs.readFileSync(commandPath, 'utf-8');
    assert.ok(commandXml.includes('<CommandParameterType>'));
    assert.ok(!commandXml.includes('<ChoiceFoldersAndItems'));
  });

  test('состав ролевых свойств зависит от вида регистра-владельца', () => {
    const cases: { owner: string; kind: 'Dimension' | 'Resource'; expected: string[]; forbidden: string[] }[] = [
      {
        owner: 'InformationRegister',
        kind: 'Dimension',
        expected: ['Master', 'MainFilter', 'DenyIncompleteValues', 'TypeReductionMode', 'DataHistory'],
        forbidden: ['UseInTotals', 'Balance', 'AccountingFlag'],
      },
      {
        owner: 'InformationRegister',
        kind: 'Resource',
        expected: ['Indexing', 'DataHistory'],
        forbidden: ['Balance', 'AccountingFlag', 'Master'],
      },
      {
        owner: 'AccumulationRegister',
        kind: 'Dimension',
        expected: ['DenyIncompleteValues', 'UseInTotals', 'Indexing'],
        forbidden: ['Master', 'MainFilter', 'TypeReductionMode', 'DataHistory', 'FillFromFillingValue'],
      },
      {
        owner: 'AccumulationRegister',
        kind: 'Resource',
        expected: ['FullTextSearch'],
        forbidden: ['Indexing', 'DataHistory', 'Balance', 'UseInTotals'],
      },
      {
        owner: 'AccountingRegister',
        kind: 'Dimension',
        expected: ['Balance', 'AccountingFlag', 'DenyIncompleteValues', 'Indexing'],
        forbidden: ['UseInTotals', 'Master', 'DataHistory'],
      },
      {
        owner: 'AccountingRegister',
        kind: 'Resource',
        expected: ['Balance', 'AccountingFlag', 'ExtDimensionAccountingFlag'],
        forbidden: ['UseInTotals', 'Indexing', 'DataHistory'],
      },
    ];

    for (const item of cases) {
      const normalized = normalizeTypedFieldPropertiesAfterTypeChange(
        buildFieldXml(item.kind),
        item.kind,
        NUMBER_TYPE,
        item.owner
      );
      for (const key of item.expected) {
        assert.ok(normalized.includes(`<${key}`), `${item.owner}.${item.kind}: ожидалось свойство ${key}`);
      }
      for (const key of item.forbidden) {
        assert.ok(!normalized.includes(`<${key}`), `${item.owner}.${item.kind}: свойство ${key} недопустимо`);
      }
    }
  });

  test('для регистра с неописанными правилами ролевые свойства только сохраняются', () => {
    const withRole = buildFieldXml('Dimension', '\t\t\t\t<Balance>true</Balance>\n\t\t\t\t<AccountingFlag/>');
    const preserved = normalizeTypedFieldPropertiesAfterTypeChange(withRole, 'Dimension', NUMBER_TYPE, 'CalculationRegister');
    assert.ok(preserved.includes('<Balance>true</Balance>'));
    assert.ok(preserved.includes('<AccountingFlag/>'));

    const bare = normalizeTypedFieldPropertiesAfterTypeChange(buildFieldXml('Dimension'), 'Dimension', NUMBER_TYPE, 'CalculationRegister');
    for (const key of ['UseInTotals', 'Balance', 'AccountingFlag', 'Master', 'DataHistory', 'Indexing']) {
      assert.ok(!bare.includes(`<${key}`), `свойство ${key} нельзя дописывать неизвестному владельцу`);
    }
  });

  test('toRegisterOwnerKind сужает только описанные виды регистров', () => {
    assert.strictEqual(toRegisterOwnerKind('InformationRegister'), 'InformationRegister');
    assert.strictEqual(toRegisterOwnerKind('AccumulationRegister'), 'AccumulationRegister');
    assert.strictEqual(toRegisterOwnerKind('AccountingRegister'), 'AccountingRegister');
    assert.strictEqual(toRegisterOwnerKind('CalculationRegister'), undefined);
    assert.strictEqual(toRegisterOwnerKind('Catalog'), undefined);
    assert.strictEqual(toRegisterOwnerKind(undefined), undefined);
  });

  test('панель свойств с известным владельцем не предлагает свойства чужого вида', () => {
    // Панель рисует недостающие ключи редактируемыми полями и дописывает их в XML
    // при первом вводе, поэтому её список обязан совпадать с контрактом записи.
    const irDimension = getDisplayTypedFieldPropertyKeys('Dimension', NUMBER_TYPE, 'InformationRegister');
    assert.ok(irDimension.includes('Master'));
    for (const alien of ['UseInTotals', 'Balance', 'AccountingFlag']) {
      assert.ok(!irDimension.includes(alien), `панель не должна предлагать ${alien} измерению РС`);
    }
    assert.deepStrictEqual(
      irDimension,
      getTypedFieldPropertyKeys('Dimension', NUMBER_TYPE, 'InformationRegister'),
      'показ и запись должны совпадать при известном владельце'
    );

    const arResource = getDisplayTypedFieldPropertyKeys('Resource', NUMBER_TYPE, 'AccountingRegister');
    assert.ok(arResource.includes('ExtDimensionAccountingFlag'));
    assert.ok(!arResource.includes('UseInTotals'));
  });

  test('регистр расчёта: панель показывает записанное и не предлагает непроверенного', () => {
    // Правила полей регистра расчёта с эталона не сняты, поэтому и показ, и запись
    // идут консервативным путём: ролевые свойства берутся из самого XML.
    const dimensionXml = readReferenceElementXml(
      path.resolve(__dirname, '../../../example/2.20/src/cf/CalculationRegisters/Начисления.xml'),
      'Dimension'
    );
    const typeInner = /<Type>([\s\S]*?)<\/Type>/.exec(dimensionXml)?.[1] ?? '';

    const display = getDisplayTypedFieldPropertyKeys('Dimension', typeInner, 'CalculationRegister', dimensionXml);
    assert.ok(display.includes('DenyIncompleteValues'), 'записанное платформой свойство нельзя прятать');
    assert.ok(display.includes('Indexing'));
    for (const alien of ['FillFromFillingValue', 'FillValue', 'DataHistory', 'UseInTotals', 'Balance']) {
      assert.ok(!display.includes(alien), `панель не должна предлагать ${alien} измерению регистра расчёта`);
    }

    // Два направления, каждое из которых и было дефектом:
    // 1) панель не имеет права спрятать записанное платформой свойство, зависящее
    //    от вида владельца (типозависимые она сужает по <Type> намеренно — у
    //    ссылочного поля не место строковому PasswordMode);
    const ownerDependentInXml = [...dimensionXml.matchAll(/<([A-Za-z][\w]*)[ />]/g)]
      .map((match) => match[1])
      .filter(isTypedFieldControlledPropertyKey)
      .filter((key) => ['DenyIncompleteValues', 'Indexing', 'DataHistory', 'UseInTotals', 'Balance'].includes(key));
    assert.ok(ownerDependentInXml.includes('DenyIncompleteValues'), 'фикстура должна содержать ролевое свойство');
    for (const key of ownerDependentInXml) {
      assert.ok(display.includes(key), `панель спрятала записанное свойство ${key}`);
    }

    // 2) панель не имеет права предложить свойство, которого у поля нет и правил
    //    для которого мы не проверяли: ввод дописал бы его в XML.
    const afterTypeChange = normalizeTypedFieldPropertiesAfterTypeChange(
      dimensionXml,
      'Dimension',
      typeInner,
      'CalculationRegister'
    );
    for (const key of display) {
      // Format/EditFormat путь записи сохраняет как пустые теги независимо от типа
      // (shouldPreserveEmptyFormattingProperty) — они не про вид владельца.
      if (key === 'Format' || key === 'EditFormat') {
        continue;
      }
      assert.ok(afterTypeChange.includes(`<${key}`), `панель предлагает ${key}, которого путь записи не пишет`);
    }
  });

  test('панель без известного владельца показывает ролевые свойства всех регистров', () => {
    // Владелец неизвестен — прятать уже записанное платформой свойство нельзя.
    const dimensionKeys = getDisplayTypedFieldPropertyKeys('Dimension', NUMBER_TYPE);
    for (const key of ['Master', 'MainFilter', 'TypeReductionMode', 'UseInTotals', 'Balance', 'AccountingFlag']) {
      assert.ok(dimensionKeys.includes(key), `панель должна показывать ${key}`);
    }
    const resourceKeys = getDisplayTypedFieldPropertyKeys('Resource', NUMBER_TYPE);
    assert.ok(resourceKeys.includes('Balance'));
    assert.ok(resourceKeys.includes('ExtDimensionAccountingFlag'));
    // Реквизит не является полем регистра — ролевых свойств у него нет.
    assert.ok(!getDisplayTypedFieldPropertyKeys('Attribute', NUMBER_TYPE).includes('UseInTotals'));
  });

  test('реквизит регистра накопления и бухгалтерии теряет свойства заполнения', () => {
    // В эталонах реквизит РН и РБ (в отличие от реквизита РС) не имеет
    // FillFromFillingValue/FillValue/DataHistory — правило вида владельца
    // распространяется на реквизит, а не только на измерение и ресурс.
    for (const owner of ['AccumulationRegister', 'AccountingRegister']) {
      const keys = getTypedFieldPropertyKeys('Attribute', NUMBER_TYPE, toRegisterOwnerKind(owner));
      for (const alien of ['FillFromFillingValue', 'FillValue', 'DataHistory']) {
        assert.ok(!keys.includes(alien), `${owner}.Attribute: ${alien} недопустим`);
      }
      assert.ok(keys.includes('Indexing'), `${owner}.Attribute: Indexing должен остаться`);
    }
    const irKeys = getTypedFieldPropertyKeys('Attribute', NUMBER_TYPE, 'InformationRegister');
    for (const own of ['FillFromFillingValue', 'FillValue', 'DataHistory']) {
      assert.ok(irKeys.includes(own), `InformationRegister.Attribute: ${own} должен остаться`);
    }
  });

  test('генерируемый набор свойств — подпоследовательность эталонного поля из example', () => {
    // Схема 1С — xs:sequence, поэтому проверяем не множество, а порядок: всё, что
    // пишет генератор, должно идти в том же порядке, что и в реальной выгрузке,
    // и не содержать ключей, которых у эталонного поля нет.
    const cases: { file: string; tag: 'Attribute' | 'Dimension' | 'Resource'; owner: string }[] = [
      { file: 'InformationRegisters/АвтоНумерацияДоговоровКонтрагента.xml', tag: 'Resource', owner: 'InformationRegister' },
      { file: 'InformationRegisters/АбонентыЭДО.xml', tag: 'Dimension', owner: 'InformationRegister' },
      { file: 'AccumulationRegisters/АвансовыеПлатежиИностранцевПоНДФЛ.xml', tag: 'Resource', owner: 'AccumulationRegister' },
      { file: 'AccumulationRegisters/АвансовыеПлатежиИностранцевПоНДФЛ.xml', tag: 'Dimension', owner: 'AccumulationRegister' },
      { file: 'AccumulationRegisters/АвансовыеПлатежиИностранцевПоНДФЛ.xml', tag: 'Attribute', owner: 'AccumulationRegister' },
      { file: 'AccountingRegisters/Управленческий.xml', tag: 'Dimension', owner: 'AccountingRegister' },
      { file: 'AccountingRegisters/Управленческий.xml', tag: 'Resource', owner: 'AccountingRegister' },
    ];

    for (const item of cases) {
      const referenceKeys = readReferenceFieldKeys(item.file, item.tag);
      assert.ok(referenceKeys.length > 0, `${item.file}: эталонное поле ${item.tag} не найдено`);
      const generated = getTypedFieldPropertyKeys(item.tag, NUMBER_TYPE, toRegisterOwnerKind(item.owner));
      assert.ok(
        isSubsequence(generated, referenceKeys),
        `${item.owner}.${item.tag}: генерируемый набор\n  ${generated.join(',')}\nне является подпоследовательностью эталона\n  ${referenceKeys.join(',')}`
      );
    }
  });

  test('AccountingFlag генерируется пустым тегом, а не булевым значением', () => {
    // Это ссылка на признак учёта плана счетов; в эталонах — либо
    // ChartOfAccounts.X.AccountingFlag.Y, либо <AccountingFlag/>.
    for (const kind of ['Dimension', 'Resource'] as const) {
      const blocks = buildTypedFieldPropertyBlocks(kind, NUMBER_TYPE, '', 'AccountingRegister');
      assert.ok(blocks.includes('<AccountingFlag/>'), `${kind}: ожидался пустой <AccountingFlag/>`);
      assert.ok(!blocks.some((block) => block.includes('<AccountingFlag>false')), `${kind}: false недопустим`);
    }
    // Balance при этом действительно булево.
    assert.ok(
      buildTypedFieldPropertyBlocks('Dimension', NUMBER_TYPE, '', 'AccountingRegister').includes('<Balance>false</Balance>')
    );
  });
});

suite('registerFieldProperties — проверка принадлежности свойств виду метаданных', () => {
  test('validate_metadata сообщает о свойстве чужого вида метаданных', () => {
    const xmlPath = writeRegisterXml('InformationRegister', 'ее_ТестБагРС2', {
      dimensionExtra: '\t\t\t\t<UseInTotals>false</UseInTotals>',
      resourceExtra: '\t\t\t\t<Balance>false</Balance>\n\t\t\t\t<AccountingFlag>false</AccountingFlag>',
    });

    const result = new MetadataValidationService().validate({ objectPath: xmlPath });

    assert.strictEqual(result.ok, false);
    const issues = result.objects[0].issues.filter((issue) => issue.code === 'property-not-allowed');
    assert.strictEqual(issues.length, 3);
    assert.ok(issues.some((issue) => issue.message.includes('UseInTotals') && issue.message.includes('Dimension')));
    assert.ok(issues.some((issue) => issue.message.includes('Balance') && issue.message.includes('Resource')));
    assert.ok(issues.some((issue) => issue.message.includes('AccountingFlag')));
  });

  test('validate_metadata не ругается на корректный регистр сведений', () => {
    const xmlPath = writeRegisterXml('InformationRegister', 'ее_ТестЧистый');
    const result = new MetadataValidationService().validate({ objectPath: xmlPath });
    assert.ok(!result.objects[0].issues.some((issue) => issue.code === 'property-not-allowed'));
  });

  test('на реальных выгрузках проверка не даёт ложных срабатываний', () => {
    // Ложное срабатывание здесь опаснее пропуска: оно заваливает validate_metadata
    // ошибками на типовой конфигурации. Берём реальные объекты всех видов, у
    // которых есть типизированные поля.
    const service = new MetadataValidationService();
    let checked = 0;
    for (const folder of ['InformationRegisters', 'AccumulationRegisters', 'AccountingRegisters', 'Catalogs', 'Documents']) {
      for (const xmlPath of takeFixtureObjects(folder, 12)) {
        const result = service.validate({ objectPath: xmlPath });
        const wrong = result.objects[0].issues.filter((issue) => issue.code === 'property-not-allowed');
        assert.deepStrictEqual(
          wrong.map((issue) => issue.message),
          [],
          `ложное срабатывание на ${xmlPath}`
        );
        checked += 1;
      }
    }
    assert.ok(checked >= 40, `проверено объектов: ${String(checked)}`);
  });

  test('объект без <ChildObjects> и ТЧ без колонок проверку не ломают', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-validate-empty-'));
    fs.mkdirSync(path.join(root, 'Constants'), { recursive: true });
    const constantPath = path.join(root, 'Constants', 'Аудитор.xml');
    fs.writeFileSync(constantPath, [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<MetaDataObject xmlns:v8="http://v8.1c.ru/8.1/data/core" version="2.21">',
      '\t<Constant uuid="44444444-4444-4444-4444-444444444444">',
      '\t\t<Properties>',
      '\t\t\t<Name>Аудитор</Name>',
      '\t\t</Properties>',
      '\t</Constant>',
      '</MetaDataObject>',
    ].join('\n'), 'utf-8');

    fs.mkdirSync(path.join(root, 'Catalogs'), { recursive: true });
    const catalogPath = path.join(root, 'Catalogs', 'Товары.xml');
    fs.writeFileSync(catalogPath, [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<MetaDataObject xmlns:v8="http://v8.1c.ru/8.1/data/core" version="2.21">',
      '\t<Catalog uuid="55555555-5555-5555-5555-555555555555">',
      '\t\t<Properties>',
      '\t\t\t<Name>Товары</Name>',
      '\t\t</Properties>',
      '\t\t<ChildObjects>',
      '\t\t\t<TabularSection uuid="66666666-6666-6666-6666-666666666666">',
      '\t\t\t\t<Properties>',
      '\t\t\t\t\t<Name>Состав</Name>',
      '\t\t\t\t</Properties>',
      '\t\t\t</TabularSection>',
      '\t\t</ChildObjects>',
      '\t</Catalog>',
      '</MetaDataObject>',
    ].join('\n'), 'utf-8');

    const service = new MetadataValidationService();
    for (const xmlPath of [constantPath, catalogPath]) {
      const result = service.validate({ objectPath: xmlPath });
      assert.ok(!result.objects[0].issues.some((issue) => issue.code === 'property-not-allowed'));
    }
  });

  test('findDisallowedTypedFieldProperties молчит для полей неописанного регистра', () => {
    const xml = buildFieldXml('Dimension', '\t\t\t\t<UseInTotals>false</UseInTotals>');
    assert.deepStrictEqual(findDisallowedTypedFieldProperties(xml, 'Dimension', 'CalculationRegister'), []);
    assert.deepStrictEqual(findDisallowedTypedFieldProperties('<Dimension/>', 'Dimension', 'InformationRegister'), []);
    assert.deepStrictEqual(findDisallowedTypedFieldProperties(xml, 'Dimension', 'InformationRegister'), ['UseInTotals']);
  });
});

/**
 * Вырезает XML-фрагмент дочернего элемента по тегу для точечной проверки его
 * состава свойств. Годится только для тестовых фикстур этого файла — в них
 * ровно один `Dimension`/`Resource` без вложенных одноимённых тегов.
 */
function extractElementBlock(xml: string, tag: 'Dimension' | 'Resource'): string {
  const match = new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`).exec(xml);
  if (!match) {
    throw new Error(`элемент <${tag}> не найден в XML фикстуры`);
  }
  return match[0];
}

/** Полный XML первого подходящего элемента реальной выгрузки. */
function readReferenceElementXml(xmlPath: string, tag: string): string {
  const xml = fs.readFileSync(xmlPath, 'utf-8');
  const element = new RegExp(`<${tag} uuid[^>]*>[\\s\\S]*?</${tag}>`).exec(xml);
  assert.ok(element, `${xmlPath}: элемент ${tag} не найден`);
  return element[0];
}

/** Ключи свойств первого подходящего поля из реальной выгрузки example/2.21. */
function readReferenceFieldKeys(relativePath: string, tag: 'Attribute' | 'Dimension' | 'Resource'): string[] {
  const xml = fs.readFileSync(path.join(EXAMPLE_CF_2_21, relativePath), 'utf-8');
  const element = new RegExp(`<${tag} uuid[^>]*>([\\s\\S]*?)</${tag}>`).exec(xml);
  if (!element) {
    return [];
  }
  const properties = /<Properties>([\s\S]*?)<\/Properties>/.exec(element[0]);
  if (!properties) {
    return [];
  }
  return [...properties[1].matchAll(/^\t+<([A-Za-z][\w]*)/gm)]
    .map((match) => match[1])
    .filter((key) => !['Name', 'Synonym', 'Comment', 'Type'].includes(key));
}

function isSubsequence(candidate: readonly string[], source: readonly string[]): boolean {
  let index = 0;
  for (const key of candidate) {
    index = source.indexOf(key, index);
    if (index < 0) {
      return false;
    }
    index += 1;
  }
  return true;
}

function takeFixtureObjects(folder: string, limit: number): string[] {
  const dir = path.join(EXAMPLE_CF_2_21, folder);
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.xml'))
    .sort()
    .slice(0, limit)
    .map((name) => path.join(dir, name));
}

function buildFieldXml(tag: 'Dimension' | 'Resource', extra = ''): string {
  return [
    `<${tag} uuid="11111111-1111-1111-1111-111111111111">`,
    '\t\t\t<Properties>',
    '\t\t\t\t<Name>Изм</Name>',
    '\t\t\t\t<Synonym/>',
    '\t\t\t\t<Comment/>',
    '\t\t\t\t<Type>',
    '\t\t\t\t\t<v8:Type>xs:string</v8:Type>',
    '\t\t\t\t</Type>',
    '\t\t\t\t<FullTextSearch>Use</FullTextSearch>',
    ...(extra ? [extra] : []),
    '\t\t\t</Properties>',
    `\t\t</${tag}>`,
  ].join('\n');
}

function writeRegisterXml(
  kind: string,
  name: string,
  extras: { dimensionExtra?: string; resourceExtra?: string } = {}
): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-register-field-'));
  const dir = path.join(root, `${kind}s`);
  fs.mkdirSync(dir, { recursive: true });
  const xmlPath = path.join(dir, `${name}.xml`);
  fs.writeFileSync(xmlPath, [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<MetaDataObject xmlns:v8="http://v8.1c.ru/8.1/data/core" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" version="2.21">',
    `\t<${kind} uuid="22222222-2222-2222-2222-222222222222">`,
    '\t\t<Properties>',
    `\t\t\t<Name>${name}</Name>`,
    '\t\t\t<Synonym/>',
    '\t\t\t<Comment/>',
    '\t\t</Properties>',
    '\t\t<ChildObjects>',
    buildRegisterField('Dimension', 'Изм', extras.dimensionExtra),
    buildRegisterField('Resource', 'РесЧисло', extras.resourceExtra),
    '\t\t</ChildObjects>',
    `\t</${kind}>`,
    '</MetaDataObject>',
  ].join('\n'), 'utf-8');
  return xmlPath;
}

function buildRegisterField(tag: 'Dimension' | 'Resource', name: string, extra?: string): string {
  return [
    `\t\t\t<${tag} uuid="33333333-3333-3333-3333-33333333333${tag === 'Dimension' ? '1' : '2'}">`,
    '\t\t\t\t<Properties>',
    `\t\t\t\t\t<Name>${name}</Name>`,
    '\t\t\t\t\t<Synonym/>',
    '\t\t\t\t\t<Comment/>',
    '\t\t\t\t\t<Type>',
    '\t\t\t\t\t\t<v8:Type>xs:string</v8:Type>',
    '\t\t\t\t\t</Type>',
    '\t\t\t\t\t<FullTextSearch>Use</FullTextSearch>',
    ...(extra ? [extra] : []),
    '\t\t\t\t</Properties>',
    `\t\t\t</${tag}>`,
  ].join('\n');
}
