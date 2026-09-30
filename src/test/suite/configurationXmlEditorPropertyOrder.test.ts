import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigurationXmlEditor, type EditResult } from '../../infra/xml/ConfigurationXmlEditor';
import { extractTopLevelPropertiesChildren } from '../../infra/xml/MetadataPropertiesXml';
import { collectPropertyBlocks, findPropertiesRange, removeBlocks } from '../../infra/xml/typedField/PropertyBlockEditor';
import { EXAMPLE_GENERATIONS, skipWithoutCorpus } from './support/corpus';
import {
  asRestorableBlock,
  assertSameModuloMixedEol,
  expectedXmlAfterInsert,
  relativeToCorpus,
  sameModuloMixedEol,
  stripWhitespaceBetweenTags,
} from './support/propertyOrderCorpus';
import { assertWellFormedXml } from './support/typedFieldCorpus';

/**
 * Писатель корня конфигурации (`ConfigurationXmlEditor.modifyConfigurationProperty`):
 * ветка «тег не найден» вместо отказа вставляет свойство на каноническое место.
 *
 * Дефект здесь СИЛЬНЕЕ, чем «не туда»: это ОТКАЗ. На выгрузке 2.20 выбор любой из
 * восьми `Auxiliary*`-форм уровня приложения не работает вовсе (тега в файле нет,
 * а писатель отвечал `fail('Свойство … не найдено.')`).
 *
 * Асимметрия фолбэков с писателем объектов НАМЕРЕННАЯ: у объекта неизвестный ключ
 * дописывается в конец, а у корня конфигурации по-прежнему отказ — расширять до
 * «создать любой тег» нельзя, опечатка в имени породила бы мусорный тег, который
 * платформа не примет.
 *
 * Корень РАСШИРЕНИЯ пишет тот же тег `Configuration` и обслуживается той же
 * строкой канона. Эталонный порядок в оракуле (`expectedXmlAfterInsert`) снят с
 * ФАЙЛА 2.21, а не с production-таблицы. Все мутации — над копиями во временном
 * каталоге.
 */

const CONFIG_2_20 = path.join(EXAMPLE_GENERATIONS.cf20, 'Configuration.xml');
const CONFIG_2_21 = path.join(EXAMPLE_GENERATIONS.cf21, 'Configuration.xml');
const CONFIG_EXTENSION = path.join(EXAMPLE_GENERATIONS.cfe21, 'Configuration.xml');

/** Восемь вспомогательных форм приложения: в 2.21 платформа их пишет, в 2.20 — нет. */
const AUXILIARY_FORMS_ABSENT_IN_2_20 = [
  'AuxiliaryReportForm',
  'AuxiliaryReportVariantForm',
  'AuxiliaryReportSettingsForm',
  'AuxiliaryDynamicListSettingsForm',
  'AuxiliaryDataHistoryChangeHistoryForm',
  'AuxiliaryDataHistoryVersionDataForm',
  'AuxiliaryDataHistoryVersionDifferencesForm',
  'AuxiliaryCollaborationSystemUsersChoiceForm',
] as const;

type RootPropertyKind = 'scalar' | 'localized' | 'reference' | 'boolean' | 'multiEnum';
const ROOT_PROPERTY_KINDS: readonly RootPropertyKind[] = ['scalar', 'localized', 'reference', 'boolean', 'multiEnum'];

const tempDirs: string[] = [];

function writeTemp(content: string, name = 'Configuration.xml'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-config-order-'));
  tempDirs.push(dir);
  const target = path.join(dir, name);
  fs.writeFileSync(target, content, 'utf-8');
  return target;
}

function copyToTemp(source: string): string {
  return writeTemp(fs.readFileSync(source, 'utf-8'));
}

function modify(
  file: string,
  key: string,
  value: string | boolean | string[],
  kind: RootPropertyKind
): EditResult {
  return new ConfigurationXmlEditor().modifyConfigurationProperty(file, key, value, kind);
}

function keysOf(xml: string): string[] {
  return extractTopLevelPropertiesChildren(xml).map((child) => child.tag);
}

/** Вырезает свойство `key` из корневого <Properties> — вход теста «записать обратно». */
function withoutProperty(xml: string, key: string): string {
  const range = findPropertiesRange(xml);
  assert.ok(range);
  const block = collectPropertyBlocks(range.inner).find((item) => item.key === key);
  assert.ok(block, `в файле нет свойства ${key}`);
  return xml.slice(0, range.start) + removeBlocks(range.inner, [block]) + xml.slice(range.end);
}

function blockText(xml: string, key: string): string {
  const range = findPropertiesRange(xml);
  const block = range ? collectPropertyBlocks(range.inner).find((item) => item.key === key) : undefined;
  assert.ok(block, `в файле нет свойства ${key}`);
  return block.xml;
}

suite('ConfigurationXmlEditor.modifyConfigurationProperty — канон порядка свойств корня (эталон example/)', () => {
  suiteSetup(function () {
    skipWithoutCorpus(this, CONFIG_2_20, CONFIG_2_21, CONFIG_EXTENSION);
  });
  suiteTeardown(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  /** Эталонный порядок ключей корня — с файла 2.21 (надпоследовательность порядка 2.20). */
  function canonical(): string[] {
    return keysOf(fs.readFileSync(CONFIG_2_21, 'utf-8'));
  }

  test('AuxiliaryReportForm на выгрузке 2.20: success вместо прежнего отказа, тег на эталонном месте', () => {
    const original = fs.readFileSync(CONFIG_2_20, 'utf-8');
    assert.ok(!keysOf(original).includes('AuxiliaryReportForm'), 'в 2.20 тега нет — отсюда и отказ');
    const copy = copyToTemp(CONFIG_2_20);

    const result = modify(copy, 'AuxiliaryReportForm', 'CommonForm.ФормаОтчета', 'scalar');

    assert.deepStrictEqual(result.errors, [], 'вставка не должна давать отказ «Свойство … не найдено»');
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.changed, true);
    assert.deepStrictEqual(result.changedFiles, [copy]);
    const after = fs.readFileSync(copy, 'utf-8');
    const keys = keysOf(after);
    assert.strictEqual(
      keys[keys.indexOf('AuxiliaryReportForm') - 1],
      'DefaultCollaborationSystemUsersChoiceForm',
      'первая из вспомогательных форм идёт сразу за последней основной'
    );
    assert.strictEqual(
      after,
      expectedXmlAfterInsert(original, canonical(), 'AuxiliaryReportForm', '<AuxiliaryReportForm>CommonForm.ФормаОтчета</AuxiliaryReportForm>'),
      'файл изменился не только вставкой одной строки на месте, снятом с эталона 2.21'
    );
    assertWellFormedXml(after, 'Configuration.xml после вставки');
  });

  test('все 8 Auxiliary*-ключей, которых нет в 2.20, — по отдельности: success и каждый на своём месте', () => {
    const keys20 = keysOf(fs.readFileSync(CONFIG_2_20, 'utf-8'));
    const canonicalKeys = canonical();
    // Пин набора: в 2.21 столько вспомогательных форм, которых нет в 2.20; порядок 2.20 — подпоследовательность 2.21.
    const absent = canonicalKeys.filter((key) => key.startsWith('Auxiliary') && !keys20.includes(key));
    assert.deepStrictEqual(absent, [...AUXILIARY_FORMS_ABSENT_IN_2_20]);
    assert.deepStrictEqual(
      keys20.filter((key) => canonicalKeys.includes(key)).sort((a, b) => canonicalKeys.indexOf(a) - canonicalKeys.indexOf(b)),
      keys20.filter((key) => canonicalKeys.includes(key)),
      'порядок 2.20 обязан быть подпоследовательностью порядка 2.21'
    );

    const original = fs.readFileSync(CONFIG_2_20, 'utf-8');
    for (const key of AUXILIARY_FORMS_ABSENT_IN_2_20) {
      const copy = copyToTemp(CONFIG_2_20);
      const result = modify(copy, key, `CommonForm.Форма_${key}`, 'scalar');
      assert.strictEqual(result.success, true, `${key}: ${result.errors.join('; ')}`);
      assert.strictEqual(
        fs.readFileSync(copy, 'utf-8'),
        expectedXmlAfterInsert(original, canonicalKeys, key, `<${key}>CommonForm.Форма_${key}</${key}>`),
        `${key}: не на своём месте`
      );
    }
  });

  test('все 8 ключей подряд в один файл: итоговый порядок = порядок 2.21 для объединения ключей', () => {
    const canonicalKeys = canonical();
    const copy = copyToTemp(CONFIG_2_20);
    for (const key of AUXILIARY_FORMS_ABSENT_IN_2_20) {
      assert.strictEqual(modify(copy, key, `CommonForm.Форма_${key}`, 'scalar').success, true, key);
    }
    const after = keysOf(fs.readFileSync(copy, 'utf-8'));
    const expectedSet = new Set([...keysOf(fs.readFileSync(CONFIG_2_20, 'utf-8')), ...AUXILIARY_FORMS_ABSENT_IN_2_20]);
    assert.deepStrictEqual(
      after,
      canonicalKeys.filter((key) => expectedSet.has(key)),
      'после восьми вставок порядок ключей 2.20 должен совпасть с эталонным порядком 2.21'
    );
  });

  test('неизвестный ключ — по-прежнему отказ fail("Свойство … не найдено."), файл не тронут (все 5 RootPropertyKind)', () => {
    const originalBytes = fs.readFileSync(CONFIG_2_20);
    for (const kind of ROOT_PROPERTY_KINDS) {
      const copy = copyToTemp(CONFIG_2_20);
      const result = modify(copy, 'ОпечаткаВИмениСвойства', kind === 'boolean' ? true : kind === 'multiEnum' ? ['x'] : 'x', kind);
      assert.strictEqual(result.success, false, kind);
      assert.strictEqual(result.changed, false, kind);
      assert.deepStrictEqual(result.errors, ['Свойство "ОпечаткаВИмениСвойства" не найдено.'], kind);
      assert.deepStrictEqual(result.changedFiles, [], kind);
      assert.deepStrictEqual(fs.readFileSync(copy), originalBytes, `${kind}: файл не должен меняться`);
    }
  });

  test('существующее свойство: прежнее поведение (замена), повтор — «не изменилось» и файл байт-в-байт', () => {
    const copy = copyToTemp(CONFIG_2_20);
    const first = modify(copy, 'Vendor', 'Новый вендор', 'scalar');
    assert.strictEqual(first.success, true);
    assert.strictEqual(first.changed, true);
    const afterFirst = fs.readFileSync(copy);

    const second = modify(copy, 'Vendor', 'Новый вендор', 'scalar');
    assert.strictEqual(second.success, true);
    assert.strictEqual(second.changed, false);
    assert.deepStrictEqual(second.warnings, ['Значение свойства не изменилось.']);
    assert.deepStrictEqual(fs.readFileSync(copy), afterFirst, 'идемпотентность сохранена');

    const original = fs.readFileSync(CONFIG_2_20, 'utf-8');
    assert.deepStrictEqual(keysOf(afterFirst.toString('utf-8')), keysOf(original), 'замена не двигает ключи');
  });

  test('граница: правка существующего свойства в файле с неканоническим порядком не переставляет ни одного тега', () => {
    const original = fs.readFileSync(CONFIG_2_21, 'utf-8');
    // Vendor и Version меняются местами: существующий порядок не «чинится».
    const vendor = blockText(original, 'Vendor');
    const version = blockText(original, 'Version');
    const swapped = original.replace(vendor, '@@V@@').replace(version, vendor).replace('@@V@@', version);
    const copy = writeTemp(swapped);
    const shuffledKeys = keysOf(swapped);
    assert.ok(shuffledKeys.indexOf('Version') < shuffledKeys.indexOf('Vendor'), 'фикстура: порядок нарушен');

    assert.strictEqual(modify(copy, 'Vendor', 'Другой', 'scalar').success, true);
    assert.deepStrictEqual(keysOf(fs.readFileSync(copy, 'utf-8')), shuffledKeys);
  });

  test('обе подветки multiEnum: UsePurposes вставляется по канону; DefaultRoles заменяется по-прежнему', () => {
    const original = fs.readFileSync(CONFIG_2_21, 'utf-8');
    // UsePurposes: вырезаем и записываем обратно с 1, 2 и 0 значениями.
    const stripped = withoutProperty(original, 'UsePurposes');
    for (const values of [['PlatformApplication'], ['PlatformApplication', 'MobileClient'], []]) {
      const copy = writeTemp(stripped);
      const result = modify(copy, 'UsePurposes', values, 'multiEnum');
      assert.strictEqual(result.success, true, `UsePurposes ${JSON.stringify(values)}: ${result.errors.join('; ')}`);
      const after = fs.readFileSync(copy, 'utf-8');
      assert.deepStrictEqual(keysOf(after), keysOf(original), `UsePurposes ${JSON.stringify(values)}: порядок ключей`);
      assertWellFormedXml(after, 'UsePurposes');
      const items = [...blockText(after, 'UsePurposes').matchAll(/<v8:Value [^>]*>([^<]+)<\/v8:Value>/g)].map((m) => m[1]);
      assert.deepStrictEqual(items, values);
      if (values.length === 0) {
        assert.strictEqual(blockText(after, 'UsePurposes'), '<UsePurposes/>', 'пустой список — самозакрытый тег');
      }
    }
    // Одно значение — байт-в-байт эталон (формат блока совпадает с платформенным).
    const single = writeTemp(stripped);
    modify(single, 'UsePurposes', ['PlatformApplication'], 'multiEnum');
    assert.strictEqual(stripWhitespaceBetweenTags(fs.readFileSync(single, 'utf-8')), stripWhitespaceBetweenTags(original));

    // DefaultRoles — существующий тег: путь через setDefaultRoles, заменяется, порядок не трогается.
    const rolesCopy = copyToTemp(CONFIG_2_20);
    const replaced = modify(rolesCopy, 'DefaultRoles', ['Role.Администратор'], 'multiEnum');
    assert.strictEqual(replaced.success, true, replaced.errors.join('; '));
    const rolesAfter = fs.readFileSync(rolesCopy, 'utf-8');
    assert.deepStrictEqual(keysOf(rolesAfter), keysOf(fs.readFileSync(CONFIG_2_20, 'utf-8')));
    assert.ok(rolesAfter.includes('>Role.Администратор</xr:Item>'));
  });

  test('DefaultRoles отсутствует в файле: не разрушительный исход — отказ без правки либо вставка ровно один раз по канону', () => {
    // Спецификация задачи про ветку «тег не найден» общего пути; DefaultRoles идёт через
    // отдельный путь setDefaultRoles. В корпусе тег есть у всех трёх корней, так что
    // сценарий рукописный — допустимы оба исхода, недопустима порча файла.
    const original = fs.readFileSync(CONFIG_2_21, 'utf-8');
    const stripped = withoutProperty(original, 'DefaultRoles');
    const copy = writeTemp(stripped);
    const result = modify(copy, 'DefaultRoles', ['Role.Администратор'], 'multiEnum');
    const after = fs.readFileSync(copy, 'utf-8');
    assertWellFormedXml(after, 'DefaultRoles отсутствует');
    if (result.success) {
      assert.deepStrictEqual(keysOf(after), keysOf(original), 'вставка обязана лечь на своё место');
    } else {
      assert.strictEqual(after, stripped, 'при отказе файл не должен меняться');
    }
  });

  test('boolean: UseManagedFormInOrdinaryApplication вставляется на своё место — true (2.21) и false (2.20), байт-в-байт', () => {
    for (const [source, value] of [[CONFIG_2_21, true], [CONFIG_2_20, false]] as const) {
      const original = fs.readFileSync(source, 'utf-8');
      const copy = writeTemp(withoutProperty(original, 'UseManagedFormInOrdinaryApplication'));
      const result = modify(copy, 'UseManagedFormInOrdinaryApplication', value, 'boolean');
      assert.strictEqual(result.success, true, result.errors.join('; '));
      assert.strictEqual(fs.readFileSync(copy, 'utf-8'), original, `значение ${String(value)}`);
    }
  });

  test('reference: DefaultLanguage без точки получает префикс Language. и встаёт на своё место, байт-в-байт', () => {
    const original = fs.readFileSync(CONFIG_2_21, 'utf-8');
    for (const input of ['Русский', 'Language.Русский']) {
      const copy = writeTemp(withoutProperty(original, 'DefaultLanguage'));
      const result = modify(copy, 'DefaultLanguage', input, 'reference');
      assert.strictEqual(result.success, true, `${input}: ${result.errors.join('; ')}`);
      assert.strictEqual(fs.readFileSync(copy, 'utf-8'), original, input);
    }
  });

  test('localized: Synonym и Copyright вставляются на своё место; блок с тем же содержимым (отступы закрывающего тега не сравниваются)', () => {
    const original = fs.readFileSync(CONFIG_2_21, 'utf-8');
    for (const key of ['Synonym', 'Copyright']) {
      const rawText = /<v8:content>([^<]*)<\/v8:content>/.exec(blockText(original, key))?.[1] ?? '';
      const copy = writeTemp(withoutProperty(original, key));
      const result = modify(copy, key, rawText.replace(/&quot;/g, '"'), 'localized');
      assert.strictEqual(result.success, true, `${key}: ${result.errors.join('; ')}`);
      const after = fs.readFileSync(copy, 'utf-8');
      assert.deepStrictEqual(keysOf(after), keysOf(original), `${key}: порядок ключей`);
      assertWellFormedXml(after, key);
      assert.strictEqual(
        stripWhitespaceBetweenTags(blockText(after, key)).replace(/&quot;/g, '"'),
        stripWhitespaceBetweenTags(blockText(original, key)).replace(/&quot;/g, '"'),
        `${key}: содержимое блока`
      );
    }
    // Пустая локализованная строка — самозакрытый тег на своём месте.
    const copy = writeTemp(withoutProperty(original, 'Copyright'));
    assert.strictEqual(modify(copy, 'Copyright', '', 'localized').success, true);
    const after = fs.readFileSync(copy, 'utf-8');
    assert.strictEqual(blockText(after, 'Copyright'), '<Copyright/>');
    assert.deepStrictEqual(keysOf(after), keysOf(original));
  });

  test('scalar: каждое однострочное свойство корня каждого из трёх корней (2.20, 2.21, расширение) возвращается на место', function () {
    this.timeout(120_000);
    // Единый цикл по конечному множеству: все однострочные ключи Configuration.xml трёх корней.
    // Вырезаем свойство и пишем его обратно — файл должен вернуться БАЙТ-В-БАЙТ (включая BOM/EOL).
    let restored = 0;
    const failures: string[] = [];
    for (const source of [CONFIG_2_20, CONFIG_2_21, CONFIG_EXTENSION]) {
      const original = fs.readFileSync(source, 'utf-8');
      const range = findPropertiesRange(original);
      assert.ok(range);
      const eol = original.includes('\r\n') ? '\r\n' : '\n';
      for (const block of collectPropertyBlocks(range.inner)) {
        // DefaultRoles/UsePurposes — multiEnum со своим путём и форматом, проверены отдельно.
        if (block.key === 'DefaultRoles' || block.key === 'UsePurposes') {
          continue;
        }
        const restorable = asRestorableBlock(block.xml, block.key, block.indent, eol);
        if (!restorable) {
          continue;
        }
        const copy = writeTemp(withoutProperty(original, block.key));
        const kind: RootPropertyKind = restorable.kind === 'localizedString' ? 'localized' : 'scalar';
        const result = modify(copy, block.key, restorable.value, kind);
        const after = fs.readFileSync(copy, 'utf-8');
        restored++;
        // Локализованный блок писатель корня оформляет по-своему (закрывающий тег без отступа) —
        // это существующее поведение замены; здесь важно МЕСТО и содержимое, а не отступ.
        const same =
          restorable.kind === 'localizedString'
            ? stripWhitespaceBetweenTags(after) === stripWhitespaceBetweenTags(original)
            : sameModuloMixedEol(after, original);
        if (!result.success || !same) {
          failures.push(`${relativeToCorpus(source)}: ${block.key}${result.success ? '' : ` — ${result.errors.join('; ')}`}`);
        }
      }
    }
    assert.deepStrictEqual(failures, [], `не вернулись на место ${String(failures.length)} из ${String(restored)}`);
    assert.ok(restored > 100, `проверено подозрительно мало восстановлений: ${String(restored)}`);
  });

  test('корень РАСШИРЕНИЯ обслуживается той же строкой канона: вставка в Configuration.xml расширения на эталонное место', () => {
    const original = fs.readFileSync(CONFIG_EXTENSION, 'utf-8');
    assert.strictEqual(keysOf(original)[0], 'ObjectBelonging', 'корень расширения: ObjectBelonging первым');
    // Порядок расширения (с ObjectBelonging/ConfigurationExtensionPurpose) — надпоследовательность
    // порядка 2.21 cf; эталон для оракула: ключи cf 2.21, а неизвестные ему теги якорями не считаются.
    const canonicalKeys = canonical();

    for (const key of ['DefaultReportForm', 'AuxiliaryReportForm', 'DefaultConstantsForm', 'UpdateCatalogAddress']) {
      assert.ok(!keysOf(original).includes(key), `фикстура: в расширении нет ${key}`);
      const copy = copyToTemp(CONFIG_EXTENSION);
      const result = modify(copy, key, `CommonForm.Ф_${key}`, 'scalar');
      assert.strictEqual(result.success, true, `${key}: ${result.errors.join('; ')}`);
      assertSameModuloMixedEol(
        fs.readFileSync(copy, 'utf-8'),
        expectedXmlAfterInsert(original, canonicalKeys, key, `<${key}>CommonForm.Ф_${key}</${key}>`),
        `${key}: не на своём месте в корне расширения`
      );
    }
    // ObjectBelonging — ранг 0: вставка ДО Name, а не в конец блока.
    const stripped = withoutProperty(original, 'ObjectBelonging');
    const copy = writeTemp(stripped);
    assert.strictEqual(modify(copy, 'ObjectBelonging', 'Adopted', 'scalar').success, true);
    assertSameModuloMixedEol(fs.readFileSync(copy, 'utf-8'), original, 'ObjectBelonging возвращён первым');
  });

  test('реальный файл: BOM и перевод строки исходника сохраняются на вставке', () => {
    for (const source of [CONFIG_2_20, CONFIG_2_21, CONFIG_EXTENSION]) {
      const original = fs.readFileSync(source, 'utf-8');
      const copy = writeTemp(withoutProperty(original, 'Version'));
      const result = modify(copy, 'Version', /<Version>([^<]*)<\/Version>/.exec(blockText(original, 'Version'))?.[1] ?? '', 'scalar');
      assert.strictEqual(result.success, true, `${relativeToCorpus(source)}: ${result.errors.join('; ')}`);
      const after = fs.readFileSync(copy, 'utf-8');
      assert.strictEqual(after.startsWith('﻿'), original.startsWith('﻿'), `${relativeToCorpus(source)}: BOM`);
      assert.strictEqual(after.includes('\r\n'), original.includes('\r\n'), `${relativeToCorpus(source)}: EOL`);
      assert.ok(original.includes('\r\n') ? !/(?<!\r)\n/.test(after) : !after.includes('\r'), `${relativeToCorpus(source)}: смешанный EOL`);
    }
  });
});

// --- Синтетические файлы: без корпуса ----------------------------------------------------------

function configDoc(propertyLines: readonly string[], options: { eol?: string; bom?: boolean } = {}): string {
  const eol = options.eol ?? '\n';
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" xmlns:v8="http://v8.1c.ru/8.1/data/core" ' +
      'xmlns:xr="http://v8.1c.ru/8.3/xcf/readable" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" version="2.21">',
    '\t<Configuration uuid="0b4a2a1e-0000-0000-0000-000000000001">',
    '\t\t<Properties>',
    ...propertyLines.map((line) => `\t\t\t${line}`),
    '\t\t</Properties>',
    '\t\t<ChildObjects/>',
    '\t</Configuration>',
    '</MetaDataObject>',
    '',
  ];
  return `${options.bom ? '﻿' : ''}${lines.join(eol)}`;
}

suite('ConfigurationXmlEditor.modifyConfigurationProperty — канон порядка (синтетические файлы)', () => {
  suiteTeardown(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  const BASE = ['<Name>Тест</Name>', '<Synonym/>', '<Comment/>', '<ScriptVariant>Russian</ScriptVariant>', '<Vendor>В</Vendor>', '<DefaultLanguage>Language.Русский</DefaultLanguage>'];

  // 4 комбинации BOM × EOL на ВСТАВКЕ.
  for (const bom of [false, true]) {
    for (const eol of ['\n', '\r\n']) {
      test(`вставка сохраняет BOM и EOL: BOM=${String(bom)}, EOL=${JSON.stringify(eol)}`, () => {
        const copy = writeTemp(configDoc(BASE, { eol, bom }));
        const result = modify(copy, 'Version', '1.0', 'scalar');
        assert.strictEqual(result.success, true, result.errors.join('; '));
        const expected = configDoc([...BASE.slice(0, 5), '<Version>1.0</Version>', ...BASE.slice(5)], { eol, bom });
        const actual = fs.readFileSync(copy, 'utf-8');
        assert.strictEqual(actual, expected);
        assert.strictEqual(actual.startsWith('﻿'), bom);
      });
    }
  }

  test('ранг 0: ObjectBelonging вставляется до Name (в начало блока)', () => {
    const copy = writeTemp(configDoc(BASE));
    assert.strictEqual(modify(copy, 'ObjectBelonging', 'Adopted', 'scalar').success, true);
    assert.strictEqual(fs.readFileSync(copy, 'utf-8'), configDoc(['<ObjectBelonging>Adopted</ObjectBelonging>', ...BASE]));
  });

  test('после последнего младшего: ключ, старшие которого в файле отсутствуют, встаёт после последнего известного', () => {
    const copy = writeTemp(configDoc(['<Name>Тест</Name>', '<Synonym/>']));
    assert.strictEqual(modify(copy, 'Comment', 'заметка', 'scalar').success, true);
    assert.strictEqual(fs.readFileSync(copy, 'utf-8'), configDoc(['<Name>Тест</Name>', '<Synonym/>', '<Comment>заметка</Comment>']));
  });

  test('пустое значение вставляется самозакрытым тегом на своё место', () => {
    const copy = writeTemp(configDoc(BASE));
    assert.strictEqual(modify(copy, 'Version', '', 'scalar').success, true);
    assert.strictEqual(
      fs.readFileSync(copy, 'utf-8'),
      configDoc([...BASE.slice(0, 5), '<Version/>', ...BASE.slice(5)])
    );
  });

  test('Properties без блока: отказ «отсутствует блок <Properties>», файл не тронут (прежнее поведение)', () => {
    const original = configDoc([]).replace('\t\t<Properties>\n\t\t</Properties>\n', '');
    const copy = writeTemp(original);
    const result = modify(copy, 'Version', '1', 'scalar');
    assert.strictEqual(result.success, false);
    assert.deepStrictEqual(result.errors, ['В Configuration.xml отсутствует блок <Properties>.']);
    assert.strictEqual(fs.readFileSync(copy, 'utf-8'), original);
  });

  test('файла нет: отказ «Не найден файл», ничего не создаётся (прежнее поведение)', () => {
    const missing = path.join(os.tmpdir(), 'v8vscedit-config-order-нет-такого', 'Configuration.xml');
    const result = modify(missing, 'Version', '1', 'scalar');
    assert.strictEqual(result.success, false);
    assert.deepStrictEqual(result.errors, [`Не найден файл: ${missing}`]);
    assert.strictEqual(fs.existsSync(missing), false);
  });
});
