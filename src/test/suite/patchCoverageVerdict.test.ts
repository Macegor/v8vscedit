import * as assert from 'assert';
import * as path from 'path';
import { importEsmModule, isModuleNotFoundError } from './support/importEsm';

/**
 * Тесты ядра гейта — `scripts/patch-coverage/verdict.mjs` (`parseLcov`,
 * `summarizeBranchCoverage`, `buildVerdict`). ЕЩЁ НЕ СУЩЕСТВУЕТ на фазе
 * «красный».
 *
 * КОНТРАКТ `buildVerdict({ changed, targetLinesOf, lcov, branchRangesOf,
 * isTypeOnly, degradedShare, degradedMaxShare, allowEmptyChanged? })`
 * (`allowEmptyChanged` — расширение сигнатуры из брифа: чистая функция не
 * читает `COVERAGE_ALLOW_EMPTY` из окружения сама, оркестратор передаёт флаг):
 *
 *  0. `lcov === null` (нет `lcov.info`) → exitCode=2 немедленно, без обращения
 *     к per-file коллбэкам (проверено явно: `targetLinesOf` брошенный).
 *  1. `changed.length === 0` → exitCode=2, если не `allowEmptyChanged`; иначе 0.
 *  2. Для каждого `changed`-файла:
 *     а) файла нет в `lcov` → «чисто-типовой» (isTypeOnly) — ок; иначе offender
 *        `«${rel}: НЕТ данных покрытия (не загружен тестами) — нужен тест»`.
 *     б) целевые строки (`targetLinesOf`) с `DA===0` → offender «не покрыто —
 *        строки N,M» (сортировка по возрастанию).
 *     в) диапазоны `branchRangesOf(rel)`, ПЕРЕСЕКАЮЩИЕСЯ с целевыми строками:
 *        - пусто → ветки не проверяются вовсе (легитимный линейный патч, а
 *          ТАКЖЕ безопасный результат для правки, задевшей только заголовок
 *          `switch` — см. анти-регресс тест ниже);
 *        - непусто, но в объединении диапазонов НЕТ ни одной BRDA-записи —
 *          РАЗЛИЧАЕМ по `entry.brda.size` ВСЕГО ФАЙЛА (реальный замер
 *          ревьюера: у if-диапазонов 495 промахов BRDA из 2696 — почти
 *          пятая часть НЕ деградация, а обычное поведение V8, не создающего
 *          BRDA-блок для всегда-взятой ветки):
 *            • `entry.brda.size > 0` (у файла есть BRDA данные в других
 *              местах — измерению можно верить) → offender «не покрыто —
 *              ветки на строках N (противоположная ветвь ни разу не
 *              исполнялась — допишите тест на неё)» → код 1, РЕАЛЬНЫЙ пробел;
 *            • `entry.brda.size === 0` (у файла НЕТ ни одной BRDA-записи
 *              вообще) → offender «НЕТ ДАННЫХ О ВЕТКАХ» → код 2, признак
 *              недостоверности измерения по файлу;
 *        - есть BRDA В САМОМ диапазоне, но `taken ∈ {'-','0'}` на какой-то из
 *          них → offender «не покрыто — ветки на строках N» (код 1, без
 *          уточнения о причине — данные есть, просто ветка не покрыта).
 *  3. Канарейка: `degradedShare > degradedMaxShare` → offender
 *     «ДЕГРАДАЦИЯ ПОКРЫТИЯ...» → 2 (сравнение НЕ строгое строго-больше —
 *     граница `share === max` считается ОК).
 *  4. Итоговый `exitCode` = максимум по приоритету 2 > 1 > 0 среди ВСЕХ
 *     источников (в т.ч. смешанный случай: один файл с offender-«1», другой
 *     файл с offender-«2» → итог 2, но ОБА offender-сообщения присутствуют).
 *
 * `offenders` — детерминированный массив строк В ПОРЯДКЕ `changed`.
 */

type BranchKind = 'if' | 'conditional' | 'logical' | 'switch';

interface BranchRange {
  readonly startLine: number;
  readonly endLine: number;
  readonly kind: BranchKind;
}

interface LcovFileEntry {
  readonly da: Map<number, number>;
  readonly brda: Map<number, string[]>;
}

interface BranchSummary {
  readonly totalFiles: number;
  readonly filesWithBranches: number;
  readonly filesWithoutBranchData: number;
  readonly share: number;
}

interface ChangedFile {
  readonly rel: string;
  readonly isNew: boolean;
}

interface Verdict {
  readonly offenders: string[];
  readonly summary: string;
  readonly exitCode: 0 | 1 | 2;
}

interface BuildVerdictArgs {
  changed: ChangedFile[];
  targetLinesOf: (rel: string, isNew: boolean) => Set<number>;
  lcov: Map<string, LcovFileEntry> | null;
  branchRangesOf: (rel: string) => BranchRange[];
  isTypeOnly: (rel: string) => boolean;
  degradedShare: number;
  degradedMaxShare: number;
  allowEmptyChanged?: boolean;
}

interface VerdictModule {
  parseLcov(text: string): Map<string, LcovFileEntry>;
  summarizeBranchCoverage(args: {
    lcov: Map<string, LcovFileEntry>;
    branchRangesOf: (rel: string) => BranchRange[] | null;
  }): BranchSummary;
  buildVerdict(args: BuildVerdictArgs): Verdict;
}

const MODULE_PATH = path.resolve(__dirname, '../../../scripts/patch-coverage/verdict.mjs');
const BRANCH_FACTS_PATH = path.resolve(__dirname, '../../../scripts/patch-coverage/branchFacts.mjs');

interface BranchFactsModule {
  branchRangesOfSource(text: string, fileName: string): BranchRange[];
}

function lcovBlock(sf: string, da: [number, number][], brda: [number, number, number, string][] = []): string {
  const out = ['TN:', `SF:${sf}`];
  for (const [ln, hits] of da) {
    out.push(`DA:${String(ln)},${String(hits)}`);
  }
  for (const [ln, blockId, branchId, taken] of brda) {
    out.push(`BRDA:${String(ln)},${String(blockId)},${String(branchId)},${taken}`);
  }
  out.push('end_of_record');
  return out.join('\n');
}

function throwing(label: string): never {
  throw new Error(`не должно быть вызвано в этом сценарии: ${label}`);
}

suite('verdict.mjs — parseLcov/summarizeBranchCoverage/buildVerdict (T-coverage-gate)', () => {
  let mod: VerdictModule | undefined;
  let branchFacts: BranchFactsModule | undefined;
  let loadError: unknown;

  suiteSetup(async () => {
    try {
      mod = await importEsmModule<VerdictModule>(MODULE_PATH);
      branchFacts = await importEsmModule<BranchFactsModule>(BRANCH_FACTS_PATH);
    } catch (err) {
      if (!isModuleNotFoundError(err)) {
        throw err;
      }
      loadError = err;
    }
  });

  test('модуль scripts/patch-coverage/verdict.mjs существует и экспортирует parseLcov/summarizeBranchCoverage/buildVerdict', () => {
    assert.ok(mod, `verdict.mjs ещё не реализован (ожидаемо на фазе «красный» TDD): ${String(loadError)}`);
  });

  function m(): VerdictModule {
    if (!mod) {
      assert.fail('verdict.mjs не реализован — см. первый тест');
    }
    return mod;
  }

  function bf(): BranchFactsModule {
    if (!branchFacts) {
      assert.fail('branchFacts.mjs не реализован — см. первый тест');
    }
    return branchFacts;
  }

  // Базовые «безопасные» параметры канарейки — используются во всех тестах,
  // не посвящённых самой канарейке, чтобы не смешивать проверяемые свойства.
  const SAFE_CANARY = { degradedShare: 0, degradedMaxShare: 1 };

  // ---- parseLcov -------------------------------------------------------

  test('parseLcov: разбирает SF/DA/BRDA нескольких файлов в Map, игнорируя TN/end_of_record как разделители', () => {
    const text = [lcovBlock('a.ts', [[1, 1], [2, 0]]), lcovBlock('b.ts', [[1, 5]], [[1, 0, 0, '2']])].join('\n');
    const lcov = m().parseLcov(text);
    assert.strictEqual(lcov.size, 2);
    assert.strictEqual(lcov.get('a.ts')?.da.get(1), 1);
    assert.strictEqual(lcov.get('a.ts')?.da.get(2), 0);
    assert.strictEqual(lcov.get('b.ts')?.brda.get(1)?.[0], '2');
  });

  // ---- summarizeBranchCoverage: доля 0 / деление на 0 / null-пропуск ----

  test('summarizeBranchCoverage: файлов с ветвлениями 0 → доля 0 (без деления на 0)', () => {
    const lcov = m().parseLcov(lcovBlock('nobranch.ts', [[1, 1]]));
    const summary = m().summarizeBranchCoverage({ lcov, branchRangesOf: () => [] });
    assert.strictEqual(summary.filesWithBranches, 0);
    assert.strictEqual(summary.share, 0);
  });

  test('summarizeBranchCoverage: branchRangesOf(null) — файл пропускается из расчёта целиком (не входит в totalFiles)', () => {
    const lcov = m().parseLcov([lcovBlock('a.ts', [[1, 1]]), lcovBlock('unreadable.ts', [[1, 1]])].join('\n'));
    const summary = m().summarizeBranchCoverage({
      lcov,
      branchRangesOf: (rel) => (rel === 'unreadable.ts' ? null : []),
    });
    assert.strictEqual(summary.totalFiles, 1, 'unreadable.ts обязан быть исключён из знаменателя, а не посчитан как 0-ветвлений файл');
  });

  // ---- buildVerdict: правило 0 — lcov === null -------------------------

  test('buildVerdict: lcov === null → exitCode=2 НЕМЕДЛЕННО, per-file коллбэки не вызываются', () => {
    const verdict = m().buildVerdict({
      changed: [{ rel: 'x.ts', isNew: false }],
      targetLinesOf: () => throwing('targetLinesOf'),
      lcov: null,
      branchRangesOf: () => throwing('branchRangesOf'),
      isTypeOnly: () => throwing('isTypeOnly'),
      ...SAFE_CANARY,
    });
    assert.strictEqual(verdict.exitCode, 2);
    assert.ok(verdict.summary.toLowerCase().includes('lcov'), 'summary обязан объяснять отсутствие lcov.info');
  });

  // ---- buildVerdict: правило 1 — пустой набор изменений -----------------

  test('buildVerdict: changed=[] без allowEmptyChanged → exitCode=2', () => {
    const verdict = m().buildVerdict({
      changed: [],
      targetLinesOf: () => new Set<number>(),
      lcov: m().parseLcov(''),
      branchRangesOf: () => [],
      isTypeOnly: () => false,
      ...SAFE_CANARY,
    });
    assert.strictEqual(verdict.exitCode, 2);
  });

  test('buildVerdict: changed=[] с allowEmptyChanged=true → exitCode=0', () => {
    const verdict = m().buildVerdict({
      changed: [],
      targetLinesOf: () => new Set<number>(),
      lcov: m().parseLcov(''),
      branchRangesOf: () => [],
      isTypeOnly: () => false,
      allowEmptyChanged: true,
      ...SAFE_CANARY,
    });
    assert.strictEqual(verdict.exitCode, 0);
    assert.deepStrictEqual(verdict.offenders, []);
  });

  // ---- buildVerdict: правило 2а — файла нет в lcov -----------------------

  test('buildVerdict: файла нет в lcov, но он чисто-типовой → ок (0)', () => {
    const verdict = m().buildVerdict({
      changed: [{ rel: 'types/only.ts', isNew: true }],
      targetLinesOf: () => new Set([1]),
      lcov: m().parseLcov(''),
      branchRangesOf: () => [],
      isTypeOnly: (rel) => rel === 'types/only.ts',
      ...SAFE_CANARY,
    });
    assert.strictEqual(verdict.exitCode, 0);
    assert.deepStrictEqual(verdict.offenders, []);
  });

  test('buildVerdict: файла нет в lcov и он НЕ чисто-типовой → offender, exitCode=1', () => {
    const verdict = m().buildVerdict({
      changed: [{ rel: 'infra/missing.ts', isNew: true }],
      targetLinesOf: () => new Set([1]),
      lcov: m().parseLcov(''),
      branchRangesOf: () => [],
      isTypeOnly: () => false,
      ...SAFE_CANARY,
    });
    assert.strictEqual(verdict.exitCode, 1);
    assert.deepStrictEqual(verdict.offenders, ['infra/missing.ts: НЕТ данных покрытия (не загружен тестами) — нужен тест']);
  });

  // ---- buildVerdict: правило 2б — покрытые/непокрытые строки -------------

  test('buildVerdict: полностью покрытый новый файл, без ветвлений → 0', () => {
    const lcov = m().parseLcov(lcovBlock('new/clean.ts', [[1, 1], [2, 1], [3, 1]]));
    const verdict = m().buildVerdict({
      changed: [{ rel: 'new/clean.ts', isNew: true }],
      targetLinesOf: () => new Set([1, 2, 3]),
      lcov,
      branchRangesOf: () => [],
      isTypeOnly: () => false,
      ...SAFE_CANARY,
    });
    assert.strictEqual(verdict.exitCode, 0);
    assert.deepStrictEqual(verdict.offenders, []);
  });

  test('buildVerdict: DA=0 на целевой строке → offender «не покрыто — строки N», exitCode=1', () => {
    const lcov = m().parseLcov(lcovBlock('new/dirty.ts', [[1, 1], [2, 0], [3, 1]]));
    const verdict = m().buildVerdict({
      changed: [{ rel: 'new/dirty.ts', isNew: true }],
      targetLinesOf: () => new Set([1, 2, 3]),
      lcov,
      branchRangesOf: () => [],
      isTypeOnly: () => false,
      ...SAFE_CANARY,
    });
    assert.strictEqual(verdict.exitCode, 1);
    assert.deepStrictEqual(verdict.offenders, ['new/dirty.ts: не покрыто — строки 2']);
  });

  test('buildVerdict: несколько непокрытых строк — сортировка по возрастанию НЕЗАВИСИМО от порядка target-Set', () => {
    const lcov = m().parseLcov(lcovBlock('new/manyDirty.ts', [[1, 1], [2, 0], [3, 0], [4, 1]]));
    const verdict = m().buildVerdict({
      changed: [{ rel: 'new/manyDirty.ts', isNew: true }],
      targetLinesOf: () => new Set([3, 2, 1, 4]),
      lcov,
      branchRangesOf: () => [],
      isTypeOnly: () => false,
      ...SAFE_CANARY,
    });
    assert.deepStrictEqual(verdict.offenders, ['new/manyDirty.ts: не покрыто — строки 2,3']);
  });

  test('buildVerdict: изменённые строки БЕЗ пересечения с добавленным диапазоном (модифицированный файл) → только добавленные', () => {
    // Легаси-строка того же файла с DA=0 не должна попасть в отчёт — таргет
    // содержит только «добавленную» строку 2.
    const lcov = m().parseLcov(lcovBlock('mod/legacy.ts', [[1, 0], [2, 0], [3, 1]]));
    const verdict = m().buildVerdict({
      changed: [{ rel: 'mod/legacy.ts', isNew: false }],
      targetLinesOf: () => new Set([2]),
      lcov,
      branchRangesOf: () => [],
      isTypeOnly: () => false,
      ...SAFE_CANARY,
    });
    assert.deepStrictEqual(verdict.offenders, ['mod/legacy.ts: не покрыто — строки 2']);
  });

  // ---- buildVerdict: правило 2в — диапазоны ветвлений ---------------------

  test('buildVerdict: диапазон НЕ пересекается с целевыми строками → ветки не проверяются вовсе (0), даже если та ветка не покрыта', () => {
    const lcov = m().parseLcov(lcovBlock('mod/farBranch.ts', [[2, 1]], [[10, 0, 0, '0']]));
    const verdict = m().buildVerdict({
      changed: [{ rel: 'mod/farBranch.ts', isNew: false }],
      targetLinesOf: () => new Set([2]),
      lcov,
      branchRangesOf: () => [{ startLine: 10, endLine: 10, kind: 'if' }],
      isTypeOnly: () => false,
      ...SAFE_CANARY,
    });
    assert.strictEqual(verdict.exitCode, 0);
    assert.deepStrictEqual(verdict.offenders, []);
  });

  // Реальный замер ревьюера на coverage/lcov.info: у if-диапазонов 495 промахов
  // BRDA из 2696 — «нет записи в диапазоне» почти в пятой части случаев. Это по
  // большей части НЕ деградация измерения, а обычное поведение V8: он не создаёт
  // BRDA-блок, когда конструкция всегда идёт по одной и той же ветке (пример
  // ревьюера: src/cli/core/onecCommon.ts:35 — строка исполнена, но записи нет).
  // Если такой случай ВСЕГДА тянет за собой код 2 «данные недостоверны», гейт
  // маскирует настоящий пробел покрытия под «инструменту нельзя верить» — команда
  // научится обходить гейт вместо того, чтобы дописывать тест. Различитель —
  // есть ли у файла BRDA ГДЕ-ТО ЕЩЁ (entry.brda.size > 0): если есть, измерению
  // по файлу в целом верить можно, и отсутствие записи именно в этом диапазоне —
  // реальный пробел (код 1). Если BRDA нет вообще нигде — это и есть деградация
  // измерения по файлу (код 2, как раньше).

  test('buildVerdict: диапазон пересекается, BRDA в нём нет, НО у файла есть BRDA в другом месте → РЕАЛЬНЫЙ пробел, код 1, «допишите тест»', () => {
    const lcov = m().parseLcov(
      lcovBlock('mod/branchNeverTaken.ts', [[1, 1], [2, 1], [3, 1], [10, 1]], [[10, 0, 0, '1'], [10, 0, 1, '1']])
    );
    const verdict = m().buildVerdict({
      changed: [{ rel: 'mod/branchNeverTaken.ts', isNew: false }],
      targetLinesOf: () => new Set([2]),
      lcov,
      branchRangesOf: () => [{ startLine: 2, endLine: 2, kind: 'if' }],
      isTypeOnly: () => false,
      ...SAFE_CANARY,
    });
    assert.strictEqual(verdict.exitCode, 1, 'у файла ЕСТЬ BRDA-данные — измерению можно верить, это код 1, а не 2');
    assert.strictEqual(verdict.offenders.length, 1);
    assert.ok(
      verdict.offenders[0]?.includes('допишите тест'),
      `сообщение обязано указывать на исправимость тестом: ${verdict.offenders[0]}`
    );
    assert.ok(
      !verdict.offenders[0]?.includes('НЕТ ДАННЫХ'),
      `код 1 не должен использовать формулировку кода 2 (не путать причины): ${verdict.offenders[0]}`
    );
    assert.ok(verdict.offenders[0]?.startsWith('mod/branchNeverTaken.ts:'));
  });

  test('buildVerdict: диапазон пересекается, у файла НЕТ ни одной записи BRDA вообще → недостоверные данные, код 2, «НЕТ ДАННЫХ»', () => {
    const lcov = m().parseLcov(lcovBlock('mod/noBrda.ts', [[1, 1], [2, 1], [3, 1]]));
    const verdict = m().buildVerdict({
      changed: [{ rel: 'mod/noBrda.ts', isNew: false }],
      targetLinesOf: () => new Set([2]),
      lcov,
      branchRangesOf: () => [{ startLine: 2, endLine: 2, kind: 'if' }],
      isTypeOnly: () => false,
      ...SAFE_CANARY,
    });
    assert.strictEqual(verdict.exitCode, 2, 'у файла НЕТ ни одной BRDA — измерению по нему верить нельзя, код 2');
    assert.strictEqual(verdict.offenders.length, 1);
    assert.ok(verdict.offenders[0]?.includes('НЕТ ДАННЫХ О ВЕТКАХ'), `неожиданный формат: ${verdict.offenders[0]}`);
    assert.ok(
      !verdict.offenders[0]?.includes('допишите тест'),
      `код 2 не должен использовать формулировку кода 1 (не путать причины): ${verdict.offenders[0]}`
    );
    assert.ok(verdict.offenders[0]?.startsWith('mod/noBrda.ts:'));
  });

  test('ГРАНИЦА код1/код2: ОДИН И ТОТ ЖЕ целевой диапазон без BRDA — код различается ТОЛЬКО наличием BRDA у файла где-то ещё', () => {
    // Намеренно идентичные DA/target/range между вариантами A и B — единственная
    // переменная часть, которая должна переключать код, это присутствие BRDA
    // на НЕСВЯЗАННОЙ строке 10 (вариант A) против полного её отсутствия (B).
    const commonDa: [number, number][] = [[1, 1], [2, 1], [3, 1]];
    const rangeAtLine2 = [{ startLine: 2, endLine: 2, kind: 'if' as const }];

    const lcovA = m().parseLcov(lcovBlock('mod/boundaryA.ts', [...commonDa, [10, 1]], [[10, 0, 0, '1'], [10, 0, 1, '1']]));
    const lcovB = m().parseLcov(lcovBlock('mod/boundaryB.ts', commonDa));

    const verdictA = m().buildVerdict({
      changed: [{ rel: 'mod/boundaryA.ts', isNew: false }],
      targetLinesOf: () => new Set([2]),
      lcov: lcovA,
      branchRangesOf: () => rangeAtLine2,
      isTypeOnly: () => false,
      ...SAFE_CANARY,
    });
    const verdictB = m().buildVerdict({
      changed: [{ rel: 'mod/boundaryB.ts', isNew: false }],
      targetLinesOf: () => new Set([2]),
      lcov: lcovB,
      branchRangesOf: () => rangeAtLine2,
      isTypeOnly: () => false,
      ...SAFE_CANARY,
    });

    assert.strictEqual(verdictA.exitCode, 1, 'файл с BRDA-данными ГДЕ-ТО ЕЩЁ — реальный непокрытый кейс, код 1');
    assert.strictEqual(verdictB.exitCode, 2, 'файл БЕЗ единой BRDA-записи — недостоверные данные, код 2');
    assert.ok(verdictA.offenders[0]?.includes('допишите тест'));
    assert.ok(verdictB.offenders[0]?.includes('НЕТ ДАННЫХ'));
  });

  for (const taken of ['0', '-']) {
    test(`buildVerdict: BRDA.taken='${taken}' на пересекающемся диапазоне → «не покрыто — ветки», exitCode=1`, () => {
      const lcov = m().parseLcov(lcovBlock('mod/branchGap.ts', [[1, 1], [2, 1]], [[2, 0, 0, '1'], [2, 0, 1, taken]]));
      const verdict = m().buildVerdict({
        changed: [{ rel: 'mod/branchGap.ts', isNew: false }],
        targetLinesOf: () => new Set([2]),
        lcov,
        branchRangesOf: () => [{ startLine: 2, endLine: 2, kind: 'if' }],
        isTypeOnly: () => false,
        ...SAFE_CANARY,
      });
      assert.strictEqual(verdict.exitCode, 1);
      assert.deepStrictEqual(verdict.offenders, ['mod/branchGap.ts: не покрыто — ветки на строках 2']);
    });
  }

  for (const taken of ['1', '3']) {
    // '3' здесь представляет условное «>1» из Части 3 п.2 брифа: в реальном
    // lcov `taken` — неотрицательное целое число попаданий (не буквальная
    // строка «>1»); важно лишь, что ЛЮБОЕ число ≥1 считается покрытой веткой.
    test(`buildVerdict: BRDA.taken='${taken}' (покрыта) на пересекающемся диапазоне → 0`, () => {
      const lcov = m().parseLcov(lcovBlock('mod/branchOk.ts', [[1, 1], [2, 1]], [[2, 0, 0, taken], [2, 0, 1, taken]]));
      const verdict = m().buildVerdict({
        changed: [{ rel: 'mod/branchOk.ts', isNew: false }],
        targetLinesOf: () => new Set([2]),
        lcov,
        branchRangesOf: () => [{ startLine: 2, endLine: 2, kind: 'if' }],
        isTypeOnly: () => false,
        ...SAFE_CANARY,
      });
      assert.strictEqual(verdict.exitCode, 0);
      assert.deepStrictEqual(verdict.offenders, []);
    });
  }

  // ---- Ключевой анти-ложно-красный тест: многострочный тернарник ---------

  test('АНТИ-ЛОЖНЫЙ-КРАСНЫЙ: многострочный тернарник, BRDA стоит на строке `?` (не на изменённой строке `cond`) — 0', () => {
    // Реальный детектор (branchFacts.mjs), реальный TS-фрагмент — не ручной
    // диапазон: тест обязан доказывать, что ИНТЕГРАЦИЯ с настоящим AST-детектором
    // не даёт ложного красного на многострочных конструкциях.
    const source = ['export const y = cond', '  ? a', '  : b;'].join('\n');
    const ranges = bf().branchRangesOfSource(source, 'mod/ternary.ts');
    assert.deepStrictEqual(ranges, [{ startLine: 1, endLine: 3, kind: 'conditional' }], 'предпосылка теста: диапазон детектора должен быть [1,3]');

    const lcov = m().parseLcov(lcovBlock('mod/ternary.ts', [[1, 1], [2, 1], [3, 1]], [[2, 0, 0, '4'], [2, 0, 1, '3']]));
    const verdict = m().buildVerdict({
      // «Изменена» только строка 1 (cond) — диффом это выглядело бы как
      // однострочная правка, BRDA при этом физически стоит на строке 2 (`?`).
      changed: [{ rel: 'mod/ternary.ts', isNew: false }],
      targetLinesOf: () => new Set([1]),
      lcov,
      branchRangesOf: (rel) => bf().branchRangesOfSource(source, rel),
      isTypeOnly: () => false,
      ...SAFE_CANARY,
    });
    assert.strictEqual(verdict.exitCode, 0, `ложный красный: ${JSON.stringify(verdict.offenders)}`);
    assert.deepStrictEqual(verdict.offenders, []);
  });

  test('тот же многострочный тернарник, но BRDA.taken=0 на строке `?` — ДЕЙСТВИТЕЛЬНО непокрыт (не всегда 0)', () => {
    // Контрольная пара к предыдущему тесту: доказывает, что зелёный там — не
    // потому что проверка вообще ничего не делает, а потому что ветка реально
    // покрыта. Здесь с тем же диапазоном, но taken='0', обязан быть exitCode=1.
    const source = ['export const y = cond', '  ? a', '  : b;'].join('\n');
    const lcov = m().parseLcov(lcovBlock('mod/ternaryGap.ts', [[1, 1], [2, 1], [3, 1]], [[2, 0, 0, '4'], [2, 0, 1, '0']]));
    const verdict = m().buildVerdict({
      changed: [{ rel: 'mod/ternaryGap.ts', isNew: false }],
      targetLinesOf: () => new Set([1]),
      lcov,
      branchRangesOf: (rel) => bf().branchRangesOfSource(source, rel),
      isTypeOnly: () => false,
      ...SAFE_CANARY,
    });
    assert.strictEqual(verdict.exitCode, 1);
    assert.deepStrictEqual(verdict.offenders, ['mod/ternaryGap.ts: не покрыто — ветки на строках 2']);
  });

  // ---- Анти-регресс: switch-диспетчер, правка заголовка -------------------

  test('АНТИ-РЕГРЕСС (switch): правка ТОЛЬКО строки-заголовка switch не порождает диапазон → ветки не проверяются, exitCode=0', () => {
    // Блокер из ревью: старый детектор давал ОДИН диапазон-заголовок switch,
    // а v8-to-istanbul кладёт BRDA на строки case-клауз — диапазон заголовка
    // не совпадал НИКОГДА (замерено: 1 попадание против 25 промахов на
    // реальном lcov.info). После фикса детектор выдаёт диапазон НА КАЖДУЮ
    // case-клаузу, а не на заголовок — правка заголовка (например, переименование
    // дискриминанта) законно не пересекается ни с одним диапазоном.
    const source = [
      'export function dispatch(kind: string): number {',
      '  switch (kind) {',
      "    case 'a':",
      '      return 1;',
      "    case 'b':",
      '      return 2;',
      '    default:',
      '      return 0;',
      '  }',
      '}',
    ].join('\n');
    const ranges = bf().branchRangesOfSource(source, 'mod/dispatch.ts');
    assert.ok(
      ranges.every((r) => r.startLine !== 2 && r.endLine !== 2),
      `диапазоны не должны включать строку заголовка switch (2): ${JSON.stringify(ranges)}`
    );

    const lcov = m().parseLcov(
      lcovBlock(
        'mod/dispatch.ts',
        [[1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1], [7, 1], [8, 1], [9, 1], [10, 1]],
        [[3, 0, 0, '1'], [5, 0, 1, '1']]
      )
    );
    const verdict = m().buildVerdict({
      changed: [{ rel: 'mod/dispatch.ts', isNew: false }],
      // «Изменена» только строка заголовка switch (2) — типичный дифф
      // переименования дискриминанта, тела case не тронуты.
      targetLinesOf: () => new Set([2]),
      lcov,
      branchRangesOf: (rel) => bf().branchRangesOfSource(source, rel),
      isTypeOnly: () => false,
      ...SAFE_CANARY,
    });
    assert.strictEqual(verdict.exitCode, 0, `ложный красный на правке заголовка switch: ${JSON.stringify(verdict.offenders)}`);
    assert.deepStrictEqual(verdict.offenders, []);
  });

  // ---- Канарейка: три доли (0 / ровно порог / порог+1) --------------------

  function cleanSingleFileArgs(overrides: Partial<BuildVerdictArgs>): BuildVerdictArgs {
    const lcov = m().parseLcov(lcovBlock('clean/canary.ts', [[1, 1]]));
    return {
      changed: [{ rel: 'clean/canary.ts', isNew: true }],
      targetLinesOf: () => new Set([1]),
      lcov,
      branchRangesOf: () => [],
      isTypeOnly: () => false,
      degradedShare: 0,
      degradedMaxShare: 1,
      ...overrides,
    };
  }

  test('канарейка: доля=0 → 0', () => {
    const verdict = m().buildVerdict(cleanSingleFileArgs({ degradedShare: 0, degradedMaxShare: 0 }));
    assert.strictEqual(verdict.exitCode, 0);
  });

  test('канарейка: доля РОВНО НА ПОРОГЕ (share === max) → 0 (граница включительная)', () => {
    const verdict = m().buildVerdict(cleanSingleFileArgs({ degradedShare: 0.5, degradedMaxShare: 0.5 }));
    assert.strictEqual(verdict.exitCode, 0);
  });

  test('канарейка: доля выше порога на «один файл» (0.6 против порога 0.5 = 5/10) → exitCode=2, отдельный offender', () => {
    const verdict = m().buildVerdict(cleanSingleFileArgs({ degradedShare: 0.6, degradedMaxShare: 0.5 }));
    assert.strictEqual(verdict.exitCode, 2);
    assert.strictEqual(verdict.offenders.length, 1);
    assert.ok(verdict.offenders[0]?.toUpperCase().includes('ДЕГРАДАЦ'), `неожиданный формат: ${verdict.offenders[0]}`);
  });

  // ---- Смешанный приоритет: exit=2 главенствует над exit=1 ---------------

  test('смешанный сценарий: один файл даёт «1» (непокрытая строка), другой — «2» (нет данных о ветках) → итог 2, ОБА offender-а присутствуют в порядке changed', () => {
    const lcovA = m().parseLcov(lcovBlock('mixed/a.ts', [[1, 1], [2, 0]]));
    const lcovB = m().parseLcov(lcovBlock('mixed/b.ts', [[1, 1], [2, 1]]));
    const merged = new Map<string, LcovFileEntry>([...lcovA, ...lcovB]);

    const verdict = m().buildVerdict({
      changed: [
        { rel: 'mixed/a.ts', isNew: false },
        { rel: 'mixed/b.ts', isNew: false },
      ],
      // Целевая строка одинаковая (2) в обоих файлах — параметр `rel` здесь не
      // используется намеренно, различие между файлами задаётся branchRangesOf.
      targetLinesOf: () => new Set([2]),
      lcov: merged,
      branchRangesOf: (rel) => (rel === 'mixed/b.ts' ? [{ startLine: 2, endLine: 2, kind: 'if' }] : []),
      isTypeOnly: () => false,
      ...SAFE_CANARY,
    });

    assert.strictEqual(verdict.exitCode, 2, 'exitCode=2 обязан главенствовать над локальным exitCode=1 у mixed/a.ts');
    // Точный текст «НЕТ ДАННЫХ О ВЕТКАХ» уже проверен отдельным тестом выше —
    // здесь важны ПОРЯДОК (mixed/a.ts ПЕРЕД mixed/b.ts, как в `changed`) и то,
    // что оба offender-а присутствуют ОДНОВРЕМЕННО, а не подавляют друг друга.
    assert.strictEqual(verdict.offenders.length, 2, `оба offender-а обязаны попасть в вывод: ${JSON.stringify(verdict.offenders)}`);
    assert.strictEqual(verdict.offenders[0], 'mixed/a.ts: не покрыто — строки 2');
    assert.ok(verdict.offenders[1]?.startsWith('mixed/b.ts: НЕТ ДАННЫХ О ВЕТКАХ'), `неожиданный формат: ${verdict.offenders[1]}`);
  });
});
