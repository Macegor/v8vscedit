// Patch-покрытие: 100% на коде, РЕАЛЬНО затронутом изменением, без ложных падений
// на легаси. Мотивация: глобальный `coverage --100` всегда красный из-за
// унаследованного долга, а гейт «весь изменённый файл → 100%» блокирует на старых
// непокрытых строках внутри модифицированного файла. Правильный критерий —
// покрытие самого патча (industry-standard patch coverage).
//
// Правила:
//   • НОВЫЙ файл (неотслеживаемый) — все исполняемые строки должны быть покрыты (=100%).
//   • МОДИФИЦИРОВАННЫЙ файл — покрыты должны быть только ДОБАВЛЕННЫЕ/изменённые строки
//     (из `git diff -U0 HEAD`); легаси-строки того же файла не трогаем.
//   • Чисто-типовой файл и composition root (Container/extension) — вне гейта.
//
// Этот файл — ТОНКИЙ оркестратор (git, спавны, ФС, печать). Вся решающая логика
// живёт в `scripts/patch-coverage/*.mjs` и покрыта тестами:
//   • branchFacts.mjs — какие ветвления есть в исходнике (AST TypeScript);
//   • diffBase.mjs    — выбор базы сравнения и разбор добавленных строк;
//   • verdict.mjs     — разбор lcov, канарейка достоверности, сам вердикт;
//   • shards.mjs      — планирование порций прогона и сверка их отчётов.
//
// Прогон тестов дробится на несколько СВЕЖИХ процессов: замерено на сыром
// NODE_V8_COVERAGE (functions[].isBlockCoverage), что долгоживущий процесс тестов
// теряет поблочную детализацию целиком (полный прогон — 615 скриптов и 0 блочных,
// короткий — 1224 скрипта и 1219 блочных). Без дробления lcov не содержит записей
// BRDA у большинства файлов, и «покрытие веток» превращается в молчаливый
// ложно-зелёный: в прежнем прогоне BRDA были лишь у 85 файлов из 263.
//
// Использование: `npm run coverage:changed` (стадия qa-e2e TDD-конвейера).

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { globSync } from 'glob';
import { branchRangesOfSource } from './patch-coverage/branchFacts.mjs';
import { parseLcov, summarizeBranchCoverage, buildVerdict } from './patch-coverage/verdict.mjs';
import { planShards, verifyShardReports } from './patch-coverage/shards.mjs';
import { resolveDiffBase, addedLines } from './patch-coverage/diffBase.mjs';

const ROOT = process.cwd();
const TMP_DIR = path.join(ROOT, 'coverage', 'tmp');
// Манифесты и отчёты шардов лежат ВНЕ coverage/tmp: c8 разбирает в temp-каталоге
// всё подряд как свои JSON-профили и давится чужим форматом.
const SHARD_DIR = path.join(ROOT, 'coverage', 'shards');
// Замерено на этом наборе тестов: потеря поблочной детализации — свойство
// ПРОЦЕССА, а не отдельного файла. Один тест со сканом корпуса example/
// (typedFieldOwnerRoleRules) своим давлением на GC обнуляет блочное покрытие
// всего процесса целиком: шард из 40 тестовых файлов дал 0 блочных скриптов и
// 0 записей BRDA по всем 160 файлам lcov — а вместе с ними и по всей своей
// алфавитной окрестности (тесты и их production-файлы соседствуют по имени).
// Порции по ~20 файлов эту катастрофу не воспроизводят (доля блочных 0.76–0.90),
// поэтому дефолт — 8, а не 4: при 4 шардах гейт «слеп» к веткам целого
// алфавитного среза проекта, включая собственные модули scripts/patch-coverage/.
const SHARD_COUNT = Number(process.env.COVERAGE_SHARDS ?? '8');
// Порог канарейки: доля файлов, у которых детектор нашёл ветвления, а lcov не дал
// ни одной записи BRDA. На здоровом (дроблёном) прогоне доля мала и объясняется
// консервативностью детектора; резкий рост означает возврат потери блочной
// детализации, то есть недостоверность всего вердикта по веткам.
const MAX_DEGRADED_SHARE = Number(process.env.COVERAGE_MAX_DEGRADED ?? '0.25');

function git(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf-8' });
  } catch {
    return '';
  }
}

// Container/extension исполняются в Extension Host, который c8 не инструментирует
// (тонкие адаптеры, покрываются интеграционно) — из гейта исключены.
// Тот же класс уникально-неинструментируемых оркестраторов:
//   • src/cli/onec-tools.ts — самовыполняющаяся точка входа CLI (`void main()` на
//     верхнем уровне модуля), исполняется только как отдельный процесс
//     `node dist/cli/onec-tools.js`; покрывается E2E-тестом
//     src/test/suite/cliProcess.test.ts (спавн собранного бинарника), но c8 не
//     видит её из-за exclude dist/** до source-map ремапа.
//   • src/cli/commands/listDbExtensions.ts — CLI-оркестратор спавна реального
//     Конфигуратора 1С; в CI в процесс не загружается (только через тот же спавн
//     бинарника), поэтому lcov-записи нет вовсе. Вся тестируемая логика (разбор
//     вывода) вынесена в infra/environment/ExtensionListParser.ts (100%).
//   • src/ui/commands/ext/ExtensionCommands.ts — регистрация vscode-команд,
//     исполняется только в Extension Host при активации (как Container/extension);
//     решающая логика выбора вынесена в planExtensionChoices (100%). Ср.:
//     инструментируется лишь ExtensionCommandRunner.ts (извлечённая логика).
//   • scripts/patch-coverage.mjs — сам оркестратор гейта. В процесс тестов он не
//     загружается вовсе (это ОН их и запускает), поэтому lcov-записи по нему нет
//     физически — как у Container.ts в Extension Host. Непокрытым остаётся именно
//     то, что нельзя выполнить внутри тестового процесса: вызовы `git`, спавн
//     шардов и `c8 report`, работа с ФС (temp-каталоги, манифесты, отчёты) и
//     печать. Вся решающая логика вынесена в scripts/patch-coverage/* (детектор
//     ветвлений, вердикт, планирование/сверка шардов, выбор базы диффа) и покрыта
//     тестами на 100%.
const NOT_INSTRUMENTED = new Set([
  'src/Container.ts',
  'src/extension.ts',
  'src/cli/onec-tools.ts',
  'src/cli/commands/listDbExtensions.ts',
  'src/ui/commands/ext/ExtensionCommands.ts',
  'scripts/patch-coverage.mjs',
]);

/**
 * Файлы в зоне гейта: production-исходники расширения и собственные модули
 * гейта (они грузятся в процесс тестов и инструментируются наравне с src/**).
 */
function isProdTs(f) {
  if (NOT_INSTRUMENTED.has(f)) {
    return false;
  }
  if (f.startsWith('scripts/patch-coverage/') && f.endsWith('.mjs')) {
    return true;
  }
  return f.startsWith('src/') && f.endsWith('.ts') && !f.startsWith('src/test/') && !f.endsWith('.d.ts');
}

const untracked = git(['ls-files', '--others', '--exclude-standard'])
  .split('\n')
  .map((s) => s.trim())
  .filter((f) => f && isProdTs(f) && existsSync(path.join(ROOT, f)));

/** Production-файлы, изменённые относительно указанной базы (без untracked). */
function modifiedAgainst(base) {
  return git(['diff', '--name-only', base])
    .split('\n')
    .map((s) => s.trim())
    .filter((f) => f && isProdTs(f) && !untracked.includes(f) && existsSync(path.join(ROOT, f)));
}

/**
 * SHA точки расхождения с веткой интеграции; `undefined` — ветка недоступна
 * (нет remote, свежий клон). Try/catch здесь не нужен и раньше был мёртвым
 * кодом: `git()` сам глотает ошибку процесса и возвращает пустую строку.
 * Глотание оставлено — пустой вывод и есть штатный признак «ветки нет», а
 * различать коды ошибок git тут нечем и незачем.
 */
function mergeBaseOf(upstream) {
  const sha = git(['merge-base', 'HEAD', upstream]).trim();
  return sha === '' ? undefined : sha;
}

const { base: DIFF_BASE, why: BASE_REASON } = resolveDiffBase({
  env: process.env,
  untracked,
  upstreams: ['origin/develop', 'origin/main'],
  mergeBaseOf,
  modifiedAgainst,
});

console.log(`[coverage:changed] База сравнения: ${DIFF_BASE} (${BASE_REASON}).`);

const modified = modifiedAgainst(DIFF_BASE);
const changed = [
  ...untracked.map((rel) => ({ rel, isNew: true })),
  ...modified.map((rel) => ({ rel, isNew: false })),
];

// Добавленные/изменённые строки модифицированного файла из unified=0 diff.
function addedLinesOf(rel) {
  return addedLines(git(['diff', '--unified=0', DIFF_BASE, '--', rel]));
}

// Эвристика «чисто-типового» файла (нет исполняемого кода → нет покрытия — это норма).
function isTypeOnly(rel) {
  // Факт вместо догадки: если TypeScript не породил для файла НИ ОДНОГО
  // исполняемого оператора, покрывать в нём нечего физически — c8 в принципе
  // не может дать по такому файлу lcov-запись. Текстовая эвристика ниже
  // оставлена лишь запасным вариантом: она гадает по виду строк и ломается,
  // например, на многострочной сигнатуре метода интерфейса (строка,
  // заканчивающаяся на `(`, и последний параметр без завершающей запятой).
  const emitted = readEmittedJs(rel);
  if (emitted !== null) {
    return emitted === '';
  }
  return looksTypeOnlyBySource(rel);
}

/**
 * Содержимое скомпилированного JS без служебной обвязки tsc (`use strict`,
 * пометка `__esModule`, комментарии, ссылка на sourcemap). Пустая строка —
 * файл не породил исполняемого кода. `null` — вывода нет (файл не
 * компилируется в `out/`, например webview из `src-ui/`).
 */
function readEmittedJs(rel) {
  if (!rel.startsWith('src/') || !rel.endsWith('.ts')) {
    return null;
  }
  const srcPath = path.join(ROOT, rel);
  const outPath = path.join(ROOT, 'out', rel.slice('src/'.length).replace(/\.ts$/, '.js'));
  if (!existsSync(outPath)) {
    return null;
  }
  // Устаревший emit врёт в САМУЮ опасную сторону: файл, который когда-то был
  // чисто-типовым, а с тех пор обзавёлся кодом, был бы классифицирован как
  // «покрывать нечего» и ТИХО выпал из гейта. Поэтому вывод старше исходника
  // не считается фактом — вызывающий уходит на текстовую эвристику, а она при
  // наличии кода даёт «не типовой», то есть покрытие всё-таки потребуется.
  // Ошибаться этот гейт обязан в красную сторону, а не в зелёную.
  try {
    if (statSync(outPath).mtimeMs < statSync(srcPath).mtimeMs) {
      return null;
    }
  } catch {
    // Исходник исчез между diff и проверкой — факта нет, решает эвристика.
    return null;
  }
  return readFileSync(outPath, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/["']use strict["'];?/g, '')
    .replace(/Object\.defineProperty\(exports,\s*["']__esModule["'],[^)]*\);?/g, '')
    .trim();
}

function looksTypeOnlyBySource(rel) {
  const stripped = readFileSync(path.join(ROOT, rel), 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  return stripped.every(
    (l) =>
      l.startsWith('import ') ||
      l.startsWith('export type') ||
      l.startsWith('export interface') ||
      l.startsWith('export {') ||
      l.startsWith('type ') ||
      l.startsWith('interface ') ||
      l === '}' ||
      /^[|&?]/.test(l) ||
      /[;,{]$/.test(l)
  );
}

const branchRangeCache = new Map();

/** Ветвления файла по его исходнику; null — исходник недоступен (удалён, вне репозитория). */
function branchRangesOfFile(rel) {
  if (branchRangeCache.has(rel)) {
    return branchRangeCache.get(rel);
  }
  const abs = path.resolve(ROOT, rel);
  let ranges = null;
  if (existsSync(abs)) {
    ranges = branchRangesOfSource(readFileSync(abs, 'utf-8'), abs);
  }
  branchRangeCache.set(rel, ranges);
  return ranges;
}

console.log('[coverage:changed] Проверяю patch-покрытие по файлам:');
for (const { rel, isNew } of changed) console.log(`  • (${isNew ? 'новый' : 'изменён'})`, rel);

function fail(message, code) {
  console.error(`[coverage:changed] ${message}`);
  process.exit(code);
}

// Пустой патч разрешается ДО прогона: гонять шарды ради заведомо известного
// вердикта — минуты впустую.
if (changed.length === 0) {
  const empty = buildVerdict({
    changed,
    targetLinesOf: () => new Set(),
    lcov: new Map(),
    branchRangesOf: () => [],
    isTypeOnly: () => false,
    degradedShare: 0,
    degradedMaxShare: MAX_DEGRADED_SHARE,
    allowEmptyChanged: process.env.COVERAGE_ALLOW_EMPTY === '1',
  });
  if (empty.exitCode === 0) {
    console.log(`[coverage:changed] GREEN — ${empty.summary}.`);
  } else {
    for (const o of empty.offenders) console.error('  ✗', o);
    console.error('[coverage:changed] Укажите базу явно (COVERAGE_BASE=<ref>) либо подтвердите пустой патч осознанно: COVERAGE_ALLOW_EMPTY=1.');
  }
  process.exit(empty.exitCode);
}

// 1. Сборка. Отдельным шагом, а не через `npm test` внутри каждого шарда:
// pretest не должен выполняться N раз.
const pretest = spawnSync('npm', ['run', 'pretest'], {
  cwd: ROOT,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (pretest.status !== 0) {
  fail('npm run pretest упал — сначала почини сборку.', pretest.status ?? 1);
}

// 2. Планирование шардов по скомпилированным тестовым файлам (тот же glob, что
// в src/test/suite/index.ts, — имена в манифесте обязаны совпадать буквально).
const testsRoot = path.join(ROOT, 'out', 'test', 'suite');
const allTestFiles = globSync('**/*.test.js', { cwd: testsRoot }).sort();
const shards = planShards(allTestFiles, SHARD_COUNT);
if (shards.length === 0) {
  fail('не найдено ни одного скомпилированного *.test.js — прогон бессмыслен.', 2);
}

// 3. Чистка temp-каталога V8 — РОВНО ОДИН РАЗ, до первого шарда. Чистка между
// шардами уничтожила бы профили предыдущих (их и надо слить), отсутствие
// чистки перед первым — подмешало бы мусор прошлого прогона.
rmSync(TMP_DIR, { recursive: true, force: true });
mkdirSync(TMP_DIR, { recursive: true });
rmSync(SHARD_DIR, { recursive: true, force: true });
mkdirSync(SHARD_DIR, { recursive: true });

const reports = [];
for (let i = 0; i < shards.length; i += 1) {
  const listPath = path.join(SHARD_DIR, `shard-${i}.txt`);
  const reportPath = path.join(SHARD_DIR, `report-${i}.json`);
  writeFileSync(listPath, `${shards[i].join('\n')}\n`, 'utf-8');
  console.log(`\n[coverage:changed] Шард ${i + 1}/${shards.length}: ${shards[i].length} файл(ов) тестов.`);
  const run = spawnSync('node', ['./out/test/runTests.js'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      NODE_V8_COVERAGE: TMP_DIR,
      MOCHA_SHARD_LIST: listPath,
      MOCHA_SHARD_REPORT: reportPath,
      MOCHA_SHARD_INDEX: String(i),
      MOCHA_SHARD_TOTAL: String(shards.length),
    },
  });
  // Падение шарда — выход ДО сборки отчёта c8: частичный lcov неотличим от
  // валидного и дал бы вердикт по неполным данным.
  if (run.signal) {
    // Убийство сигналом — НЕ падение теста, и советовать «почини тесты» здесь
    // значит увести разработчика не туда. Частая причина в этом окружении:
    // не задана VSCODE_TEST_VERSION, и качается версия, которая падает сразу
    // после старта Electron.
    fail(
      `шард ${i + 1}/${shards.length} убит сигналом ${run.signal} — это не падение теста. ` +
      `Проверь VSCODE_TEST_VERSION (без неё берётся stable, который может не запускаться) и память.`,
      1
    );
  }
  if (run.status !== 0) {
    fail(`шард ${i + 1}/${shards.length} упал — сначала почини тесты.`, run.status ?? 1);
  }
  reports.push(existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf-8')) : undefined);
}

const shardProblems = verifyShardReports(reports, { shardTotal: shards.length, allFiles: allTestFiles });
if (shardProblems.length > 0) {
  console.error('\n[coverage:changed] RED — прогон шардов рассогласован, данным покрытия верить нельзя:');
  for (const p of shardProblems) console.error('  ✗', p);
  process.exit(2);
}
const totalTests = reports.reduce((sum, r) => sum + r.stats.tests, 0);
console.log(`\n[coverage:changed] Шарды прогнаны: ${String(shards.length)}, тестов всего ${String(totalTests)}.`);

// 4. Слияние профилей всех шардов в один lcov.
const report = spawnSync(
  'npx',
  ['c8', 'report', '--reporter=lcov', '--reporter=text', `--temp-directory=${TMP_DIR}`],
  { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' }
);
if (report.status !== 0) {
  fail('c8 report завершился с ошибкой.', report.status ?? 1);
}

// 5. Вердикт. Ключи lcov приводим к путям относительно корня репозитория —
// в том же виде, в каком файлы называет git.
const lcovPath = path.join(ROOT, 'coverage', 'lcov.info');
const lcov = existsSync(lcovPath)
  ? new Map(
      [...parseLcov(readFileSync(lcovPath, 'utf-8'))].map(([sf, entry]) => [
        path.relative(ROOT, path.resolve(ROOT, sf)),
        entry,
      ])
    )
  : null;

const summary =
  lcov === null
    ? { totalFiles: 0, filesWithBranches: 0, filesWithoutBranchData: 0, share: 0 }
    : summarizeBranchCoverage({ lcov, branchRangesOf: branchRangesOfFile });
console.log(
  `[coverage:changed] Достоверность данных о ветках: файлов ${String(summary.totalFiles)}; ` +
    `с ветвлениями ${String(summary.filesWithBranches)}; без BRDA ${String(summary.filesWithoutBranchData)} ` +
    `(доля ${summary.share.toFixed(3)} при пороге ${MAX_DEGRADED_SHARE.toFixed(3)}).`
);

const verdict = buildVerdict({
  changed,
  targetLinesOf: (rel, isNew) => (isNew ? new Set(lcov.get(rel)?.da.keys() ?? []) : addedLinesOf(rel)),
  lcov,
  branchRangesOf: (rel) => branchRangesOfFile(rel) ?? [],
  isTypeOnly,
  degradedShare: summary.share,
  degradedMaxShare: MAX_DEGRADED_SHARE,
  allowEmptyChanged: process.env.COVERAGE_ALLOW_EMPTY === '1',
});

if (verdict.exitCode !== 0) {
  console.error(`\n[coverage:changed] RED (код ${String(verdict.exitCode)}) — ${verdict.summary}:`);
  for (const o of verdict.offenders) console.error('  ✗', o);
  console.error(
    verdict.exitCode === 2
      ? '\nКод 2 — данным нельзя верить: проверь базу диффа (COVERAGE_BASE), наличие lcov.info и достоверность записей BRDA.'
      : '\nПокрой эти строки/ветки тестом либо (для осознанно недостижимой защиты) пометь /* c8 ignore */ с обоснованием.'
  );
  process.exit(verdict.exitCode);
}

console.log(`\n[coverage:changed] GREEN — ${verdict.summary}.`);
