import * as assert from 'assert';
import * as path from 'path';
import { importEsmModule, isModuleNotFoundError } from './support/importEsm';

/**
 * Тесты детектора ветвлений `scripts/patch-coverage/branchFacts.mjs` —
 * ЕЩЁ НЕ СУЩЕСТВУЕТ на фазе «красный» (задача «починить гейт coverage:changed»).
 *
 * Детектор — консервативный: он ОБЯЗАН НЕДООЦЕНИВАТЬ. Пропущенное ветвление
 * не хуже сегодняшнего поведения (гейт промолчит), а лишнее найденное — вечный
 * неисправимый красный на легитимном коде (`if`/`?`/`&&` внутри строки,
 * комментария, regex-литерала, условный ТИП `T extends X ? A : B`,
 * optional chaining `a?.b`). Поэтому здесь много НЕГАТИВНЫХ тестов —
 * они так же важны, как позитивные.
 */

type BranchKind = 'if' | 'conditional' | 'logical' | 'switch';

interface BranchRange {
  readonly startLine: number;
  readonly endLine: number;
  readonly kind: BranchKind;
}

interface BranchFactsModule {
  branchRangesOfSource(text: string, fileName: string): BranchRange[];
}

const MODULE_PATH = path.resolve(__dirname, '../../../scripts/patch-coverage/branchFacts.mjs');
const VIRTUAL_FILE = 'virtual.ts';

function src(...linesOfCode: string[]): string {
  return linesOfCode.join('\n');
}

suite('branchFacts.mjs — детектор ветвлений AST (T-coverage-gate)', () => {
  let mod: BranchFactsModule | undefined;
  let loadError: unknown;

  suiteSetup(async () => {
    try {
      mod = await importEsmModule<BranchFactsModule>(MODULE_PATH);
    } catch (err) {
      if (!isModuleNotFoundError(err)) {
        throw err;
      }
      loadError = err;
    }
  });

  test('модуль scripts/patch-coverage/branchFacts.mjs существует и экспортирует branchRangesOfSource', () => {
    assert.ok(
      mod,
      `scripts/patch-coverage/branchFacts.mjs ещё не реализован (ожидаемо на фазе «красный» TDD): ${String(loadError)}`
    );
  });

  function ranges(text: string): BranchRange[] {
    if (!mod) {
      assert.fail('branchFacts.mjs не реализован — см. первый тест');
    }
    return mod.branchRangesOfSource(text, VIRTUAL_FILE);
  }

  // ---- Позитивные конструкции из Части 3 п.1 --------------------------------

  test('if — одна ветвь, диапазон = строка условия (не тело)', () => {
    const text = src(
      'export function f(a: number): number {',
      '  if (a > 0) {',
      '    return 1;',
      '  }',
      '  return 0;',
      '}'
    );
    const found = ranges(text);
    assert.deepStrictEqual(found, [{ startLine: 2, endLine: 2, kind: 'if' }]);
  });

  test('if/else — одна ветвь (else-блок не порождает отдельного диапазона)', () => {
    const text = src(
      'export function f(a: number): number {',
      '  if (a > 0) {',
      '    return 1;',
      '  } else {',
      '    return 0;',
      '  }',
      '}'
    );
    const found = ranges(text);
    assert.deepStrictEqual(found, [{ startLine: 2, endLine: 2, kind: 'if' }]);
  });

  test('else if — цепочка из двух IfStatement даёт ДВА раздельных диапазона', () => {
    const text = src(
      'export function f(a: number): number {',
      '  if (a > 0) {',
      '    return 1;',
      '  } else if (a < 0) {',
      '    return -1;',
      '  } else {',
      '    return 0;',
      '  }',
      '}'
    );
    const found = ranges(text);
    assert.deepStrictEqual(found, [
      { startLine: 2, endLine: 2, kind: 'if' },
      { startLine: 4, endLine: 4, kind: 'if' },
    ]);
  });

  test('тернарник однострочный', () => {
    const text = src('export const y = cond ? 1 : 2;');
    const found = ranges(text);
    assert.deepStrictEqual(found, [{ startLine: 1, endLine: 1, kind: 'conditional' }]);
  });

  test('тернарник многострочный — диапазон охватывает ВСЕ его строки (условие+обе ветви)', () => {
    const text = src('export const y = cond', '  ? 1', '  : 2;');
    const found = ranges(text);
    assert.deepStrictEqual(found, [{ startLine: 1, endLine: 3, kind: 'conditional' }]);
  });

  test('логическое && (однострочное, без окружающего if)', () => {
    const text = src('export const c = a && b;');
    const found = ranges(text);
    assert.deepStrictEqual(found, [{ startLine: 1, endLine: 1, kind: 'logical' }]);
  });

  test('логическое || (однострочное)', () => {
    const text = src('export const c = a || b;');
    const found = ranges(text);
    assert.deepStrictEqual(found, [{ startLine: 1, endLine: 1, kind: 'logical' }]);
  });

  test('логическое ?? (однострочное)', () => {
    const text = src('export const c = a ?? b;');
    const found = ranges(text);
    assert.deepStrictEqual(found, [{ startLine: 1, endLine: 1, kind: 'logical' }]);
  });

  test('логическое && многострочное — диапазон охватывает обе строки', () => {
    const text = src('export const c = a &&', '  b;');
    const found = ranges(text);
    assert.deepStrictEqual(found, [{ startLine: 1, endLine: 2, kind: 'logical' }]);
  });

  // switch: блокер из ревью — старый детектор возвращал ОДИН диапазон-заголовок
  // (`switch(x)`), а v8-to-istanbul кладёт BRDA-записи на строки САМИХ
  // case-клауз, а не на заголовок. Замерено на реальном coverage/lcov.info
  // (295 файлов): по диапазонам-заголовкам switch — 1 попадание против 25
  // промахов, причём единственное совпадение случайное (BRDA принадлежит
  // соседней конструкции). Такой красный НЕВОЗМОЖНО закрыть тестом — V8
  // физически не кладёт запись на строку заголовка. Поэтому детектор выдаёт
  // ОТДЕЛЬНЫЙ диапазон НА КАЖДУЮ case-клаузу (по её собственной строке), а не
  // один диапазон на весь switch — правка, задевшая только заголовок, теперь
  // законно не пересекается ни с одним диапазоном (безопасная недооценка),
  // а правка, задевшая конкретный case, пересечётся с его диапазоном, где
  // BRDA реально есть.

  test('switch с несколькими case — ОТДЕЛЬНЫЙ диапазон НА КАЖДУЮ case-клаузу (по её строке), не один диапазон-заголовок', () => {
    const text = src(
      'switch (x) {', // 1 — заголовок, диапазона НЕ порождает
      '  case 1:', // 2
      '    break;', // 3
      '  case 2:', // 4
      '    break;', // 5
      '  default:', // 6 — default диапазона не порождает (см. отдельный тест)
      '    break;', // 7
      '}' // 8
    );
    const found = ranges(text);
    assert.deepStrictEqual(found, [
      { startLine: 2, endLine: 2, kind: 'switch' },
      { startLine: 4, endLine: 4, kind: 'switch' },
    ]);
  });

  test('case с телом в НЕСКОЛЬКО строк — диапазон НЕ расширяется на тело, остаётся строкой самой клаузы', () => {
    const text = src(
      'switch (x) {', // 1
      '  case 1:', // 2
      '    doA();', // 3
      '    doB();', // 4
      '    break;', // 5
      '}' // 6
    );
    const found = ranges(text);
    assert.deepStrictEqual(found, [{ startLine: 2, endLine: 2, kind: 'switch' }]);
  });

  test('многострочный switch (дискриминант на нескольких строках) — заголовок диапазона по-прежнему не порождает, диапазон case не зависит от его длины', () => {
    const text = src(
      'switch (', // 1
      '  x', // 2
      ') {', // 3
      '  case 1:', // 4
      '    break;', // 5
      '}' // 6
    );
    const found = ranges(text);
    assert.deepStrictEqual(found, [{ startLine: 4, endLine: 4, kind: 'switch' }]);
  });

  test('case со значением на нескольких строках — диапазон охватывает ВЫРАЖЕНИЕ case (не тело)', () => {
    const text = src(
      'switch (x) {', // 1
      '  case a +', // 2
      '    b:', // 3
      '    break;', // 4
      '}' // 5
    );
    const found = ranges(text);
    assert.deepStrictEqual(found, [{ startLine: 2, endLine: 3, kind: 'switch' }]);
  });

  test('НЕГАТИВ: default-клауза НЕ входит в детектор — намеренно (недооценка безопасна, поведение v8-to-istanbul по default ревьюером НЕ измерено)', () => {
    // Явный тест-фиксатор: следующий агент не должен «дополнить» набор до
    // default вслепую по аналогии с case — для default нет замера, что BRDA
    // там вообще появляется, а лишний диапазон, которому неоткуда взять BRDA,
    // это неисправимый ложный красный (см. шапку файла — детектор обязан
    // недооценивать).
    const text = src(
      'switch (x) {', // 1
      '  case 1:', // 2 — единственный диапазон
      '    break;', // 3
      '  default:', // 4 — диапазона НЕ порождает
      '    break;', // 5
      '}' // 6
    );
    const found = ranges(text);
    assert.deepStrictEqual(found, [{ startLine: 2, endLine: 2, kind: 'switch' }], 'default (строка 4) не должен породить диапазон');
  });

  test('switch БЕЗ единого case (только default) — НЕ считается ветвлением (недооценка безопасна)', () => {
    const text = src('switch (x) {', '  default:', '    break;', '}');
    assert.deepStrictEqual(ranges(text), []);
  });

  test('switch пустой ({}) — НЕ считается ветвлением', () => {
    const text = src('switch (x) {', '}');
    assert.deepStrictEqual(ranges(text), []);
  });

  // ---- Диапазоны многострочного if-условия -----------------------------

  test('if с многострочным условием — диапазон охватывает if-заголовок ЦЕЛИКОМ, но не тело; && внутри условия даёт СВОЙ диапазон', () => {
    const text = src(
      'if (',
      '  a > 0 &&',
      '  b < 10',
      ') {',
      '  return 1;',
      '}',
      '// строка тела ниже НЕ должна попасть ни в один диапазон'
    );
    const found = ranges(text);
    assert.deepStrictEqual(found, [
      { startLine: 1, endLine: 3, kind: 'if' },
      { startLine: 2, endLine: 3, kind: 'logical' },
    ]);
  });

  // ---- Вложенность -------------------------------------------------------

  test('вложенность: тернарник внутри условия if — обе конструкции распознаются РАЗДЕЛЬНО', () => {
    // Буквально «if внутри тернарника» синтаксически невозможно (ветви тернарника —
    // выражения, не операторы); проверяем симметричный случай вложенности одной
    // конструкции внутрь заголовка другой.
    const text = src(
      'export function f(a: number): number {',
      '  if (a > 0 ? true : false) {',
      '    return 1;',
      '  }',
      '  return 0;',
      '}'
    );
    const found = ranges(text);
    assert.strictEqual(found.length, 2, 'ожидались 2 диапазона: if и вложенный тернарник в его условии');
    assert.ok(found.some((r) => r.kind === 'if'));
    assert.ok(found.some((r) => r.kind === 'conditional'));
  });

  test('вложенность: тернарник внутри ветви другого тернарника — ДВА раздельных диапазона на одной строке', () => {
    const text = src('export const y = cond ? (a > 0 ? 1 : 2) : 3;');
    const found = ranges(text);
    assert.strictEqual(found.length, 2);
    assert.ok(found.every((r) => r.kind === 'conditional'));
    assert.ok(found.every((r) => r.startLine === 1 && r.endLine === 1));
  });

  // ---- Негативы: инвариант «детектор обязан НЕДООЦЕНИВАТЬ» -----------------

  test('НЕГАТИВ: if/? внутри строкового литерала не считается ветвлением', () => {
    const text = src('export const s = "if (a) { return cond ? 1 : 2; }";');
    assert.deepStrictEqual(ranges(text), []);
  });

  test('НЕГАТИВ: if/? внутри однострочного комментария не считается ветвлением', () => {
    const text = src('// if (a) { return cond ? 1 : 2; }', 'export const z = 1;');
    assert.deepStrictEqual(ranges(text), []);
  });

  test('НЕГАТИВ: if/? внутри блочного комментария не считается ветвлением', () => {
    const text = src('/* if (a) { return cond ? 1 : 2; } */', 'export const z = 1;');
    assert.deepStrictEqual(ranges(text), []);
  });

  test('НЕГАТИВ: if( внутри regex-литерала не парсится как IfStatement', () => {
    const text = src('export const re = /if\\s*\\(/;');
    assert.deepStrictEqual(ranges(text), []);
  });

  test('НЕГАТИВ: условный ТИП (ConditionalTypeNode) — не ConditionalExpression, в JS не эмитится', () => {
    const text = src('export type A<T> = T extends string ? 1 : 2;');
    assert.deepStrictEqual(ranges(text), []);
  });

  test('НЕГАТИВ: optional chaining (?.) — не входит в консервативный список конструкций', () => {
    const text = src('export const v = a?.b;');
    assert.deepStrictEqual(ranges(text), []);
  });

  test('НЕГАТИВ: значение параметра по умолчанию (=) — не ветвление', () => {
    const text = src('export function f(a = 1): number { return a; }');
    assert.deepStrictEqual(ranges(text), []);
  });

  test('файл без ветвлений (обычная функция) — пустой массив', () => {
    const text = src('export function sum(a: number, b: number): number {', '  return a + b;', '}');
    assert.deepStrictEqual(ranges(text), []);
  });

  test('файл только с импортами и типами — пустой массив', () => {
    const text = src(
      "import { X } from './x';",
      'export type A = X;',
      'export interface B {',
      '  a: X;',
      '}'
    );
    assert.deepStrictEqual(ranges(text), []);
  });

  test('пустой файл ("") — пустой массив', () => {
    assert.deepStrictEqual(ranges(''), []);
  });
});
