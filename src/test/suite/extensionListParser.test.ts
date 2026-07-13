import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as iconv from 'iconv-lite';
import {
  parseExtensionList,
  readExtensionListFromDumpFile,
  planExtensionChoices,
  type ExtensionChoicePlan,
} from '../../infra/environment/ExtensionListParser';

// Формат парсится из реального вывода 1С:Предприятие 8.3.27.1688
// (DumpDBCfgList -AllExtensions /Out <file>): UTF-8 BOM + имена расширений
// по строке, разделитель CRLF. Эталонные байты одного расширения —
// EF BB BF 49 6E 64 69 67 6F 4C 61 62 0D 0A ("IndigoLab\r\n").
//
// Область покрытия задачи и обоснование пропусков (правило CLAUDE.md №3 —
// запрет заглушек/фиктивных ассертов ради покрытия):
//
// 1. `src/cli/commands/listDbExtensions.ts` — тонкий оркестратор
//    (resolveConnection → createTempDir → runDesignerAndPrintResult →
//    writeUtf8BomLines). Юнит-тестом не покрывается: единственная развилка,
//    которую он добавляет сверх уже протестированного `readExtensionListFromDumpFile`
//    и `writeUtf8BomLines` (см. `onecCommon.ts`), — это реальный спавн
//    Конфигуратора 1С с флагом `/DumpDBCfgList -AllExtensions`, которого нет
//    в тестовом окружении CI (аналогично уже принятому решению для
//    `exportConfiguration.ts`/`importConfiguration.ts` — для них тоже нет
//    юнит-тестов на CLI-обёртку, см. `src/test/suite/cliProcess.test.ts`,
//    где тестируется только процессный слой, а не сами команды).
//
// 2. `src/ui/commands/ext/ExtensionCommandRunner.ts` (новый экспорт
//    `listConnectedDatabaseExtensions`) — спавнит `node <cli онлайн>` как
//    дочерний процесс; не юнит-тестируется по той же причине (внешний
//    процесс, не детерминируемый в CI).
//
// 3. `src/ui/commands/ext/ExtensionCommands.ts` — тело команды
//    `v8vscedit.connectExtension` (QuickPick вместо showInputBox). В проекте
//    НЕТ готового механизма для интеграционного теста полной регистрации
//    команды: `CommandServices` — интерфейс из ~30 полей, и ни один
//    существующий тест не строит его целиком для вызова
//    `vscode.commands.executeCommand('v8vscedit.connectExtension')`
//    (проверено: `grep -rln "registerExtensionCommands" src/test` — пусто).
//    Кроме того, в проекте нет sinon/proxyquire/rewire (проверено по
//    package.json), поэтому импортированный напрямую (не через `services`)
//    `runDecompileExtension` из `ExtensionCommandRunner` подменить нельзя —
//    happy-path выбора расширения в QuickPick неизбежно упирается в реальный
//    спавн Конфигуратора при декомпиляции. Городить ради одной задачи новую
//    тяжёлую тестовую инфраструктуру (полный `CommandServices`-харнесс) —
//    это неявный широкий рефакторинг тестовой базы, который CLAUDE.md
//    прямо запрещает («Не трогай несвязанные тесты, не делай широкий
//    рефакторинг тестовой базы»).
//
//    ВАЖНО: ветвящаяся логика выбора («какие расширения показать в
//    QuickPick, какие уже подключены, показывать ли пункт «Ввести
//    вручную…»») архитектором вынесена из UI в чистую функцию
//    `planExtensionChoices` (ниже, suite `planExtensionChoices`) — она
//    юнит-тестируется полностью и без vscode/диалогов/процессов. В самом
//    `ExtensionCommands.ts` остаётся только тонкая склейка: вызов
//    `listConnectedDatabaseExtensions`, вызов `planExtensionChoices`,
//    построение QuickPick-элементов и показ диалога — эта склейка и есть
//    та часть, что не покрывается юнитом по причинам выше.
//
//    Вся ветвящаяся логика, которую МОЖНО проверить детерминированно и без
//    внешних процессов/диалогов, — это `parseExtensionList`/
//    `readExtensionListFromDumpFile`/`planExtensionChoices` ниже, и она
//    покрыта на 100% по всем веткам (форматы CRLF/LF/BOM-варианты/пустые
//    строки/кириллица; регистронезависимое сравнение и флаг «все
//    подключены» для выбора расширения).

suite('parseExtensionList', () => {
  test('Разбирает несколько имён, разделённых CRLF (реальный формат /Out)', () => {
    assert.deepStrictEqual(parseExtensionList('IndigoLab\r\nDemo\r\n'), ['IndigoLab', 'Demo']);
  });

  test('Разбирает имена, разделённые LF', () => {
    assert.deepStrictEqual(parseExtensionList('A\nB\n'), ['A', 'B']);
  });

  test('Снимает ведущий символьный BOM перед первым именем', () => {
    // BOM через экранирование \uFEFF (не литеральным невидимым символом),
    // чтобы не триггерить no-irregular-whitespace, — тот же приём, что и в
    // metadataMutationServiceSupport.test.ts.
    assert.deepStrictEqual(parseExtensionList('\uFEFFIndigoLab\r\n'), ['IndigoLab']);
  });

  test('Единственная строка без завершающего перевода строки', () => {
    assert.deepStrictEqual(parseExtensionList('Solo'), ['Solo']);
  });

  test('Пустая строка — пустой список', () => {
    assert.deepStrictEqual(parseExtensionList(''), []);
  });

  test('Только BOM без имён — пустой список', () => {
    assert.deepStrictEqual(parseExtensionList('\uFEFF'), []);
  });

  test('Строка из одних пробелов и перевода строки — пустой список', () => {
    assert.deepStrictEqual(parseExtensionList('   \r\n'), []);
  });

  test('Обрезает пробелы по краям имени', () => {
    assert.deepStrictEqual(parseExtensionList('  Name  \r\n'), ['Name']);
  });

  test('Отбрасывает пустые строки между именами', () => {
    assert.deepStrictEqual(parseExtensionList('A\r\n\r\nB\r\n'), ['A', 'B']);
  });

  test('Кириллическое имя расширения разбирается без искажений', () => {
    assert.deepStrictEqual(parseExtensionList('РасширениеПродаж\r\n'), ['РасширениеПродаж']);
  });
});

suite('readExtensionListFromDumpFile', () => {
  let tempDir: string;

  setup(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-ext-list-'));
  });

  teardown(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('UTF-8 BOM + CRLF — эталонные байты одного расширения (снято с живой базы 8.3.27.1688)', () => {
    const filePath = path.join(tempDir, 'dump-utf8.txt');
    // Точные байты: EF BB BF 49 6E 64 69 67 6F 4C 61 62 0D 0A = "IndigoLab\r\n"
    const bytes = Buffer.from([
      0xef, 0xbb, 0xbf,
      0x49, 0x6e, 0x64, 0x69, 0x67, 0x6f, 0x4c, 0x61, 0x62,
      0x0d, 0x0a,
    ]);
    fs.writeFileSync(filePath, bytes);

    assert.deepStrictEqual(readExtensionListFromDumpFile(filePath), ['IndigoLab']);
  });

  test('UTF-16LE BOM (FF FE) с кириллическим именем расширения', () => {
    const filePath = path.join(tempDir, 'dump-utf16le.txt');
    const bom = Buffer.from([0xff, 0xfe]);
    const body = Buffer.from('РасширениеПродаж\r\n', 'utf16le');
    fs.writeFileSync(filePath, Buffer.concat([bom, body]));

    assert.deepStrictEqual(readExtensionListFromDumpFile(filePath), ['РасширениеПродаж']);
  });

  test('UTF-16BE BOM (FE FF) с кириллическим именем расширения', () => {
    const filePath = path.join(tempDir, 'dump-utf16be.txt');
    const bom = Buffer.from([0xfe, 0xff]);
    const body = iconv.encode('РасширениеПродаж\r\n', 'utf16-be');
    fs.writeFileSync(filePath, Buffer.concat([bom, body]));

    assert.deepStrictEqual(readExtensionListFromDumpFile(filePath), ['РасширениеПродаж']);
  });

  test('Файл только с UTF-8 BOM без имён — пустой список', () => {
    const filePath = path.join(tempDir, 'dump-empty.txt');
    fs.writeFileSync(filePath, Buffer.from([0xef, 0xbb, 0xbf]));

    assert.deepStrictEqual(readExtensionListFromDumpFile(filePath), []);
  });

  test('Несуществующий путь — пустой список без исключения', () => {
    const missingPath = path.join(tempDir, 'no-such-file.txt');
    assert.deepStrictEqual(readExtensionListFromDumpFile(missingPath), []);
  });

  test('Файл без BOM, чистый UTF-8 с CRLF', () => {
    const filePath = path.join(tempDir, 'dump-no-bom.txt');
    fs.writeFileSync(filePath, 'A\r\nB\r\n', 'utf-8');

    assert.deepStrictEqual(readExtensionListFromDumpFile(filePath), ['A', 'B']);
  });

  test('Путь существует, но не читается как файл (реальный EISDIR на каталоге) — пустой список без исключения', () => {
    // fs.existsSync(dumpFilePath) вернёт true (каталог существует), но
    // fs.readFileSync на каталоге бросает реальную ошибку EISDIR — эта ветка
    // catch отличается от ветки «путь не существует» выше и требует
    // отдельного покрытия без моков (правило CLAUDE.md №3).
    const dirPath = path.join(tempDir, 'not-a-file');
    fs.mkdirSync(dirPath);

    assert.deepStrictEqual(readExtensionListFromDumpFile(dirPath), []);
  });
});

// planExtensionChoices — чистая функция, вынесенная из UI-обёртки
// connectExtension: решает, какие имена расширений базы показать в QuickPick
// (ещё не подключённые как каталог src/cfe/<имя>), и признак «база непуста,
// но всё уже подключено» — им UI отличает «нечего выбирать» от «в базе нет
// расширений вовсе» и решает, показывать ли сразу ручной ввод.
suite('planExtensionChoices', () => {
  test('Отфильтровывает уже подключённые имена, сохраняя порядок из базы', () => {
    const plan: ExtensionChoicePlan = planExtensionChoices(['A', 'B', 'C'], ['B']);
    assert.deepStrictEqual(plan.selectable, ['A', 'C']);
    assert.strictEqual(plan.allConnected, false);
  });

  test('Сравнение подключённых имён регистронезависимое (ФС macOS/Windows)', () => {
    const plan = planExtensionChoices(['Продажи', 'Закупки'], ['продажи']);
    assert.deepStrictEqual(plan.selectable, ['Закупки']);
    assert.strictEqual(plan.allConnected, false);
  });

  test('Все расширения базы уже подключены — allConnected=true, selectable пуст', () => {
    const plan = planExtensionChoices(['A', 'B'], ['a', 'b']);
    assert.deepStrictEqual(plan.selectable, []);
    assert.strictEqual(plan.allConnected, true);
  });

  test('В базе нет расширений — allConnected=false (не путать с «всё подключено»)', () => {
    const plan = planExtensionChoices([], ['A']);
    assert.deepStrictEqual(plan.selectable, []);
    assert.strictEqual(plan.allConnected, false);
  });

  test('Ничего ещё не подключено — selectable совпадает с dbNames целиком', () => {
    const plan = planExtensionChoices(['A', 'B'], []);
    assert.deepStrictEqual(plan.selectable, ['A', 'B']);
    assert.strictEqual(plan.allConnected, false);
  });

  test('Исходный регистр имени в selectable сохраняется (не приводится к нижнему)', () => {
    const plan = planExtensionChoices(['CamelCase'], []);
    assert.deepStrictEqual(plan.selectable, ['CamelCase']);
    assert.strictEqual(plan.allConnected, false);
  });
});
