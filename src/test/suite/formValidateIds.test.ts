import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FormToolsService } from '../../infra/xml';
import { EXAMPLE_ROOT, findAllFormXmlFiles, hasFormCorpus, writeFormCopy } from './support/formFixtures';
import { skipWithoutCorpus } from './support/corpus';

/**
 * Поведенческие тесты `FormValidateService.validate()` после переноса секций
 * «3. Unique element IDs»/«3b» на `FormIdSpaces`. Проверяет точный контракт
 * сообщений, OK-строки, инвариант maxErrors/stopped и защитные guard'ы.
 *
 * До реализации FormValidateService ещё не использует новый модуль —
 * дефекты A (служебные теги невидимы), B (11 новых тегов), C (плоский счёт
 * колонок), D (own+BaseForm в одном пространстве) актуальны, поэтому
 * большинство тестов здесь красные по СМЫСЛУ (реальное поведение), а не из-за
 * ошибки компиляции (в отличие от formIdSpaces.test.ts).
 */

const OSTATKI_FORM = path.join(EXAMPLE_ROOT, '2.20', 'src', 'cf', 'Reports', 'ОстаткиТоваровНаСкладах', 'Forms', 'ФормаОтчета', 'Ext', 'Form.xml');
const RASHODY_FORM = path.join(EXAMPLE_ROOT, '2.21', 'src', 'cf', 'Documents', 'РасходыПриИмпорте', 'Forms', 'ФормаДокумента', 'Ext', 'Form.xml');
const POLZOVATELI_CFE_FORM = path.join(EXAMPLE_ROOT, '2.21', 'src', 'cfe', 'EVOLC', 'Catalogs', 'Пользователи', 'Forms', 'ФормаЭлемента', 'Ext', 'Form.xml');

/** Курируемый список форм-носителей 11 новых видов полей (см. бриф задачи). */
const NEW_FIELD_CARRIER_FORMS: readonly { readonly tag: string; readonly formPath: string }[] = [
  { tag: 'SpreadSheetDocumentField', formPath: OSTATKI_FORM },
  { tag: 'ChartField', formPath: path.join(EXAMPLE_ROOT, '2.20', 'src', 'cf', 'Reports', 'ДашбордПродажи', 'Forms', 'ФормаОтчета', 'Ext', 'Form.xml') },
  { tag: 'HTMLDocumentField', formPath: path.join(EXAMPLE_ROOT, '2.20', 'src', 'cf', 'Catalogs', 'Товары', 'Forms', 'ФормаЭлемента', 'Ext', 'Form.xml') },
  { tag: 'FormattedDocumentField', formPath: path.join(EXAMPLE_ROOT, '2.20', 'src', 'cf', 'Catalogs', 'Товары', 'Forms', 'ФормаЭлемента', 'Ext', 'Form.xml') },
  { tag: 'ProgressBarField', formPath: path.join(EXAMPLE_ROOT, '2.20', 'src', 'cf', 'Catalogs', 'ХранимыеФайлы', 'Forms', 'ФормаЭлемента', 'Ext', 'Form.xml') },
  { tag: 'PlannerField', formPath: path.join(EXAMPLE_ROOT, '2.20', 'src', 'cf', 'Catalogs', 'Встречи', 'Forms', 'Календарь', 'Ext', 'Form.xml') },
  { tag: 'TextDocumentField', formPath: path.join(EXAMPLE_ROOT, '2.21', 'src', 'cf', 'CommonForms', 'ПредпросмотрЧека', 'Ext', 'Form.xml') },
  { tag: 'TrackBarField', formPath: path.join(EXAMPLE_ROOT, '2.21', 'src', 'cf', 'CommonForms', 'АЛКОВыборМасштаба', 'Ext', 'Form.xml') },
  { tag: 'PDFDocumentField', formPath: path.join(EXAMPLE_ROOT, '2.21', 'src', 'cf', 'CommonForms', 'ПодписаниеДокументов', 'Ext', 'Form.xml') },
  { tag: 'GeographicalSchemaField', formPath: path.join(EXAMPLE_ROOT, '2.21', 'src', 'cf', 'Documents', 'Событие', 'Forms', 'ФормаЕдиногоПросмотраВложений', 'Ext', 'Form.xml') },
  { tag: 'GraphicalSchemaField', formPath: path.join(EXAMPLE_ROOT, '2.21', 'src', 'cf', 'Documents', 'Событие', 'Forms', 'ФормаЕдиногоПросмотраВложений', 'Ext', 'Form.xml') },
  { tag: 'GraphicalSchemaField (запасной носитель)', formPath: path.join(EXAMPLE_ROOT, '2.21', 'src', 'cf', 'DataProcessors', 'КартаМаршрутаБизнесПроцесса', 'Forms', 'Форма', 'Ext', 'Form.xml') },
];

const ALL_11_NEW_TAGS = [
  'SpreadSheetDocumentField', 'HTMLDocumentField', 'TextDocumentField', 'ProgressBarField',
  'FormattedDocumentField', 'ChartField', 'TrackBarField', 'PDFDocumentField', 'PlannerField',
  'GraphicalSchemaField', 'GeographicalSchemaField',
];

/** Курируемый список форм для регресса «ноль ложных срабатываний» (T-9): все
 * формы EVOLC + РасходыПриИмпорте (AdditionalColumns) + все формы-носители 11
 * новых тегов (без повторов путей). */
function buildRegressionFormList(): readonly string[] {
  const evolc = findAllFormXmlFiles(path.join(EXAMPLE_ROOT, '2.21', 'src', 'cfe', 'EVOLC'));
  const carriers = [...new Set(NEW_FIELD_CARRIER_FORMS.map((c) => c.formPath))];
  return [...new Set([...evolc, RASHODY_FORM, ...carriers])].sort();
}

function readFixture(p: string): string {
  return fs.readFileSync(p, 'utf-8');
}

function shortLabel(formPath: string): string {
  return path.relative(EXAMPLE_ROOT, formPath);
}

const service = new FormToolsService();

suite('FormValidateService — T-8: воспроизведение дефекта (служебные теги невидимы для дублей)', () => {
  // `example/` не отслеживается git — без корпуса сьют пропускается, а не падает
  // (единый гейт: support/corpus.ts).
  suiteSetup(function () {
    skipWithoutCorpus(this);
  });

  test('подмена id обычного InputField на id служебного ContextMenu внутри Table → validate() обязан обнаружить дубль', () => {
    const donor = readFixture(RASHODY_FORM);

    // Контрольный прогон на неизменённой копии — обязана быть чистой (0 Duplicate).
    const cleanPath = writeFormCopy(donor);
    const clean = service.validate({ formPath: cleanPath, detailed: true });
    assert.deepStrictEqual(
      clean.lines.filter((l) => l.includes('Duplicate')),
      [],
      `неизменённый донор не должен давать ошибок Duplicate:\n${clean.lines.join('\n')}`
    );

    // Подмена: id обычного элемента таблицы "Разделы" совпадает с id служебного
    // ContextMenu ЭТОЙ ЖЕ таблицы (реальный сценарий из отчёта пользователя —
    // 18 элементов дублировали id служебных элементов таблиц).
    const mutated = donor.replace('<InputField name="РазделыНомерСтроки" id="38">', '<InputField name="РазделыНомерСтроки" id="36">');
    assert.notStrictEqual(mutated, donor, 'мутация обязана реально сработать');
    const mutatedPath = writeFormCopy(mutated);
    const result = service.validate({ formPath: mutatedPath, detailed: true });

    const dupLine = result.lines.find((l) => l.startsWith('[ERROR] Duplicate element id=36'));
    assert.ok(dupLine, `ожидали ERROR про дубль id=36 (ContextMenu vs InputField):\n${result.lines.join('\n')}`);
    assert.ok(dupLine.includes('ContextMenu'), 'сообщение должно называть оба тега — ContextMenu');
    assert.ok(dupLine.includes('InputField'), 'сообщение должно называть оба тега — InputField');
    assert.ok(
      !result.lines.some((l) => l.startsWith('[OK]    Unique element IDs:')),
      'при найденном дубле в element-пространстве OK-строка "Unique element IDs" печататься не должна'
    );
  });
});

suite('FormValidateService — T-9: регресс «ноль ложных срабатываний» на курируемом списке форм', () => {
  // Корпус в .gitignore: без него пропускаем явно. Молчаливо «сьюта без тестов»
  // хуже пропуска — отсутствие проверки выглядело бы как её успешное прохождение.
  suiteSetup(function () {
    if (!hasFormCorpus()) {
      this.skip();
    }
  });
  const formList = buildRegressionFormList();

  test('курируемый список форм действительно не пуст и включает EVOLC + РасходыПриИмпорте + носители новых тегов', () => {
    assert.ok(formList.length >= 15, `ожидали не менее 15 форм в регрессе, получили ${String(formList.length)}`);
    assert.ok(formList.includes(RASHODY_FORM));
  });

  for (const formPath of buildRegressionFormList()) {
    test(`0 Duplicate-ошибок: ${shortLabel(formPath)}`, () => {
      // Предупреждения (WARN) намеренно игнорируются — версия формы 2.21 в
      // эталонах даёт WARN по смежной причине, это не предмет этой задачи.
      const result = service.validate({ formPath, detailed: false });
      const dupLines = result.lines.filter((l) => l.includes('Duplicate'));
      assert.deepStrictEqual(dupLines, [], `${formPath}:\n${dupLines.join('\n')}`);
    });
  }
});

suite('FormValidateService — T-10: гейт по 11 новым тегам на формах-носителях', () => {
  // `example/` не отслеживается git — без корпуса сьют пропускается, а не падает
  // (единый гейт: support/corpus.ts).
  suiteSetup(function () {
    skipWithoutCorpus(this);
  });

  for (const carrier of NEW_FIELD_CARRIER_FORMS) {
    test(`[ERROR]-строки не содержат имена новых тегов: ${carrier.tag} (${shortLabel(carrier.formPath)})`, () => {
      const result = service.validate({ formPath: carrier.formPath, detailed: false });
      const errorLines = result.lines.filter((l) => l.startsWith('[ERROR]'));
      for (const line of errorLines) {
        for (const tag of ALL_11_NEW_TAGS) {
          assert.ok(!line.includes(tag), `строка "${line}" не должна упоминать новый тег "${tag}"`);
        }
      }
    });
  }
});

suite('FormValidateService — T-12: точный контракт сообщений по каждому пространству', () => {
  const FORM_XMLNS_HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" version="2.21">\n';

  test('element: "Duplicate element id=205: \'КолонкаТовар\' <ColumnGroup> and \'ПолеТовар\' <InputField>"', () => {
    const xml = FORM_XMLNS_HEAD +
      '\t<AutoCommandBar name="" id="-1"/>\n' +
      '\t<ChildItems>\n' +
      '\t\t<InputField name="ПолеТовар" id="205"/>\n' +
      '\t\t<ColumnGroup name="КолонкаТовар" id="205"/>\n' +
      '\t</ChildItems>\n' +
      '</Form>\n';
    const result = service.validate({ formPath: writeFormCopy(xml), detailed: true });
    assert.ok(
      result.lines.includes("[ERROR] Duplicate element id=205: 'КолонкаТовар' <ColumnGroup> and 'ПолеТовар' <InputField>"),
      result.lines.join('\n')
    );
  });

  test('element: безымянный участник дубля рендерится как \'(unnamed)\' на месте своего имени (quoteName)', () => {
    // InputField без атрибута name — реальная (хоть и редкая) ситуация в
    // выгрузках; ветка quoteName(name || '(unnamed)') достижима и обязана
    // покрываться отдельно от T-8/T-12, где у обоих участников дубля есть имя.
    const xml = FORM_XMLNS_HEAD +
      '\t<AutoCommandBar name="" id="-1"/>\n' +
      '\t<ChildItems>\n' +
      '\t\t<InputField id="5"/>\n' +
      '\t\t<Button name="Б" id="5"/>\n' +
      '\t</ChildItems>\n' +
      '</Form>\n';
    const result = service.validate({ formPath: writeFormCopy(xml), detailed: true });
    assert.ok(
      result.lines.includes("[ERROR] Duplicate element id=5: 'Б' <Button> and '(unnamed)' <InputField>"),
      result.lines.join('\n')
    );
  });

  test('attribute: "Duplicate attribute id=3: \'Б\' and \'А\'"', () => {
    const xml = FORM_XMLNS_HEAD +
      '\t<AutoCommandBar name="" id="-1"/>\n' +
      '\t<ChildItems/>\n' +
      '\t<Attributes>\n' +
      '\t\t<Attribute name="А" id="3"><Type><v8:Type>xs:string</v8:Type></Type></Attribute>\n' +
      '\t\t<Attribute name="Б" id="3"><Type><v8:Type>xs:string</v8:Type></Type></Attribute>\n' +
      '\t</Attributes>\n' +
      '</Form>\n';
    const result = service.validate({ formPath: writeFormCopy(xml), detailed: true });
    assert.ok(result.lines.includes("[ERROR] Duplicate attribute id=3: 'Б' and 'А'"), result.lines.join('\n'));
  });

  test('command: "Duplicate command id=2: \'Б\' and \'А\'"', () => {
    const xml = FORM_XMLNS_HEAD +
      '\t<AutoCommandBar name="" id="-1"/>\n' +
      '\t<ChildItems/>\n' +
      '\t<Commands>\n' +
      '\t\t<Command name="А" id="2"><Action>Действие1</Action></Command>\n' +
      '\t\t<Command name="Б" id="2"><Action>Действие2</Action></Command>\n' +
      '\t</Commands>\n' +
      '</Form>\n';
    const result = service.validate({ formPath: writeFormCopy(xml), detailed: true });
    assert.ok(result.lines.includes("[ERROR] Duplicate command id=2: 'Б' and 'А'"), result.lines.join('\n'));
  });

  test('column: все 3 варианта (AdditionalColumns/table=, прямая Columns с владельцем, Columns без владельца)', () => {
    // Один синтетический каркас сразу тремя независимыми колоночными контейнерами —
    // так проверяются все три формулировки сообщения из контракта задачи за один
    // прогон, при этом каждый контейнер даёт РОВНО один дубль.
    const xml = FORM_XMLNS_HEAD +
      '\t<AutoCommandBar name="" id="-1"/>\n' +
      '\t<ChildItems/>\n' +
      '\t<Columns>\n' +
      '\t\t<Column name="А" id="2"/>\n' +
      '\t\t<Column name="Б" id="2"/>\n' +
      '\t</Columns>\n' +
      '\t<Attributes>\n' +
      '\t\t<Attribute name="Список" id="1">\n' +
      '\t\t\t<Type><v8:Type>v8:ValueTable</v8:Type></Type>\n' +
      '\t\t\t<Columns>\n' +
      '\t\t\t\t<AdditionalColumns table="Объект.Запасы">\n' +
      '\t\t\t\t\t<Column name="А" id="2"/>\n' +
      '\t\t\t\t\t<Column name="Б" id="2"/>\n' +
      '\t\t\t\t</AdditionalColumns>\n' +
      '\t\t\t</Columns>\n' +
      '\t\t</Attribute>\n' +
      '\t\t<Attribute name="Таблица" id="2">\n' +
      '\t\t\t<Type><v8:Type>v8:ValueTable</v8:Type></Type>\n' +
      '\t\t\t<Columns>\n' +
      '\t\t\t\t<Column name="А" id="2"/>\n' +
      '\t\t\t\t<Column name="Б" id="2"/>\n' +
      '\t\t\t</Columns>\n' +
      '\t\t</Attribute>\n' +
      '\t</Attributes>\n' +
      '</Form>\n';
    const result = service.validate({ formPath: writeFormCopy(xml), detailed: true });
    const lines = result.lines;
    assert.ok(
      lines.includes('[ERROR] Duplicate column id=2 in \'Список\' / AdditionalColumns table="Объект.Запасы": \'Б\' and \'А\''),
      lines.join('\n')
    );
    assert.ok(lines.includes("[ERROR] Duplicate column id=2 in 'Таблица' / Columns: 'Б' and 'А'"), lines.join('\n'));
    assert.ok(lines.includes("[ERROR] Duplicate column id=2 in Columns: 'Б' and 'А'"), lines.join('\n'));
  });
});

suite('FormValidateService — T-13/T-14: OK-строки, счётчики, detailed', () => {
  // `example/` не отслеживается git — без корпуса сьют пропускается, а не падает
  // (единый гейт: support/corpus.ts).
  suiteSetup(function () {
    skipWithoutCorpus(this);
  });

  test('T-13a: чистая форма (РасходыПриИмпорте) — все 4 OK-строки с точными golden-числами', () => {
    // Golden-числа сверены независимо (grep + python xml.etree, см. подготовку
    // задачи): 342 element-записи (id != "-1"), 36 attribute-записей,
    // 11 command-записей, 9 колонок в 2 контейнерах.
    const result = service.validate({ formPath: RASHODY_FORM, detailed: true });
    assert.ok(result.lines.includes('[OK]    Unique element IDs: 342 elements'), result.lines.join('\n'));
    assert.ok(result.lines.includes('[OK]    Unique attribute IDs: 36 entries'), result.lines.join('\n'));
    assert.ok(result.lines.includes('[OK]    Unique command IDs: 11 entries'), result.lines.join('\n'));
    assert.ok(result.lines.includes('[OK]    Unique column IDs: 9 columns in 2 containers'), result.lines.join('\n'));
  });

  test('T-13b: дубль ровно в одном пространстве (attribute) — OK-строка ЭТОГО пространства отсутствует, остальные есть', () => {
    const donor = readFixture(RASHODY_FORM);
    const mutated = donor.replace('<Attribute name="Компания" id="4">', '<Attribute name="Компания" id="2">');
    assert.notStrictEqual(mutated, donor);
    const result = service.validate({ formPath: writeFormCopy(mutated), detailed: true });

    assert.ok(
      !result.lines.some((l) => l.startsWith('[OK]    Unique attribute IDs:')),
      `OK-строка attribute не должна печататься при дубле:\n${result.lines.join('\n')}`
    );
    assert.ok(result.lines.some((l) => l.startsWith('[OK]    Unique element IDs:')), result.lines.join('\n'));
    assert.ok(result.lines.some((l) => l.startsWith('[OK]    Unique command IDs:')), result.lines.join('\n'));
    assert.ok(result.lines.some((l) => l.startsWith('[OK]    Unique column IDs:')), result.lines.join('\n'));
  });

  test('T-14: detailed=false — OK-строк нет вовсе, errors и [ERROR]-строки совпадают с detailed=true', () => {
    const detailed = service.validate({ formPath: RASHODY_FORM, detailed: true });
    const plain = service.validate({ formPath: RASHODY_FORM, detailed: false });
    assert.strictEqual(plain.errors, detailed.errors);
    assert.ok(!plain.lines.some((l) => l.startsWith('[OK]')), 'detailed=false не должен печатать OK-строки');
    assert.deepStrictEqual(
      plain.lines.filter((l) => l.startsWith('[ERROR]')),
      detailed.lines.filter((l) => l.startsWith('[ERROR]'))
    );
  });
});

suite('FormValidateService — T-15: инвариант maxErrors/stopped', () => {
  const FORM_HEADER = '<?xml version="1.0" encoding="UTF-8"?>\n<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" version="2.21">\n';

  /**
   * Строит форму РОВНО с `dupCount` дублирующимися элементами (id="1" у
   * `dupCount + 1` тегов ButtonGroup — 1 базовый + dupCount дублей). ButtonGroup
   * выбран намеренно: он НЕ участвует ни в COMPANION_RULES, ни в DataPath-владении
   * (кроме последнего элемента, который несёт DataPath на существующий атрибут) —
   * это гарантирует, что ЕДИНСТВЕННЫЙ источник ошибок в форме — дубли id.
   */
  function buildDuplicateElementForm(dupCount: number): string {
    const total = dupCount + 1;
    const items: string[] = [];
    for (let i = 1; i <= total; i++) {
      if (i === total) {
        items.push(`\t\t<ButtonGroup name="Группа${String(i)}" id="1"><DataPath>Реквизит1</DataPath></ButtonGroup>`);
      } else {
        items.push(`\t\t<ButtonGroup name="Группа${String(i)}" id="1"/>`);
      }
    }
    return FORM_HEADER +
      '\t<AutoCommandBar name="" id="-1"/>\n' +
      '\t<ChildItems>\n' + items.join('\n') + '\n\t</ChildItems>\n' +
      '\t<Attributes>\n' +
      '\t\t<Attribute name="Реквизит1" id="1"><Type><v8:Type>xs:string</v8:Type></Type></Attribute>\n' +
      '\t</Attributes>\n' +
      '</Form>\n';
  }

  const DUP_COUNT = 18;
  // Маркеры секций 4-12, гарантированно печатающихся при непрерванном прогоне
  // (см. конструкцию формы выше: ровно 1 DataPath, ровно 0 main-атрибутов,
  // ровно 1 валидный xs:string-тип).
  const LATER_SECTION_MARKERS = ['DataPath references', 'MainAttribute:', '12. Types'];

  for (const maxErrors of [1, 5, 18, 30, 500]) {
    test(`maxErrors=${String(maxErrors)}: errors капается ровно min(18, maxErrors), later-секции строго по stopped`, () => {
      const formPath = writeFormCopy(buildDuplicateElementForm(DUP_COUNT));
      const result = service.validate({ formPath, detailed: true, maxErrors });
      const expectedErrors = Math.min(DUP_COUNT, maxErrors);
      assert.strictEqual(result.errors, expectedErrors, result.lines.join('\n'));

      // Останов срабатывает, когда errors достигает maxErrors — при maxErrors<=18
      // это происходит ВНУТРИ element-пространства, later-секции не выполняются.
      const shouldContinue = maxErrors > DUP_COUNT;
      for (const marker of LATER_SECTION_MARKERS) {
        const present = result.lines.some((l) => l.includes(marker));
        assert.strictEqual(
          present,
          shouldContinue,
          `маркер "${marker}" при maxErrors=${String(maxErrors)}: ожидали present=${String(shouldContinue)}\n${result.lines.join('\n')}`
        );
      }
    });
  }
});

suite('FormValidateService — T-16: BaseForm-иммунитет', () => {
  // `example/` не отслеживается git — без корпуса сьют пропускается, а не падает
  // (единый гейт: support/corpus.ts).
  suiteSetup(function () {
    skipWithoutCorpus(this);
  });

  test('T-16a: реальная CFE-форма Пользователи (own+BaseForm с зеркальными id) даёт 0 Duplicate-ошибок', () => {
    const result = service.validate({ formPath: POLZOVATELI_CFE_FORM, detailed: true });
    assert.deepStrictEqual(result.lines.filter((l) => l.includes('Duplicate')), [], result.lines.join('\n'));
  });

  test('T-16b: id, продублированный ВНУТРИ own-региона (совпадающий по значению с id из BaseForm), — ошибка есть', () => {
    // own-регион формы Пользователи и так содержит ColumnGroup id="180" (строка
    // 1028 реального файла) — инъекция ЕЩЁ ОДНОГО элемента с id="180" сразу после
    // <Form> создаёт настоящий интра-own дубль. Исключается из проверки именно
    // BaseForm-регион, а не сама проверка целиком.
    const donor = readFixture(POLZOVATELI_CFE_FORM);
    const mutated = donor.replace(/(<Form\b[^>]*>)/, '$1\n\t<ColumnGroup name="ИнъекцияДубля" id="180"/>');
    assert.notStrictEqual(mutated, donor);
    const result = service.validate({ formPath: writeFormCopy(mutated), detailed: true });
    const dupLine = result.lines.find((l) => l.startsWith('[ERROR] Duplicate element id=180'));
    assert.ok(dupLine, `ожидали дубль id=180 внутри own-региона:\n${result.lines.join('\n')}`);
  });
});

suite('FormValidateService — T-17: защитные guard-ветки', () => {
  test('путь резолвится, но файл физически отсутствует → "Cannot read file", ранний выход', () => {
    // resolveFormXmlPath не бросает для существующего каталога без Ext/Form.xml
    // внутри — ошибка возникает уже при попытке чтения файла в validate().
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-empty-form-'));
    const result = service.validate({ formPath: dir, detailed: true });
    assert.strictEqual(result.errors, 1);
    assert.ok(result.lines.some((l) => l.includes('Cannot read file')));
  });

  test('файл без <Form> → "Root element is not Form.", id-проверки не выполняются', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-notform-'));
    const formPath = path.join(root, 'Form.xml');
    fs.writeFileSync(formPath, '<NotAForm/>', 'utf-8');
    const result = service.validate({ formPath, detailed: true });
    assert.ok(result.lines.some((l) => l.includes('Root element is not Form.')));
    assert.ok(!result.lines.some((l) => l.includes('Unique element IDs')));
    assert.ok(!result.lines.some((l) => l.includes('Duplicate')));
  });
});

suite('FormValidateService — секция 2 (AutoCommandBar): обе ветки отклонения', () => {
  const FORM_XMLNS_HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" version="2.21">\n';

  test('тег <AutoCommandBar> отсутствует в документе вовсе → "AutoCommandBar element missing", проверка не останавливает прогон', () => {
    const xml = FORM_XMLNS_HEAD +
      '\t<ChildItems/>\n' +
      '</Form>\n';
    const result = service.validate({ formPath: writeFormCopy(xml), detailed: true });
    assert.ok(result.lines.includes('[ERROR] AutoCommandBar element missing'), result.lines.join('\n'));
    // Секция 1 (AutoCommandBar) не умеет ставить stopped — прогон обязан
    // дойти до later-секций (здесь — секции 9 «MainAttribute»).
    assert.ok(result.lines.some((l) => l.startsWith('[OK]    MainAttribute:')), result.lines.join('\n'));
  });

  // Нетипичный id — предупреждение, а не ошибка: платформа выгружает такие
  // формы (2 из 6329 в эталоне example/), см. FormValidateService.
  test('<AutoCommandBar id> отличается от "-1" → WARN "AutoCommandBar id=\'5\' — atypical…"', () => {
    const xml = FORM_XMLNS_HEAD +
      '\t<AutoCommandBar name="ПанельКоманд" id="5"/>\n' +
      '\t<ChildItems/>\n' +
      '</Form>\n';
    const result = service.validate({ formPath: writeFormCopy(xml), detailed: true });
    const line = result.lines.find((l) => l.startsWith("[WARN]  AutoCommandBar id='5'"));
    assert.ok(line, result.lines.join('\n'));
    assert.ok(line.includes("normally has id='-1'"), line);
    assert.strictEqual(result.errors, 0, result.lines.join('\n'));
    assert.ok(!result.lines.some((l) => l.startsWith('[OK]    AutoCommandBar:')), result.lines.join('\n'));
  });

  test('<AutoCommandBar> найден, но БЕЗ атрибутов id/name вовсе → attr() возвращает undefined, ?? \'\' подставляет пустую строку', () => {
    // Тег присутствует (иначе acb===null, другая ветка), но у самого тега нет
    // ни id, ни name — единственный способ дойти до fallback `?? ''` в обеих
    // строках (acbId и acbName), а не до regexp-match с непустым значением.
    const xml = FORM_XMLNS_HEAD +
      '\t<AutoCommandBar/>\n' +
      '\t<ChildItems/>\n' +
      '</Form>\n';
    const result = service.validate({ formPath: writeFormCopy(xml), detailed: true });
    assert.ok(
      result.lines.some((l) => l.startsWith("[WARN]  AutoCommandBar id='' — atypical")),
      result.lines.join('\n')
    );
  });
});

suite('FormValidateService — секция 9 (MainAttribute): ветка нескольких основных реквизитов', () => {
  const FORM_XMLNS_HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" version="2.21">\n';

  test('два реквизита с <MainAttribute>true</MainAttribute> → "Multiple MainAttribute=true (2 found, expected 0 or 1)"', () => {
    const xml = FORM_XMLNS_HEAD +
      '\t<AutoCommandBar name="" id="-1"/>\n' +
      '\t<ChildItems/>\n' +
      '\t<Attributes>\n' +
      '\t\t<Attribute name="А" id="1"><Type><v8:Type>xs:string</v8:Type></Type><MainAttribute>true</MainAttribute></Attribute>\n' +
      '\t\t<Attribute name="Б" id="2"><Type><v8:Type>xs:string</v8:Type></Type><MainAttribute>true</MainAttribute></Attribute>\n' +
      '\t</Attributes>\n' +
      '</Form>\n';
    const result = service.validate({ formPath: writeFormCopy(xml), detailed: true });
    assert.ok(
      result.lines.includes('[ERROR] Multiple MainAttribute=true (2 found, expected 0 or 1)'),
      result.lines.join('\n')
    );
    assert.ok(!result.lines.some((l) => l.startsWith('[OK]    MainAttribute:')), result.lines.join('\n'));
  });
});
