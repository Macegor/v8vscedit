import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readPorcelainEntries, resolveGitRoot } from '../../infra/git/GitStatusReader';

/**
 * `GitStatusReader` — тонкий раннер git-процесса поверх `GitPorcelainReader`.
 * Проверяем на РЕАЛЬНОМ git-репозитории и на РЕАЛЬНОМ каталоге вне репозитория
 * (мягкие значения по умолчанию — пустой массив/`null`, без исключений).
 */
suite('GitStatusReader — раннер git status/rev-parse', () => {
  function git(repo: string, args: string[]): string {
    return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf-8' });
  }

  test('readPorcelainEntries на реальном репозитории возвращает записи untracked-файла', () => {
    // realpathSync: см. gitPorcelainReader.test.ts — иначе /tmp разойдётся с /private/tmp на macOS.
    const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-status-reader-')));
    try {
      git(repo, ['init', '-q']);
      fs.writeFileSync(path.join(repo, 'новый.txt'), 'содержимое\n', 'utf-8');

      const entries = readPorcelainEntries(repo);

      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0].index, '?');
      assert.strictEqual(entries[0].worktree, '?');
      assert.strictEqual(entries[0].relPath, 'новый.txt');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('readPorcelainEntries вне git-репозитория — пустой массив, без исключения', () => {
    const outsideAnyRepo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-status-reader-no-git-')));
    try {
      assert.deepStrictEqual(readPorcelainEntries(outsideAnyRepo), []);
    } finally {
      fs.rmSync(outsideAnyRepo, { recursive: true, force: true });
    }
  });

  test('resolveGitRoot на реальном репозитории возвращает его корень', () => {
    const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-status-reader-root-')));
    try {
      git(repo, ['init', '-q']);
      const nested = path.join(repo, 'src', 'cf');
      fs.mkdirSync(nested, { recursive: true });

      assert.strictEqual(resolveGitRoot(nested), repo, 'из вложенного каталога должен резолвиться корень репозитория');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('resolveGitRoot вне git-репозитория — null, без исключения', () => {
    const outsideAnyRepo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-status-reader-no-root-')));
    try {
      assert.strictEqual(resolveGitRoot(outsideAnyRepo), null);
    } finally {
      fs.rmSync(outsideAnyRepo, { recursive: true, force: true });
    }
  });
});
