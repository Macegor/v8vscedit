import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { META_TYPES, type MetaKind } from '../../domain/MetaTypes';
import { MetadataXmlCreator } from '../../infra/xml/MetadataXmlCreator';
import { ObjectXmlReader } from '../../infra/xml/ObjectXmlReader';
import { extractTopLevelPropertiesChildren } from '../../infra/xml/MetadataPropertiesXml';
import { collectPropertyBlocks, findPropertiesRange, removeBlocks } from '../../infra/xml/typedField/PropertyBlockEditor';
import { skipWithoutCorpus } from './support/corpus';
import { relativeToCorpus, requirePropertyOrder, sameModuloMixedEol, scanRootPropertyFacts } from './support/propertyOrderCorpus';
import { assertWellFormedXml } from './support/typedFieldCorpus';

/**
 * ЭТАП 2 задачи «канон порядка свойств корня»: третье место вставки —
 * `replaceOrInsertTypeBlock`. Отсутствующий `<Type>`/`<Source>`/`<CommandParameterType>`
 * писался «сразу после `<Comment>`» независимо от вида объекта. Для `Constant`,
 * `SessionParameter`, `DefinedType`, `EventSubscription` это верно случайно, для
 * `CommonCommand` — нет: эталон даёт `CommandParameterType` ПОСЛЕ
 * `IncludeHelpInContents` (десятым), а мы писали четвёртым, перед `Group`.
 *
 * Сьюты этой задачи вынесены в отдельный файл, чтобы этап 1 (писатели свойств)
 * принимался независимо от этапа 2.
 *
 * Мутации — только над копиями во временном каталоге; `example/` не пишется.
 */

const tempDirs: string[] = [];

function writeTemp(content: string, name = 'Объект.xml'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-type-order-'));
  tempDirs.push(dir);
  const target = path.join(dir, name);
  fs.writeFileSync(target, content, 'utf-8');
  return target;
}

function keysOf(xml: string): string[] {
  return extractTopLevelPropertiesChildren(xml).map((child) => child.tag);
}

type TypeTarget = 'SessionParameter' | 'DefinedType' | 'EventSubscription' | 'CommonCommand' | 'Constant';
type TypeProperty = 'Type' | 'Source' | 'CommandParameterType';

interface TypeCase {
  readonly xmlRoot: string;
  readonly targetKind: TypeTarget;
  readonly propertyName: TypeProperty;
  /** Виды с нормализацией состава свойств (Type → перестройка типозависимых ключей) сравниваются по началу блока. */
  readonly normalizesComposition: boolean;
}

// Все корневые виды, где расширение вставляет тип отдельным блоком (`isRootTypeTargetKind`),
// кроме CommonAttribute — у него ветка типизированного поля с собственным составом свойств.
const TYPE_CASES: readonly TypeCase[] = [
  { xmlRoot: 'CommonCommand', targetKind: 'CommonCommand', propertyName: 'CommandParameterType', normalizesComposition: false },
  { xmlRoot: 'SessionParameter', targetKind: 'SessionParameter', propertyName: 'Type', normalizesComposition: false },
  { xmlRoot: 'DefinedType', targetKind: 'DefinedType', propertyName: 'Type', normalizesComposition: false },
  { xmlRoot: 'EventSubscription', targetKind: 'EventSubscription', propertyName: 'Source', normalizesComposition: false },
  { xmlRoot: 'Constant', targetKind: 'Constant', propertyName: 'Type', normalizesComposition: true },
];

/** Тип для записи, если в оригинале блок пустой/самозакрытый: любой валидный, состав от него не зависит. */
const FALLBACK_TYPE_INNER = '<v8:Type>xs:string</v8:Type>';

suite('ЭТАП 2 — ObjectXmlReader.updateTypeInObject: отсутствующий блок типа встаёт по канону вида (эталон example/)', () => {
  suiteSetup(function () {
    skipWithoutCorpus(this);
  });
  suiteTeardown(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  for (const item of TYPE_CASES) {
    test(`${item.targetKind}: вырезанный ${item.propertyName} возвращается на своё место во ВСЕХ файлах трёх корней корпуса`, function () {
      this.timeout(300_000);
      const bucket = scanRootPropertyFacts().get(item.xmlRoot);
      assert.ok(bucket && bucket.files.length > 0, `в корпусе нет ни одного ${item.xmlRoot}`);
      const failures: string[] = [];
      let checked = 0;

      for (const file of bucket.files) {
        const original = fs.readFileSync(file.file, 'utf-8');
        const range = findPropertiesRange(original);
        const eol = original.includes('\r\n') ? '\r\n' : '\n';
        const block = range ? collectPropertyBlocks(range.inner).find((candidate) => candidate.key === item.propertyName) : undefined;
        if (!range || !block) {
          continue;
        }
        const stripped = original.slice(0, range.start) + removeBlocks(range.inner, [block]) + original.slice(range.end);
        assert.ok(!keysOf(stripped).includes(item.propertyName), 'фикстура: блок вырезан');

        // Оригинальное содержимое блока — чтобы для видов без нормализации состава
        // сравнить файл БАЙТ-В-БАЙТ; отступ внутренних строк снимается ровно на один уровень.
        const paired = new RegExp(`^<${item.propertyName}>${eol}([\\s\\S]*)${eol}${block.indent}</${item.propertyName}>$`).exec(block.xml);
        const originalInner = paired
          ? paired[1].split(eol).map((line) => (line.startsWith(`${block.indent}\t`) ? line.slice(block.indent.length + 1) : line)).join('\n')
          : undefined;
        if (item.normalizesComposition && !originalInner) {
          continue;
        }

        const copy = writeTemp(stripped, path.basename(file.file));
        const changed = new ObjectXmlReader().updateTypeInObject(copy, {
          targetKind: item.targetKind,
          targetName: path.basename(file.file, '.xml'),
          propertyName: item.propertyName,
          typeInnerXml: originalInner ?? FALLBACK_TYPE_INNER,
        });
        const after = fs.readFileSync(copy, 'utf-8');
        checked++;

        const afterKeys = keysOf(after);
        const expectedKeys = item.normalizesComposition ? file.keys.slice(0, 4) : file.keys;
        const actualKeys = item.normalizesComposition ? afterKeys.slice(0, 4) : afterKeys;
        const wrongPlace = JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys);
        const notByteEqual = !item.normalizesComposition && originalInner !== undefined && !sameModuloMixedEol(after, original);
        if (!changed || wrongPlace || notByteEqual) {
          failures.push(
            `${relativeToCorpus(file.file)}: ${changed ? (wrongPlace ? `порядок ${afterKeys.join(',')}` : 'не байт-в-байт') : 'изменений нет'}`
          );
        }
      }

      assert.deepStrictEqual(
        failures.slice(0, 10),
        [],
        `${item.propertyName} у вида ${item.xmlRoot} лёг не на место эталона: ${String(failures.length)} из ${String(checked)} файлов`
      );
      assert.ok(checked > 0, `не проверено ни одного файла вида ${item.xmlRoot}`);
    });
  }

  test('CommonCommand: CommandParameterType встаёт ПОСЛЕ IncludeHelpInContents, а не после Comment (нагляден на реальном файле)', () => {
    const bucket = scanRootPropertyFacts().get('CommonCommand');
    assert.ok(bucket);
    const source = bucket.files[0];
    const original = fs.readFileSync(source.file, 'utf-8');
    const range = findPropertiesRange(original);
    assert.ok(range);
    const block = collectPropertyBlocks(range.inner).find((candidate) => candidate.key === 'CommandParameterType');
    assert.ok(block);
    const copy = writeTemp(original.slice(0, range.start) + removeBlocks(range.inner, [block]) + original.slice(range.end));

    assert.strictEqual(
      new ObjectXmlReader().updateTypeInObject(copy, {
        targetKind: 'CommonCommand',
        targetName: 'Команда',
        propertyName: 'CommandParameterType',
        typeInnerXml: '<v8:Type>cfg:CatalogRef.Товары</v8:Type>',
      }),
      true
    );

    const keys = keysOf(fs.readFileSync(copy, 'utf-8'));
    const at = keys.indexOf('CommandParameterType');
    assert.strictEqual(keys[at - 1], 'IncludeHelpInContents', 'тип параметра — сразу за IncludeHelpInContents');
    assert.strictEqual(keys[at + 1], 'ParameterUseMode');
    assert.ok(at > keys.indexOf('Group'), 'не перед Group, где его писала эвристика «после Comment»');
  });
});

// --- Антирегресс: типизированное поле без <Type> — прежняя эвристика «после Comment» -------------

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>';
const MD_OPEN =
  '<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" xmlns:v8="http://v8.1c.ru/8.1/data/core" ' +
  'xmlns:xr="http://v8.1c.ru/8.3/xcf/readable" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" version="2.21">';

/**
 * Два вида `<Comment>` у поля без `<Type>`: платформа пишет пустой комментарий
 * САМОЗАКРЫТЫМ тегом (в эталоне это подавляющее большинство полей), парный —
 * только у заполненного. Эвристика «после Comment» обязана работать на обоих.
 */
const COMMENT_FORMS: readonly { label: string; xml: string }[] = [
  { label: 'пустой <Comment/>', xml: '<Comment/>' },
  { label: 'заполненный <Comment>Текст</Comment>', xml: '<Comment>Текст</Comment>' },
];

/** Поле без <Type>: канон типизированного поля — Name, Synonym, Comment, Type; общий фолбэк «в конец» был бы регрессом. */
function fieldProps(comment: string): string[] {
  return ['<Name>Поле1</Name>', '<Synonym/>', comment, '<ToolTip/>'];
}

function fieldElement(tag: string, depth: number, comment: string): string[] {
  const tabs = (n: number): string => '\t'.repeat(n);
  return [
    `${tabs(depth)}<${tag} uuid="0b4a2a1e-0000-0000-0000-00000000000${String(depth)}">`,
    `${tabs(depth + 1)}<Properties>`,
    ...fieldProps(comment).map((line) => `${tabs(depth + 2)}${line}`),
    `${tabs(depth + 1)}</Properties>`,
    `${tabs(depth)}</${tag}>`,
  ];
}

function ownerDoc(rootTag: string, children: readonly string[]): string {
  return [
    XML_HEADER,
    MD_OPEN,
    `\t<${rootTag} uuid="0b4a2a1e-0000-0000-0000-000000000001">`,
    '\t\t<Properties>',
    '\t\t\t<Name>Владелец</Name>',
    '\t\t\t<Synonym/>',
    '\t\t\t<Comment/>',
    '\t\t</Properties>',
    '\t\t<ChildObjects>',
    ...children,
    '\t\t</ChildObjects>',
    `\t</${rootTag}>`,
    '</MetaDataObject>',
    '',
  ].join('\n');
}

suite('ЭТАП 2 — updateTypeInObject: типизированное поле без <Type> сохраняет эвристику «после Comment» (антирегресс)', () => {
  suiteTeardown(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  const cases: {
    name: string;
    rootTag: string;
    targetKind: 'Attribute' | 'AddressingAttribute' | 'Dimension' | 'Resource' | 'Column';
    build: (comment: string) => string;
    tabularSectionName?: string;
  }[] = [
    { name: 'Attribute справочника', rootTag: 'Catalog', targetKind: 'Attribute', build: (comment) => ownerDoc('Catalog', fieldElement('Attribute', 3, comment)) },
    { name: 'Attribute документа', rootTag: 'Document', targetKind: 'Attribute', build: (comment) => ownerDoc('Document', fieldElement('Attribute', 3, comment)) },
    { name: 'AddressingAttribute задачи', rootTag: 'Task', targetKind: 'AddressingAttribute', build: (comment) => ownerDoc('Task', fieldElement('AddressingAttribute', 3, comment)) },
    { name: 'Dimension регистра сведений', rootTag: 'InformationRegister', targetKind: 'Dimension', build: (comment) => ownerDoc('InformationRegister', fieldElement('Dimension', 3, comment)) },
    { name: 'Resource регистра сведений', rootTag: 'InformationRegister', targetKind: 'Resource', build: (comment) => ownerDoc('InformationRegister', fieldElement('Resource', 3, comment)) },
    {
      name: 'Column табличной части',
      rootTag: 'Catalog',
      targetKind: 'Column',
      tabularSectionName: 'ТЧ1',
      build: (comment) =>
        ownerDoc('Catalog', [
          '\t\t\t<TabularSection uuid="0b4a2a1e-0000-0000-0000-000000000009">',
          '\t\t\t\t<Properties>',
          '\t\t\t\t\t<Name>ТЧ1</Name>',
          '\t\t\t\t</Properties>',
          '\t\t\t\t<ChildObjects>',
          ...fieldElement('Attribute', 5, comment),
          '\t\t\t\t</ChildObjects>',
          '\t\t\t</TabularSection>',
        ]),
    },
  ];

  for (const item of cases) {
    for (const comment of COMMENT_FORMS) {
      test(`${item.name}, ${comment.label}: Type ставится сразу за Comment (Name, Synonym, Comment, Type), а не в конец и не после Name`, () => {
        const copy = writeTemp(item.build(comment.xml));
        const changed = new ObjectXmlReader().updateTypeInObject(copy, {
          targetKind: item.targetKind,
          targetName: 'Поле1',
          tabularSectionName: item.tabularSectionName,
          typeInnerXml: '<v8:Type>xs:string</v8:Type>',
        });
        assert.strictEqual(changed, true);

        const after = fs.readFileSync(copy, 'utf-8');
        assertWellFormedXml(after, item.name);
        const fieldTag = item.targetKind === 'Column' ? 'Attribute' : item.targetKind;
        const propsInner = new RegExp(`<${fieldTag} uuid[^>]*>\\s*<Properties>([\\s\\S]*?)</Properties>`).exec(
          after.slice(after.indexOf('<ChildObjects>'))
        )?.[1];
        assert.ok(propsInner, 'у поля есть <Properties>');
        const keys = collectPropertyBlocks(propsInner).map((block) => block.key);
        assert.deepStrictEqual(keys.slice(0, 4), ['Name', 'Synonym', 'Comment', 'Type'], `${item.name}: ${keys.join(',')}`);
      });
    }
  }
});

// --- Гейт генератора: MetadataXmlCreator.addRootObject пишет свойства в каноническом порядке ------

/**
 * Дефект-находка этапа: `infra/xml/creator/rootObjectBuilders.ts` несёт собственные
 * литералы порядка свойств, никак не сверенные с эталоном. Гейт ждёт: порядок
 * прямых детей `<Properties>` ВЫВОДА генератора — подпоследовательность строки
 * `ROOT_PROPERTY_ORDER[вид]`. Ожидаемо КРАСНЫЙ на текущем коде — расхождения
 * перечислены поимённо в сообщении; чинить генератор в рамках этой задачи не требуется.
 */
suite('ЭТАП 2 — гейт генератора: порядок свойств вывода addRootObject — подпоследовательность канона', () => {
  suiteTeardown(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function createConfigRoot(version: string): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-generator-order-'));
    tempDirs.push(root);
    fs.writeFileSync(
      path.join(root, 'Configuration.xml'),
      `${XML_HEADER}\n<MetaDataObject version="${version}">\n\t<Configuration>\n\t\t<Properties>\n\t\t\t<Name>Тест</Name>\n\t\t\t<Synonym/>\n\t\t</Properties>\n\t\t<ChildObjects/>\n\t</Configuration>\n</MetaDataObject>\n`,
      'utf-8'
    );
    return root;
  }

  function isSubsequence(part: readonly string[], whole: readonly string[]): boolean {
    let cursor = 0;
    for (const item of whole) {
      if (item === part[cursor]) {
        cursor++;
      }
    }
    return cursor === part.length;
  }

  for (const version of ['2.20', '2.21']) {
    test(`формат ${version}: у каждого создаваемого вида порядок прямых детей <Properties> — подпоследовательность строки канона`, () => {
      const order = requirePropertyOrder();
      const root = createConfigRoot(version);
      const creator = new MetadataXmlCreator();
      const violations: string[] = [];
      let generated = 0;

      const creatable = (Object.values(META_TYPES) as { kind: MetaKind; folder?: string; englishKind?: string }[]).filter(
        (def) => def.folder !== undefined
      );
      for (const def of creatable) {
        const created = creator.addRootObject({ configRoot: root, kind: def.kind, name: `Тест${def.kind}` });
        if (!created.success) {
          continue;
        }
        generated++;
        const xmlPath = created.changedFiles.find((file) => file.endsWith(`Тест${def.kind}.xml`));
        assert.ok(xmlPath, `${def.kind}: генератор не вернул путь XML объекта`);
        const keys = keysOf(fs.readFileSync(xmlPath, 'utf-8'));
        const row = order.ROOT_PROPERTY_ORDER[def.kind];
        if (!row) {
          // Вид без строки канона (нет экземпляров в корпусе) — сверять не с чем.
          continue;
        }
        const unknown = keys.filter((key) => !row.includes(key));
        if (unknown.length > 0) {
          violations.push(`${def.kind}: теги вне канона — ${unknown.join(', ')}`);
        }
        const known = keys.filter((key) => row.includes(key));
        if (!isSubsequence(known, row)) {
          const inversion = known.find((key, index) => index > 0 && row.indexOf(key) < row.indexOf(known[index - 1]));
          violations.push(`${def.kind}: нарушен порядок — «${inversion ?? '?'}» стоит позже, чем в эталоне (вывод: ${known.join(', ')})`);
        }
      }

      assert.ok(generated >= 30, `генератор создал подозрительно мало видов: ${String(generated)}`);
      assert.deepStrictEqual(violations, [], `расхождения порядка свойств генератора (формат ${version}) с каноном:\n${violations.join('\n')}`);
    });
  }
});
