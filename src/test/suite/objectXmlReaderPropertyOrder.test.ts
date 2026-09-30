import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ObjectXmlReader } from '../../infra/xml/ObjectXmlReader';
import { extractTopLevelPropertiesChildren } from '../../infra/xml/MetadataPropertiesXml';
import { collectPropertyBlocks, findPropertiesRange, removeBlocks } from '../../infra/xml/typedField/PropertyBlockEditor';
import { EXAMPLE_GENERATIONS, skipWithoutCorpus } from './support/corpus';
import {
  asRestorableBlock,
  relativeToCorpus,
  sameModuloMixedEol,
  scanRootPropertyFacts,
  type RootPropertyFile,
} from './support/propertyOrderCorpus';
import { assertWellFormedXml } from './support/typedFieldCorpus';

/**
 * Писатель свойств объекта (`ObjectXmlReader.updatePropertyInObject`): новое
 * свойство КОРНЕВОГО объекта встаёт на каноническое место (`ROOT_PROPERTY_ORDER`),
 * а не в конец `<Properties>`.
 *
 * Исходный дефект: выбор вспомогательной формы варианта отчёта на выгрузке 2.20
 * (`AuxiliaryVariantForm`, у всех 9 отчётов 2.20 тега нет) писал тег ПОСЛЕ
 * `Explanation`, тогда как платформа кладёт его между `DefaultVariantForm` и
 * `VariantsStorage`.
 *
 * Все мутации — только над КОПИЯМИ во временном каталоге: `example/` не
 * отслеживается git, испорченный эталон теряется безвозвратно.
 */

type ValueKind = 'string' | 'boolean' | 'localizedString' | 'metadataReferenceList' | 'metadataFieldList';

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function copyToTemp(source: string, prefix = 'v8vscedit-prop-order-'): string {
  const target = path.join(makeTempDir(prefix), path.basename(source));
  fs.copyFileSync(source, target);
  return target;
}

function writeTemp(content: string, name = 'Объект.xml', prefix = 'v8vscedit-prop-order-'): string {
  const target = path.join(makeTempDir(prefix), name);
  fs.writeFileSync(target, content, 'utf-8');
  return target;
}

function updateSelf(
  xmlPath: string,
  propertyKey: string,
  valueKind: ValueKind,
  value: string | boolean | string[],
  targetName = 'Объект'
): boolean {
  return new ObjectXmlReader().updatePropertyInObject(xmlPath, { targetKind: 'Self', targetName, propertyKey, valueKind, value });
}

function keysOf(xml: string): string[] {
  return extractTopLevelPropertiesChildren(xml).map((child) => child.tag);
}

/** Поздний вариант `objectXmlReaderEmptyProperty`: реальные отчёты 2.20 — все без AuxiliaryVariantForm. */
function reports(root: string): string[] {
  const dir = path.join(root, 'Reports');
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.xml'))
    .sort()
    .map((name) => path.join(dir, name));
}

/** Вставляет `line` сразу после блока свойства `afterKey` (в `xml` с переводом строки файла). */
function insertAfterProperty(xml: string, afterKey: string, line: string): string {
  const eol = xml.includes('\r\n') ? '\r\n' : '\n';
  const match = new RegExp(`([\\t ]*)<${afterKey}(?:/>|>[\\s\\S]*?</${afterKey}>)`).exec(xml);
  assert.ok(match, `в файле нет свойства ${afterKey}`);
  const end = match.index + match[0].length;
  return `${xml.slice(0, end)}${eol}${match[1]}${line}${xml.slice(end)}`;
}

suite('ObjectXmlReader.updatePropertyInObject — канон порядка свойств корня (эталон example/)', () => {
  suiteSetup(function () {
    skipWithoutCorpus(this);
  });
  suiteTeardown(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('ключевой сценарий: AuxiliaryVariantForm у каждого отчёта 2.20 встаёт между DefaultVariantForm и VariantsStorage', function () {
    this.timeout(60_000);
    const files = reports(EXAMPLE_GENERATIONS.cf20);
    assert.strictEqual(files.length, 9, 'в эталоне 2.20 девять отчётов');
    for (const source of files) {
      const original = fs.readFileSync(source, 'utf-8');
      assert.ok(!keysOf(original).includes('AuxiliaryVariantForm'), `${path.basename(source)}: в 2.20 тега быть не должно`);

      const name = path.basename(source, '.xml');
      const value = `Report.${name}.Form.ФормаВарианта`;
      const copy = copyToTemp(source);
      assert.strictEqual(updateSelf(copy, 'AuxiliaryVariantForm', 'string', value, name), true, name);

      const after = fs.readFileSync(copy, 'utf-8');
      const keys = keysOf(after);
      const variantIndex = keys.indexOf('DefaultVariantForm');
      assert.strictEqual(keys[variantIndex + 1], 'AuxiliaryVariantForm', `${name}: тег обязан идти сразу за DefaultVariantForm`);
      assert.strictEqual(keys[variantIndex + 2], 'VariantsStorage', `${name}: за ним — VariantsStorage`);
      assert.notStrictEqual(keys.at(-1), 'AuxiliaryVariantForm', `${name}: тег не должен уехать в конец (после Explanation)`);
      // Побайтово: единственное отличие — одна строка после DefaultVariantForm, с отступом и EOL файла.
      assert.strictEqual(
        after,
        insertAfterProperty(original, 'DefaultVariantForm', `<AuxiliaryVariantForm>${value}</AuxiliaryVariantForm>`),
        `${name}: файл изменился не только вставкой одной строки на каноническом месте`
      );
    }
  });

  test('место сверено с эталоном 2.21: во всех отчётах 2.21 AuxiliaryVariantForm стоит между DefaultVariantForm и VariantsStorage', () => {
    let checked = 0;
    for (const file of reports(EXAMPLE_GENERATIONS.cf21)) {
      const keys = keysOf(fs.readFileSync(file, 'utf-8'));
      const index = keys.indexOf('AuxiliaryVariantForm');
      if (index < 0) {
        continue;
      }
      checked++;
      assert.strictEqual(keys[index - 1], 'DefaultVariantForm', relativeToCorpus(file));
      assert.strictEqual(keys[index + 1], 'VariantsStorage', relativeToCorpus(file));
    }
    assert.ok(checked > 300, `проверено отчётов 2.21: ${String(checked)}`);
  });

  test('идемпотентность: повторная запись того же значения — false и файл байт-в-байт', () => {
    const source = reports(EXAMPLE_GENERATIONS.cf20)[0];
    const name = path.basename(source, '.xml');
    const copy = copyToTemp(source);
    assert.strictEqual(updateSelf(copy, 'AuxiliaryVariantForm', 'string', 'Report.X.Form.Y', name), true);
    const afterFirst = fs.readFileSync(copy);
    // Идемпотентность имеет смысл только для вставки на КАНОНИЧЕСКОЕ место: в конец
    // блока повтор тоже был бы no-op, и тест проверял бы не то.
    const keys = keysOf(afterFirst.toString('utf-8'));
    assert.strictEqual(keys[keys.indexOf('AuxiliaryVariantForm') + 1], 'VariantsStorage');

    assert.strictEqual(updateSelf(copy, 'AuxiliaryVariantForm', 'string', 'Report.X.Form.Y', name), false);
    assert.deepStrictEqual(fs.readFileSync(copy), afterFirst, 'повторный вызов не должен переписывать файл');
  });

  test('структурный round-trip: well-formed, прямые дети <Properties> отличаются РОВНО одним новым элементом, остальное — позиционно идентично', () => {
    const source = reports(EXAMPLE_GENERATIONS.cf20)[0];
    const name = path.basename(source, '.xml');
    const before = fs.readFileSync(source, 'utf-8');
    const copy = copyToTemp(source);
    updateSelf(copy, 'AuxiliaryVariantForm', 'string', 'Report.X.Form.Y', name);
    const after = fs.readFileSync(copy, 'utf-8');

    assertWellFormedXml(before, 'до вставки');
    assertWellFormedXml(after, 'после вставки');

    const beforeChildren = extractTopLevelPropertiesChildren(before);
    const afterChildren = extractTopLevelPropertiesChildren(after);
    assert.strictEqual(afterChildren.length, beforeChildren.length + 1, 'добавлен ровно один прямой ребёнок');
    const inserted = afterChildren.findIndex((child) => child.tag === 'AuxiliaryVariantForm');
    assert.ok(inserted >= 0);
    assert.strictEqual(afterChildren[inserted - 1].tag, 'DefaultVariantForm', 'новый элемент — на каноническом месте');
    const withoutInserted = afterChildren.filter((_, index) => index !== inserted);
    assert.deepStrictEqual(withoutInserted, beforeChildren, 'остальные свойства (тег и содержимое) позиционно идентичны');
    // Всё вне <Properties> (ChildObjects, uuid, шапка) — нетронуто.
    assert.strictEqual(after.slice(after.indexOf('<ChildObjects')), before.slice(before.indexOf('<ChildObjects')));
  });

  test('граница: правка значения СУЩЕСТВУЮЩЕГО свойства в файле с неканоническим порядком не двигает ни одного тега', () => {
    const source = reports(EXAMPLE_GENERATIONS.cf20)[0];
    const name = path.basename(source, '.xml');
    const original = fs.readFileSync(source, 'utf-8');
    const eol = original.includes('\r\n') ? '\r\n' : '\n';
    // Ломаем порядок намеренно: Explanation переезжает перед Comment. Существующее
    // переупорядочивать мы не берёмся — правило действует только на ВСТАВКУ нового.
    const range = findPropertiesRange(original);
    assert.ok(range);
    const blocks = collectPropertyBlocks(range.inner);
    const explanation = blocks.find((block) => block.key === 'Explanation');
    assert.ok(explanation, 'в отчёте есть Explanation');
    const withoutExplanation = removeBlocks(range.inner, [explanation]);
    const comment = collectPropertyBlocks(withoutExplanation).find((block) => block.key === 'Comment');
    assert.ok(comment, 'в отчёте есть Comment');
    const shuffledInner =
      `${withoutExplanation.slice(0, comment.start)}${explanation.xml}${eol}${comment.indent}${withoutExplanation.slice(comment.start)}`;
    const shuffled = original.slice(0, range.start) + shuffledInner + original.slice(range.end);
    const shuffledKeys = keysOf(shuffled);
    assert.ok(shuffledKeys.indexOf('Explanation') < shuffledKeys.indexOf('Comment'), 'порядок действительно нарушен');

    const updates: { key: string; kind: ValueKind; value: string | boolean }[] = [
      { key: 'DefaultForm', kind: 'string', value: `Report.${name}.Form.ФормаОтчёта` },
      { key: 'UseStandardCommands', kind: 'boolean', value: false },
      { key: 'Explanation', kind: 'localizedString', value: 'Новое пояснение' },
    ];
    for (const update of updates) {
      const copy = writeTemp(shuffled, `${name}.xml`);
      assert.strictEqual(updateSelf(copy, update.key, update.kind, update.value, name), true, update.key);
      const after = fs.readFileSync(copy, 'utf-8');
      assert.deepStrictEqual(keysOf(after), shuffledKeys, `${update.key}: порядок тегов обязан остаться прежним`);
      assert.ok(after.includes(eol), 'перевод строки файла сохранён');
    }
  });

  test('ветка «вид вне таблицы» на файле: корень без правила — ключ дописывается в конец (прежнее поведение)', () => {
    // Корневой тег Sequence есть в META_TYPES, но правила порядка для него не снято
    // (в корпусе ни одного экземпляра) — писатель обязан работать консервативно.
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" version="2.21">',
      '\t<Sequence uuid="0b4a2a1e-0000-0000-0000-000000000009">',
      '\t\t<Properties>',
      '\t\t\t<Name>Объект</Name>',
      '\t\t\t<Explanation/>',
      '\t\t</Properties>',
      '\t</Sequence>',
      '</MetaDataObject>',
      '',
    ].join('\n');
    const copy = writeTemp(xml);
    assert.strictEqual(updateSelf(copy, 'Comment', 'string', 'Тест'), true);
    assert.deepStrictEqual(keysOf(fs.readFileSync(copy, 'utf-8')), ['Name', 'Explanation', 'Comment']);
  });

  test('ветка «владелец не определён»: файл без обёртки <MetaDataObject> — ключ дописывается в конец', () => {
    const xml = [
      '<Report uuid="0b4a2a1e-0000-0000-0000-000000000009">',
      '\t<Properties>',
      '\t\t<Name>Объект</Name>',
      '\t\t<Explanation/>',
      '\t</Properties>',
      '</Report>',
      '',
    ].join('\n');
    const copy = writeTemp(xml);
    assert.strictEqual(updateSelf(copy, 'Comment', 'string', 'Тест'), true);
    const after = fs.readFileSync(copy, 'utf-8');
    const props = /<Properties>([\s\S]*?)<\/Properties>/.exec(after)?.[1] ?? '';
    assert.deepStrictEqual(
      collectPropertyBlocks(props).map((block) => block.key),
      ['Name', 'Explanation', 'Comment']
    );
  });

  test('восстановление удалённого свойства: для каждого вида и корня выгрузки вставка возвращает файл байт-в-байт', function () {
    this.timeout(600_000);
    // Сквозная проверка таблицы и писателя на 48 видах: из эталонного файла вырезается
    // одно свойство (однострочное или стандартный локализованный блок), затем оно
    // записывается обратно тем же `updatePropertyInObject`. Если таблица и механика
    // согласованы, результат ИДЕНТИЧЕН исходнику — включая отступ, EOL и BOM.
    const facts = scanRootPropertyFacts();
    const perKind = new Map<string, number>();
    let restored = 0;
    const failures: string[] = [];

    for (const [xmlRoot, bucket] of facts) {
      const chosen = new Map<string, RootPropertyFile>();
      for (const file of bucket.files) {
        const current = chosen.get(file.root);
        if (!current || file.keys.length > current.keys.length) {
          chosen.set(file.root, file);
        }
      }
      for (const file of chosen.values()) {
        const original = fs.readFileSync(file.file, 'utf-8');
        const range = findPropertiesRange(original);
        if (!range) {
          continue;
        }
        const eol = original.includes('\r\n') ? '\r\n' : '\n';
        const blocks = collectPropertyBlocks(range.inner);
        for (const block of blocks) {
          const restoreValue = asRestorableBlock(block.xml, block.key, block.indent, eol);
          if (!restoreValue) {
            continue;
          }
          const stripped =
            original.slice(0, range.start) + removeBlocks(range.inner, [block]) + original.slice(range.end);
          const copy = writeTemp(stripped, path.basename(file.file));
          const ok = updateSelf(copy, block.key, restoreValue.kind, restoreValue.value, path.basename(file.file, '.xml'));
          const after = fs.readFileSync(copy, 'utf-8');
          restored++;
          perKind.set(xmlRoot, (perKind.get(xmlRoot) ?? 0) + 1);
          if (!ok || !sameModuloMixedEol(after, original)) {
            failures.push(`${xmlRoot}/${file.root}: ${block.key} (${relativeToCorpus(file.file)})`);
          }
          fs.rmSync(path.dirname(copy), { recursive: true, force: true });
        }
      }
    }

    assert.deepStrictEqual(failures.slice(0, 40), [], `свойство не вернулось на своё место (всего ${String(failures.length)} из ${String(restored)})`);
    assert.ok(restored > 1500, `проверено подозрительно мало восстановлений: ${String(restored)}`);
    const uncovered = [...facts.keys()].filter((xmlRoot) => (perKind.get(xmlRoot) ?? 0) === 0);
    assert.deepStrictEqual(uncovered, [], 'по этим видам не проверено ни одного восстановления');
  });
});

// --- Синтетические фикстуры: без корпуса, ветки и граничные случаи ---------------------------

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>';
const MD_OPEN =
  '<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" xmlns:v8="http://v8.1c.ru/8.1/data/core" ' +
  'xmlns:xr="http://v8.1c.ru/8.3/xcf/readable" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" version="2.21">';

function rootDoc(rootTag: string, propertyLines: readonly string[], options: { eol?: string; bom?: boolean } = {}): string {
  const eol = options.eol ?? '\n';
  const lines = [
    XML_HEADER,
    MD_OPEN,
    `\t<${rootTag} uuid="0b4a2a1e-0000-0000-0000-000000000001">`,
    '\t\t<Properties>',
    ...propertyLines.map((line) => `\t\t\t${line}`),
    '\t\t</Properties>',
    '\t\t<ChildObjects/>',
    `\t</${rootTag}>`,
    '</MetaDataObject>',
    '',
  ];
  return `${options.bom ? '\uFEFF' : ''}${lines.join(eol)}`;
}

suite('ObjectXmlReader.updatePropertyInObject — канон порядка свойств корня (синтетические файлы)', () => {
  suiteTeardown(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  const REPORT_PROPS = [
    '<Name>Объект</Name>',
    '<Synonym/>',
    '<Comment/>',
    '<UseStandardCommands>true</UseStandardCommands>',
    '<DefaultVariantForm/>',
    '<VariantsStorage/>',
    '<Explanation/>',
  ];
  const NEW_LINE = '<AuxiliaryVariantForm>Report.Объект.Form.Вариант</AuxiliaryVariantForm>';

  // 4 комбинации BOM × EOL на ВСТАВКЕ (на замене они проверены давно): писатель обязан
  // сохранить обе особенности файла и вставить строку с ТЕМ ЖЕ переводом строки.
  for (const bom of [false, true]) {
    for (const eol of ['\n', '\r\n']) {
      test(`вставка сохраняет BOM и EOL файла: BOM=${String(bom)}, EOL=${JSON.stringify(eol)}`, () => {
        const original = rootDoc('Report', REPORT_PROPS, { eol, bom });
        const copy = writeTemp(original);
        assert.strictEqual(updateSelf(copy, 'AuxiliaryVariantForm', 'string', 'Report.Объект.Form.Вариант'), true);

        const expected = rootDoc(
          'Report',
          [...REPORT_PROPS.slice(0, 5), NEW_LINE, ...REPORT_PROPS.slice(5)],
          { eol, bom }
        );
        const actual = fs.readFileSync(copy, 'utf-8');
        assert.strictEqual(actual, expected);
        assert.strictEqual(actual.startsWith('\uFEFF'), bom, 'BOM не должен ни появиться, ни пропасть');
        assert.ok(eol === '\r\n' ? !/(?<!\r)\n/.test(actual) : !actual.includes('\r'), 'перевод строки файла выдержан на всём файле');
      });
    }
  }

  // Все пять видов значения на ВСТАВКЕ нового свойства корня: у трёх блок многострочный,
  // и его внутренний отступ берётся от места свойства по-разному (localizedString — от
  // отступа блоков корня, списки — фиксированные 4/3 табуляции).
  const CATALOG_PROPS = ['<Name>Справочник</Name>', '<Comment/>', '<DefaultObjectForm/>', '<Explanation/>'];
  const insertionCases: {
    valueKind: ValueKind;
    key: string;
    value: string | boolean | string[];
    block: string[];
    /** Индекс в CATALOG_PROPS, перед которым встаёт блок. */
    beforeIndex: number;
  }[] = [
    { valueKind: 'string', key: 'CodeLength', value: '9', block: ['<CodeLength>9</CodeLength>'], beforeIndex: 2 },
    { valueKind: 'string', key: 'CodeLength', value: '', block: ['<CodeLength/>'], beforeIndex: 2 },
    { valueKind: 'boolean', key: 'Hierarchical', value: true, block: ['<Hierarchical>true</Hierarchical>'], beforeIndex: 2 },
    { valueKind: 'boolean', key: 'Hierarchical', value: false, block: ['<Hierarchical>false</Hierarchical>'], beforeIndex: 2 },
    {
      valueKind: 'localizedString',
      key: 'ObjectPresentation',
      value: 'Клиент',
      block: [
        '<ObjectPresentation>',
        '\t\t\t\t<v8:item>',
        '\t\t\t\t\t<v8:lang>ru</v8:lang>',
        '\t\t\t\t\t<v8:content>Клиент</v8:content>',
        '\t\t\t\t</v8:item>',
        '\t\t\t</ObjectPresentation>',
      ],
      beforeIndex: 3,
    },
    { valueKind: 'localizedString', key: 'ObjectPresentation', value: '', block: ['<ObjectPresentation/>'], beforeIndex: 3 },
    {
      valueKind: 'metadataReferenceList',
      key: 'BasedOn',
      value: ['Document.Заказ', 'Document.Счёт'],
      block: [
        '<BasedOn>',
        '\t\t\t\t<xr:Item xsi:type="xr:MDObjectRef">Document.Заказ</xr:Item>',
        '\t\t\t\t<xr:Item xsi:type="xr:MDObjectRef">Document.Счёт</xr:Item>',
        '\t\t\t</BasedOn>',
      ],
      beforeIndex: 3,
    },
    { valueKind: 'metadataReferenceList', key: 'BasedOn', value: [], block: ['<BasedOn/>'], beforeIndex: 3 },
    {
      valueKind: 'metadataFieldList',
      key: 'DataLockFields',
      value: ['Catalog.Справочник.Attribute.Реквизит'],
      block: [
        '<DataLockFields>',
        '\t\t\t\t<xr:Field>Catalog.Справочник.Attribute.Реквизит</xr:Field>',
        '\t\t\t</DataLockFields>',
      ],
      beforeIndex: 3,
    },
    { valueKind: 'metadataFieldList', key: 'DataLockFields', value: [], block: ['<DataLockFields/>'], beforeIndex: 3 },
  ];
  for (const item of insertionCases) {
    const emptyMark = Array.isArray(item.value) ? (item.value.length === 0 ? ' (пустой)' : '') : item.value === '' ? ' (пустое)' : '';
    test(`вставка нового свойства корня, valueKind=${item.valueKind}${emptyMark}: ${item.key} встаёт на канонное место`, () => {
      const copy = writeTemp(rootDoc('Catalog', CATALOG_PROPS));
      assert.strictEqual(updateSelf(copy, item.key, item.valueKind, item.value, 'Справочник'), true);

      const expectedLines = [...CATALOG_PROPS];
      // Строки блока уже несут абсолютный отступ; rootDoc добавляет отступ только к первой.
      expectedLines.splice(item.beforeIndex, 0, item.block.join('\n'));
      const expected = rootDoc('Catalog', expectedLines);
      const actual = fs.readFileSync(copy, 'utf-8');
      assert.strictEqual(actual, expected);
      assertWellFormedXml(actual, `${item.key}: результат`);
    });
  }

  // Дочерние targetKind (11 штук, кроме Self): правило снято с КОРНЕЙ и на них не
  // распространяется. Ключ `Comment` намеренно выбран из канона корня Catalog — если бы
  // писатель по ошибке передавал вид корня и детям, `Comment` лёг бы перед `Explanation`,
  // а не в конец, как у ребёнка всегда.
  const CHILD_PROPS = ['<Name>Имя</Name>', '<Synonym/>', '<Explanation/>'];
  type ChildKind =
    | 'Attribute' | 'AddressingAttribute' | 'Dimension' | 'Resource' | 'TabularSection'
    | 'Column' | 'Command' | 'EnumValue' | 'URLTemplate' | 'Method';
  const childCases: {
    targetKind: ChildKind;
    targetName: string;
    tabularSectionName?: string;
    urlTemplateName?: string;
  }[] = [
    { targetKind: 'Attribute', targetName: 'Реквизит1' },
    { targetKind: 'AddressingAttribute', targetName: 'Адрес1' },
    { targetKind: 'Dimension', targetName: 'Измерение1' },
    { targetKind: 'Resource', targetName: 'Ресурс1' },
    { targetKind: 'TabularSection', targetName: 'ТЧ1' },
    { targetKind: 'Column', targetName: 'Колонка1', tabularSectionName: 'ТЧ1' },
    { targetKind: 'Command', targetName: 'Команда1' },
    { targetKind: 'EnumValue', targetName: 'Значение1' },
    { targetKind: 'URLTemplate', targetName: 'Шаблон1' },
    { targetKind: 'Method', targetName: 'Метод1', urlTemplateName: 'Шаблон1' },
  ];

  /** Элемент `<tag>` с блоком Properties (+ вложенные) на заданной глубине. */
  function element(tag: string, name: string, depth: number, commentFor: string | undefined, nested: string[] = []): string[] {
    const tabs = (n: number): string => '\t'.repeat(n);
    const props = [`<Name>${name}</Name>`, ...CHILD_PROPS.slice(1)];
    if (commentFor === name) {
      props.push('<Comment>Тест</Comment>');
    }
    return [
      `${tabs(depth)}<${tag} uuid="0b4a2a1e-0000-0000-0000-0000000000${String(depth)}1">`,
      `${tabs(depth + 1)}<Properties>`,
      ...props.map((line) => `${tabs(depth + 2)}${line}`),
      `${tabs(depth + 1)}</Properties>`,
      ...(nested.length > 0 ? [`${tabs(depth + 1)}<ChildObjects>`, ...nested, `${tabs(depth + 1)}</ChildObjects>`] : []),
      `${tabs(depth)}</${tag}>`,
    ];
  }

  function ownerWithChildren(commentFor?: string): string {
    const nestedColumn = element('Attribute', 'Колонка1', 5, commentFor);
    const nestedMethod = element('Method', 'Метод1', 5, commentFor);
    const children = [
      ...element('Attribute', 'Реквизит1', 3, commentFor),
      ...element('AddressingAttribute', 'Адрес1', 3, commentFor),
      ...element('Dimension', 'Измерение1', 3, commentFor),
      ...element('Resource', 'Ресурс1', 3, commentFor),
      ...element('TabularSection', 'ТЧ1', 3, commentFor, nestedColumn),
      ...element('Command', 'Команда1', 3, commentFor),
      ...element('EnumValue', 'Значение1', 3, commentFor),
      ...element('URLTemplate', 'Шаблон1', 3, commentFor, nestedMethod),
    ];
    return [
      XML_HEADER,
      MD_OPEN,
      '\t<Catalog uuid="0b4a2a1e-0000-0000-0000-000000000001">',
      '\t\t<Properties>',
      '\t\t\t<Name>Владелец</Name>',
      '\t\t\t<Synonym/>',
      '\t\t\t<Explanation/>',
      '\t\t</Properties>',
      '\t\t<ChildObjects>',
      ...children,
      '\t\t</ChildObjects>',
      '\t</Catalog>',
      '</MetaDataObject>',
      '',
    ].join('\n');
  }

  for (const child of childCases) {
    test(`дочерний targetKind=${child.targetKind}: поведение не изменилось — новое свойство в конец Properties ребёнка`, () => {
      const copy = writeTemp(ownerWithChildren());
      const reader = new ObjectXmlReader();
      const changed = reader.updatePropertyInObject(copy, {
        ...child,
        propertyKey: 'Comment',
        valueKind: 'string',
        value: 'Тест',
      });
      assert.strictEqual(changed, true);
      assert.strictEqual(
        fs.readFileSync(copy, 'utf-8'),
        ownerWithChildren(child.targetName),
        'изменён должен быть только целевой ребёнок, свойство — последним в его Properties'
      );
    });
  }

  test('дочерний targetKind=StandardAttribute: писатель по-прежнему не трогает файл (у стандартного реквизита нет блока <Properties>)', function () {
    skipWithoutCorpus(this);
    // Стандартный реквизит лежит внутри StandardAttributes корневого <Properties> и сам
    // <Properties> не имеет: поведение (false, файл нетронут) закрепляется, чтобы канон корня
    // не «просочился» в правку стандартных реквизитов.
    const copy = copyToTemp(path.join(EXAMPLE_GENERATIONS.cf20, 'Catalogs', 'Пользователи.xml'));
    const before = fs.readFileSync(copy);
    const changed = new ObjectXmlReader().updatePropertyInObject(copy, {
      targetKind: 'StandardAttribute',
      targetName: 'Description',
      propertyKey: 'ToolTip',
      valueKind: 'string',
      value: 'Подсказка',
    });
    assert.strictEqual(changed, false);
    assert.deepStrictEqual(fs.readFileSync(copy), before);
  });

  test('находка 2 (латентная мина): <Properties></Properties> — свойство не уезжает в начало файла, перед <?xml', () => {
    // propsInner === '' и `String.replace('', …)` вставлял бы в позицию 0. Платформа пишет
    // `<Properties/>`, но рукописной правкой такой файл получить легко.
    const original = rootDoc('Report', []).replace('<Properties>\n\t\t</Properties>', '<Properties></Properties>');
    assert.ok(original.includes('<Properties></Properties>'), 'фикстура: пустой парный блок');
    const withBom = `\uFEFF${original}`;
    const copy = writeTemp(withBom);

    const changed = updateSelf(copy, 'Comment', 'string', 'Тест');

    const after = fs.readFileSync(copy, 'utf-8');
    assert.ok(after.startsWith(`\uFEFF${XML_HEADER}`), `файл начинается не с исходной шапки: ${JSON.stringify(after.slice(0, 40))}`);
    assertWellFormedXml(after, 'результат правки пустого <Properties></Properties>');
    if (changed) {
      // Допустимы два исхода: файл не тронут либо свойство лежит ВНУТРИ <Properties>.
      const propsStart = after.indexOf('<Properties>');
      const propsEnd = after.indexOf('</Properties>');
      const at = after.indexOf('<Comment>Тест</Comment>');
      assert.ok(propsStart >= 0 && at > propsStart && at < propsEnd, 'свойство обязано лежать внутри <Properties>');
    } else {
      assert.strictEqual(after, withBom, 'при отказе файл не должен меняться');
    }
    assert.strictEqual(after.split('<Comment>Тест</Comment>').length <= 2, true, 'не более одной вставки');
  });

  test('<Properties/> самозакрытый: вызов не падает и не меняет файл', () => {
    const original = rootDoc('Report', []).replace('\t\t<Properties>\n\t\t</Properties>', '\t\t<Properties/>');
    assert.ok(original.includes('<Properties/>'), 'фикстура: самозакрытый блок');
    const copy = writeTemp(original);
    assert.strictEqual(updateSelf(copy, 'Comment', 'string', 'Тест'), false);
    assert.strictEqual(fs.readFileSync(copy, 'utf-8'), original);
  });

  test('блока <Properties> нет вовсе: вызов не падает и не меняет файл', () => {
    const original = [XML_HEADER, MD_OPEN, '\t<Report uuid="0b4a2a1e-0000-0000-0000-000000000001">', '\t</Report>', '</MetaDataObject>', ''].join('\n');
    const copy = writeTemp(original);
    assert.strictEqual(updateSelf(copy, 'Comment', 'string', 'Тест'), false);
    assert.strictEqual(fs.readFileSync(copy, 'utf-8'), original);
  });

  test('ключ вне таблицы вида: неизвестное свойство корня дописывается в конец, а не теряется', () => {
    const original = rootDoc('Report', REPORT_PROPS);
    const copy = writeTemp(original);
    assert.strictEqual(updateSelf(copy, 'SomeFutureProperty', 'string', 'v'), true);
    assert.strictEqual(
      fs.readFileSync(copy, 'utf-8'),
      rootDoc('Report', [...REPORT_PROPS, '<SomeFutureProperty>v</SomeFutureProperty>'])
    );
  });

  test('ObjectBelonging (ранг 0) у Catalog встаёт ПЕРВЫМ, до Name — писатель не теряет нулевой ранг', () => {
    const copy = writeTemp(rootDoc('Catalog', ['<Name>Справочник</Name>', '<Comment/>']));
    assert.strictEqual(updateSelf(copy, 'ObjectBelonging', 'string', 'Adopted', 'Справочник'), true);
    assert.strictEqual(
      fs.readFileSync(copy, 'utf-8'),
      rootDoc('Catalog', ['<ObjectBelonging>Adopted</ObjectBelonging>', '<Name>Справочник</Name>', '<Comment/>'])
    );
  });
});
