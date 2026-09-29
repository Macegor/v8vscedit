import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import {
  buildBusinessProcessFlowchartXml,
  ensureTemplateContentFiles,
} from '../../infra/xml/creator/auxiliaryFileBuilders';
import type { TemplateType } from '../../infra/xml/creator/creatorShared';
import type { FormatRuleset } from '../../infra/xml/format/FormatRuleset';
import { resolveFormatRuleset } from '../../infra/xml/format/formatRegistry';
import { MetadataXmlCreator } from '../../infra/xml/MetadataXmlCreator';
import { GOLDEN_BusinessProcess21 } from './support/metadataXmlCreatorGoldenFixtures';
import { EXAMPLE_GENERATIONS, hasExampleCorpus } from './support/typedFieldCorpus';

/**
 * Схема бизнес-процесса (`BusinessProcesses/<Имя>/Ext/Flowchart.xml`).
 *
 * Дефект: генератор писал самозакрытый `<Flowchart xmlns="…/MDClasses" version=…/>`,
 * а платформа выгружает `<GraphicalSchema xmlns="http://v8.1c.ru/8.3/xcf/scheme" …>`
 * с содержимым (см. `example/2.21/src/cf/BusinessProcesses/Задание/Ext/Flowchart.xml`).
 *
 * Две находки, ради которых тесты строго привязаны к эталону:
 *  1. Макет «Графическая схема» (`buildGraphicalSchemaTemplateXml`) слепо
 *     переиспользовать НЕЛЬЗЯ — у макета `GridEnabled=false`/`DrawGridMode=None`,
 *     у схемы бизнес-процесса `true`/`Lines` (все файлы корпуса). Значит, нужен
 *     общий скелет, а профиль задаёт ТОЛЬКО эту пару настроек сетки.
 *  2. Макет безусловно писал `xmlns:pal`, а для формата 2.20 префикса `pal` в
 *     эталоне нет — та же ошибка «ось версии не учтена». Ось версии живёт в
 *     ruleset (`graphicalSchemaXmlns`, по образцу `metaDataObjectXmlns`).
 */

/** Множество версий формата: baseline-поколения, отдельный ruleset 2.20 и неизвестная версия (fallback на самый свежий). */
const FORMAT_VERSIONS = ['2.17', '2.18', '2.19', '2.20', '2.21', '9.99'] as const;

/** Префикс `pal` есть только у baseline-поколения (2.21); в эталоне 2.20 его нет. Остальные версии идут по реестру ruleset. */
function expectsPalPrefix(version: string): boolean {
  return version !== '2.20';
}

const SCHEME_NS = 'http://v8.1c.ru/8.3/xcf/scheme';
const PAL_NS = 'http://v8.1c.ru/8.1/data/ui/colors/palette';
const COMMON_PREFIXES = ['sch', 'style', 'v8', 'v8ui', 'web', 'win', 'xs', 'xsi'] as const;

/** Порядок верхних свойств схемы, общий для всех эталонных файлов. */
const TOP_KEYS = ['BackColor', 'GridEnabled', 'DrawGridMode', 'GridHorizontalStep', 'GridVerticalStep', 'PrintParameters', 'Items'];

const schemaParser = new XMLParser({
  ignoreAttributes: false,
  ignoreDeclaration: true,
  parseTagValue: false,
  trimValues: true,
});

interface ParsedSchema {
  readonly rootTag: string | undefined;
  readonly attrs: Readonly<Record<string, string>>;
  readonly keys: readonly string[];
  readonly values: Readonly<Record<string, unknown>>;
}

function parseSchema(xml: string): ParsedSchema {
  const parsed = schemaParser.parse(xml.replace(/^\ufeff/, '')) as Record<string, Record<string, unknown> | string>;
  const rootTag: string | undefined = Object.keys(parsed)[0];
  const root = rootTag ? parsed[rootTag] : undefined;
  if (!rootTag || typeof root !== 'object') {
    return { rootTag, attrs: {}, keys: [], values: {} };
  }
  const attrs: Record<string, string> = {};
  const keys: string[] = [];
  for (const [key, value] of Object.entries(root)) {
    if (key.startsWith('@_')) {
      attrs[key.slice(2)] = String(value);
    } else {
      keys.push(key);
    }
  }
  return { rootTag, attrs, keys, values: root };
}

interface CorpusFlowchart {
  readonly file: string;
  readonly generation: keyof typeof EXAMPLE_GENERATIONS;
  readonly buffer: Buffer;
  readonly text: string;
}

function flowchartCorpus(): CorpusFlowchart[] {
  const result: CorpusFlowchart[] = [];
  for (const generation of Object.keys(EXAMPLE_GENERATIONS) as (keyof typeof EXAMPLE_GENERATIONS)[]) {
    const dir = path.join(EXAMPLE_GENERATIONS[generation], 'BusinessProcesses');
    if (!fs.existsSync(dir)) {
      continue;
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name, 'Ext', 'Flowchart.xml');
      if (entry.isDirectory() && fs.existsSync(file)) {
        const buffer = fs.readFileSync(file);
        result.push({ file, generation, buffer, text: buffer.toString('utf-8').replace(/^\ufeff/, '') });
      }
    }
  }
  return result;
}

/** Файлы макетов «Графическая схема» из корпуса — для фиксации различия профилей сетки. */
function graphicalSchemaTemplateCorpus(): string[] {
  const result: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > 4 || !fs.existsSync(dir)) {
      return;
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else if (entry.name === 'Template.xml') {
        const head = fs.readFileSync(full, 'utf-8').slice(0, 400);
        if (head.includes('<GraphicalSchema ')) {
          result.push(full);
        }
      }
    }
  };
  for (const gen of Object.values(EXAMPLE_GENERATIONS)) {
    for (const holder of ['DataProcessors', 'Reports', 'CommonTemplates', 'Catalogs', 'Documents']) {
      walk(path.join(gen, holder), 0);
    }
  }
  return result;
}

/**
 * Обёртка над сигнатурами builder'ов: ось версии живёт в ruleset, и разработчик
 * вправе передать его отдельным аргументом (как `buildFormDescriptorXml`) либо
 * получать внутри по `formatVersion`. Лишний аргумент безвреден в обоих вариантах.
 */
type BuilderWithOptionalRuleset = (formatVersion: string, ruleset?: FormatRuleset) => string;

function buildFlowchart(version: string): string {
  const build: BuilderWithOptionalRuleset = buildBusinessProcessFlowchartXml;
  return build(version, resolveFormatRuleset(version));
}

function buildGraphicalTemplate(version: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-gs-tpl-'));
  const ensure: (dir: string, type: TemplateType, version: string, ruleset?: FormatRuleset) => string[] = ensureTemplateContentFiles;
  const created = ensure(dir, 'GraphicalSchema', version, resolveFormatRuleset(version));
  assert.strictEqual(created.length, 1, 'GraphicalSchema создаёт ровно один Ext/Template.xml');
  return fs.readFileSync(created[0], 'utf-8');
}

function assertWellFormed(xml: string, label: string): void {
  const result = XMLValidator.validate(xml);
  assert.strictEqual(result, true, `${label}: XML не well-formed: ${JSON.stringify(result)}`);
}

function assertSchemaShape(
  xml: string,
  version: string,
  profile: { readonly grid: string; readonly mode: string },
  label: string
): void {
  assert.strictEqual(xml.split('\n')[0], '<?xml version="1.0" encoding="UTF-8"?>', `${label}: декларация`);
  assertWellFormed(xml, label);
  const schema = parseSchema(xml);
  assert.strictEqual(schema.rootTag, 'GraphicalSchema', `${label}: корень должен быть GraphicalSchema, а не Flowchart`);
  assert.strictEqual(schema.attrs.xmlns, SCHEME_NS, `${label}: пространство имён схемы`);
  assert.strictEqual(schema.attrs.version, version, `${label}: version`);
  for (const prefix of COMMON_PREFIXES) {
    assert.ok(`xmlns:${prefix}` in schema.attrs, `${label}: нет xmlns:${prefix}`);
  }
  assert.strictEqual(
    schema.attrs['xmlns:pal'],
    expectsPalPrefix(version) ? PAL_NS : undefined,
    `${label}: xmlns:pal ${expectsPalPrefix(version) ? 'обязателен' : 'обязан отсутствовать'} для версии ${version}`
  );
  assert.deepStrictEqual(schema.keys, TOP_KEYS, `${label}: порядок верхних свойств`);
  assert.strictEqual(schema.values.BackColor, 'style:FieldBackColor', `${label}: BackColor — первый ребёнок`);
  assert.strictEqual(schema.values.GridEnabled, profile.grid, `${label}: GridEnabled`);
  assert.strictEqual(schema.values.DrawGridMode, profile.mode, `${label}: DrawGridMode`);
  assert.strictEqual(schema.values.GridHorizontalStep, '20');
  assert.strictEqual(schema.values.GridVerticalStep, '20');
  assert.deepStrictEqual(schema.values.PrintParameters, {
    TopMargin: '10', LeftMargin: '10', BottomMargin: '10', RightMargin: '10', BlackAndWhite: 'false', FitPageMode: 'Auto',
  }, `${label}: PrintParameters`);
}

const BP_PROFILE = { grid: 'true', mode: 'Lines' } as const;
const TEMPLATE_PROFILE = { grid: 'false', mode: 'None' } as const;

suite('Схема бизнес-процесса: эталон example/ (T-A1.4/5)', function () {
  this.timeout(60000);
  let corpus: CorpusFlowchart[] = [];

  suiteSetup(function () {
    if (!hasExampleCorpus()) {
      this.skip();
    }
    corpus = flowchartCorpus();
  });

  test('выборка достаточна: есть схемы обеих генераций 2.20 и 2.21 (число считает сам тест)', () => {
    assert.ok(corpus.length > 0, 'в корпусе нет ни одного Flowchart.xml — тесты ниже были бы зелёными на пустом корпусе');
    const versions = new Set(corpus.map((c) => parseSchema(c.text).attrs.version));
    assert.ok(versions.has('2.20') && versions.has('2.21'), `нужны обе генерации, есть: ${[...versions].join(', ')}`);
  });

  test('ноль контрпримеров: корень GraphicalSchema, ns scheme, pal строго при 2.21, верхние свойства и сетка true/Lines', () => {
    const violations: string[] = [];
    for (const { file, text } of corpus) {
      const schema = parseSchema(text);
      const version = schema.attrs.version;
      const problems: string[] = [];
      if (schema.rootTag !== 'GraphicalSchema') { problems.push(`корень ${schema.rootTag ?? '?'}`); }
      if (schema.attrs.xmlns !== SCHEME_NS) { problems.push(`xmlns ${schema.attrs.xmlns}`); }
      if (('xmlns:pal' in schema.attrs) !== (version === '2.21')) { problems.push(`pal при версии ${version}`); }
      if (!COMMON_PREFIXES.every((p) => `xmlns:${p}` in schema.attrs)) { problems.push('не хватает общих префиксов'); }
      if (schema.keys.join(',') !== TOP_KEYS.join(',')) { problems.push(`порядок ключей ${schema.keys.join(',')}`); }
      if (schema.values.BackColor !== 'style:FieldBackColor') { problems.push('BackColor'); }
      if (schema.values.GridEnabled !== 'true') { problems.push('GridEnabled'); }
      if (schema.values.DrawGridMode !== 'Lines') { problems.push('DrawGridMode'); }
      if (schema.values.GridHorizontalStep !== '20' || schema.values.GridVerticalStep !== '20') { problems.push('шаги сетки'); }
      if (JSON.stringify(schema.values.PrintParameters) !== JSON.stringify(
        { TopMargin: '10', LeftMargin: '10', BottomMargin: '10', RightMargin: '10', BlackAndWhite: 'false', FitPageMode: 'Auto' }
      )) { problems.push('PrintParameters'); }
      if (problems.length > 0) {
        violations.push(`${file}: ${problems.join('; ')}`);
      }
    }
    assert.deepStrictEqual(violations, []);
  });

  test('пустая схема в эталоне записана как самозакрытый <Items/> сразу перед закрывающим корнем (есть хотя бы один такой файл)', () => {
    const empty = corpus.filter((c) => c.text.includes('<Items/>'));
    assert.ok(empty.length > 0, 'в корпусе нет пустой схемы — форму пустой схемы не с чем сверить');
    for (const { file, text } of empty) {
      assert.ok(/\r?\n\t<Items\/>\r?\n<\/GraphicalSchema>$/.test(text), `${file}: <Items/> должен идти последним`);
    }
  });

  test('BOM и финальный перевод строки эталонов измеряются по Buffer (readFileSync utf-8 съедает BOM): однородность корпуса', () => {
    // Измерение по байтам: `readFileSync(..., 'utf-8')` молча отбрасывает BOM,
    // поэтому по строке его не увидеть. Числа считает сам тест.
    const withBom = corpus.filter((c) => c.buffer[0] === 0xef && c.buffer[1] === 0xbb && c.buffer[2] === 0xbf);
    const withCrlf = corpus.filter((c) => c.buffer.includes(Buffer.from('\r\n')));
    const withoutTrailingNewline = corpus.filter((c) => c.buffer[c.buffer.length - 1] === 0x3e /* '>' */);
    assert.strictEqual(withBom.length, corpus.length, 'все эталоны выгружены платформой с BOM');
    assert.strictEqual(withCrlf.length, corpus.length, 'все эталоны — с переводами строк CRLF');
    assert.strictEqual(withoutTrailingNewline.length, corpus.length, 'платформа не ставит перевод строки после закрывающего корня');
  });

  test('различие профилей: у БП всегда Lines, у макетов «Графическая схема» в корпусе всегда None (пара настроек сетки принадлежит профилю)', () => {
    const templates = graphicalSchemaTemplateCorpus();
    assert.ok(templates.length > 0, 'в корпусе нет макетов «Графическая схема»');
    for (const file of templates) {
      const schema = parseSchema(fs.readFileSync(file, 'utf-8'));
      assert.strictEqual(schema.values.DrawGridMode, 'None', `${file}: у макета сетка не рисуется`);
    }
    for (const { text } of corpus) {
      assert.strictEqual(parseSchema(text).values.DrawGridMode, 'Lines');
    }
  });
});

suite('Схема бизнес-процесса: ruleset (graphicalSchemaXmlns)', () => {
  for (const version of FORMAT_VERSIONS) {
    test(`версия ${version}: ruleset.graphicalSchemaXmlns — пространство схемы, xmlns:pal строго у baseline, без version`, () => {
      const ruleset = resolveFormatRuleset(version) as FormatRuleset & { graphicalSchemaXmlns?: unknown };
      assert.strictEqual(typeof ruleset.graphicalSchemaXmlns, 'string', 'в FormatRuleset нет поля graphicalSchemaXmlns (по образцу metaDataObjectXmlns)');
      const xmlns = ruleset.graphicalSchemaXmlns;
      assert.ok(xmlns.startsWith(`xmlns="${SCHEME_NS}"`), `строка должна начинаться с пространства схемы: ${xmlns.slice(0, 60)}`);
      assert.strictEqual(xmlns.includes(`xmlns:pal="${PAL_NS}"`), expectsPalPrefix(version));
      assert.ok(!/\bversion=/.test(xmlns), 'version дописывает builder, а не ruleset');
    });
  }
});

suite('Схема бизнес-процесса: buildBusinessProcessFlowchartXml × версии формата (T-A1.6)', () => {
  for (const version of FORMAT_VERSIONS) {
    test(`версия ${version}: корень GraphicalSchema, ns схемы, pal по версии, сетка true/Lines, пустой <Items/>`, () => {
      const xml = buildFlowchart(version);
      assertSchemaShape(xml, version, BP_PROFILE, `Flowchart@${version}`);
      assert.strictEqual(parseSchema(xml).values.Items, '', 'новая схема пуста');
      assert.ok(xml.endsWith('\n\t<Items/>\n</GraphicalSchema>\n'), 'пустая схема — самозакрытый <Items/>');
      assert.ok(!xml.includes('<Flowchart'), 'прежний корень Flowchart недопустим');
      assert.ok(!xml.includes('MDClasses'), 'схема не живёт в пространстве MDClasses');
    });
  }
});

suite('Макет «Графическая схема»: buildGraphicalSchemaTemplateXml × версии (T-A1.7)', () => {
  for (const version of FORMAT_VERSIONS) {
    test(`версия ${version}: xmlns:pal только у baseline, сетка false/None (анти-регресс)`, () => {
      assertSchemaShape(buildGraphicalTemplate(version), version, TEMPLATE_PROFILE, `GraphicalSchema-макет@${version}`);
    });

    test(`версия ${version}: макет и схема БП различаются ТОЛЬКО парой GridEnabled/DrawGridMode (общий скелет с профилем)`, () => {
      const dropProfile = (xml: string): string => xml
        .replace(/\t<GridEnabled>\w+<\/GridEnabled>\n/, '')
        .replace(/\t<DrawGridMode>\w+<\/DrawGridMode>\n/, '');
      const template = buildGraphicalTemplate(version);
      const flowchart = buildFlowchart(version);
      assert.notStrictEqual(template, flowchart, 'профили сетки обязаны различаться');
      assert.strictEqual(dropProfile(template), dropProfile(flowchart));
      assert.ok(template.includes('<GridEnabled>false</GridEnabled>') && template.includes('<DrawGridMode>None</DrawGridMode>'));
      assert.ok(flowchart.includes('<GridEnabled>true</GridEnabled>') && flowchart.includes('<DrawGridMode>Lines</DrawGridMode>'));
    });

    test(`версия ${version}: открывающий тег корня собирается из ruleset.graphicalSchemaXmlns + version`, () => {
      const ruleset = resolveFormatRuleset(version) as FormatRuleset & { graphicalSchemaXmlns?: string };
      const expectedRoot = `<GraphicalSchema ${ruleset.graphicalSchemaXmlns} version="${version}">`;
      assert.ok(buildFlowchart(version).includes(`\n${expectedRoot}\n`), 'схема БП не по ruleset');
      assert.ok(buildGraphicalTemplate(version).includes(`\n${expectedRoot}\n`), 'макет не по ruleset');
    });
  }
});

suite('Схема бизнес-процесса: MetadataXmlCreator.addRootObject(BusinessProcess) против эталона своей генерации (T-A1.8)', function () {
  this.timeout(30000);

  const generations: readonly { version: '2.20' | '2.21'; key: 'cf20' | 'cf21' }[] = [
    { version: '2.20', key: 'cf20' },
    { version: '2.21', key: 'cf21' },
  ];

  for (const { version, key } of generations) {
    test(`формат ${version}: Ext/Flowchart.xml структурно совпадает с эталоном (атрибуты корня, порядок и значения верхних свойств)`, function () {
      if (!hasExampleCorpus()) {
        this.skip();
      }
      const reference = flowchartCorpus().find((c) => c.generation === key && parseSchema(c.text).attrs.version === version);
      assert.ok(reference, `нет эталонной схемы ${version}`);
      const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-bp-flowchart-'));
      fs.writeFileSync(path.join(configRoot, 'Configuration.xml'), [
        '<?xml version="1.0" encoding="utf-8"?>',
        `<MetaDataObject version="${version}">`,
        '\t<Configuration>',
        '\t\t<Properties><Name>Тест</Name><Synonym/></Properties>',
        '\t\t<ChildObjects/>',
        '\t</Configuration>',
        '</MetaDataObject>',
        '',
      ].join('\n'), 'utf-8');

      const result = new MetadataXmlCreator().addRootObject({ configRoot, kind: 'BusinessProcess', name: 'Процесс1' });
      assert.strictEqual(result.success, true, result.errors.join('; '));
      const flowchartPath = path.join(configRoot, 'BusinessProcesses', 'Процесс1', 'Ext', 'Flowchart.xml');
      const generated = parseSchema(fs.readFileSync(flowchartPath, 'utf-8'));
      const expected = parseSchema(reference.text);

      assert.strictEqual(generated.rootTag, expected.rootTag);
      assert.deepStrictEqual(generated.attrs, expected.attrs, 'атрибуты корня (ns, префиксы, version) — как в эталоне');
      assert.deepStrictEqual(generated.keys, expected.keys, 'состав и порядок верхних свойств — как в эталоне');
      for (const key2 of TOP_KEYS.filter((k) => k !== 'Items')) {
        assert.deepStrictEqual(generated.values[key2], expected.values[key2], `значение ${key2}`);
      }
    });
  }

  test('golden-фикстура БП@2.21 совпадает с эталоном example/ (а не снята с вывода генератора)', function () {
    if (!hasExampleCorpus()) {
      this.skip();
    }
    // Golden обязан быть выведен из эталона: берём заголовок реальной схемы
    // 2.21 до <Items> и добавляем пустую схему. Иначе golden закрепил бы ошибку.
    const reference = flowchartCorpus().find((c) => c.generation === 'cf21');
    assert.ok(reference);
    const normalized = reference.text.replace(/\r\n/g, '\n');
    const head = normalized.slice(0, normalized.indexOf('</PrintParameters>') + '</PrintParameters>'.length);
    const golden = GOLDEN_BusinessProcess21.files['BusinessProcesses/Тест/Ext/Flowchart.xml'];
    assert.strictEqual(golden, `${head}\n\t<Items/>\n</GraphicalSchema>\n`);
  });
});

suite('Макеты: ensureTemplateContentFiles × все 8 TemplateType (T-A1.9)', () => {
  const EXPECTED: Readonly<Record<TemplateType, { files: readonly string[]; xml: readonly string[] }>> = {
    SpreadsheetDocument: { files: ['Ext/Template.xml'], xml: ['Ext/Template.xml'] },
    TextDocument: { files: ['Ext/Template.txt'], xml: [] },
    HTMLDocument: { files: ['Ext/Template.xml', 'Ext/Template/ru.html'], xml: ['Ext/Template.xml'] },
    BinaryData: { files: ['Ext/Template.bin'], xml: [] },
    DataCompositionSchema: { files: ['Ext/Template.xml'], xml: ['Ext/Template.xml'] },
    DataCompositionAppearanceTemplate: { files: ['Ext/Template.xml'], xml: ['Ext/Template.xml'] },
    GraphicalSchema: { files: ['Ext/Template.xml'], xml: ['Ext/Template.xml'] },
    AddIn: { files: ['Ext/Template.bin'], xml: [] },
  };

  for (const type of Object.keys(EXPECTED) as TemplateType[]) {
    test(`${type}: файлы созданы, декларация UTF-8, повторный вызов ничего не перезаписывает`, () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-tpl-all-'));
      const created = ensureTemplateContentFiles(dir, type, '2.21');
      assert.deepStrictEqual(
        created.map((f) => path.relative(dir, f).split(path.sep).join('/')).sort(),
        [...EXPECTED[type].files].sort()
      );
      for (const rel of EXPECTED[type].xml) {
        const text = fs.readFileSync(path.join(dir, rel), 'utf-8');
        assert.strictEqual(text.split('\n')[0], '<?xml version="1.0" encoding="UTF-8"?>', `${type}: декларация`);
      }

      // Пользователь уже мог наполнить макет — повторный вызов не вправе его затирать.
      for (const f of created) {
        fs.appendFileSync(f, type === 'BinaryData' || type === 'AddIn' ? Buffer.from([1]) : '\n<!-- правка пользователя -->\n');
      }
      const tainted = new Map(created.map((f) => [f, fs.readFileSync(f)]));
      assert.deepStrictEqual(ensureTemplateContentFiles(dir, type, '2.21'), [], `${type}: повторный вызов вернул созданные файлы`);
      for (const f of created) {
        assert.ok(fs.readFileSync(f).equals(tainted.get(f) as Buffer), `${f}: повторный вызов перезаписал файл`);
      }
    });
  }
});
