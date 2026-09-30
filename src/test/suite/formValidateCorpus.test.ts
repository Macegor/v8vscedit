import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { FormValidateService } from '../../infra/xml';
import { EXAMPLE_ROOT, findAllFormXmlFiles, hasFormCorpus, writeFormCopy } from './support/formFixtures';

/**
 * Гейт «validate_form не объявляет невалидной платформенную выгрузку».
 *
 * До исправления прогон по эталону `example/` (6329 форм, 2.20 и 2.21, cf и cfe)
 * давал 186 ошибок в 122 формах и 6249 предупреждений о версии формата — то есть
 * валидатор ругался на 98,7% настоящих форм. Такой вывод приучает его
 * игнорировать, что опаснее отсутствия проверки.
 *
 * Здесь два взаимно страхующих гейта:
 *  1) корпусный — ноль ошибок и ЗАФИКСИРОВАННЫЕ суммы смягчённых предупреждений
 *     на всём эталоне;
 *  2) «инструмент ловит» — на копию реальной формы вносится по одному настоящему
 *     дефекту, и каждый обязан сработать. Без второго гейта первый доказывался бы
 *     тривиально — валидатором, который перестал проверять.
 *
 * Корпус лежит в `.gitignore`, поэтому корпус-зависимые сьюты пропускаются на
 * чистом клоне. Всё, что можно проверить синтетической формой, вынесено в
 * отдельные сьюты БЕЗ пропуска: иначе на машине без эталона без покрытия
 * оставались бы все ветки `resolveDataPathRoot` и обе ветки версии формата.
 */

const service = new FormValidateService();

/**
 * Донор для мутаций: настоящая форма эталона, маленькая (78 строк) и с
 * ЕДИНСТВЕННЫМ `<AutoCommandBar>` — последнее важно для кейса «панель
 * отсутствует»: в крупных формах есть вложенные панели таблиц, и удаление
 * формальной панели формы не даёт «отсутствия».
 */
const DONOR_FORM = path.join(EXAMPLE_ROOT, '2.20', 'src', 'cf', 'Catalogs', 'Валюты', 'Forms', 'ФормаЭлемента', 'Ext', 'Form.xml');

/** Реальная форма с командой без `<Action>` (эталон, выгрузка платформы). */
const COMMAND_WITHOUT_ACTION_FORM = path.join(EXAMPLE_ROOT, '2.21', 'src', 'cf', 'Catalogs', 'КлассификаторЗанятийУНФ', 'Forms', 'ФормаСписка', 'Ext', 'Form.xml');

/** Реальная форма с `AutoCommandBar id='607'` — одна из двух на весь эталон. */
const ATYPICAL_ACB_FORM = path.join(EXAMPLE_ROOT, '2.21', 'src', 'cf', 'Documents', 'ЭлектроннаяСопроводительнаяВедомость', 'Forms', 'ОсновнаяФорма', 'Ext', 'Form.xml');

/** Реальная форма с вложенной таблицей: `Items.<Таблица>.CurrentData.<ТЧ>`. */
const NESTED_TABLE_FORM = path.join(EXAMPLE_ROOT, '2.21', 'src', 'cf', 'DataProcessors', 'НастройкаПравилОбработкиЗаявокСотрудников', 'Forms', 'НастройкаПравилОбработкиЗаявокСотрудников', 'Ext', 'Form.xml');

/**
 * Предупреждения, сознательно оставленные «мягкими» (см. комментарии в сервисе),
 * с ТОЧНЫМИ суммами по эталону. Числа — не украшение отчёта: каждое смягчённое
 * правило на корпусе молчало бы и при полном его отключении, поэтому только
 * пин суммы ловит случайное дальнейшее смягчение (например, если предупреждение
 * про Action перестанет выдаваться вовсе — станет 0).
 */
const DOWNGRADED_WARNINGS = [
  { kind: 'missing or empty Action', expected: 179 },
  { kind: 'atypical, form-level AutoCommandBar', expected: 2 },
] as const;

function mutateDonor(from: string, to: string): string {
  const xml = fs.readFileSync(DONOR_FORM, 'utf-8');
  assert.ok(xml.includes(from), `в доноре нет якоря мутации "${from}"`);
  const mutated = xml.replace(from, to);
  assert.strictEqual(mutated !== xml, from !== to, 'мутация обязана реально сработать');
  return writeFormCopy(mutated);
}

function errorLines(lines: readonly string[]): string[] {
  return lines.filter((l) => l.startsWith('[ERROR]'));
}

function warnLines(lines: readonly string[]): string[] {
  return lines.filter((l) => l.startsWith('[WARN]'));
}

// ─── Синтетические формы: общий конструктор ─────────────────────────────────

function formHead(version: string | null): string {
  const versionAttr = version === null ? '' : ` version="${version}"`;
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + `<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core"${versionAttr}>\n`
    + '\t<AutoCommandBar name="ФормаКоманднаяПанель" id="-1"/>\n';
}

const FORM_ATTRIBUTES = '\t<Attributes>\n'
  + '\t\t<Attribute name="Корень" id="1">\n'
  + '\t\t\t<Type>\n\t\t\t\t<v8:Type>xs:string</v8:Type>\n\t\t\t</Type>\n'
  + '\t\t</Attribute>\n'
  + '\t</Attributes>\n';

/** Таблица со всеми обязательными companion-элементами (иначе сработает секция 4). */
function tableXml(name: string, id: number, dataPath: string | null): string {
  const dp = dataPath === null ? '' : `\t\t\t<DataPath>${dataPath}</DataPath>\n`;
  return `\t\t<Table name="${name}" id="${String(id)}">\n${dp}`
    + `\t\t\t<ContextMenu name="${name}КонтекстноеМеню" id="${String(id + 1)}"/>\n`
    + `\t\t\t<AutoCommandBar name="${name}КоманднаяПанель" id="${String(id + 2)}"/>\n`
    + `\t\t\t<SearchStringAddition name="${name}СтрокаПоиска" id="${String(id + 3)}"/>\n`
    + `\t\t\t<ViewStatusAddition name="${name}СостояниеПросмотра" id="${String(id + 4)}"/>\n`
    + `\t\t\t<SearchControlAddition name="${name}УправлениеПоиском" id="${String(id + 5)}"/>\n`
    + '\t\t</Table>\n';
}

function inputFieldXml(name: string, id: number, dataPath: string): string {
  return `\t\t<InputField name="${name}" id="${String(id)}">\n`
    + `\t\t\t<DataPath>${dataPath}</DataPath>\n`
    + `\t\t\t<ContextMenu name="${name}КонтекстноеМеню" id="${String(id + 1)}"/>\n`
    + `\t\t\t<ExtendedTooltip name="${name}РасширеннаяПодсказка" id="${String(id + 2)}"/>\n`
    + '\t\t</InputField>\n';
}

function buildForm(items: string, version: string | null = '2.21'): string {
  return `${formHead(version)}\t<ChildItems>\n${items}\t</ChildItems>\n${FORM_ATTRIBUTES}</Form>\n`;
}

/** Минимальная корректная форма: ноль ошибок и ноль предупреждений по построению. */
function buildCleanForm(version: string | null = '2.21'): string {
  return buildForm(inputFieldXml('Поле', 100, 'Корень'), version);
}

/**
 * Цепочка вложенных таблиц Т1…Тn: Т1 смотрит на реквизит формы, каждая
 * следующая — на `Items.Т{k-1}.CurrentData.Строки`. Поле смотрит на последнюю,
 * поэтому его путь разворачивается ровно за `n` переходов.
 */
function buildChainForm(tableCount: number): string {
  let items = tableXml('Т1', 100, 'Корень');
  for (let k = 2; k <= tableCount; k++) {
    items += tableXml(`Т${String(k)}`, 100 + (k - 1) * 10, `Items.Т${String(k - 1)}.CurrentData.Строки`);
  }
  items += inputFieldXml('Поле', 100 + tableCount * 10, `Items.Т${String(tableCount)}.CurrentData.Поле`);
  return buildForm(items);
}

// ─── Корпус-зависимые сьюты ─────────────────────────────────────────────────

suite('validate_form — корпусный гейт по эталону example/', () => {
  // Корпус в .gitignore: на чистом клоне его нет, сьют обязан пропускаться,
  // а не падать (иначе «нет корпуса» неотличимо от регресса).
  suiteSetup(function () {
    if (!hasFormCorpus()) {
      this.skip();
    }
  });

  test('ноль ошибок, ноль предупреждений о версии и точные суммы смягчённых на всех Form.xml эталона', function () {
    // Полный обход корпуса — 6329 форм, ~12 с; дефолтные 2 с Mocha не хватит,
    // а дробить гейт по формам нельзя: смысл именно в суммарном числе.
    this.timeout(300_000);

    const files = findAllFormXmlFiles(EXAMPLE_ROOT);
    assert.ok(files.length > 1000, `эталон найден, но форм подозрительно мало: ${String(files.length)}`);

    let totalErrors = 0;
    let formsWithErrors = 0;
    const errorSamples: string[] = [];
    const versionWarnings: string[] = [];
    const otherWarnings: string[] = [];
    const downgradedCounts = new Map<string, number>(DOWNGRADED_WARNINGS.map((w) => [w.kind, 0]));

    for (const formPath of files) {
      // maxErrors по умолчанию (30) обрезает счёт — для гейта берём заведомо больший лимит.
      const result = service.validate({ formPath, maxErrors: 1000 });
      assert.strictEqual(typeof result.errors, 'number', 'errors в результате validate — число, а не массив');
      assert.strictEqual(typeof result.warnings, 'number', 'warnings в результате validate — число, а не массив');
      if (result.errors > 0) {
        totalErrors += result.errors;
        formsWithErrors++;
        if (errorSamples.length < 5) {
          errorSamples.push(`${path.relative(EXAMPLE_ROOT, formPath)}\n    ${errorLines(result.lines).slice(0, 3).join('\n    ')}`);
        }
      }
      for (const line of warnLines(result.lines)) {
        if (line.includes('Form version')) {
          if (versionWarnings.length < 5) {
            versionWarnings.push(`${path.relative(EXAMPLE_ROOT, formPath)}: ${line}`);
          }
          continue;
        }
        const downgraded = DOWNGRADED_WARNINGS.find((w) => line.includes(w.kind));
        if (downgraded) {
          downgradedCounts.set(downgraded.kind, (downgradedCounts.get(downgraded.kind) ?? 0) + 1);
          continue;
        }
        if (otherWarnings.length < 5) {
          otherWarnings.push(`${path.relative(EXAMPLE_ROOT, formPath)}: ${line}`);
        }
      }
    }

    assert.strictEqual(
      totalErrors,
      0,
      `платформенная выгрузка корректна по построению — ошибок быть не должно, `
      + `получено ${String(totalErrors)} в ${String(formsWithErrors)} формах из ${String(files.length)}:\n  `
      + errorSamples.join('\n  ')
    );
    assert.deepStrictEqual(
      versionWarnings,
      [],
      'версии формата эталона (2.20 и 2.21) обязаны считаться известными'
    );
    assert.deepStrictEqual(
      otherWarnings,
      [],
      'на эталоне допустимы только сознательно смягчённые предупреждения (Action, AutoCommandBar)'
    );
    assert.deepStrictEqual(
      Object.fromEntries(downgradedCounts),
      Object.fromEntries(DOWNGRADED_WARNINGS.map((w) => [w.kind, w.expected])),
      'суммы смягчённых предупреждений на эталоне зафиксированы: расхождение — либо регресс правила, '
      + 'либо его дальнейшее смягчение, и то и другое требует нового замера'
    );
  });
});

suite('validate_form — гейт «инструмент ловит» (мутации реальной формы)', () => {
  suiteSetup(function () {
    if (!hasFormCorpus()) {
      this.skip();
    }
  });

  test('неизменённый донор чист: 0 ошибок, 0 предупреждений', () => {
    const result = service.validate({ formPath: DONOR_FORM });
    assert.strictEqual(result.errors, 0, result.lines.join('\n'));
    assert.strictEqual(result.warnings, 0, result.lines.join('\n'));
  });

  test('дубль id у двух элементов формы → ошибка', () => {
    const formPath = mutateDonor('<InputField name="Наименование" id="4">', '<InputField name="Наименование" id="1">');
    const result = service.validate({ formPath });
    assert.strictEqual(result.errors, 1, result.lines.join('\n'));
    const line = errorLines(result.lines)[0];
    assert.ok(line.startsWith('[ERROR] Duplicate element id=1:'), line);
    assert.ok(line.includes("'Наименование'") && line.includes("'Код'"), line);
  });

  test('DataPath на несуществующий реквизит → ошибка', () => {
    const formPath = mutateDonor('<DataPath>Объект.Code</DataPath>', '<DataPath>НетТакогоРеквизита.Code</DataPath>');
    const result = service.validate({ formPath });
    assert.strictEqual(result.errors, 1, result.lines.join('\n'));
    assert.strictEqual(
      errorLines(result.lines)[0],
      "[ERROR] [InputField] 'Код': DataPath='НетТакогоРеквизита.Code' — attribute 'НетТакогоРеквизита' not found"
    );
  });

  test('Items.<НесуществующаяТаблица>.CurrentData.X → ошибка', () => {
    const formPath = mutateDonor('<DataPath>Объект.Code</DataPath>', '<DataPath>Items.НетТакойТаблицы.CurrentData.Поле</DataPath>');
    const result = service.validate({ formPath });
    assert.strictEqual(result.errors, 1, result.lines.join('\n'));
    assert.strictEqual(
      errorLines(result.lines)[0],
      "[ERROR] [InputField] 'Код': DataPath='Items.НетТакойТаблицы.CurrentData.Поле' — table element 'НетТакойТаблицы' not found"
    );
  });

  test('отсутствие AutoCommandBar у формы → ошибка', () => {
    // Якорь без отступа и перевода строки: донор в CRLF, привязываться к EOL незачем.
    const formPath = mutateDonor('<AutoCommandBar name="ФормаКоманднаяПанель" id="-1"/>', '');
    const result = service.validate({ formPath });
    assert.strictEqual(result.errors, 1, result.lines.join('\n'));
    assert.strictEqual(errorLines(result.lines)[0], '[ERROR] AutoCommandBar element missing');
  });

  test('AutoCommandBar с нетипичным id на мутированном доноре → WARN и НЕ ERROR', () => {
    const formPath = mutateDonor('<AutoCommandBar name="ФормаКоманднаяПанель" id="-1"/>', '<AutoCommandBar name="ФормаКоманднаяПанель" id="605"/>');
    const result = service.validate({ formPath });
    assert.strictEqual(result.errors, 0, result.lines.join('\n'));
    assert.strictEqual(result.warnings, 1, result.lines.join('\n'));
    assert.ok(warnLines(result.lines)[0].includes("AutoCommandBar id='605'"), result.lines.join('\n'));
  });
});

suite('validate_form — смягчённые правила на реальных формах эталона', () => {
  suiteSetup(function () {
    if (!hasFormCorpus()) {
      this.skip();
    }
  });

  test('команда без <Action> на реальной форме эталона → WARN и НЕ ERROR', () => {
    const result = service.validate({ formPath: COMMAND_WITHOUT_ACTION_FORM });
    assert.strictEqual(result.errors, 0, result.lines.join('\n'));
    assert.strictEqual(result.warnings, 1, result.lines.join('\n'));
    const line = warnLines(result.lines)[0];
    assert.ok(line.startsWith("[WARN]  Command 'ВосстановитьНачальныеЗначения': missing or empty Action"), line);
    assert.ok(line.includes('may be legitimate'), `формулировка обязана объяснять, почему это не ошибка: ${line}`);
    assert.deepStrictEqual(errorLines(result.lines), []);
  });

  test('AutoCommandBar с нетипичным id на реальной форме эталона → WARN и НЕ ERROR', () => {
    const result = service.validate({ formPath: ATYPICAL_ACB_FORM });
    assert.strictEqual(result.errors, 0, result.lines.join('\n'));
    assert.strictEqual(result.warnings, 1, result.lines.join('\n'));
    const line = warnLines(result.lines)[0];
    assert.ok(line.startsWith("[WARN]  AutoCommandBar id='607'"), line);
    assert.ok(line.includes('atypical'), line);
    assert.deepStrictEqual(errorLines(result.lines), []);
  });

  test('реальная форма эталона с вложенной таблицей — ноль ошибок', () => {
    const result = service.validate({ formPath: NESTED_TABLE_FORM });
    assert.strictEqual(result.errors, 0, result.lines.join('\n'));
    assert.ok(
      !result.lines.some((l) => l.includes("attribute 'Items' not found")),
      `однократная подстановка оставляла корнем само слово Items:\n${result.lines.join('\n')}`
    );
  });
});

// ─── Синтетические сьюты: работают и на клоне без корпуса ───────────────────

suite('validate_form — версия формата (синтетическая форма)', () => {
  // Набор известных версий — общий с генерацией и с валидатором внешнего
  // объекта (`infra/xml/format/formatRegistry`). Список здесь продублирован
  // СОЗНАТЕЛЬНО: тест обязан ловить незамеченное изменение центрального набора,
  // а не повторять его же выражением.
  for (const version of ['2.17', '2.18', '2.20', '2.21']) {
    test(`version='${version}' не даёт предупреждения о версии`, () => {
      const result = service.validate({ formPath: writeFormCopy(buildCleanForm(version)), detailed: true });
      assert.strictEqual(result.warnings, 0, result.lines.join('\n'));
      assert.ok(
        result.lines.includes(`[OK]    Root element: Form version=${version}`),
        result.lines.join('\n')
      );
    });
  }

  // 2.19 привязана к ruleset генерации, но в корпусе (6329 Form.xml и 28 257
  // корней MetaDataObject — только 2.20 и 2.21) не встречается, поэтому
  // известной версией формата не считается.
  for (const version of ['2.99', '2.19']) {
    test(`неизвестная версия формата ${version} → предупреждение, но не ошибка`, () => {
      const result = service.validate({ formPath: writeFormCopy(buildCleanForm(version)) });
      assert.strictEqual(result.errors, 0, result.lines.join('\n'));
      assert.strictEqual(result.warnings, 1, result.lines.join('\n'));
      assert.strictEqual(
        warnLines(result.lines)[0],
        `[WARN]  Form version='${version}' (expected 2.17, 2.18, 2.20, 2.21)`
      );
    });
  }

  test('отсутствие атрибута version → предупреждение', () => {
    const result = service.validate({ formPath: writeFormCopy(buildCleanForm(null)) });
    assert.strictEqual(result.errors, 0, result.lines.join('\n'));
    assert.strictEqual(result.warnings, 1, result.lines.join('\n'));
    assert.strictEqual(warnLines(result.lines)[0], '[WARN]  Form version attribute missing');
  });
});

suite('validate_form — смягчённые правила (синтетическая форма)', () => {
  test('синтетические команды без <Action> и с пустым <Action> → по предупреждению на каждую', () => {
    // Платформа тег просто опускает (см. КлассификаторЗанятийУНФ), но пустой
    // <Action> тоже возможен в рукописной форме — обе формы одного дефекта.
    const xml = buildCleanForm().replace(
      '</Form>',
      '\t<Commands>\n'
      + '\t\t<Command name="БезТегаAction" id="1">\n\t\t\t<Title>\n\t\t\t\t<v8:item>\n\t\t\t\t\t<v8:lang>ru</v8:lang>\n\t\t\t\t\t<v8:content>Без тега</v8:content>\n\t\t\t\t</v8:item>\n\t\t\t</Title>\n\t\t</Command>\n'
      + '\t\t<Command name="СПустымAction" id="2">\n\t\t\t<Action></Action>\n\t\t</Command>\n'
      + '\t</Commands>\n</Form>'
    );
    const result = service.validate({ formPath: writeFormCopy(xml) });
    assert.strictEqual(result.errors, 0, result.lines.join('\n'));
    assert.strictEqual(result.warnings, 2, result.lines.join('\n'));
    assert.ok(warnLines(result.lines)[0].includes("Command 'БезТегаAction'"), result.lines.join('\n'));
    assert.ok(warnLines(result.lines)[1].includes("Command 'СПустымAction'"), result.lines.join('\n'));
  });

  test('команды с заполненным <Action> → OK-строка и ноль предупреждений', () => {
    const xml = buildCleanForm().replace(
      '</Form>',
      '\t<Commands>\n\t\t<Command name="СОбработчиком" id="1">\n\t\t\t<Action>ОбработкаКоманды</Action>\n\t\t</Command>\n\t</Commands>\n</Form>'
    );
    const result = service.validate({ formPath: writeFormCopy(xml), detailed: true });
    assert.strictEqual(result.errors, 0, result.lines.join('\n'));
    assert.strictEqual(result.warnings, 0, result.lines.join('\n'));
    assert.ok(result.lines.includes('[OK]    Command actions: 1 commands checked'), result.lines.join('\n'));
  });
});

suite('validate_form — рекурсивное разворачивание Items.<Таблица>.CurrentData.* (синтетическая форма)', () => {
  test('цепочка из трёх вложенных таблиц разворачивается до реквизита формы', () => {
    const result = service.validate({ formPath: writeFormCopy(buildChainForm(3)), detailed: true });
    assert.strictEqual(result.errors, 0, result.lines.join('\n'));
    assert.strictEqual(result.warnings, 0, result.lines.join('\n'));
    assert.ok(
      result.lines.some((l) => l.startsWith('[OK]    DataPath references: 4 paths checked')),
      result.lines.join('\n')
    );
  });

  test('DataPath с префиксом ~ и индексом [0] нормализуется перед разбором', () => {
    const xml = buildForm(tableXml('Т1', 100, 'Корень') + inputFieldXml('Поле', 200, '~Items[0].Т1.CurrentData.Поле'));
    const result = service.validate({ formPath: writeFormCopy(xml) });
    assert.strictEqual(result.errors, 0, result.lines.join('\n'));
    assert.strictEqual(result.warnings, 0, result.lines.join('\n'));
  });

  test('таблица без тега <DataPath> — путь пропускается без ошибки', () => {
    const xml = buildForm(tableXml('Т1', 100, null) + inputFieldXml('Поле', 200, 'Items.Т1.CurrentData.Поле'));
    const result = service.validate({ formPath: writeFormCopy(xml) });
    assert.strictEqual(result.errors, 0, result.lines.join('\n'));
    assert.strictEqual(result.warnings, 0, result.lines.join('\n'));
  });

  test('таблица с пробельным <DataPath> — тот же пропуск, что и при отсутствии тега', () => {
    // Вторая под-ветка того же guard'а: тег есть, но после trim пуст — путь
    // разворачивать не во что, и объявлять это дефектом формы нельзя.
    const xml = buildForm(tableXml('Т1', 100, '   ') + inputFieldXml('Поле', 200, 'Items.Т1.CurrentData.Поле'));
    const result = service.validate({ formPath: writeFormCopy(xml) });
    assert.strictEqual(result.errors, 0, result.lines.join('\n'));
    assert.strictEqual(result.warnings, 0, result.lines.join('\n'));
  });

  for (const shape of ['Items.Т1', 'Items.Т1.Поле']) {
    test(`нераспознанная форма пути '${shape}' → предупреждение, не ошибка`, () => {
      const xml = buildForm(tableXml('Т1', 100, 'Корень') + inputFieldXml('Поле', 200, shape));
      const result = service.validate({ formPath: writeFormCopy(xml) });
      assert.strictEqual(result.errors, 0, result.lines.join('\n'));
      assert.strictEqual(result.warnings, 1, result.lines.join('\n'));
      assert.strictEqual(
        warnLines(result.lines)[0],
        `[WARN]  [InputField] 'Поле': DataPath='${shape}' — unknown Items.* shape, expected Items.<Table>.CurrentData.*`
      );
    });
  }

  test('цикл «таблица A ↔ таблица B» → ошибка про цикл, а не ложное «attribute not found»', () => {
    // Без множества посещённых таблиц обход не завис бы (предел глубины
    // страхует в любом случае) — он выдал бы «исчерпание глубины» на
    // двухзвенной взаимной ссылке, то есть диагностику не по причине дефекта.
    const xml = buildForm(
      tableXml('ТаблицаA', 100, 'Items.ТаблицаB.CurrentData.Строки')
      + tableXml('ТаблицаB', 200, 'Items.ТаблицаA.CurrentData.Строки')
    );
    const result = service.validate({ formPath: writeFormCopy(xml) });
    assert.strictEqual(result.errors, 2, result.lines.join('\n'));
    for (const line of errorLines(result.lines)) {
      assert.ok(line.includes('cyclic Items.* reference through table element'), line);
    }
  });

  test('цепочка ровно из 16 переходов разворачивается — предел не срабатывает на единицу раньше', () => {
    const result = service.validate({ formPath: writeFormCopy(buildChainForm(16)), detailed: true });
    assert.strictEqual(result.errors, 0, result.lines.join('\n'));
    assert.strictEqual(result.warnings, 0, result.lines.join('\n'));
    assert.ok(
      result.lines.some((l) => l.startsWith('[OK]    DataPath references: 17 paths checked')),
      result.lines.join('\n')
    );
  });

  test('цепочка из 17 переходов → ошибка исчерпания, а не ложное «attribute not found»', () => {
    const result = service.validate({ formPath: writeFormCopy(buildChainForm(17)) });
    assert.strictEqual(result.errors, 1, result.lines.join('\n'));
    assert.strictEqual(
      errorLines(result.lines)[0],
      "[ERROR] [InputField] 'Поле': DataPath='Items.Т17.CurrentData.Поле' — Items.* chain is deeper than 16 hops"
    );
  });
});
