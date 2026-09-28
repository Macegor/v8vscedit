import * as assert from 'assert';
import * as path from 'path';
import { importEsmModule, isModuleNotFoundError } from './support/importEsm';

/**
 * Тесты `scripts/patch-coverage/diffBase.mjs` (`resolveDiffBase`, `addedLines`) —
 * ЕЩЁ НЕ СУЩЕСТВУЕТ на фазе «красный» (возврат ревьюера: эта логика сейчас
 * инлайнится в `scripts/patch-coverage.mjs` как побочный эффект верхнего уровня
 * модуля — читает `process.env`, спавнит `git` напрямую — и потому НИЧЕМ не
 * покрыта, хотя именно в ней уже нашлись 3 из 4 известных дефектов гейта
 * (включая недавний фикс «задача только с новыми файлами не должна уезжать на
 * origin/main»). Оркестратор выносит обе функции сюда ЧИСТЫМИ — I/O
 * (собственно `git`, чтение `process.env`) внедряется параметрами.
 *
 * КОНТРАКТ:
 *
 * `resolveDiffBase({ env, untracked, upstreams, mergeBaseOf, modifiedAgainst })`
 * (`mergeBaseOf` — расширение сигнатуры сверх дословного списка брифа
 * `{ untracked, modifiedAgainst, upstreams, env }`: без отдельной функции
 * получения SHA точки расхождения `modifiedAgainst` физически нечем вызвать —
 * ей нужна КОНКРЕТНАЯ база для `git diff --name-only <base>`, а «ветка
 * недоступна» — паттерн `undefined`, отдельный от «доступна, но пустой diff»):
 *   - `env.COVERAGE_BASE` (после `.trim()`) непусто → он и есть база, `why`
 *     называет переменную; `mergeBaseOf`/`modifiedAgainst` НЕ вызываются;
 *   - иначе перебор `upstreams` В ЗАДАННОМ ПОРЯДКЕ: `mergeBaseOf(upstream)`
 *     — `undefined` (ветка недоступна) → пропустить; иначе если
 *     `untracked.length + modifiedAgainst(mergeBase).length > 0` — ПРИНЯТЬ
 *     эту базу (короткое замыкание, следующие upstream не проверяются);
 *   - ни один upstream не принят → `{ base: 'HEAD', why: '...недоступна...' }`.
 *   Ключевое: `untracked` участвует в критерии принятия НАРАВНЕ с
 *   `modifiedAgainst` — задача, добавившая только НОВЫЕ файлы (нулевой
 *   `git diff --name-only`), обязана остаться на первом доступном upstream,
 *   а не уехать на `origin/main` и унаследовать чужой долг покрытия.
 *
 * `addedLines(diffText)` — парсер ханков `@@ -a[,c] +b[,d] @@` из
 * `git diff --unified=0`: возвращает `Set<number>` добавленных номеров строк
 * `b..b+d-1` (при отсутствии `,d` считать d=1; `,0` — чистое удаление, ханк не
 * добавляет строк).
 */

interface DiffBaseResult {
  readonly base: string;
  readonly why: string;
}

interface DiffBaseModule {
  resolveDiffBase(args: {
    env: Record<string, string | undefined>;
    untracked: string[];
    upstreams: string[];
    mergeBaseOf: (upstream: string) => string | undefined;
    modifiedAgainst: (base: string) => string[];
  }): DiffBaseResult;
  addedLines(diffText: string): Set<number>;
}

const MODULE_PATH = path.resolve(__dirname, '../../../scripts/patch-coverage/diffBase.mjs');

function throwingUpstreamFn(label: string): (arg: string) => never {
  return () => {
    throw new Error(`не должно быть вызвано в этом сценарии: ${label}`);
  };
}

suite('diffBase.mjs — resolveDiffBase/addedLines (T-coverage-gate)', () => {
  let mod: DiffBaseModule | undefined;
  let loadError: unknown;

  suiteSetup(async () => {
    try {
      mod = await importEsmModule<DiffBaseModule>(MODULE_PATH);
    } catch (err) {
      if (!isModuleNotFoundError(err)) {
        throw err;
      }
      loadError = err;
    }
  });

  test('модуль scripts/patch-coverage/diffBase.mjs существует и экспортирует resolveDiffBase/addedLines', () => {
    assert.ok(mod, `diffBase.mjs ещё не реализован (ожидаемо на фазе «красный» TDD): ${String(loadError)}`);
  });

  function m(): DiffBaseModule {
    if (!mod) {
      assert.fail('diffBase.mjs не реализован — см. первый тест');
    }
    return mod;
  }

  // ---- resolveDiffBase ---------------------------------------------------

  test('resolveDiffBase: COVERAGE_BASE задан явно → база берётся из него, git-функции НЕ вызываются', () => {
    const result = m().resolveDiffBase({
      env: { COVERAGE_BASE: 'refs/my-custom-base' },
      untracked: [],
      upstreams: ['origin/develop', 'origin/main'],
      mergeBaseOf: throwingUpstreamFn('mergeBaseOf'),
      modifiedAgainst: throwingUpstreamFn('modifiedAgainst'),
    });
    assert.strictEqual(result.base, 'refs/my-custom-base');
    assert.ok(result.why.includes('COVERAGE_BASE'), `why обязан называть переменную: ${result.why}`);
  });

  test('resolveDiffBase: COVERAGE_BASE из одних пробелов после trim() пуст → игнорируется, идёт обычный перебор upstream', () => {
    const result = m().resolveDiffBase({
      env: { COVERAGE_BASE: '   ' },
      untracked: [],
      upstreams: ['origin/develop'],
      mergeBaseOf: () => 'sha-develop',
      modifiedAgainst: () => ['a.ts'],
    });
    assert.strictEqual(result.base, 'sha-develop', 'пустой после trim() COVERAGE_BASE не должен подменять собой обычный алгоритм');
  });

  test('resolveDiffBase: origin/develop даёт непустой modifiedAgainst → выбирается develop, origin/main НЕ проверяется (короткое замыкание)', () => {
    let mainCalled = false;
    function modifiedAgainst(base: string): string[] {
      if (base !== 'sha-develop') {
        throw new Error('modifiedAgainst(main) не должен вызываться — develop принят первым');
      }
      return ['a.ts'];
    }
    const result = m().resolveDiffBase({
      env: {},
      untracked: [],
      upstreams: ['origin/develop', 'origin/main'],
      mergeBaseOf: (upstream) => {
        if (upstream === 'origin/main') {
          mainCalled = true;
        }
        return upstream === 'origin/develop' ? 'sha-develop' : 'sha-main';
      },
      modifiedAgainst,
    });
    assert.strictEqual(result.base, 'sha-develop');
    assert.ok(result.why.includes('origin/develop'), `why обязан называть upstream: ${result.why}`);
    assert.strictEqual(mainCalled, false, 'origin/main не должен даже опрашиваться на mergeBase после принятия develop');
  });

  test('resolveDiffBase: набор по develop пуст (и untracked пуст) → берётся origin/main', () => {
    const result = m().resolveDiffBase({
      env: {},
      untracked: [],
      upstreams: ['origin/develop', 'origin/main'],
      mergeBaseOf: (upstream) => (upstream === 'origin/develop' ? 'sha-develop' : 'sha-main'),
      modifiedAgainst: (base) => (base === 'sha-develop' ? [] : ['b.ts']),
    });
    assert.strictEqual(result.base, 'sha-main');
    assert.ok(result.why.includes('origin/main'), `why обязан называть upstream: ${result.why}`);
  });

  test('resolveDiffBase: обе ветки интеграции недоступны (mergeBaseOf → undefined для всех) → HEAD', () => {
    const result = m().resolveDiffBase({
      env: {},
      untracked: [],
      upstreams: ['origin/develop', 'origin/main'],
      mergeBaseOf: () => undefined,
      modifiedAgainst: throwingUpstreamFn('modifiedAgainst'),
    });
    assert.strictEqual(result.base, 'HEAD');
    assert.ok(result.why.includes('недоступна') || result.why.toLowerCase().includes('head'), `why обязан объяснять фолбэк: ${result.why}`);
  });

  test('resolveDiffBase: пустой список upstreams → сразу HEAD, mergeBaseOf ни разу не вызывается (0 итераций)', () => {
    const result = m().resolveDiffBase({
      env: {},
      untracked: [],
      upstreams: [],
      mergeBaseOf: throwingUpstreamFn('mergeBaseOf'),
      modifiedAgainst: throwingUpstreamFn('modifiedAgainst'),
    });
    assert.strictEqual(result.base, 'HEAD');
  });

  test('resolveDiffBase: порядок upstream берётся ИЗ АРГУМЕНТА, а не зашит внутри — develop вторым в списке тоже находится', () => {
    const result = m().resolveDiffBase({
      env: {},
      untracked: [],
      upstreams: ['origin/main', 'origin/develop'],
      mergeBaseOf: (upstream) => (upstream === 'origin/develop' ? 'sha-develop' : undefined),
      modifiedAgainst: () => ['a.ts'],
    });
    assert.strictEqual(result.base, 'sha-develop');
    assert.ok(result.why.includes('origin/develop'));
  });

  test('ПОЧИНЕННЫЙ ДЕФЕКТ: задача ТОЛЬКО с новыми (untracked) файлами и ПУСТЫМ modifiedAgainst остаётся на develop, не уезжает на main', () => {
    // Раньше критерий принятия upstream смотрел ТОЛЬКО на modifiedAgainst —
    // если он пуст, база молча уезжала на origin/main, даже когда есть только
    // новые untracked-файлы (у которых modifiedAgainst всегда 0, это git diff,
    // а не git status). Итог — гейт вменял задаче долг покрытия ВСЕЙ ветки main.
    let mainMergeBaseOfCalled = false;
    const result = m().resolveDiffBase({
      env: {},
      untracked: ['src/infra/new/BrandNewService.ts'],
      upstreams: ['origin/develop', 'origin/main'],
      mergeBaseOf: (upstream) => {
        if (upstream === 'origin/main') {
          mainMergeBaseOfCalled = true;
        }
        return upstream === 'origin/develop' ? 'sha-develop' : 'sha-main';
      },
      modifiedAgainst: () => [],
    });
    assert.strictEqual(result.base, 'sha-develop', 'задача только с новыми файлами обязана остаться на develop');
    assert.strictEqual(mainMergeBaseOfCalled, false, 'origin/main не должен даже опрашиваться — develop принят по untracked');
  });

  // ---- addedLines ---------------------------------------------------------

  test('addedLines: "@@ -a +b @@" (оба счётчика опущены) → одна добавленная строка b', () => {
    const lines = m().addedLines('@@ -10 +20 @@\n+content\n');
    assert.deepStrictEqual([...lines].sort((a, b) => a - b), [20]);
  });

  test('addedLines: "@@ -a,c +b,d @@" → строки b..b+d-1', () => {
    const lines = m().addedLines('@@ -5,2 +8,3 @@\n+a\n+b\n+c\n');
    assert.deepStrictEqual([...lines].sort((a, b) => a - b), [8, 9, 10]);
  });

  test('addedLines: "@@ -a,c +b,0 @@" (чистое удаление, d=0) — ноль добавленных строк из этого ханка', () => {
    const lines = m().addedLines('@@ -5,3 +7,0 @@\n-removed1\n-removed2\n-removed3\n');
    assert.deepStrictEqual([...lines], []);
  });

  test('addedLines: несколько ханков в одном диффе — объединение всех', () => {
    const diff = [
      'diff --git a/foo.ts b/foo.ts',
      'index abc123..def456 100644',
      '--- a/foo.ts',
      '+++ b/foo.ts',
      '@@ -10 +10,2 @@',
      '+added line 1',
      '+added line 2',
      '@@ -20,2 +21 @@',
      '-removed line',
      '',
    ].join('\n');
    const lines = m().addedLines(diff);
    assert.deepStrictEqual([...lines].sort((a, b) => a - b), [10, 11, 21]);
  });

  test('addedLines: пустой diff-текст → пустое множество', () => {
    assert.deepStrictEqual([...m().addedLines('')], []);
  });
});
