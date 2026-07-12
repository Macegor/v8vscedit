import * as assert from 'assert';
// Граф истории git, Слой 1: чистый парсер вывода
// `git diff-tree --no-commit-id --name-status -r -M --first-parent <commit>`.
// Модуль ещё не реализован — импорт обязан провалиться до появления
// `src/infra/git/GitCommitChangesReader.ts`.
//
// Форма результата — существующий `PorcelainEntry` из `GitPorcelainReader`
// (index/worktree/relPath/oldRelPath), НЕ новый тип: `--name-status` даёт
// только один статусный символ на строку (без раздельных X/Y уровней
// индекса/дерева, которые бывают у `git status --porcelain`), поэтому
// `worktree` парсер обязан всегда заполнять пробелом.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { PorcelainEntry } from '../../infra/git/GitPorcelainReader';
import { parseNameStatus, readCommitChanges } from '../../infra/git/GitCommitChangesReader';
import { buildHistoryRepo, git, removeHistoryRepo } from './support/changesFixtures';

suite('GitCommitChangesReader — разбор `git diff-tree --name-status`', () => {
  test('изменённый файл: M\\tpath — index=M, worktree=пробел', () => {
    const entries = parseNameStatus('M\tCatalogs/ПричиныВозврата.xml\n');
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].index, 'M');
    assert.strictEqual(entries[0].worktree, ' ');
    assert.strictEqual(entries[0].relPath, 'Catalogs/ПричиныВозврата.xml');
    assert.strictEqual(entries[0].oldRelPath, undefined);
  });

  test('добавленный файл: A\\tpath — index=A', () => {
    const entries = parseNameStatus('A\tCatalogs/Новый.xml\n');
    assert.strictEqual(entries[0].index, 'A');
    assert.strictEqual(entries[0].relPath, 'Catalogs/Новый.xml');
  });

  test('удалённый файл: D\\tpath — index=D', () => {
    const entries = parseNameStatus('D\tCatalogs/Удалённый.xml\n');
    assert.strictEqual(entries[0].index, 'D');
    assert.strictEqual(entries[0].relPath, 'Catalogs/Удалённый.xml');
  });

  test('переименование: R100\\told\\tnew — index=R (без степени сходства), relPath=new, oldRelPath=old', () => {
    const entries = parseNameStatus('R100\told/path.txt\tnew/path.txt\n');
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].index, 'R');
    assert.strictEqual(entries[0].relPath, 'new/path.txt');
    assert.strictEqual(entries[0].oldRelPath, 'old/path.txt');
  });

  test('копирование: C100\\tsrc\\tdst — index=C, relPath=dst, oldRelPath=src', () => {
    const entries = parseNameStatus('C100\tsrc.txt\tdst.txt\n');
    assert.strictEqual(entries[0].index, 'C');
    assert.strictEqual(entries[0].relPath, 'dst.txt');
    assert.strictEqual(entries[0].oldRelPath, 'src.txt');
  });

  test('несколько строк подряд разбираются в массив в исходном порядке', () => {
    const output = 'M\ta.txt\nA\tb.txt\nD\tc.txt\n';
    const entries = parseNameStatus(output);
    assert.deepStrictEqual(entries.map((e: PorcelainEntry) => [e.index, e.relPath]), [
      ['M', 'a.txt'],
      ['A', 'b.txt'],
      ['D', 'c.txt'],
    ]);
  });

  test('пустой вход даёт пустой массив', () => {
    assert.deepStrictEqual(parseNameStatus(''), []);
  });

  test('строка без символа табуляции (короче двух полей) пропускается, не попадает в результат', () => {
    // Защитная ветка на случай обрезанной/повреждённой строки вывода
    // (например на границе maxBuffer) — `parts.length < 2` без реального `\t`.
    const entries = parseNameStatus('M\nA\tb.txt\n');
    assert.deepStrictEqual(entries.map((e: PorcelainEntry) => e.relPath), ['b.txt']);
  });

  /**
   * Интеграционный тест на РЕАЛЬНОМ коммите (`buildHistoryRepo().renameCommit`,
   * который поверх merge переименовывает файл и добавляет файл с кириллическим
   * именем): проверяет и разбор `R100` от настоящего git, и декодирование
   * octal-escape кириллического пути (core.quotepath=true по умолчанию —
   * фикстура его НЕ отключает, см. комментарий в `changesFixtures.ts`).
   */
  suite('на реальном коммите с переименованием и кириллическим именем файла', () => {
    let fixture: ReturnType<typeof buildHistoryRepo>;
    let entries: PorcelainEntry[];

    suiteSetup(() => {
      fixture = buildHistoryRepo();
      const output = git(fixture.repoRoot, [
        'diff-tree', '--no-commit-id', '--name-status', '-r', '-M', '--first-parent', fixture.renameCommit,
      ]);
      entries = parseNameStatus(output);
    });

    suiteTeardown(() => {
      removeHistoryRepo(fixture);
    });

    test('ровно две записи — переименование и добавление', () => {
      assert.strictEqual(entries.length, 2);
    });

    test('переименование base.txt → base-переименован.txt распознано как R с oldRelPath', () => {
      const renamed = entries.find((e: PorcelainEntry) => e.oldRelPath === 'base.txt');
      assert.ok(renamed, 'запись о переименовании base.txt обязана присутствовать');
      assert.strictEqual(renamed.index, 'R');
      assert.strictEqual(renamed.relPath, 'base-переименован.txt');
    });

    test('добавленный кириллический файл декодирован из octal-escape в исходное имя', () => {
      const added = entries.find((e: PorcelainEntry) => e.index === 'A');
      assert.ok(added, 'запись о добавленном файле обязана присутствовать');
      assert.strictEqual(added.relPath, 'новый-файл.txt');
      assert.strictEqual(added.worktree, ' ');
    });
  });
});

/**
 * Граф истории git, Слой 1: раннер `readCommitChanges` — реальный запуск
 * `git diff-tree --name-status` (в отличие от `parseNameStatus`, который
 * разбирает уже готовую строку). Проверяет и сам процесс (аргументы,
 * `--root` для корневого коммита), и мягкий фолбэк.
 */
suite('GitCommitChangesReader — readCommitChanges: реальный запуск `git diff-tree`', () => {
  let fixture: ReturnType<typeof buildHistoryRepo>;

  suiteSetup(() => {
    fixture = buildHistoryRepo();
  });

  suiteTeardown(() => {
    removeHistoryRepo(fixture);
  });

  test('обычный коммит (mainCommit) — единственная запись о добавлении main-only.txt', () => {
    const entries = readCommitChanges(fixture.repoRoot, fixture.mainCommit);
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].index, 'A');
    assert.strictEqual(entries[0].relPath, 'main-only.txt');
  });

  test('коммит с переименованием и кириллическим файлом (renameCommit) — R + A, как и у parseNameStatus', () => {
    const entries = readCommitChanges(fixture.repoRoot, fixture.renameCommit);
    assert.strictEqual(entries.length, 2);
    const renamed = entries.find((e: PorcelainEntry) => e.oldRelPath === 'base.txt');
    assert.ok(renamed);
    assert.strictEqual(renamed.relPath, 'base-переименован.txt');
    const added = entries.find((e: PorcelainEntry) => e.index === 'A');
    assert.ok(added);
    assert.strictEqual(added.relPath, 'новый-файл.txt');
  });

  test('корневой коммит БЕЗ options.root — пустой список (--first-parent не может сравнить с несуществующим родителем)', () => {
    assert.deepStrictEqual(readCommitChanges(fixture.repoRoot, fixture.root), []);
  });

  test('корневой коммит С options.root=true — перечисляет добавленные файлы (base.txt)', () => {
    const entries = readCommitChanges(fixture.repoRoot, fixture.root, { root: true });
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].index, 'A');
    assert.strictEqual(entries[0].relPath, 'base.txt');
  });

  test('несуществующий коммит — мягкий фолбэк [], без исключения', () => {
    assert.deepStrictEqual(
      readCommitChanges(fixture.repoRoot, 'ffffffffffffffffffffffffffffffffffffff'),
      []
    );
  });

  test('вызов вне git-репозитория — мягкий фолбэк [], без исключения', () => {
    const outsideAnyRepo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-no-git-changes-')));
    try {
      assert.deepStrictEqual(readCommitChanges(outsideAnyRepo, fixture.renameCommit), []);
    } finally {
      fs.rmSync(outsideAnyRepo, { recursive: true, force: true });
    }
  });
});
