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
const NOT_INSTRUMENTED = new Set(['src/Container.ts', 'src/extension.ts']);

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

const modified = git(['diff', '--name-only', 'HEAD'])
  .split('\n')
  .map((s) => s.trim())
  .filter((f) => f && isProdTs(f) && !untracked.includes(f) && existsSync(path.join(ROOT, f)));

const changed = [...untracked, ...modified];
if (changed.length === 0) {
  console.log('[coverage:changed] Изменённых production-файлов нет — проверять нечего.');
  process.exit(0);
}

// Добавленные/изменённые строки модифицированного файла из unified=0 diff.
function addedLines(rel) {
  const diff = git(['diff', '--unified=0', 'HEAD', '--', rel]);
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
