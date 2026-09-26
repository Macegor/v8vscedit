import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { XMLValidator } from 'fast-xml-parser';
import type { ChildTag } from '../../domain/ChildTag';
import type { MetaKind } from '../../domain/MetaTypes';
import { ensureTemplateContentFiles } from '../../infra/xml/creator/auxiliaryFileBuilders';
import { buildRootObjectXml } from '../../infra/xml/creator/rootObjectBuilders';
import { BASELINE_RULESET } from '../../infra/xml/format/baselineRuleset';
import type { EditResult } from '../../infra/xml/ConfigurationXmlEditor';
import { MetadataXmlCreator } from '../../infra/xml/MetadataXmlCreator';
import { buildSchemaXml } from '../../infra/xml/dcs/schemaBuilders';
import { buildExternalObjectXml } from '../../infra/xml/external/externalObjectXml';
import {
  CANON_CHILD_ORDER,
  directChildObjectsEntries,
  directChildObjectsTagSequence,
} from './support/childObjectsCorpus';

/**
 * Задача «порядок дочерних элементов в `<ChildObjects>` по виду владельца +
 * регистр `UTF-8` в XML-декларации» — T-3..T-11: поведение генератора
 * (`MetadataXmlCreator`/`infra/xml/creator/*`) на реальных временных файлах.
 * Источник ожидаемого порядка — {@link CANON_CHILD_ORDER}
 * (`support/childObjectsCorpus.ts`), НЕЗАВИСИМО снятый и провалидированный
 * против `example/` в `childObjectsOrder.corpus.test.ts` (T-1) — не хардкод
 * "на глаз".
 */

function readXml(filePath: string): string {
  return fs.readFileSync(filePath, 'utf-8');
}

function newConfigRoot(version = '2.21'): string {
  const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-child-order-'));
  const configXml = [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<MetaDataObject version="${version}">`,
    '\t<Configuration>',
    '\t\t<Properties><Name>Тест</Name><Synonym/></Properties>',
    '\t\t<ChildObjects/>',
    '\t</Configuration>',
    '</MetaDataObject>',
  ].join('\n');
  fs.writeFileSync(path.join(configRoot, 'Configuration.xml'), configXml, 'utf-8');
  return configRoot;
}

function assertOk(result: EditResult, label: string): void {
  assert.strictEqual(result.success, true, `${label}: ${result.errors.join('; ')}`);
}

/** Добавляет дочерний элемент, автоматически подставляя обязательный templateType для Template. */
function addTag(creator: MetadataXmlCreator, ownerXmlPath: string, tag: ChildTag, name: string): EditResult {
  return creator.addChildElement({
    ownerObjectXmlPath: ownerXmlPath,
    childTag: tag,
    name,
    ...(tag === 'Template' ? { templateType: 'SpreadsheetDocument' as const } : {}),
  });
}

function createOwner(creator: MetadataXmlCreator, configRoot: string, kind: MetaKind, name: string): string {
  const result = creator.addRootObject({ configRoot, kind, name });
  assertOk(result, `addRootObject(${kind})`);
  const xmlPath = result.changedFiles.find((f) => f.endsWith(`${name}.xml`) && !f.includes('Configuration.xml'));
  assert.ok(xmlPath, `не найден путь к созданному объекту ${kind}.${name}`);
  return xmlPath;
}

// ── T-3: декларация 13 билдеров ────────────────────────────────────────────

suite('ChildObjects/декларация: T-3 — все генераторы XML объявляют encoding="UTF-8"', () => {
  test('buildRootObjectXml: первая строка результата — <?xml version="1.0" encoding="UTF-8"?>', () => {
    const xml = buildRootObjectXml('Catalog', 'Тест', '2.21', BASELINE_RULESET);
    assert.strictEqual(xml.split('\n')[0], '<?xml version="1.0" encoding="UTF-8"?>');
  });

  test('ensureTemplateContentFiles(TextDocument): без XML-декларации (обычный текстовый файл) — не применимо, пропускаем декларацию, но файл создаётся', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-tpl-'));
    const created = ensureTemplateContentFiles(dir, 'TextDocument', '2.21');
    assert.strictEqual(created.length, 1);
  });

  const templateTypesWithXmlDeclaration: { type: Parameters<typeof ensureTemplateContentFiles>[1]; label: string }[] = [
    { type: 'SpreadsheetDocument', label: 'buildSpreadsheetDocumentTemplateXml (Template.xml)' },
    { type: 'DataCompositionSchema', label: 'buildDataCompositionSchemaTemplateXml (Template.xml)' },
    { type: 'DataCompositionAppearanceTemplate', label: 'buildDataCompositionAppearanceTemplateXml (Template.xml)' },
    { type: 'GraphicalSchema', label: 'buildGraphicalSchemaTemplateXml (Template.xml)' },
    { type: 'HTMLDocument', label: 'buildHtmlTemplateDescriptorXml (Template.xml — HTML-описатель)' },
  ];

  for (const { type, label } of templateTypesWithXmlDeclaration) {
    test(`ensureTemplateContentFiles(${type}): ${label} — первая строка "<?xml ... encoding=\\"UTF-8\\"?>"`, () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-tpl-'));
      const created = ensureTemplateContentFiles(dir, type, '2.21');
      const xmlFile = created.find((f) => f.endsWith('.xml'));
      assert.ok(xmlFile, `${type}: не создан описательный .xml`);
      assert.strictEqual(readXml(xmlFile).split('\n')[0], '<?xml version="1.0" encoding="UTF-8"?>');
    });
  }

  test('MetadataXmlCreator.addRootObject(Role): buildEmptyRightsXml(Ext/Rights.xml) — "UTF-8" (контроль: уже был верным до задачи)', () => {
    const configRoot = newConfigRoot();
    const creator = new MetadataXmlCreator();
    const result = creator.addRootObject({ configRoot, kind: 'Role', name: 'Тест' });
    assertOk(result, 'addRootObject(Role)');
    const rightsPath = result.changedFiles.find((f) => f.endsWith('Rights.xml'));
    assert.ok(rightsPath);
    assert.strictEqual(readXml(rightsPath).split('\n')[0], '<?xml version="1.0" encoding="UTF-8"?>');
  });

  test('MetadataXmlCreator.addRootObject(BusinessProcess): buildBusinessProcessFlowchartXml(Ext/Flowchart.xml) — "UTF-8"', () => {
    const configRoot = newConfigRoot();
    const creator = new MetadataXmlCreator();
    const result = creator.addRootObject({ configRoot, kind: 'BusinessProcess', name: 'Тест' });
    assertOk(result, 'addRootObject(BusinessProcess)');
    const flowchartPath = result.changedFiles.find((f) => f.endsWith('Flowchart.xml'));
    assert.ok(flowchartPath);
    assert.strictEqual(readXml(flowchartPath).split('\n')[0], '<?xml version="1.0" encoding="UTF-8"?>');
  });

  test('MetadataXmlCreator.addChildElement(Form): buildFormDescriptorXml/buildManagedFormXml — "UTF-8" (контроль: уже был верным)', () => {
    const configRoot = newConfigRoot();
    const creator = new MetadataXmlCreator();
    const ownerXml = createOwner(creator, configRoot, 'Catalog', 'Тест');
    const result = addTag(creator, ownerXml, 'Form', 'Форма1');
    assertOk(result, 'addChildElement(Form)');
    const descriptorXml = result.changedFiles.find((f) => f.endsWith('Форма1.xml'));
    const formXml = result.changedFiles.find((f) => f.endsWith(path.join('Форма1', 'Ext', 'Form.xml')));
    assert.ok(descriptorXml && formXml);
    assert.strictEqual(readXml(descriptorXml).split('\n')[0], '<?xml version="1.0" encoding="UTF-8"?>');
    assert.strictEqual(readXml(formXml).split('\n')[0], '<?xml version="1.0" encoding="UTF-8"?>');
  });

  test('externalObjectXml.buildExternalObjectXml (контрольная группа — уже "UTF-8" до задачи, править не нужно)', () => {
    const xml = buildExternalObjectXml({ type: 'ExternalDataProcessor', name: 'Тест', synonym: 'Тест' });
    assert.strictEqual(xml.split('\n')[0], '<?xml version="1.0" encoding="UTF-8"?>');
  });

  test('dcs/schemaBuilders.buildSchemaXml (контрольная группа — уже "UTF-8" до задачи, править не нужно)', () => {
    const xml = buildSchemaXml({ dataSources: [], dataSets: [], totalFields: [] });
    assert.strictEqual(xml.split('\n')[0], '<?xml version="1.0" encoding="UTF-8"?>');
  });

  test('НЕГАТИВНЫЙ GUARD: в src/infra нет ни одного вхождения encoding="utf-8" (строчными)', () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (entry.name.endsWith('.ts') && readXml(full).includes('encoding="utf-8"')) {
          offenders.push(full);
        }
      }
    };
    walk(path.resolve(__dirname, '../../infra'));
    assert.deepStrictEqual(offenders, [], `найдены файлы со строчной декларацией encoding="utf-8": ${offenders.join(', ')}`);
  });
});

// ── T-4/T-5: порядок вставки — канон и инвариантность к порядку вызовов ────

/** Владельцы, добавляемые тэги которых (пересечение канона T-1 и реально СОЗДАВАЕМЫХ через API тегов) — для T-4/T-5. */
const ADDABLE_CANON: Readonly<Record<string, readonly ChildTag[]>> = {
  Catalog: ['Attribute', 'TabularSection', 'Form', 'Template', 'Command'],
  ChartOfCharacteristicTypes: ['Attribute', 'TabularSection', 'Form', 'Template', 'Command'],
  ChartOfCalculationTypes: ['Attribute', 'TabularSection', 'Form', 'Template', 'Command'],
  BusinessProcess: ['Attribute', 'TabularSection', 'Form', 'Template', 'Command'],
  ExchangePlan: ['Attribute', 'TabularSection', 'Form', 'Template', 'Command'],
  Report: ['Attribute', 'TabularSection', 'Form', 'Template', 'Command'],
  DataProcessor: ['Attribute', 'TabularSection', 'Form', 'Template', 'Command'],
  Document: ['Attribute', 'Form', 'TabularSection', 'Template', 'Command'],
  // AccountingFlag/ExtDimensionAccountingFlag НЕ создаются через API — см. T-6.
  ChartOfAccounts: ['Attribute', 'TabularSection', 'Form', 'Template', 'Command'],
  Task: ['Attribute', 'TabularSection', 'Form', 'AddressingAttribute', 'Template', 'Command'],
  InformationRegister: ['Resource', 'Attribute', 'Dimension', 'Form', 'Template', 'Command'],
  AccumulationRegister: ['Resource', 'Attribute', 'Dimension', 'Form', 'Template', 'Command'],
  CalculationRegister: ['Resource', 'Attribute', 'Dimension', 'Form', 'Template', 'Command'],
  AccountingRegister: ['Dimension', 'Resource', 'Attribute', 'Form', 'Template', 'Command'],
  Enum: ['EnumValue', 'Form', 'Template', 'Command'],
  // Column НЕ создаётся через API у DocumentJournal — см. T-6.
  DocumentJournal: ['Form', 'Template', 'Command'],
};

// Сверка ПЕРЕД использованием: ADDABLE_CANON обязан быть подпоследовательностью
// CANON_CHILD_ORDER для того же владельца — иначе тесты T-4/T-5 проверяли бы
// не то, что заявлено в T-1.
suite('ChildObjects: ADDABLE_CANON — самопроверка (подпоследовательность CANON_CHILD_ORDER из T-1)', () => {
  for (const [kind, tags] of Object.entries(ADDABLE_CANON)) {
    test(`${kind}: addable-тэги — подпоследовательность канона`, () => {
      const canon = CANON_CHILD_ORDER[kind];
      const canonIndex = new Map(canon.map((t, i) => [t, i]));
      const indices = tags.map((t) => canonIndex.get(t));
      assert.ok(indices.every((i): i is number => i !== undefined), `${kind}: тег вне канона в ADDABLE_CANON`);
      // Начиная с TS 5.5 `indices.every((i): i is number => ...)` внутри
      // assert.ok сужает САМ массив `indices` до `number[]` для кода ниже —
      // повторная фильтрация здесь была бы избыточной (типы не пересекаются).
      const sorted = [...indices].sort((a, b) => a - b);
      assert.deepStrictEqual(indices, sorted, `${kind}: ADDABLE_CANON не подпоследовательность канона`);
    });
  }
});

suite('ChildObjects: T-4 — вставка В КАНОНИЧНОМ порядке вызовов даёт канон (базовая регрессия)', () => {
  for (const [kindStr, tags] of Object.entries(ADDABLE_CANON)) {
    const kind = kindStr as MetaKind;
    test(`${kind}: добавление [${tags.join(', ')}] в канон-порядке → итоговая последовательность = канон`, () => {
      const configRoot = newConfigRoot();
      const creator = new MetadataXmlCreator();
      const ownerXml = createOwner(creator, configRoot, kind, 'Тест');
      for (const tag of tags) {
        const r = addTag(creator, ownerXml, tag, `${tag}1`);
        assertOk(r, `addChildElement(${kind}, ${tag})`);
      }
      const actual = directChildObjectsTagSequence(readXml(ownerXml), kind);
      assert.deepStrictEqual(actual, tags);
    });
  }
});

function allAdjacentTranspositions<T>(order: readonly T[]): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < order.length - 1; i += 1) {
    const copy = [...order];
    [copy[i], copy[i + 1]] = [copy[i + 1], copy[i]];
    result.push(copy);
  }
  return result;
}

suite('ChildObjects: T-5 (КЛЮЧЕВОЙ) — итог НЕ зависит от порядка вызовов add', () => {
  suite('обратный порядок вызовов даёт тот же канон, что и прямой', () => {
    for (const [kindStr, tags] of Object.entries(ADDABLE_CANON)) {
      const kind = kindStr as MetaKind;
      test(`${kind}: reverse([${tags.join(', ')}]) → итог всё равно = канон`, () => {
        const configRoot = newConfigRoot();
        const creator = new MetadataXmlCreator();
        const ownerXml = createOwner(creator, configRoot, kind, 'Тест');
        for (const tag of [...tags].reverse()) {
          const r = addTag(creator, ownerXml, tag, `${tag}1`);
          assertOk(r, `addChildElement(${kind}, ${tag})`);
        }
        const actual = directChildObjectsTagSequence(readXml(ownerXml), kind);
        assert.deepStrictEqual(actual, tags, `${kind}: обратный порядок вызовов обязан давать канон, а не порядок вызовов`);
      });
    }
  });

  suite('ЛЮБАЯ соседняя транспозиция порядка вызовов даёт тот же канон', () => {
    for (const [kindStr, tags] of Object.entries(ADDABLE_CANON)) {
      const kind = kindStr as MetaKind;
      const transpositions = allAdjacentTranspositions(tags);
      transpositions.forEach((callOrder, idx) => {
        test(`${kind}: транспозиция #${String(idx + 1)} порядка вызовов [${callOrder.join(', ')}] → итог = канон`, () => {
          const configRoot = newConfigRoot();
          const creator = new MetadataXmlCreator();
          const ownerXml = createOwner(creator, configRoot, kind, 'Тест');
          for (const tag of callOrder) {
            const r = addTag(creator, ownerXml, tag, `${tag}1`);
            assertOk(r, `addChildElement(${kind}, ${tag})`);
          }
          const actual = directChildObjectsTagSequence(readXml(ownerXml), kind);
          assert.deepStrictEqual(actual, tags);
        });
      });
    }
  });

  test('ОБЯЗАТЕЛЬНЫЙ явный кейс из заявки пользователя: InformationRegister — add Dimension затем Resource даёт ТОТ ЖЕ файл (по составу/порядку), что обратная последовательность, и в обоих Resource раньше Dimension', () => {
    const creator = new MetadataXmlCreator();

    const rootA = newConfigRoot();
    const ownerA = createOwner(creator, rootA, 'InformationRegister', 'Тест');
    assertOk(addTag(creator, ownerA, 'Dimension', 'Изм1'), 'A: Dimension');
    assertOk(addTag(creator, ownerA, 'Resource', 'Рес1'), 'A: Resource');

    const rootB = newConfigRoot();
    const ownerB = createOwner(creator, rootB, 'InformationRegister', 'Тест');
    assertOk(addTag(creator, ownerB, 'Resource', 'Рес1'), 'B: Resource');
    assertOk(addTag(creator, ownerB, 'Dimension', 'Изм1'), 'B: Dimension');

    const tagsA = directChildObjectsTagSequence(readXml(ownerA), 'InformationRegister');
    const tagsB = directChildObjectsTagSequence(readXml(ownerB), 'InformationRegister');
    assert.deepStrictEqual(tagsA, ['Resource', 'Dimension'], 'add Dimension затем Resource: Resource обязан оказаться РАНЬШЕ Dimension');
    assert.deepStrictEqual(tagsB, ['Resource', 'Dimension'], 'add Resource затем Dimension: тот же итог');
    assert.deepStrictEqual(tagsA, tagsB, 'порядок вызовов не должен влиять на итоговый файл');
  });
});

// ── T-6: пред-существующие теги вне API создания (AccountingFlag/ExtDimensionAccountingFlag/Column) ──

suite('ChildObjects: T-6 — вставка относительно существующих тегов, которые мы НЕ создаём (реальный эталон)', () => {
  test('ChartOfAccounts (реальный файл example/2.20/.../Хозрасчетный.xml): добавляемая ТЧ встаёт ПЕРЕД AccountingFlag, форма — ПОСЛЕ ExtDimensionAccountingFlag', function () {
    const sourcePath = path.resolve(__dirname, '../../../example/2.20/src/cf/ChartsOfAccounts/Хозрасчетный.xml');
    if (!fs.existsSync(sourcePath)) {
      this.skip();
      return;
    }
    const configRoot = newConfigRoot();
    const destDir = path.join(configRoot, 'ChartsOfAccounts');
    fs.mkdirSync(destDir, { recursive: true });
    const destXml = path.join(destDir, 'Хозрасчетный.xml');
    fs.copyFileSync(sourcePath, destXml);

    const creator = new MetadataXmlCreator();
    assertOk(addTag(creator, destXml, 'TabularSection', 'НоваяТЧ'), 'add TabularSection');
    assertOk(addTag(creator, destXml, 'Form', 'НоваяФорма'), 'add Form');

    const entries = directChildObjectsEntries(readXml(destXml), 'ChartOfAccounts');
    assert.ok(entries, 'не удалось разобрать ChildObjects результирующего файла');
    const tagIndex = (tag: string, name?: string): number =>
      entries.findIndex((e) => e.tag === tag && (name === undefined || e.name === name));

    const newTsIndex = tagIndex('TabularSection', 'НоваяТЧ');
    const firstAccountingFlag = tagIndex('AccountingFlag');
    const newFormIndex = tagIndex('Form', 'НоваяФорма');
    const lastExtDimIndex = entries.map((e) => e.tag).lastIndexOf('ExtDimensionAccountingFlag');

    assert.ok(newTsIndex >= 0 && firstAccountingFlag >= 0, 'не нашлись ожидаемые узлы');
    assert.ok(newTsIndex < firstAccountingFlag, 'новая табличная часть обязана встать ПЕРЕД первым AccountingFlag');
    assert.ok(newFormIndex >= 0 && lastExtDimIndex >= 0, 'не нашлись ожидаемые узлы');
    assert.ok(newFormIndex > lastExtDimIndex, 'новая форма обязана встать ПОСЛЕ последнего ExtDimensionAccountingFlag');
  });

  test('Task: форма встаёт ПЕРЕД AddressingAttribute (даже если AddressingAttribute добавлен РАНЬШЕ формы)', () => {
    const configRoot = newConfigRoot();
    const creator = new MetadataXmlCreator();
    const ownerXml = createOwner(creator, configRoot, 'Task', 'Тест');
    assertOk(addTag(creator, ownerXml, 'AddressingAttribute', 'Адресация1'), 'add AddressingAttribute');
    assertOk(addTag(creator, ownerXml, 'Form', 'Форма1'), 'add Form');

    const entries = directChildObjectsEntries(readXml(ownerXml), 'Task');
    assert.ok(entries);
    const formIndex = entries.findIndex((e) => e.tag === 'Form' && e.name === 'Форма1');
    const addrIndex = entries.findIndex((e) => e.tag === 'AddressingAttribute' && e.name === 'Адресация1');
    assert.ok(formIndex >= 0 && addrIndex >= 0);
    assert.ok(formIndex < addrIndex, 'форма обязана встать ПЕРЕД реквизитом адресации');
  });

  test('DocumentJournal (реальный файл из example/): новая Форма встаёт ПОСЛЕ всех существующих Column', function () {
    const dirRoot = path.resolve(__dirname, '../../../example/2.21/src/cf/DocumentJournals');
    if (!fs.existsSync(dirRoot)) {
      this.skip();
      return;
    }
    const candidate = fs.readdirSync(dirRoot, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.xml'))
      .map((e) => path.join(dirRoot, e.name))
      .find((p) => readXml(p).includes('<Column '));
    if (!candidate) {
      this.skip();
      return;
    }
    const configRoot = newConfigRoot();
    const destDir = path.join(configRoot, 'DocumentJournals');
    fs.mkdirSync(destDir, { recursive: true });
    const destXml = path.join(destDir, path.basename(candidate));
    fs.copyFileSync(candidate, destXml);

    const creator = new MetadataXmlCreator();
    assertOk(addTag(creator, destXml, 'Form', 'НоваяФорма'), 'add Form');

    const entries = directChildObjectsEntries(readXml(destXml), 'DocumentJournal');
    assert.ok(entries);
    const newFormIndex = entries.findIndex((e) => e.tag === 'Form' && e.name === 'НоваяФорма');
    const lastColumnIndex = entries.map((e) => e.tag).lastIndexOf('Column');
    assert.ok(newFormIndex >= 0 && lastColumnIndex >= 0);
    assert.ok(newFormIndex > lastColumnIndex, 'новая форма обязана встать ПОСЛЕ всех существующих Column');
  });
});

// ── T-7: консервативный режим (нет правила → в конец) ──────────────────────

suite('ChildObjects: T-7 — консервативный режим (владелец/тег вне таблицы, вложенные контейнеры) — вставка в конец', () => {
  test('владелец ВНЕ таблицы (гипотетический вид метаданных) — новый элемент дописывается в конец, существующие не трогаются', () => {
    const configRoot = newConfigRoot();
    const destDir = path.join(configRoot, 'FutureKinds');
    fs.mkdirSync(destDir, { recursive: true });
    const destXml = path.join(destDir, 'Тест.xml');
    const legacy = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" version="2.21">',
      '\t<FutureKind uuid="11111111-1111-1111-1111-111111111111">',
      '\t\t<Properties>',
      '\t\t\t<Name>Тест</Name>',
      '\t\t\t<Synonym/>',
      '\t\t\t<Comment/>',
      '\t\t</Properties>',
      '\t\t<ChildObjects>',
      '\t\t\t<Form>СтараяФорма</Form>',
      '\t\t</ChildObjects>',
      '\t</FutureKind>',
      '</MetaDataObject>',
      '',
    ].join('\n');
    fs.writeFileSync(destXml, legacy, 'utf-8');

    const creator = new MetadataXmlCreator();
    assertOk(addTag(creator, destXml, 'Attribute', 'НовыйРеквизит'), 'add Attribute на неизвестном виде владельца');

    const entries = directChildObjectsEntries(readXml(destXml), 'FutureKind');
    assert.ok(entries);
    assert.deepStrictEqual(entries.map((e) => e.tag), ['Form', 'Attribute'], 'на владельце вне таблицы новый элемент — в конец, порядок существующих не тронут');
  });

  test('тег, для которого у ДАННОГО владельца нет ранга (EnumValue на Catalog) — вставка в конец, порядок Attribute/Form не тронут', () => {
    const configRoot = newConfigRoot();
    const creator = new MetadataXmlCreator();
    const ownerXml = createOwner(creator, configRoot, 'Catalog', 'Тест');
    assertOk(addTag(creator, ownerXml, 'Form', 'Форма1'), 'add Form');
    assertOk(addTag(creator, ownerXml, 'Attribute', 'Реквизит1'), 'add Attribute');
    // EnumValue формально принадлежит другому виду владельца — в канон-таблице
    // Catalog для него нет ранга; ожидание — конец списка, БЕЗ попытки
    // "притянуть" его к позиции Attribute по алфавиту/типу тега.
    assertOk(addTag(creator, ownerXml, 'EnumValue', 'Значение1'), 'add EnumValue (тег вне канона для Catalog)');

    // Порядок вызовов был [Form, Attribute, EnumValue], но Attribute(ранг0)
    // строго МЕНЬШЕ Form(ранг2) в каноне Catalog — по тому же правилу, что и
    // обязательный кейс «Dimension затем Resource» из T-5, Attribute обязан
    // встать ПЕРЕД Form независимо от порядка вызовов. Проверяемое здесь
    // свойство — что EnumValue (тег вне канона для Catalog) при этом уходит
    // в конец, а не встраивается по каким-то своим правилам.
    const tags = directChildObjectsTagSequence(readXml(ownerXml), 'Catalog');
    assert.deepStrictEqual(tags, ['Attribute', 'Form', 'EnumValue']);
  });

  test('вложенный контейнер: колонка ТЧ (container=nested) — вставка в конец, БЕЗ владельческого канона (Attribute/Dimension и т.п. здесь неприменимы)', () => {
    const configRoot = newConfigRoot();
    const creator = new MetadataXmlCreator();
    const ownerXml = createOwner(creator, configRoot, 'Catalog', 'Тест');
    assertOk(addTag(creator, ownerXml, 'TabularSection', 'ТЧ1'), 'add TabularSection');
    for (const name of ['КолонкаБ', 'КолонкаА', 'КолонкаВ']) {
      const r = creator.addChildElement({ ownerObjectXmlPath: ownerXml, childTag: 'Column', name, tabularSectionName: 'ТЧ1' });
      assertOk(r, `add Column ${name}`);
    }
    const xml = readXml(ownerXml);
    const sectionBlock = /<TabularSection uuid="[^"]*">[\s\S]*?<\/TabularSection>/.exec(xml)?.[0] ?? '';
    const columnNames = [...sectionBlock.matchAll(/<Attribute uuid="[^"]*">[\s\S]*?<Name>([^<]+)<\/Name>/g)].map((m) => m[1]);
    assert.deepStrictEqual(columnNames, ['КолонкаБ', 'КолонкаА', 'КолонкаВ'], 'колонки ТЧ — строго в порядке добавления (нет канона на уровне контейнера)');
  });

  test('вложенный контейнер: метод URL-шаблона (container=nested) — вставка в конец', () => {
    const configRoot = newConfigRoot();
    const creator = new MetadataXmlCreator();
    const ownerXml = createOwner(creator, configRoot, 'HTTPService', 'Тест');
    assertOk(addTag(creator, ownerXml, 'URLTemplate', 'Шаблон1'), 'add URLTemplate');
    for (const name of ['DELETE', 'GET', 'POST']) {
      const r = creator.addChildElement({ ownerObjectXmlPath: ownerXml, childTag: 'Method', name, urlTemplateName: 'Шаблон1' });
      assertOk(r, `add Method ${name}`);
    }
    const xml = readXml(ownerXml);
    const templateBlock = /<URLTemplate uuid="[^"]*">[\s\S]*?<\/URLTemplate>/.exec(xml)?.[0] ?? '';
    const methodNames = [...templateBlock.matchAll(/<Method uuid="[^"]*">[\s\S]*?<Name>([^<]+)<\/Name>/g)].map((m) => m[1]);
    assert.deepStrictEqual(methodNames, ['DELETE', 'GET', 'POST'], 'методы URL-шаблона — строго в порядке добавления');
  });
});

// ── T-8: неизменность существующего (легаси-файл с НЕканоничным порядком) ──

suite('ChildObjects: T-8 — на легаси-файле с неканоничным порядком существующие блоки не переставляются', () => {
  test('Catalog: легаси [Form, Attribute] (неканон) + добавление TabularSection → [TabularSection(нов.), Form, Attribute] — Form/Attribute НЕ переставлены местами', () => {
    const configRoot = newConfigRoot();
    const destDir = path.join(configRoot, 'Catalogs');
    fs.mkdirSync(destDir, { recursive: true });
    const destXml = path.join(destDir, 'Легаси.xml');
    const legacy = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" version="2.21">',
      '\t<Catalog uuid="11111111-1111-1111-1111-111111111111">',
      '\t\t<Properties>',
      '\t\t\t<Name>Легаси</Name>',
      '\t\t\t<Synonym/>',
      '\t\t\t<Comment/>',
      '\t\t</Properties>',
      '\t\t<ChildObjects>',
      '\t\t\t<Form>СтараяФорма</Form>',
      '\t\t\t<Attribute uuid="22222222-2222-2222-2222-222222222222">',
      '\t\t\t\t<Properties>',
      '\t\t\t\t\t<Name>СтарыйРеквизит</Name>',
      '\t\t\t\t\t<Synonym/>',
      '\t\t\t\t\t<Comment/>',
      '\t\t\t\t\t<Type><v8:Type>xs:string</v8:Type></Type>',
      '\t\t\t\t</Properties>',
      '\t\t\t</Attribute>',
      '\t\t</ChildObjects>',
      '\t</Catalog>',
      '</MetaDataObject>',
      '',
    ].join('\n');
    fs.writeFileSync(destXml, legacy, 'utf-8');

    const creator = new MetadataXmlCreator();
    assertOk(addTag(creator, destXml, 'TabularSection', 'НоваяТЧ'), 'add TabularSection');

    const entries = directChildObjectsEntries(readXml(destXml), 'Catalog');
    assert.ok(entries);
    assert.deepStrictEqual(
      entries.map((e) => ({ tag: e.tag, name: e.name })),
      [
        { tag: 'TabularSection', name: 'НоваяТЧ' },
        { tag: 'Form', name: 'СтараяФорма' },
        { tag: 'Attribute', name: 'СтарыйРеквизит' },
      ],
      'алгоритм обязан вставить новый элемент ПЕРЕД первым существующим узлом строго большего ранга (Form), ' +
      'но НЕ переставлять существующие Form/Attribute местами (нормализации нет)'
    );
  });
});

// ── T-9: BOM/EOL ────────────────────────────────────────────────────────────

suite('ChildObjects: T-9 — BOM и EOL сохраняются при вставке (в середину и в конец)', () => {
  const boms: readonly boolean[] = [false, true];
  const eols: readonly ('\n' | '\r\n')[] = ['\n', '\r\n'];

  function buildFixture(bom: boolean, eol: '\n' | '\r\n'): string {
    const lines = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" version="2.21">',
      '\t<Catalog uuid="11111111-1111-1111-1111-111111111111">',
      '\t\t<Properties>',
      '\t\t\t<Name>Тест</Name>',
      '\t\t\t<Synonym/>',
      '\t\t\t<Comment/>',
      '\t\t</Properties>',
      '\t\t<ChildObjects>',
      '\t\t\t<Form>СтараяФорма</Form>',
      '\t\t</ChildObjects>',
      '\t</Catalog>',
      '</MetaDataObject>',
      '',
    ];
    const body = lines.join(eol);
    return (bom ? '﻿' : '') + body;
  }

  for (const bom of boms) {
    for (const eol of eols) {
      const eolLabel = eol === '\n' ? 'LF' : 'CRLF';
      test(`BOM=${String(bom)}, EOL=${eolLabel}: вставка ПЕРЕД существующим (TabularSection перед Form) сохраняет BOM/EOL`, () => {
        const configRoot = newConfigRoot();
        const destDir = path.join(configRoot, 'Catalogs');
        fs.mkdirSync(destDir, { recursive: true });
        const destXml = path.join(destDir, 'Тест.xml');
        fs.writeFileSync(destXml, buildFixture(bom, eol));

        const creator = new MetadataXmlCreator();
        assertOk(addTag(creator, destXml, 'TabularSection', 'НоваяТЧ'), 'add TabularSection (вставка в середину)');

        const raw = fs.readFileSync(destXml, 'utf-8');
        assert.strictEqual(raw.charCodeAt(0) === 0xfeff, bom, 'BOM должен сохраниться (или отсутствовать) как в исходнике');
        const withoutBom = raw.replace(/^\uFEFF/, '');
        if (eol === '\r\n') {
          assert.ok(!/(?<!\r)\n/.test(withoutBom), 'в CRLF-файле не должно остаться "голых" \\n');
        } else {
          assert.ok(!withoutBom.includes('\r\n'), 'в LF-файле не должно появиться \\r\\n');
        }
      });

      test(`BOM=${String(bom)}, EOL=${eolLabel}: вставка В КОНЕЦ (Command после Form) сохраняет BOM/EOL`, () => {
        const configRoot = newConfigRoot();
        const destDir = path.join(configRoot, 'Catalogs');
        fs.mkdirSync(destDir, { recursive: true });
        const destXml = path.join(destDir, 'Тест.xml');
        fs.writeFileSync(destXml, buildFixture(bom, eol));

        const creator = new MetadataXmlCreator();
        assertOk(addTag(creator, destXml, 'Command', 'НоваяКоманда'), 'add Command (вставка в конец)');

        const raw = fs.readFileSync(destXml, 'utf-8');
        assert.strictEqual(raw.charCodeAt(0) === 0xfeff, bom);
        const withoutBom = raw.replace(/^\uFEFF/, '');
        if (eol === '\r\n') {
          assert.ok(!/(?<!\r)\n/.test(withoutBom), 'в CRLF-файле не должно остаться "голых" \\n');
        } else {
          assert.ok(!withoutBom.includes('\r\n'), 'в LF-файле не должно появиться \\r\\n');
        }
      });
    }
  }
});

// ── T-10: идемпотентность (повторное имя — ошибка, файл не тронут) ────────

suite('ChildObjects: T-10 — повторное добавление того же имени: ошибка, файл байт-в-байт прежний', () => {
  const cases: { label: string; kind: MetaKind; tag: ChildTag; name: string; extra?: Record<string, string> }[] = [
    { label: 'Attribute (типизированное поле)', kind: 'Catalog', tag: 'Attribute', name: 'Дубль' },
    { label: 'AddressingAttribute', kind: 'Task', tag: 'AddressingAttribute', name: 'Дубль' },
    { label: 'Dimension', kind: 'InformationRegister', tag: 'Dimension', name: 'Дубль' },
    { label: 'Resource', kind: 'InformationRegister', tag: 'Resource', name: 'Дубль' },
    { label: 'TabularSection', kind: 'Catalog', tag: 'TabularSection', name: 'Дубль' },
    { label: 'Form (простая ссылка)', kind: 'Catalog', tag: 'Form', name: 'Дубль' },
    { label: 'Command (полный блок)', kind: 'Catalog', tag: 'Command', name: 'Дубль' },
    { label: 'Template (простая ссылка + доп. файлы)', kind: 'Catalog', tag: 'Template', name: 'Дубль' },
    { label: 'EnumValue', kind: 'Enum', tag: 'EnumValue', name: 'Дубль' },
  ];

  for (const { label, kind, tag, name } of cases) {
    test(`${label}: повторный add того же имени → ошибка «уже существует», файл не изменился`, () => {
      const configRoot = newConfigRoot();
      const creator = new MetadataXmlCreator();
      const ownerXml = createOwner(creator, configRoot, kind, 'Тест');
      assertOk(addTag(creator, ownerXml, tag, name), `первое добавление ${tag}`);
      const before = readXml(ownerXml);

      const result = addTag(creator, ownerXml, tag, name);
      assert.strictEqual(result.success, false, `повторное добавление ${tag} "${name}" обязано провалиться`);
      assert.ok(result.errors.some((e) => e.includes('уже существует')), `сообщение об ошибке обязано содержать «уже существует», получено: ${result.errors.join('; ')}`);
      assert.strictEqual(readXml(ownerXml), before, 'файл не должен измениться при неуспешном добавлении');
    });
  }

  test('Column (вложенный контейнер ТЧ): повторное добавление того же имени колонки — ошибка, файл не изменился', () => {
    const configRoot = newConfigRoot();
    const creator = new MetadataXmlCreator();
    const ownerXml = createOwner(creator, configRoot, 'Catalog', 'Тест');
    assertOk(addTag(creator, ownerXml, 'TabularSection', 'ТЧ1'), 'add TabularSection');
    const add = (name: string): EditResult => creator.addChildElement({ ownerObjectXmlPath: ownerXml, childTag: 'Column', name, tabularSectionName: 'ТЧ1' });
    assertOk(add('Колонка1'), 'первое добавление колонки');
    const before = readXml(ownerXml);
    const result = add('Колонка1');
    assert.strictEqual(result.success, false);
    assert.strictEqual(readXml(ownerXml), before);
  });

  test('Method (вложенный контейнер URLTemplate): повторное добавление того же имени метода — ошибка, файл не изменился', () => {
    const configRoot = newConfigRoot();
    const creator = new MetadataXmlCreator();
    const ownerXml = createOwner(creator, configRoot, 'HTTPService', 'Тест');
    assertOk(addTag(creator, ownerXml, 'URLTemplate', 'Шаблон1'), 'add URLTemplate');
    const add = (name: string): EditResult => creator.addChildElement({ ownerObjectXmlPath: ownerXml, childTag: 'Method', name, urlTemplateName: 'Шаблон1' });
    assertOk(add('GET'), 'первое добавление метода');
    const before = readXml(ownerXml);
    const result = add('GET');
    assert.strictEqual(result.success, false);
    assert.strictEqual(readXml(ownerXml), before);
  });
});

// ── T-11: структурный round-trip ───────────────────────────────────────────

suite('ChildObjects: T-11 — структурный round-trip после каждой вставки', () => {
  function assertWellFormed(xml: string, label: string): void {
    const result = XMLValidator.validate(xml, { allowBooleanAttributes: true });
    assert.strictEqual(result === true, true, `${label}: результат не well-formed XML`);
  }

  for (const [kindStr, tags] of Object.entries(ADDABLE_CANON)) {
    const kind = kindStr as MetaKind;
    test(`${kind}: после каждой вставки — well-formed, +1 прямой ребёнок, uuid/<Name> владельца и существующих детей не меняются`, () => {
      const configRoot = newConfigRoot();
      const creator = new MetadataXmlCreator();
      const ownerXml = createOwner(creator, configRoot, kind, 'Тест');

      const initial = readXml(ownerXml);
      assertWellFormed(initial, `${kind}: начальное состояние`);
      const ownerUuidRe = new RegExp(`<${kind} uuid="([^"]+)"`);
      const ownerUuid = ownerUuidRe.exec(initial)?.[1];
      assert.ok(ownerUuid, `${kind}: не удалось извлечь uuid владельца`);

      let prevEntries = directChildObjectsEntries(initial, kind) ?? [];
      for (const tag of tags) {
        const name = `${tag}Р`;
        assertOk(addTag(creator, ownerXml, tag, name), `add ${tag}`);
        const after = readXml(ownerXml);
        assertWellFormed(after, `${kind}: после add ${tag}`);

        assert.strictEqual(ownerUuidRe.exec(after)?.[1], ownerUuid, `${kind}: uuid владельца не должен меняться после add ${tag}`);
        assert.ok(after.includes('<Name>Тест</Name>'), `${kind}: <Name> владельца не должен теряться после add ${tag}`);

        const nextEntries = directChildObjectsEntries(after, kind);
        assert.ok(nextEntries, `${kind}: не удалось разобрать ChildObjects после add ${tag}`);
        assert.strictEqual(nextEntries.length, prevEntries.length + 1, `${kind}: после add ${tag} обязан появиться РОВНО один новый прямой элемент`);
        for (const prevEntry of prevEntries) {
          assert.ok(
            nextEntries.some((e) => e.tag === prevEntry.tag && e.name === prevEntry.name),
            `${kind}: ранее существовавший элемент ${prevEntry.tag}.${prevEntry.name} обязан остаться после add ${tag}`
          );
        }

        prevEntries = nextEntries;
      }
    });
  }
});
