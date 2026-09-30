/**
 * Тесты `infra/cfFile/CfeBatchNaming.ts` — превращение имён расширений базы в
 * имена `.cfe`-файлов и планирование каталога выгрузки.
 *
 * Чистый модуль, ФС не трогается. Именно на нём держится безопасность «все
 * расширения одной операцией»: имя расширения в 1С может содержать символы,
 * запрещённые в именах файлов Windows (`:`, `/`, `*` …), совпадать с
 * зарезервированными именами устройств (`CON`, `COM1` …) и отличаться от
 * другого имени лишь регистром — а файловые системы macOS/Windows
 * регистронезависимы. Ошибка здесь означает либо падение выгрузки на середине,
 * либо ТИХУЮ перезапись бэкапа одного расширения бэкапом другого.
 *
 * Порядок шагов имени зафиксирован контрактом: trim → запрещённые/управляющие
 * символы в `_` → снять хвостовые точки и пробелы → зарезервированные имена
 * Windows (`_`-префикс) → пустой результат в `_` → обрезка базы до 100 символов
 * UTF-16 → `.cfe`. Каждый шаг ниже проверяется парой, которая различает его
 * порядок с соседями.
 */
import * as assert from 'assert';
import { cfeFileNameForExtension, planCfeDumpFiles } from '../../infra/cfFile/CfeBatchNaming';

/** Полный обязательный набор имён из ТЗ; тесты «по множеству» проходят по нему целиком. */
const NAME_SET: readonly string[] = [
  'EVOLC', 'Расш Тест',
  'A:B', 'A/B', 'A\\B', 'A*B', 'A?B', 'A"B', 'A<B>', 'A|B',
  'CON', 'con.cfe', 'PRN', 'AUX', 'NUL', 'COM1', 'COM9', 'LPT1', 'LPT9',
  'Имя.', 'Имя ', '  Имя  ',
  'ext', 'EXT',
  'A\u0001B',
  'x'.repeat(300),
  'A_B',
];

const FORBIDDEN_CHARS: readonly string[] = ['\\', '/', ':', '*', '?', '"', '<', '>', '|'];
const RESERVED_BASES: readonly string[] = [
  'CON', 'PRN', 'AUX', 'NUL',
  ...Array.from({ length: 9 }, (_unused, index) => `COM${String(index + 1)}`),
  ...Array.from({ length: 9 }, (_unused, index) => `LPT${String(index + 1)}`),
];

/** Снимает суффикс `.cfe` и необязательный `~N` коллизии — остаётся «санитизированная база». */
function baseOf(fileName: string): string {
  return fileName.replace(/\.cfe$/, '').replace(/~\d+$/, '');
}

function isWellFormedUtf16(text: string): boolean {
  try {
    encodeURIComponent(text);
    return true;
  } catch {
    return false;
  }
}

/** Все перестановки массива (для набора из ≤ 4 элементов). */
function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) {
    return [[...items]];
  }
  const result: T[][] = [];
  items.forEach((item, index) => {
    const rest = [...items.slice(0, index), ...items.slice(index + 1)];
    for (const tail of permutations(rest)) {
      result.push([item, ...tail]);
    }
  });
  return result;
}

suite('CfeBatchNaming.cfeFileNameForExtension — имя файла по имени расширения', () => {
  const cases: readonly { readonly input: string; readonly expected: string; readonly why: string }[] = [
    { input: 'EVOLC', expected: 'EVOLC.cfe', why: 'обычное имя не меняется' },
    { input: 'Расш Тест', expected: 'Расш Тест.cfe', why: 'кириллица и пробел внутри допустимы в имени файла' },
    { input: 'A:B', expected: 'A_B.cfe', why: '":" запрещён' },
    { input: 'A/B', expected: 'A_B.cfe', why: '"/" запрещён' },
    { input: 'A\\B', expected: 'A_B.cfe', why: '"\\" запрещён' },
    { input: 'A*B', expected: 'A_B.cfe', why: '"*" запрещён' },
    { input: 'A?B', expected: 'A_B.cfe', why: '"?" запрещён' },
    { input: 'A"B', expected: 'A_B.cfe', why: '"\\"" запрещён' },
    { input: 'A<B>', expected: 'A_B_.cfe', why: '"<" и ">" запрещены, обе заменяются' },
    { input: 'A|B', expected: 'A_B.cfe', why: '"|" запрещён' },
    { input: 'CON', expected: '_CON.cfe', why: 'зарезервировано Windows' },
    { input: 'con.cfe', expected: '_con.cfe.cfe', why: 'зарезервированное имя регистронезависимо и с расширением; суффикс добавляется всегда' },
    { input: 'PRN', expected: '_PRN.cfe', why: 'зарезервировано Windows' },
    { input: 'AUX', expected: '_AUX.cfe', why: 'зарезервировано Windows' },
    { input: 'NUL', expected: '_NUL.cfe', why: 'зарезервировано Windows' },
    { input: 'COM1', expected: '_COM1.cfe', why: 'зарезервировано Windows' },
    { input: 'COM9', expected: '_COM9.cfe', why: 'зарезервировано Windows' },
    { input: 'LPT1', expected: '_LPT1.cfe', why: 'зарезервировано Windows' },
    { input: 'LPT9', expected: '_LPT9.cfe', why: 'зарезервировано Windows' },
    { input: 'Имя.', expected: 'Имя.cfe', why: 'хвостовая точка снимается (Windows молча отбрасывает её)' },
    { input: 'Имя ', expected: 'Имя.cfe', why: 'хвостовой пробел снимается' },
    { input: '  Имя  ', expected: 'Имя.cfe', why: 'крайние пробелы снимаются' },
    { input: 'ext', expected: 'ext.cfe', why: 'регистр сохраняется' },
    { input: 'EXT', expected: 'EXT.cfe', why: 'регистр сохраняется' },
    { input: 'A\u0001B', expected: 'A_B.cfe', why: 'управляющий символ заменяется' },
    { input: 'x'.repeat(300), expected: `${'x'.repeat(100)}.cfe`, why: 'база обрезается до 100 символов' },
    { input: 'A_B', expected: 'A_B.cfe', why: 'уже безопасное имя (будущая коллизия с A:B решается планировщиком)' },
  ];

  for (const { input, expected, why } of cases) {
    test(`${JSON.stringify(input.length > 40 ? `${input.slice(0, 10)}…(${String(input.length)})` : input)} → ${expected.length > 40 ? `${expected.slice(0, 10)}…` : expected} (${why})`, () => {
      assert.strictEqual(cfeFileNameForExtension(input), expected);
    });
  }

  test('запрещённые символы: каждый из девяти в любой позиции заменяется на "_"', () => {
    for (const ch of FORBIDDEN_CHARS) {
      assert.strictEqual(cfeFileNameForExtension(`A${ch}B`), 'A_B.cfe', `символ ${JSON.stringify(ch)} посередине`);
      assert.strictEqual(cfeFileNameForExtension(`${ch}AB`), '_AB.cfe', `символ ${JSON.stringify(ch)} в начале`);
      assert.strictEqual(cfeFileNameForExtension(`AB${ch}`), 'AB_.cfe', `символ ${JSON.stringify(ch)} в конце — заменённый, а не снятый`);
    }
  });

  test('управляющие символы U+0000…U+001F внутри имени заменяются на "_" — все 32', () => {
    for (let code = 0; code <= 0x1f; code += 1) {
      const ch = String.fromCharCode(code);
      assert.strictEqual(cfeFileNameForExtension(`A${ch}B`), 'A_B.cfe', `U+${code.toString(16).padStart(4, '0')}`);
    }
  });

  test('зарезервированные имена: все 22 базы в трёх регистрах получают префикс "_"', () => {
    for (const base of RESERVED_BASES) {
      for (const variant of [base, base.toLowerCase(), base[0] + base.slice(1).toLowerCase()]) {
        assert.strictEqual(cfeFileNameForExtension(variant), `_${variant}.cfe`, `${variant} зарезервировано без учёта регистра`);
      }
    }
  });

  test('зарезервированное имя с расширением ("con.txt", "NUL.x") тоже получает префикс — Windows смотрит на часть до первой точки', () => {
    assert.strictEqual(cfeFileNameForExtension('con.txt'), '_con.txt.cfe');
    assert.strictEqual(cfeFileNameForExtension('NUL.x'), '_NUL.x.cfe');
    assert.strictEqual(cfeFileNameForExtension('Com3.log'), '_Com3.log.cfe');
  });

  test('НЕ зарезервированные близкие имена префикс не получают (COM0, COM10, CONSOLE, LPT0, AUXILIARY, CON1)', () => {
    for (const name of ['COM0', 'COM10', 'CONSOLE', 'LPT0', 'LPT10', 'AUXILIARY', 'CON1', 'PRNT', 'NULL', 'MyCON']) {
      assert.strictEqual(cfeFileNameForExtension(name), `${name}.cfe`, name);
    }
  });

  test('порядок шагов: trim ДО замены — крайний "\\t" снимается, а не превращается в "_"', () => {
    assert.strictEqual(cfeFileNameForExtension('\tA\t'), 'A.cfe');
  });

  test('порядок шагов: замена ДО снятия хвоста — "A:." даёт "A_", а не "A"', () => {
    assert.strictEqual(cfeFileNameForExtension('A:.'), 'A_.cfe');
  });

  test('порядок шагов: хвостовые точки и пробелы снимаются пачкой, в любом чередовании', () => {
    assert.strictEqual(cfeFileNameForExtension('A. .'), 'A.cfe');
    assert.strictEqual(cfeFileNameForExtension('A .. '), 'A.cfe');
    assert.strictEqual(cfeFileNameForExtension('A...'), 'A.cfe');
  });

  test('порядок шагов: снятие хвоста ДО проверки зарезервированных — "CON." и "CON " всё равно зарезервированы', () => {
    assert.strictEqual(cfeFileNameForExtension('CON.'), '_CON.cfe');
    assert.strictEqual(cfeFileNameForExtension('CON '), '_CON.cfe');
    assert.strictEqual(cfeFileNameForExtension('nul . '), '_nul.cfe');
  });

  test('порядок шагов: замена запрещённых ДО проверки зарезервированных — "CON:" уже не зарезервировано', () => {
    assert.strictEqual(cfeFileNameForExtension('CON:'), 'CON_.cfe');
  });

  test('пустой результат превращается в "_": "", пробелы, только точки, только пробелы и точки', () => {
    for (const empty of ['', '   ', '.', '...', ' . ', '\t']) {
      assert.strictEqual(cfeFileNameForExtension(empty), '_.cfe', JSON.stringify(empty));
    }
  });

  test('порядок шагов: обрезка ПОСЛЕ префикса зарезервированного — "CON.xxx…" сначала получает "_", потом режется', () => {
    const input = `CON.${'x'.repeat(300)}`;
    assert.strictEqual(cfeFileNameForExtension(input), `_CON.${'x'.repeat(95)}.cfe`);
  });

  test('граница длины: 99, 100 не меняются, 101 обрезается до 100 (кириллица считается в единицах UTF-16 так же)', () => {
    for (const ch of ['a', 'Я']) {
      assert.strictEqual(cfeFileNameForExtension(ch.repeat(99)), `${ch.repeat(99)}.cfe`);
      assert.strictEqual(cfeFileNameForExtension(ch.repeat(100)), `${ch.repeat(100)}.cfe`);
      assert.strictEqual(cfeFileNameForExtension(ch.repeat(101)), `${ch.repeat(100)}.cfe`);
    }
  });

  test('обрезка не рвёт суррогатную пару: результат — корректная UTF-16 строка и не длиннее 100 + ".cfe"', () => {
    // Одиночный суррогат в имени файла при записи превращается в U+FFFD и даёт
    // ДРУГОЕ имя, чем то, что записано в манифесте, — потеря сопоставления.
    for (const prefixLength of [98, 99, 100]) {
      const name = `${'a'.repeat(prefixLength)}😀${'b'.repeat(10)}`;
      const result = cfeFileNameForExtension(name);
      assert.ok(isWellFormedUtf16(result), `после обрезки (префикс ${String(prefixLength)}) остался одиночный суррогат: ${JSON.stringify(result)}`);
      assert.ok(result.length <= 104, `длина ${String(result.length)} превышает 100 + ".cfe"`);
      assert.ok(result.endsWith('.cfe'));
    }
  });

  test('свойство по всему набору: суффикс ".cfe", нет запрещённых/управляющих символов, нет хвостовой точки/пробела перед суффиксом, база не пуста и ≤ 100', () => {
    for (const name of NAME_SET) {
      const fileName = cfeFileNameForExtension(name);
      const label = JSON.stringify(name.length > 20 ? `${name.slice(0, 10)}…` : name);
      assert.ok(fileName.endsWith('.cfe'), `${label}: нет суффикса .cfe`);
      const base = fileName.slice(0, -'.cfe'.length);
      assert.ok(base.length >= 1 && base.length <= 100, `${label}: длина базы ${String(base.length)}`);
      assert.ok(!/[\\/:*?"<>|]/.test(base), `${label}: остались запрещённые символы`);
      // eslint-disable-next-line no-control-regex -- проверка отсутствия управляющих символов и есть цель теста
      assert.ok(!/[\u0000-\u001F]/.test(base), `${label}: остались управляющие символы`);
      assert.ok(!/[. ]$/.test(base), `${label}: хвостовая точка/пробел в базе`);
      assert.ok(!RESERVED_BASES.includes(base.split('.')[0].toUpperCase()), `${label}: база зарезервирована: ${base}`);
    }
  });

  test('функция детерминирована и не имеет побочных эффектов: повторный вызов даёт то же', () => {
    for (const name of NAME_SET) {
      assert.strictEqual(cfeFileNameForExtension(name), cfeFileNameForExtension(name));
    }
  });
});

suite('CfeBatchNaming.planCfeDumpFiles — план имён файлов каталога выгрузки', () => {
  test('пустой список — пустой план, без конфликтов', () => {
    assert.deepStrictEqual(planCfeDumpFiles([], []), { items: [], conflicts: [] });
  });

  test('пустой список при непустом каталоге — конфликтов нет (нечего перезаписывать)', () => {
    assert.deepStrictEqual(planCfeDumpFiles([], ['EVOLC.cfe', 'notes.txt']), { items: [], conflicts: [] });
  });

  test('одно расширение — один элемент с исходным именем и вычисленным файлом', () => {
    assert.deepStrictEqual(planCfeDumpFiles(['EVOLC'], []), {
      items: [{ extensionName: 'EVOLC', fileName: 'EVOLC.cfe' }],
      conflicts: [],
    });
  });

  test('имя расширения в плане сохраняется КАК ЕСТЬ (не санитизированным): манифест по нему восстановит "A:B"', () => {
    const plan = planCfeDumpFiles(['A:B'], []);
    assert.strictEqual(plan.items[0].extensionName, 'A:B');
    assert.strictEqual(plan.items[0].fileName, 'A_B.cfe');
  });

  test('«многие в один»: A:B, A/B, A_B → A_B.cfe, A_B~2.cfe, A_B~3.cfe; сопоставление одинаково при ЛЮБОМ порядке входа', () => {
    const names = ['A:B', 'A/B', 'A_B'];
    const reference = planCfeDumpFiles(names, []);
    assert.deepStrictEqual(
      reference.items.map((item) => item.fileName).sort(),
      ['A_B.cfe', 'A_B~2.cfe', 'A_B~3.cfe']
    );
    for (const order of permutations(names)) {
      assert.deepStrictEqual(planCfeDumpFiles(order, []), reference, `порядок входа ${JSON.stringify(order)} изменил план`);
    }
  });

  test('«многие в один» на всех символах набора: A:B, A/B, A\\B, A*B, A?B, A"B, A|B, A_B — восемь разных файлов, база одна', () => {
    const names = ['A:B', 'A/B', 'A\\B', 'A*B', 'A?B', 'A"B', 'A|B', 'A_B'];
    const plan = planCfeDumpFiles(names, []);
    assert.strictEqual(plan.items.length, names.length);
    const files = plan.items.map((item) => item.fileName);
    assert.strictEqual(new Set(files.map((file) => file.toLowerCase())).size, names.length, `имена файлов не уникальны: ${files.join(', ')}`);
    assert.deepStrictEqual(
      [...files].sort(),
      ['A_B.cfe', ...Array.from({ length: 7 }, (_unused, index) => `A_B~${String(index + 2)}.cfe`)].sort()
    );
  });

  test('регистронезависимая коллизия: "ext" и "EXT" различаются только регистром — файлы обязаны различаться по нижнему регистру', () => {
    const plan = planCfeDumpFiles(['ext', 'EXT'], []);
    assert.deepStrictEqual(plan.items.map((item) => item.fileName.toLowerCase()).sort(), ['ext.cfe', 'ext~2.cfe']);
    assert.deepStrictEqual(plan.items.map((item) => item.extensionName).sort(), ['EXT', 'ext']);
    // Тот же план при обратном порядке входа.
    assert.deepStrictEqual(planCfeDumpFiles(['EXT', 'ext'], []), plan);
  });

  test('коллизия после снятия хвоста: "Имя.", "Имя ", "  Имя  " → три разных файла с базой "Имя"', () => {
    const plan = planCfeDumpFiles(['Имя.', 'Имя ', '  Имя  '], []);
    assert.deepStrictEqual(
      plan.items.map((item) => item.fileName).sort(),
      ['Имя.cfe', 'Имя~2.cfe', 'Имя~3.cfe']
    );
  });

  test('коллизия после обрезки: два длинных имени, различающихся только после 100-го символа, не сливаются в один файл', () => {
    const first = `${'x'.repeat(150)}1`;
    const second = `${'x'.repeat(150)}2`;
    const plan = planCfeDumpFiles([first, second], []);
    const files = plan.items.map((item) => item.fileName.toLowerCase());
    assert.strictEqual(new Set(files).size, 2, files.join(', '));
    for (const item of plan.items) {
      assert.ok(baseOf(item.fileName) === 'x'.repeat(100), 'база обрезана до 100 символов');
    }
  });

  test('суффикс коллизии не наступает на настоящее имя: "A_B~2" среди A_B и A/B — все три файла разные', () => {
    const plan = planCfeDumpFiles(['A_B', 'A/B', 'A_B~2'], []);
    const files = plan.items.map((item) => item.fileName.toLowerCase());
    assert.strictEqual(new Set(files).size, 3, `коллизия суффикса ~2 с реальным именем: ${files.join(', ')}`);
  });

  test('весь обязательный набор имён: каждому расширению — ровно один файл, все имена файлов уникальны без учёта регистра, база = санитизированное имя', () => {
    const plan = planCfeDumpFiles(NAME_SET, []);
    assert.strictEqual(plan.items.length, NAME_SET.length);
    assert.deepStrictEqual(plan.items.map((item) => item.extensionName).sort(), [...NAME_SET].sort(), 'каждое имя ровно один раз, без потерь и дублей');
    const files = plan.items.map((item) => item.fileName);
    assert.strictEqual(new Set(files.map((file) => file.toLowerCase())).size, files.length, 'имена файлов не уникальны без учёта регистра');
    for (const item of plan.items) {
      assert.ok(/^.+\.cfe$/.test(item.fileName), item.fileName);
      assert.strictEqual(
        baseOf(item.fileName),
        baseOf(cfeFileNameForExtension(item.extensionName)),
        `база файла ${item.fileName} не соответствует имени ${JSON.stringify(item.extensionName)}`
      );
    }
    assert.deepStrictEqual(plan.conflicts, []);
  });

  test('детерминизм: разворот, ротация и перестановки набора дают ТОТ ЖЕ план (порядок и суффиксы)', () => {
    const reference = planCfeDumpFiles(NAME_SET, []);
    const reversed = [...NAME_SET].reverse();
    const rotated = [...NAME_SET.slice(7), ...NAME_SET.slice(0, 7)];
    const interleaved = [...NAME_SET.filter((_n, i) => i % 2 === 0), ...NAME_SET.filter((_n, i) => i % 2 === 1)];
    for (const order of [reversed, rotated, interleaved]) {
      assert.deepStrictEqual(planCfeDumpFiles(order, []), reference);
    }
    // Повторный вызов на том же входе — тот же результат (нет накопления состояния).
    assert.deepStrictEqual(planCfeDumpFiles(NAME_SET, []), reference);
  });

  test('вход не мутируется: исходные массивы names/existingNames остаются как были', () => {
    const names = ['b', 'A', 'a'];
    const existing = ['b.cfe'];
    planCfeDumpFiles(names, existing);
    assert.deepStrictEqual(names, ['b', 'A', 'a']);
    assert.deepStrictEqual(existing, ['b.cfe']);
  });

  test('порядок элементов плана: по имени расширения, ru-локаль, без учёта регистра', () => {
    assert.deepStrictEqual(
      planCfeDumpFiles(['Яблоко', 'арбуз', 'Банан', 'вишня'], []).items.map((item) => item.extensionName),
      ['арбуз', 'Банан', 'вишня', 'Яблоко']
    );
    assert.deepStrictEqual(
      planCfeDumpFiles(['D', 'c', 'B', 'a'], []).items.map((item) => item.extensionName),
      ['a', 'B', 'c', 'D']
    );
  });

  test('конфликт с существующим файлом: имя из плана уже есть в каталоге — попадает в conflicts, имя файла НЕ меняется', () => {
    // Молчаливый «обход» конфликта суффиксом породил бы второй бэкап рядом с
    // первым; решение «перезаписать или отказаться» принимает вызывающий по -Overwrite.
    const plan = planCfeDumpFiles(['EVOLC', 'Other'], ['EVOLC.cfe', 'notes.txt']);
    assert.deepStrictEqual(plan.items, [
      { extensionName: 'EVOLC', fileName: 'EVOLC.cfe' },
      { extensionName: 'Other', fileName: 'Other.cfe' },
    ]);
    assert.deepStrictEqual(plan.conflicts, ['EVOLC.cfe']);
  });

  test('конфликт регистронезависим: существует "evolc.CFE", план хочет "EVOLC.cfe"', () => {
    const plan = planCfeDumpFiles(['EVOLC'], ['evolc.CFE']);
    assert.deepStrictEqual(plan.conflicts.map((file) => file.toLowerCase()), ['evolc.cfe']);
    assert.strictEqual(plan.items[0].fileName, 'EVOLC.cfe');
  });

  test('конфликт с ~N-именем: существует "A_B~2.cfe" — конфликтует тот из A:B/A_B, кто получил суффикс', () => {
    const plan = planCfeDumpFiles(['A:B', 'A_B'], ['A_B~2.cfe']);
    assert.deepStrictEqual(plan.conflicts.map((file) => file.toLowerCase()), ['a_b~2.cfe']);
  });

  test('несколько конфликтов перечисляются все; посторонние файлы конфликтами не считаются', () => {
    const plan = planCfeDumpFiles(['One', 'Two', 'Three'], ['one.cfe', 'Three.cfe', 'Four.cfe', 'readme.md', 'cfe-dump.json']);
    assert.deepStrictEqual(plan.conflicts.map((file) => file.toLowerCase()).sort(), ['one.cfe', 'three.cfe']);
  });

  test('без пересечений с каталогом — conflicts пуст', () => {
    assert.deepStrictEqual(planCfeDumpFiles(['One', 'Two'], ['Other.cfe', 'notes.txt']).conflicts, []);
  });
});
