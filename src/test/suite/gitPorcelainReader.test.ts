import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
// ВЕХА 1 «Изменения метаданных»: чистый парсер `git status --porcelain`.
// Модуль ещё не реализован — импорт обязан провалиться до появления
// `src/infra/git/GitPorcelainReader.ts` (компонент №1 плана).
import { parsePorcelain, type PorcelainEntry } from '../../infra/git/GitPorcelainReader';

/**
 * Готовит временный git-репозиторий с полным набором сочетаний
 * index/worktree-статусов, встречающихся в `git status --porcelain`.
 * Все статусы получены РЕАЛЬНЫМ процессом git, а не выдуманы руками —
 * это защищает тест от расхождения с фактическим форматом git.
 */
function buildProbeRepo(): string {
  // realpathSync: на macOS os.tmpdir() отдаёт путь через симлинк /var → /private/var,
  // а git резолвит его в выводе `status`/`show-toplevel` — без этого абсолютные
  // пути в тесте разойдутся с тем, что вернёт git-процесс.
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-porcelain-')));
  const run = (args: string[]): string =>
    execFileSync('git', ['-C', root, ...args], { encoding: 'utf-8' });

  run(['init', '-q']);
  run(['config', 'user.email', 'test@test.local']);
  run(['config', 'user.name', 'test']);

  // Базовый коммит: файлы, которые дальше будем изменять/удалять/переименовывать.
  fs.writeFileSync(path.join(root, 'staged-mod.txt'), 'исходное содержимое\n', 'utf-8');
  fs.writeFileSync(path.join(root, 'unstaged-mod.txt'), 'исходное содержимое\n', 'utf-8');
  fs.writeFileSync(path.join(root, 'staged-del.txt'), 'к удалению\n', 'utf-8');
  fs.writeFileSync(path.join(root, 'unstaged-del.txt'), 'к удалению\n', 'utf-8');
  fs.writeFileSync(path.join(root, 'rename-old.txt'), 'переименуется\n', 'utf-8');
  fs.writeFileSync(path.join(root, 'кириллица.txt'), 'исходное содержимое\n', 'utf-8');
  run(['add', '-A']);
  run(['commit', '-q', '-m', 'baseline']);

  // Staged-only: `M  file` — правится и индексируется, больше не трогается.
  fs.writeFileSync(path.join(root, 'staged-mod.txt'), 'изменено и добавлено в индекс\n', 'utf-8');
  run(['add', 'staged-mod.txt']);

  // Unstaged-only: ` M file` — правится в рабочем дереве, в индекс не попадает.
  fs.writeFileSync(path.join(root, 'unstaged-mod.txt'), 'изменено без индексации\n', 'utf-8');

  // Оба уровня разом (X != Y): сначала новый файл индексируется (A),
  // затем ещё раз правится в рабочем дереве (M) — получаем код `AM`.
  fs.writeFileSync(path.join(root, 'both-levels.txt'), 'добавлено\n', 'utf-8');
  run(['add', 'both-levels.txt']);
  fs.writeFileSync(path.join(root, 'both-levels.txt'), 'добавлено и затем изменено\n', 'utf-8');

  // Untracked: `?? file`.
  fs.writeFileSync(path.join(root, 'untracked.txt'), 'новый неотслеживаемый файл\n', 'utf-8');

  // Удаление, застейдженное в индекс: `D  file`.
  fs.rmSync(path.join(root, 'staged-del.txt'));
  run(['add', 'staged-del.txt']);

  // Удаление только в рабочем дереве: ` D file`.
  fs.rmSync(path.join(root, 'unstaged-del.txt'));

  // Переименование, застейдженное в индекс: `R  old -> new`.
  run(['mv', 'rename-old.txt', 'rename-new.txt']);

  // Кириллица в кавычках с octal-escape (core.quotepath=true по умолчанию).
  fs.writeFileSync(path.join(root, 'кириллица.txt'), 'изменено без индексации\n', 'utf-8');

  return root;
}

suite('GitPorcelainReader', () => {
  let repo: string;
  let entries: PorcelainEntry[];

  suiteSetup(() => {
    repo = buildProbeRepo();
    const output = execFileSync('git', ['-C', repo, 'status', '--porcelain', '--untracked-files=all'], {
      encoding: 'utf-8',
    });
    entries = parsePorcelain(output);
  });

  suiteTeardown(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  function findByRelPath(relPath: string): PorcelainEntry {
    const found = entries.filter((e: PorcelainEntry) => e.relPath === relPath);
    assert.strictEqual(found.length, 1, `Ожидалась ровно одна запись для «${relPath}», найдено ${String(found.length)}`);
    return found[0];
  }

  test('staged-only: index=M, worktree=пробел', () => {
    const entry = findByRelPath('staged-mod.txt');
    assert.strictEqual(entry.index, 'M');
    assert.strictEqual(entry.worktree, ' ');
  });

  test('unstaged-only: index=пробел, worktree=M', () => {
    const entry = findByRelPath('unstaged-mod.txt');
    assert.strictEqual(entry.index, ' ');
    assert.strictEqual(entry.worktree, 'M');
  });

  test('оба уровня разом, X≠Y: index=A, worktree=M — не схлопнуты в один символ', () => {
    const entry = findByRelPath('both-levels.txt');
    assert.strictEqual(entry.index, 'A');
    assert.strictEqual(entry.worktree, 'M');
    assert.notStrictEqual(entry.index, entry.worktree, 'index и worktree обязаны храниться раздельно');
  });

  test('untracked: index=worktree=?', () => {
    const entry = findByRelPath('untracked.txt');
    assert.strictEqual(entry.index, '?');
    assert.strictEqual(entry.worktree, '?');
  });

  test('удаление застейджено в индекс: index=D, worktree=пробел', () => {
    const entry = findByRelPath('staged-del.txt');
    assert.strictEqual(entry.index, 'D');
    assert.strictEqual(entry.worktree, ' ');
  });

  test('удаление только в рабочем дереве: index=пробел, worktree=D', () => {
    const entry = findByRelPath('unstaged-del.txt');
    assert.strictEqual(entry.index, ' ');
    assert.strictEqual(entry.worktree, 'D');
  });

  test('переименование сохраняет oldRelPath и relPath', () => {
    const entry = findByRelPath('rename-new.txt');
    assert.strictEqual(entry.index, 'R');
    assert.strictEqual(entry.oldRelPath, 'rename-old.txt');
  });

  test('кириллица в кавычках с octal-escape декодируется в исходное имя файла', () => {
    // core.quotepath=true (по умолчанию) заставляет git выводить путь в виде
    // "\320\272..." — реальный вывод реального git-процесса, не выдумка.
    const entry = findByRelPath('кириллица.txt');
    assert.strictEqual(entry.index, ' ');
    assert.strictEqual(entry.worktree, 'M');
  });

  test('пустой вход даёт пустой массив', () => {
    assert.deepStrictEqual(parsePorcelain(''), []);
  });

  /**
   * Имена файлов с управляющими символами (таб/перевод строки/CR), обратным
   * слешем и кавычкой — валидные для файловой системы, и РЕАЛЬНЫЙ git экранирует
   * их именно так (`\t`, `\n`, `\r`, `\\`, `\"`), что и проверяет каждый case
   * ветки `switch` в `unquotePorcelainPath`.
   */
  suite('unquotePorcelainPath — C-style escape-последовательности реального git', () => {
    let escRepo: string;

    suiteSetup(() => {
      escRepo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-porcelain-escapes-')));
      execFileSync('git', ['-C', escRepo, 'init', '-q']);
      fs.writeFileSync(path.join(escRepo, 'file\twith\ttab.txt'), '', 'utf-8');
      fs.writeFileSync(path.join(escRepo, 'file\nwith\nnewline.txt'), '', 'utf-8');
      fs.writeFileSync(path.join(escRepo, 'file\rwith\rcr.txt'), '', 'utf-8');
      fs.writeFileSync(path.join(escRepo, 'file with\\backslash.txt'), '', 'utf-8');
      fs.writeFileSync(path.join(escRepo, 'file with"quote.txt'), '', 'utf-8');
      // Bell (0x07) — git экранирует его как `\a`, не входящий в обрабатываемый
      // набор именованных escape-ов парсера: покрывает default-ветку switch
      // (символ escape-последовательности копируется как есть).
      fs.writeFileSync(path.join(escRepo, 'file\x07bell.txt'), '', 'utf-8');
    });

    suiteTeardown(() => {
      fs.rmSync(escRepo, { recursive: true, force: true });
    });

    test('таб/перевод строки/CR/обратный слеш/кавычка декодируются в исходные символы', () => {
      const output = execFileSync('git', ['-C', escRepo, 'status', '--porcelain', '--untracked-files=all'], {
        encoding: 'utf-8',
      });
      const relPaths = parsePorcelain(output).map((e) => e.relPath).sort();

      assert.deepStrictEqual(relPaths, [
        'file with"quote.txt',
        'file with\\backslash.txt',
        'file\nwith\nnewline.txt',
        'file\rwith\rcr.txt',
        'file\twith\ttab.txt',
        // Bell (\x07) вне обрабатываемого набора именованных escape-ов — попадает
        // в default-ветку switch и копируется как литеральный символ escape-кода
        // (документирует текущее, заведомо неполное поведение парсера).
        'fileabell.txt',
      ].sort());
    });

    test('оборванный escape (одинокий "\\" перед закрывающей кавычкой) — не бросает исключение, останавливает разбор', () => {
      // Защитная ветка на случай усечённого/повреждённого вывода: реальный git
      // никогда не оставляет одинокий "\" без пары, но парсер обязан не падать.
      // " M " — код статуса (X=пробел, Y=M) + разделитель, дальше — кавыченный путь.
      const malformed = ' M "усечённый\\"\n';
      assert.doesNotThrow(() => parsePorcelain(malformed));
      const entries = parsePorcelain(malformed);
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0].relPath, 'усечённый');
    });
  });
});
