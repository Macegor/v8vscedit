import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { importEsmModule, isModuleNotFoundError } from './support/importEsm';

/**
 * Калибровка канарейки деградации (`summarizeBranchCoverage` из
 * `scripts/patch-coverage/verdict.mjs`) на РЕАЛЬНОМ срезе покрытия,
 * зафиксированном оркестратором в `src/test/fixtures/coverage/lcov-degraded-sample.info`.
 *
 * Этот срез — не синтетика: он снят с реального деградированного прогона
 * (долгоживущий процесс тестов теряет поблочную детализацию), содержит 30
 * файлов, из которых лишь у 10 есть хоть одна запись `BRDA:` (измерено
 * оркестратором прогоном на прототипе: 85 из 263 в исходном полном прогоне —
 * тот же класс потери, воспроизведённый здесь в уменьшенном виде). После
 * починки гейта (дробление на шарды) этот файл станет невоспроизводим —
 * именно поэтому он закоммичен как снимок, а не генерируется тестом заново.
 *
 * Тест обязан ДОКАЗЫВАТЬ, что метрика различает здоровый и деградированный
 * прогон (а не просто что-то умеет посчитать) — поэтому ниже есть и здоровый
 * контрольный пример с долей 0.
 *
 * ВАЖНО (возврат ревьюера): исходники детектор читает НЕ с живого `src/`, а
 * из ЗАМОРОЖЕННОЙ копии `src/test/fixtures/coverage/branch-calibration-sources/`
 * (те же 30 файлов, тот же относительный путь, снятые ОДНИМ моментом вместе
 * с lcov-снимком выше). Раньше калибровка читала `src/` напрямую — числа
 * 24/15/0.625 были миной для ЛЮБОЙ другой задачи, которая случайно добавит
 * или уберёт `if`/`&&`/тернарник в одном из этих 30 файлов (например,
 * `ProjectLayout.ts`, у которого сегодня веток нет вовсе — из-за этого
 * калибровка держится на 24, а не на 25). Заморозка исходников делает
 * калибровку зависимой ТОЛЬКО от зафиксированных артефактов этой фикстуры.
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

interface BranchFactsModule {
  branchRangesOfSource(text: string, fileName: string): BranchRange[];
}

interface VerdictModule {
  parseLcov(text: string): Map<string, LcovFileEntry>;
  summarizeBranchCoverage(args: {
    lcov: Map<string, LcovFileEntry>;
    branchRangesOf: (rel: string) => BranchRange[] | null;
  }): BranchSummary;
}

const ROOT = path.resolve(__dirname, '../../../');
const BRANCH_FACTS_PATH = path.resolve(ROOT, 'scripts/patch-coverage/branchFacts.mjs');
const VERDICT_PATH = path.resolve(ROOT, 'scripts/patch-coverage/verdict.mjs');
const FIXTURE_LCOV = path.resolve(ROOT, 'src/test/fixtures/coverage/lcov-degraded-sample.info');
// Замороженная копия исходников — калибровка НЕ зависит от текущего состояния
// живого src/ (см. обоснование в шапке файла).
const FROZEN_SOURCES_ROOT = path.resolve(ROOT, 'src/test/fixtures/coverage/branch-calibration-sources');
// Суффикс `.snapshot`: `tsconfig.test.json` компилирует ВЕСЬ `src/**/*`, и без
// суффикса tsc пытался бы типизировать эти копии как настоящие модули со
// своими относительными импортами (которые внутри `fixtures/` не резолвятся) —
// это данные для чтения текстом, а не код для сборки.
function frozenSourcePath(rel: string): string {
  return path.resolve(FROZEN_SOURCES_ROOT, `${rel}.snapshot`);
}

suite('калибровка канарейки деградации — реальный срез lcov-degraded-sample.info (T-coverage-gate)', () => {
  let branchFacts: BranchFactsModule | undefined;
  let verdict: VerdictModule | undefined;
  let loadError: unknown;

  suiteSetup(async () => {
    try {
      branchFacts = await importEsmModule<BranchFactsModule>(BRANCH_FACTS_PATH);
      verdict = await importEsmModule<VerdictModule>(VERDICT_PATH);
    } catch (err) {
      if (!isModuleNotFoundError(err)) {
        throw err;
      }
      loadError = err;
    }
  });

  test('модули branchFacts.mjs и verdict.mjs существуют', () => {
    assert.ok(branchFacts && verdict, `модули ещё не реализованы (ожидаемо на фазе «красный» TDD): ${String(loadError)}`);
  });

  function requireModules(): { branchFacts: BranchFactsModule; verdict: VerdictModule } {
    if (!branchFacts || !verdict) {
      assert.fail('branchFacts.mjs/verdict.mjs не реализованы — см. первый тест');
    }
    return { branchFacts, verdict };
  }

  test('фикстура lcov-degraded-sample.info присутствует и содержит ровно 30 файлов (30 SF-записей)', () => {
    // Проверяем саму фикстуру независимо от детектора — если она пуста/повреждена,
    // остальные проверки калибровки не имеют смысла.
    const text = fs.readFileSync(FIXTURE_LCOV, 'utf-8');
    const sfCount = text.split('\n').filter((l) => l.startsWith('SF:')).length;
    assert.strictEqual(sfCount, 30, 'фикстура должна содержать ровно 30 SF-записей (снимок 10 «здоровых» + 20 «деградировавших» файлов)');
  });

  test('замороженная копия исходников содержит ВСЕ 30 файлов, названных в lcov-снимке (по тем же относительным путям)', () => {
    // Если заморозку когда-нибудь пополнят частично (например, только новыми
    // файлами будущей задачи), калибровка должна упасть здесь явно, а не
    // молча получить summary.totalFiles < 30 из-за branchRangesOf(null).
    const text = fs.readFileSync(FIXTURE_LCOV, 'utf-8');
    const relPaths = text
      .split('\n')
      .filter((l) => l.startsWith('SF:'))
      .map((l) => l.slice(3));
    assert.strictEqual(relPaths.length, 30);
    for (const rel of relPaths) {
      const abs = frozenSourcePath(rel);
      assert.ok(fs.existsSync(abs), `в заморозке отсутствует файл из lcov-снимка: ${rel} (ожидался ${abs})`);
    }
  });

  test('на реальном срезе: доля файлов-без-BRDA-при-найденных-ветвлениях — ВЫСОКАЯ (0.625 = 15 из 24)', () => {
    const { branchFacts: bf, verdict: v } = requireModules();
    const lcovText = fs.readFileSync(FIXTURE_LCOV, 'utf-8');
    const lcov = v.parseLcov(lcovText);
    assert.strictEqual(lcov.size, 30, 'parseLcov обязан разобрать все 30 SF-записей фикстуры');

    function branchRangesOf(rel: string): BranchRange[] | null {
      // Читаем ИЗ ЗАМОРОЖЕННОЙ копии, а не из живого src/ — см. шапку файла.
      const abs = frozenSourcePath(rel);
      if (!fs.existsSync(abs)) {
        return null;
      }
      return bf.branchRangesOfSource(fs.readFileSync(abs, 'utf-8'), abs);
    }

    const summary = v.summarizeBranchCoverage({ lcov, branchRangesOf });

    // Числа сняты фактическим прогоном детектора по 30 реальным файлам эталона
    // (см. обоснование в шапке файла и в CLAUDE.md); если детектор станет точнее
    // или консервативнее — эти числа изменятся осознанно, а не молча.
    assert.strictEqual(summary.totalFiles, 30);
    assert.strictEqual(summary.filesWithBranches, 24, '9 «здоровых» (из 10, projectLayout.ts без ветвлений) + 15 «деградировавших» (из 20)');
    assert.strictEqual(summary.filesWithoutBranchData, 15);
    assert.ok(
      Math.abs(summary.share - 15 / 24) < 1e-9,
      `доля деградации обязана быть ровно 15/24=0.625, получено ${String(summary.share)}`
    );
    // Ключевое утверждение задачи: доля ВЫСОКАЯ, а не близкая к нулю на «нормальном» срезе.
    assert.ok(summary.share > 0.5, 'доля деградации на реальном срезе обязана быть выше 50% — это и есть измеренный дефект');
  });

  test('контраст: на СИНТЕТИЧЕСКОМ здоровом срезе (BRDA есть у каждой найденной ветки) доля — 0', () => {
    // Без этого контрольного примера предыдущий тест мог бы проходить и на
    // метрике, которая всегда возвращает число >0.5 независимо от входа —
    // это тест на то, что метрика РЕАГИРУЕТ на состояние данных, а не константа.
    const { branchFacts: bf, verdict: v } = requireModules();

    const sources = new Map<string, string>([
      [
        'virtual/healthyA.ts',
        ['export function f(a: number): number {', '  if (a > 0) {', '    return 1;', '  }', '  return 0;', '}'].join('\n'),
      ],
      ['virtual/healthyB.ts', 'export const c = a && b;'],
    ]);

    const lcovText = [
      'TN:',
      'SF:virtual/healthyA.ts',
      'DA:1,1',
      'DA:2,1',
      'DA:3,1',
      'DA:4,1',
      'DA:5,1',
      'DA:6,1',
      'LF:6',
      'LH:6',
      'BRDA:2,0,0,1',
      'BRDA:2,0,1,1',
      'BRF:2',
      'BRH:2',
      'end_of_record',
      'TN:',
      'SF:virtual/healthyB.ts',
      'DA:1,1',
      'LF:1',
      'LH:1',
      'BRDA:1,0,0,1',
      'BRDA:1,0,1,1',
      'BRF:2',
      'BRH:2',
      'end_of_record',
    ].join('\n');

    const lcov = v.parseLcov(lcovText);
    function branchRangesOf(rel: string): BranchRange[] | null {
      const text = sources.get(rel);
      if (text === undefined) {
        return null;
      }
      return bf.branchRangesOfSource(text, rel);
    }

    const summary = v.summarizeBranchCoverage({ lcov, branchRangesOf });
    assert.strictEqual(summary.filesWithBranches, 2);
    assert.strictEqual(summary.filesWithoutBranchData, 0);
    assert.strictEqual(summary.share, 0);
  });
});
