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
// Источник данных — `coverage/lcov.info` (те же цифры, что и `coverage:report`).
// Использование: `npm run coverage:changed` (стадия qa-e2e TDD-конвейера).

/* global console, process */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();

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
const NOT_INSTRUMENTED = new Set([
  'src/Container.ts',
  'src/extension.ts',
  'src/cli/onec-tools.ts',
  'src/cli/commands/listDbExtensions.ts',
  'src/ui/commands/ext/ExtensionCommands.ts',
]);

function isProdTs(f) {
  return (
    f.startsWith('src/') &&
    f.endsWith('.ts') &&
    !f.startsWith('src/test/') &&
    !f.endsWith('.d.ts') &&
    !NOT_INSTRUMENTED.has(f)
  );
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
 * База сравнения для патч-покрытия.
 *
 * Наивное `HEAD` работает, только пока правки НЕ закоммичены. Если разработчик
 * уже закоммитил (штатная ситуация: qa-e2e запускается после его стадии),
 * дифф против HEAD пуст, и гейт «успешно» проходит, не проверив ничего —
 * молчаливый ложный зелёный. Поэтому при чистом рабочем дереве база
 * расширяется до точки расхождения с веткой интеграции, то есть проверяются
 * коммиты самой задачи. Переопределяется переменной COVERAGE_BASE.
 */
function resolveDiffBase() {
  const explicit = process.env.COVERAGE_BASE?.trim();
  if (explicit) {
    return { base: explicit, why: 'задана переменной COVERAGE_BASE' };
  }
  // merge-base предпочтительнее HEAD ВСЕГДА, когда разрешается: дифф от неё
  // включает и коммиты задачи, и рабочее дерево. Проверка «а есть ли
  // незакоммиченное» здесь была бы ошибкой — при смешанном состоянии
  // («закоммитил, потом дошлифовал») база HEAD молча теряет закоммиченную
  // часть патча, то есть воспроизводит ровно тот ложный зелёный, ради
  // которого выбор базы и вводился.
  for (const upstream of ['origin/develop', 'origin/main']) {
    let mergeBase;
    try {
      mergeBase = git(['merge-base', 'HEAD', upstream]).trim();
    } catch {
      // Ветки интеграции может не быть (нет remote, свежий клон) — пробуем следующую.
      continue;
    }
    if (mergeBase && modifiedAgainst(mergeBase).length > 0) {
      return { base: mergeBase, why: `точка расхождения с ${upstream}: в патч входят и коммиты задачи, и рабочее дерево` };
    }
  }
  // Ветки интеграции нет (нет remote, свежий клон) — остаётся дифф с последним
  // коммитом; это слабее, но лучше, чем ничего.
  return { base: 'HEAD', why: 'ветка интеграции недоступна, сравниваем с HEAD' };
}

const { base: DIFF_BASE, why: BASE_REASON } = resolveDiffBase();
console.log(`[coverage:changed] База сравнения: ${DIFF_BASE} (${BASE_REASON}).`);

const modified = modifiedAgainst(DIFF_BASE);

const changed = [...untracked, ...modified];
if (changed.length === 0) {
  // Пустой набор почти всегда значит неверно выбранную базу, а не «нечего
  // проверять». Предупреждение в длинном логе теряется, поэтому по умолчанию
  // это ОТКАЗ: гейт, который ничего не проверил, не должен выглядеть пройденным.
  console.error('[coverage:changed] RED — изменённых production-файлов относительно базы НЕ НАЙДЕНО, гейт ничего не проверил.');
  console.error('[coverage:changed] Укажите базу явно (COVERAGE_BASE=<ref>) либо подтвердите пустой патч осознанно: COVERAGE_ALLOW_EMPTY=1.');
  process.exit(process.env.COVERAGE_ALLOW_EMPTY === '1' ? 0 : 1);
}

// Добавленные/изменённые строки модифицированного файла из unified=0 diff.
function addedLines(rel) {
  const diff = git(['diff', '--unified=0', DIFF_BASE, '--', rel]);
  const lines = new Set();
  const re = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;
  for (const line of diff.split('\n')) {
    const m = re.exec(line);
    if (!m) continue;
    const start = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    for (let i = 0; i < count; i += 1) lines.add(start + i);
  }
  return lines;
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
  const outPath = path.join(ROOT, 'out', rel.slice('src/'.length).replace(/\.ts$/, '.js'));
  if (!existsSync(outPath)) {
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

console.log('[coverage:changed] Проверяю patch-покрытие по файлам:');
for (const f of untracked) console.log('  • (новый)', f);
for (const f of modified) console.log('  • (изменён)', f);

const run = spawnSync('npx', ['c8', '--reporter=lcov', '--reporter=text', 'npm', 'test'], {
  cwd: ROOT,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (run.status !== 0) {
  console.error('[coverage:changed] npm test упал — сначала почини тесты.');
  process.exit(run.status ?? 1);
}

const lcovPath = path.join(ROOT, 'coverage', 'lcov.info');
if (!existsSync(lcovPath)) {
  console.error(`[coverage:changed] Не найден ${lcovPath} — c8 не сформировал lcov.`);
  process.exit(1);
}

// Разбор lcov в карту: absPath → { da: Map<line,hits>, brda: Map<line,taken[]> }.
function parseLcov(text) {
  const files = new Map();
  let cur = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('SF:')) {
      const p = line.slice(3);
      cur = { da: new Map(), brda: new Map() };
      files.set(path.resolve(ROOT, p), cur);
    } else if (cur && line.startsWith('DA:')) {
      const [ln, hits] = line.slice(3).split(',');
      cur.da.set(Number(ln), Number(hits));
    } else if (cur && line.startsWith('BRDA:')) {
      const [ln, , , taken] = line.slice(5).split(',');
      const arr = cur.brda.get(Number(ln)) ?? [];
      arr.push(taken);
      cur.brda.set(Number(ln), arr);
    } else if (line === 'end_of_record') {
      cur = null;
    }
  }
  return files;
}

const lcov = parseLcov(readFileSync(lcovPath, 'utf-8'));
const offenders = [];

for (const rel of changed) {
  const abs = path.resolve(ROOT, rel);
  const entry = lcov.get(abs);
  const isNew = untracked.includes(rel);

  if (!entry) {
    if (isTypeOnly(rel)) {
      console.log(`[coverage:changed] ${rel}: чисто-типовой файл — покрытие не применимо, ок.`);
    } else {
      offenders.push(`${rel}: НЕТ данных покрытия (не загружен тестами) — нужен тест`);
    }
    continue;
  }

  // Целевые строки: для нового файла — все исполняемые (DA), для изменённого — только добавленные.
  const target = isNew ? new Set(entry.da.keys()) : addedLines(rel);
  const uncoveredLines = [];
  const uncoveredBranches = [];
  for (const ln of target) {
    if (entry.da.has(ln) && entry.da.get(ln) === 0) uncoveredLines.push(ln);
    const branches = entry.brda.get(ln);
    if (branches && branches.some((t) => t === '-' || t === '0')) uncoveredBranches.push(ln);
  }
  if (uncoveredLines.length || uncoveredBranches.length) {
    const parts = [];
    if (uncoveredLines.length) parts.push(`строки ${uncoveredLines.sort((a, b) => a - b).join(',')}`);
    if (uncoveredBranches.length) parts.push(`ветки на строках ${[...new Set(uncoveredBranches)].sort((a, b) => a - b).join(',')}`);
    offenders.push(`${rel}: не покрыто — ${parts.join('; ')}`);
  }
}

if (offenders.length > 0) {
  console.error('\n[coverage:changed] RED — patch-покрытие ниже 100%:');
  for (const o of offenders) console.error('  ✗', o);
  console.error('\nПокрой эти строки/ветки тестом либо (для осознанно недостижимой защиты) пометь /* c8 ignore */ с обоснованием.');
  process.exit(1);
}

console.log('\n[coverage:changed] GREEN — весь патч (новые файлы + изменённые строки) покрыт на 100%.');
