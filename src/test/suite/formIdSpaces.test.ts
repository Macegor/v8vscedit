import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
  collectIdSpaces,
  findDuplicateIds,
  maxIdByKind,
  splitBaseForm,
} from '../../infra/xml/form/FormIdSpaces';
import type { FormIdSpace, IdSpaceKind } from '../../infra/xml/form/FormIdSpaces';
import { EXAMPLE_ROOT, findAllFormXmlFiles } from './support/formFixtures';
import { skipWithoutCorpus } from './support/corpus';

/**
 * Юнит-тесты нового чистого модуля `FormIdSpaces` — сердца исправления дефекта
 * «validate_form не видит реальные дубли id» (см. правило пространств нумерации
 * id в брифе задачи). Модуль не существует до реализации — все тесты здесь
 * падают на отсутствующем импорте, это ожидаемый «красный» для TDD.
 *
 * Числа во всех golden-проверках сверены по реальным файлам (grep/python
 * xml.etree над example/), а не угаданы — см. комментарии у каждого блока.
 */

const OSTATKI_FORM = path.join(EXAMPLE_ROOT, '2.20', 'src', 'cf', 'Reports', 'ОстаткиТоваровНаСкладах', 'Forms', 'ФормаОтчета', 'Ext', 'Form.xml');
const RASHODY_FORM = path.join(EXAMPLE_ROOT, '2.21', 'src', 'cf', 'Documents', 'РасходыПриИмпорте', 'Forms', 'ФормаДокумента', 'Ext', 'Form.xml');
const POLZOVATELI_CFE_FORM = path.join(EXAMPLE_ROOT, '2.21', 'src', 'cfe', 'EVOLC', 'Catalogs', 'Пользователи', 'Forms', 'ФормаЭлемента', 'Ext', 'Form.xml');

function readFixture(p: string): string {
  return fs.readFileSync(p, 'utf-8');
}

function findSpace(spaces: readonly FormIdSpace[], kind: IdSpaceKind): FormIdSpace {
  const found = spaces.find((s) => s.kind === kind);
  assert.ok(found, `в результате collectIdSpaces должно быть пространство kind='${kind}'`);
  return found;
}

suite('FormIdSpaces — splitBaseForm', () => {
  // `example/` не отслеживается git — без корпуса сьют пропускается, а не падает
  // (единый гейт: support/corpus.ts).
  suiteSetup(function () {
    skipWithoutCorpus(this);
  });

  test('T-1a: форма без BaseForm — own===xml, baseForm===null', () => {
    const xml = readFixture(OSTATKI_FORM);
    const { own, baseForm } = splitBaseForm(xml);
    assert.strictEqual(baseForm, null);
    assert.strictEqual(own, xml);
  });

  test('T-1b: CFE-форма Пользователи — own не содержит <BaseForm, baseForm содержит ColumnGroup id=180', () => {
    // Реальный эталон: ColumnGroup id="180" встречается ДВАЖДЫ в исходном файле —
    // один раз в own-регионе (строка 1028), один раз внутри BaseForm (строка 2146).
    // Здесь проверяем именно то, что попадает в baseForm-регион.
    const xml = readFixture(POLZOVATELI_CFE_FORM);
    const { own, baseForm } = splitBaseForm(xml);
    assert.ok(!own.includes('<BaseForm'), 'own не должен содержать открывающий тег <BaseForm');
    assert.ok(baseForm !== null, 'у формы-расширения baseForm не может быть null');
    assert.ok(baseForm.includes('ColumnGroup'), 'baseForm должен содержать копию ColumnGroup из базовой формы');
    assert.ok(baseForm.includes('id="180"'), 'baseForm должен содержать id="180" (реальный ColumnGroup "РолиКолонок")');
  });

  test('T-1c: синтетика — самозакрывающийся <BaseForm/> не ломает разбор (own без тега, baseForm не null)', () => {
    // Минимальная мутация реального донора: самозакрывающийся BaseForm в природе
    // не встречается (реальные экспорты 1С всегда пишут блочный BaseForm), но
    // сканер обязан пережить этот защитный случай без исключения.
    const donor = readFixture(OSTATKI_FORM);
    const mutated = donor.replace('</Form>', '\t<BaseForm/>\n</Form>');
    assert.notStrictEqual(mutated, donor);
    const { own, baseForm } = splitBaseForm(mutated);
    assert.ok(!own.includes('<BaseForm'));
    assert.notStrictEqual(baseForm, null);
  });

  test('T-1d: синтетика — незакрытый <BaseForm version="2.21"> уводит весь остаток в base', () => {
    const donor = readFixture(OSTATKI_FORM);
    const cutIdx = donor.indexOf('</Form>');
    assert.ok(cutIdx > 0);
    // Обрезаем документ прямо на открывающем теге BaseForm и добавляем маркер —
    // ни закрывающего </BaseForm>, ни закрывающего </Form> не будет вовсе.
    const truncated = donor.slice(0, cutIdx) + '<BaseForm version="2.21"><Marker id="999"/>';
    const { own, baseForm } = splitBaseForm(truncated);
    assert.strictEqual(own, donor.slice(0, cutIdx), 'own должен быть точным префиксом до <BaseForm');
    assert.ok(baseForm !== null);
    assert.ok(baseForm.includes('Marker') && baseForm.includes('id="999"'));
    assert.ok(!own.includes('Marker'), 'маркер после BaseForm не должен просочиться в own');
  });
});

suite('FormIdSpaces — collectIdSpaces: базовые пространства', () => {
  // `example/` не отслеживается git — без корпуса сьют пропускается, а не падает
  // (единый гейт: support/corpus.ts).
  suiteSetup(function () {
    skipWithoutCorpus(this);
  });

  test('T-2: element vs attribute — пересечение id=3 между разными пространствами не дублируется', () => {
    // Реальный донор (61 строка): элементы UsualGroup=1, ExtendedTooltip=2,
    // SpreadSheetDocumentField=3, ContextMenu=4, ExtendedTooltip=5 (проверено grep).
    // Атрибуты: Отчет=1, Результат=2, ДанныеРасшифровки=3.
    const xml = readFixture(OSTATKI_FORM);
    const spaces = collectIdSpaces(xml);
    assert.strictEqual(spaces.filter((s) => s.kind === 'element').length, 1, 'element-пространство ровно одно');
    assert.strictEqual(spaces.filter((s) => s.kind === 'attribute').length, 1, 'attribute-пространство ровно одно');

    const elementSpace = findSpace(spaces, 'element');
    assert.ok(elementSpace.entries.some((e) => e.tag === 'SpreadSheetDocumentField' && e.id === '3'));
    assert.ok(elementSpace.entries.some((e) => e.tag === 'ContextMenu' && e.id === '4'));
    assert.ok(elementSpace.entries.some((e) => e.tag === 'ExtendedTooltip' && e.id === '5'));

    const attrSpace = findSpace(spaces, 'attribute');
    assert.deepStrictEqual(attrSpace.entries.map((e) => e.id).sort(), ['1', '2', '3']);

    // id=3 встречается и у SpreadSheetDocumentField (element), и у ДанныеРасшифровки
    // (attribute) — это РАЗНЫЕ пространства, дублей быть не должно.
    assert.strictEqual(findDuplicateIds(elementSpace).length, 0);
    assert.strictEqual(findDuplicateIds(attrSpace).length, 0);
  });

  test('T-3: колонки РасходыПриИмпорте — ровно 2 контейнера AdditionalColumns, нумерация с 1 в каждом', () => {
    // Числа сверены по факту файла: table="Объект.Разделы" — 2 колонки (id 1,2),
    // table="Объект.Запасы" — 7 колонок (id 1..7). Итого 9 колонок в 2 контейнерах.
    // Плоский подсчёт (текущий баг) дал бы ложный дубль id=1 и id=2 между контейнерами.
    const xml = readFixture(RASHODY_FORM);
    const spaces = collectIdSpaces(xml);
    const columnSpaces = spaces.filter((s) => s.kind === 'column');
    assert.strictEqual(columnSpaces.length, 2, 'должно быть ровно 2 колоночных пространства (2 AdditionalColumns)');

    const sizes = columnSpaces.map((s) => s.entries.length).sort((a, b) => a - b);
    assert.deepStrictEqual(sizes, [2, 7]);
    const totalColumns = columnSpaces.reduce((sum, s) => sum + s.entries.length, 0);
    assert.strictEqual(totalColumns, 9);

    for (const space of columnSpaces) {
      assert.strictEqual(findDuplicateIds(space).length, 0, `контейнер "${space.label}" не должен содержать дублей`);
      assert.ok(space.entries.some((e) => e.id === '1'), 'нумерация в каждом контейнере начинается с 1');
    }

    assert.ok(columnSpaces.some((s) => s.label.includes('Объект.Разделы')), 'label должен содержать имя table');
    assert.ok(columnSpaces.some((s) => s.label.includes('Объект.Запасы')), 'label должен содержать имя table');
    assert.notStrictEqual(columnSpaces[0].key, columnSpaces[1].key, 'у разных контейнеров разные ключи пространства');
  });

  test('T-4: id="-1" попадает в entries, но исключён из findDuplicateIds и из счётчика (даже при двух id="-1")', () => {
    // Минимальный фрагмент собран вручную: тест проверяет ОДНО точечное правило
    // (исключение id="-1"), полный контроль над числом записей обязателен.
    const region = '<UsualGroup name="Группа1" id="-1"/><UsualGroup name="Группа2" id="-1"/>';
    const spaces = collectIdSpaces(region);
    const elementSpace = findSpace(spaces, 'element');
    assert.strictEqual(elementSpace.entries.length, 2, 'обе записи с id="-1" должны попасть в entries');
    assert.ok(elementSpace.entries.every((e) => e.id === '-1'));
    assert.strictEqual(findDuplicateIds(elementSpace).length, 0, 'id="-1" не считается дублем сам с собой');
  });
});

suite('FormIdSpaces — collectIdSpaces: граничные случаи сканера', () => {
  // `example/` не отслеживается git — без корпуса сьют пропускается, а не падает
  // (единый гейт: support/corpus.ts).
  suiteSetup(function () {
    skipWithoutCorpus(this);
  });

  // BOM и CRLF — реальные свойства донора (ОстаткиТоваровНаСкладах хранится с
  // BOM и CRLF на диске, см. `file` в шелле), поэтому для этих двух случаев
  // достаточно точечной мутации реального файла, а не выдуманного фрагмента.
  test('BOM в начале документа не искажает набор entries', () => {
    const xml = readFixture(OSTATKI_FORM);
    assert.ok(xml.startsWith('\uFEFF'), 'донор должен реально содержать BOM (иначе тест ничего не проверяет)');
    const withoutBom = xml.replace(/^\uFEFF/, '');
    const withBomSpaces = collectIdSpaces(xml);
    const withoutBomSpaces = collectIdSpaces(withoutBom);
    assert.strictEqual(findSpace(withBomSpaces, 'element').entries.length, findSpace(withoutBomSpaces, 'element').entries.length);
    assert.strictEqual(findSpace(withBomSpaces, 'attribute').entries.length, findSpace(withoutBomSpaces, 'attribute').entries.length);
  });

  test('CRLF vs LF не искажает набор entries', () => {
    const xml = readFixture(OSTATKI_FORM);
    assert.ok(xml.includes('\r\n'), 'донор должен реально хранить CRLF (иначе тест ничего не проверяет)');
    const lfOnly = xml.replace(/\r\n/g, '\n');
    const crlfSpaces = collectIdSpaces(xml);
    const lfSpaces = collectIdSpaces(lfOnly);
    assert.strictEqual(findSpace(crlfSpaces, 'element').entries.length, findSpace(lfSpaces, 'element').entries.length);
  });

  // Остальные защитные ветки требуют полного контроля над структурой фрагмента —
  // строятся вручную минимальными фрагментами (аналогично T-12/T-15 в брифе).

  test('XML-комментарий с тегом внутри не даёт записи в entries', () => {
    const region = '<!-- <InputField name="Тень" id="1"/> --><InputField name="Реальное" id="2"/>';
    const spaces = collectIdSpaces(region);
    const elementSpace = findSpace(spaces, 'element');
    assert.strictEqual(elementSpace.entries.length, 1, 'закомментированный тег не должен попасть в entries');
    assert.strictEqual(elementSpace.entries[0].id, '2');
  });

  test('<?xml?>-пролог не принимается за тег с id (даже если внутри есть decoy id=)', () => {
    const region = '<?xml version="1.0" id="1"?><Button name="Б" id="2"/>';
    const spaces = collectIdSpaces(region);
    const elementSpace = findSpace(spaces, 'element');
    assert.strictEqual(elementSpace.entries.length, 1);
    assert.strictEqual(elementSpace.entries[0].id, '2');
  });

  test('атрибут xr:id="7" не считается id (не имеет собственного id)', () => {
    const region = '<InputField name="СРеальнымId" id="7"/><InputField name="ТолькоXrId" xr:id="7"/>';
    const spaces = collectIdSpaces(region);
    const elementSpace = findSpace(spaces, 'element');
    assert.strictEqual(elementSpace.entries.length, 2);
    const withReal = elementSpace.entries.find((e) => e.name === 'СРеальнымId');
    const withXrOnly = elementSpace.entries.find((e) => e.name === 'ТолькоXrId');
    assert.ok(withReal, 'запись СРеальнымId должна быть найдена');
    assert.ok(withXrOnly, 'запись ТолькоXrId должна быть найдена');
    assert.strictEqual(withReal.id, '7');
    assert.notStrictEqual(withXrOnly.id, '7', 'xr:id не должен читаться как id');
    // Раз "настоящего" id нет, дубля с withReal быть не должно.
    assert.strictEqual(findDuplicateIds(elementSpace).length, 0);
  });

  test('<CommandBar id="9"> попадает в element-пространство, а не в command', () => {
    const region = '<CommandBar name="Панель" id="9"/>';
    const spaces = collectIdSpaces(region);
    const elementSpace = findSpace(spaces, 'element');
    assert.ok(elementSpace.entries.some((e) => e.tag === 'CommandBar' && e.id === '9'));
    const commandSpace = spaces.find((s) => s.kind === 'command');
    assert.ok(!commandSpace || commandSpace.entries.every((e) => e.tag !== 'CommandBar'));
  });

  test('<Column> вне любого контейнера (Columns/AdditionalColumns) — защитная ветка не должна кидать исключение', () => {
    const region = '<Column name="Сирота" id="1"/>';
    assert.doesNotThrow(() => collectIdSpaces(region));
    const spaces = collectIdSpaces(region);
    const elementSpace = spaces.find((s) => s.kind === 'element');
    // Column никогда не считается элементом (правило 1: "кроме Attribute/Column/Command").
    assert.ok(!elementSpace || elementSpace.entries.every((e) => e.tag !== 'Column'));
  });

  test('<AdditionalColumns> без table= не ломает подсчёт дублей внутри контейнера', () => {
    const region = '<Columns><AdditionalColumns><Column name="А" id="1"/><Column name="Б" id="1"/></AdditionalColumns></Columns>';
    const spaces = collectIdSpaces(region);
    const columnSpaces = spaces.filter((s) => s.kind === 'column');
    assert.strictEqual(columnSpaces.length, 1);
    assert.strictEqual(columnSpaces[0].entries.length, 2);
    assert.strictEqual(findDuplicateIds(columnSpaces[0]).length, 1);
  });

  test('<Attribute> без name — попадает в entries с пустым name, не роняет сканер', () => {
    const region = '<Attributes><Attribute id="1"><Type><v8:Type>xs:string</v8:Type></Type></Attribute></Attributes>';
    const spaces = collectIdSpaces(region);
    const attrSpace = findSpace(spaces, 'attribute');
    assert.strictEqual(attrSpace.entries.length, 1);
    assert.strictEqual(attrSpace.entries[0].id, '1');
    assert.strictEqual(attrSpace.entries[0].name, '');
  });

  test('нечисловой id="abc" сравнивается строково — дубль всё равно находится', () => {
    const region = '<Button name="А" id="abc"/><Button name="Б" id="abc"/>';
    const spaces = collectIdSpaces(region);
    const elementSpace = findSpace(spaces, 'element');
    const dupes = findDuplicateIds(elementSpace);
    assert.strictEqual(dupes.length, 1);
    assert.strictEqual(dupes[0].id, 'abc');
    assert.strictEqual(dupes[0].current.name, 'Б');
    assert.strictEqual(dupes[0].previous.name, 'А');
  });
});

suite('FormIdSpaces — maxIdByKind', () => {
  // `example/` не отслеживается git — без корпуса сьют пропускается, а не падает
  // (единый гейт: support/corpus.ts).
  suiteSetup(function () {
    skipWithoutCorpus(this);
  });

  test('T-6a: element-максимум учитывает ColumnGroup id=180 на реальной CFE-форме', () => {
    const xml = readFixture(POLZOVATELI_CFE_FORM);
    const m = maxIdByKind(xml);
    assert.ok(m.element >= 180, `ожидали element >= 180, получили ${String(m.element)}`);
  });

  test('T-6b: Column-id не влияют на attribute-максимум (инъекция большого id колонки в реальный донор)', () => {
    const donor = readFixture(RASHODY_FORM);
    const mutated = donor.replace('<Column name="ИспользоватьХарактеристики" id="1">', '<Column name="ИспользоватьХарактеристики" id="9999999">');
    assert.notStrictEqual(mutated, donor, 'мутация обязана реально сработать (иначе тест ничего не проверяет)');
    const original = maxIdByKind(donor);
    const inflated = maxIdByKind(mutated);
    assert.strictEqual(original.attribute, inflated.attribute, 'inflate id колонки не должен менять attribute-максимум');
    // Максимум по факту файла — id="37" (см. grep по <Attribute ... id=), а не count=36.
    assert.strictEqual(original.attribute, 37);
  });

  test('T-6c: регион BaseForm учитывается в максимуме документа', () => {
    // Донор без BaseForm: element-максимум = 5 (ExtendedTooltip id=5). Инъекция
    // id=9999 ТОЛЬКО внутри BaseForm обязана быть учтена maxIdByKind целиком
    // по документу — иначе allocator сгенерирует коллизию с базовой формой.
    const donor = readFixture(OSTATKI_FORM);
    const withBase = donor.replace('</Form>', '\t<BaseForm version="2.21">\n\t\t<Button name="ИзБазовой" id="9999"/>\n\t</BaseForm>\n</Form>');
    assert.notStrictEqual(withBase, donor);
    const m = maxIdByKind(withBase);
    assert.ok(m.element >= 9999, `ожидали учёт BaseForm (id=9999), получили element=${String(m.element)}`);
  });
});

suite('FormIdSpaces — детерминизм', () => {
  // `example/` не отслеживается git — без корпуса сьют пропускается, а не падает
  // (единый гейт: support/corpus.ts).
  suiteSetup(function () {
    skipWithoutCorpus(this);
  });

  test('T-7: entries идут в документном порядке (offset монотонно растёт), повторный вызов идентичен', () => {
    const xml = readFixture(RASHODY_FORM);
    const spaces1 = collectIdSpaces(xml);
    const spaces2 = collectIdSpaces(xml);
    assert.deepStrictEqual(spaces1, spaces2, 'повторный вызов collectIdSpaces на одном и том же xml обязан давать идентичный результат');

    const elementSpace = findSpace(spaces1, 'element');
    assert.ok(elementSpace.entries.length > 1);
    for (let i = 1; i < elementSpace.entries.length; i++) {
      assert.ok(
        elementSpace.entries[i].offset > elementSpace.entries[i - 1].offset,
        `entries[${String(i)}].offset (${String(elementSpace.entries[i].offset)}) должен быть больше entries[${String(i - 1)}].offset (${String(elementSpace.entries[i - 1].offset)})`
      );
    }
  });
});

suite('FormIdSpaces — широкий sweep по корпусу example/ (регресс «ноль ложных срабатываний»)', () => {
  // `example/` не отслеживается git — без корпуса сьют пропускается, а не падает
  // (единый гейт: support/corpus.ts).
  suiteSetup(function () {
    skipWithoutCorpus(this);
  });

  test('T-11: 0 коллизий во всех пространствах на детерминированной подвыборке ~10% файлов example/', function () {
    this.timeout(60000);
    // Полный корпус — 6329 файлов Form.xml (~239 МБ). Чтобы уложиться в разумный
    // бюджет прогона, берём ДЕТЕРМИНИРОВАННУЮ подвыборку: все пути сортируются
    // и берётся каждый 10-й (~630 файлов) — воспроизводимо между запусками,
    // никакой случайности. Полный обход этого корпуса (все 6329 файлов)
    // независимо проверен python-скриптом на этапе подготовки теста — 0 коллизий.
    const allPaths = [
      ...findAllFormXmlFiles(path.join(EXAMPLE_ROOT, '2.20', 'src')),
      ...findAllFormXmlFiles(path.join(EXAMPLE_ROOT, '2.21', 'src')),
    ].sort();
    assert.ok(allPaths.length > 6000, `ожидали весь корпус example/ (~6329 файлов Form.xml), нашли ${String(allPaths.length)}`);
    const SAMPLE_STEP = 10;
    const sample = allPaths.filter((_, i) => i % SAMPLE_STEP === 0);
    assert.ok(sample.length > 500, `подвыборка должна быть представительной, получили ${String(sample.length)}`);

    let processed = 0;
    const failures: string[] = [];
    for (const formPath of sample) {
      const xml = fs.readFileSync(formPath, 'utf-8');
      const { own, baseForm } = splitBaseForm(xml);
      const regions = baseForm !== null ? [own, baseForm] : [own];
      for (const region of regions) {
        const spaces = collectIdSpaces(region);
        for (const space of spaces) {
          const dupes = findDuplicateIds(space);
          if (dupes.length > 0) {
            failures.push(`${formPath} [${space.kind}/${space.label}]: ${String(dupes.length)} дублей (первый id=${dupes[0].id})`);
          }
        }
      }
      processed++;
    }
    assert.strictEqual(processed, sample.length);
    assert.ok(processed > 0);
    assert.deepStrictEqual(failures, [], `найдены ложные срабатывания:\n${failures.slice(0, 10).join('\n')}`);
  });
});
