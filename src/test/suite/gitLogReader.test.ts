import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
// Граф истории git, Слой 1: тонкий раннер `readGitLog` (запуск реального
// `git log`). В отличие от `gitLogParser.test.ts` (который проверяет только
// чистый разбор уже готовой строки), здесь проверяется сам процесс: реальный
// вызов git, передача аргументов (`--all`, `--max-count`) и мягкий фолбэк при
// недоступном репозитории.
import { readGitLog } from '../../infra/git/GitLogReader';
import type { RawCommit } from '../../infra/git/GitLogParser';
import { buildHistoryRepo, removeHistoryRepo } from './support/changesFixtures';

suite('GitLogReader — readGitLog: реальный запуск `git log` для графа истории', () => {
  let fixture: ReturnType<typeof buildHistoryRepo>;

  suiteSetup(() => {
    fixture = buildHistoryRepo();
  });

  suiteTeardown(() => {
    removeHistoryRepo(fixture);
  });

  test('без maxCount — возвращает все 6 коммитов истории (--all), включая ветку feature вне HEAD', () => {
    const commits = readGitLog(fixture.repoRoot);
    assert.strictEqual(commits.length, 6);
    const hashes = commits.map((c: RawCommit) => c.hash);
    assert.ok(hashes.includes(fixture.root));
    assert.ok(hashes.includes(fixture.branchPoint));
    assert.ok(hashes.includes(fixture.featureCommit));
    assert.ok(hashes.includes(fixture.mainCommit));
    assert.ok(hashes.includes(fixture.mergeCommit));
    assert.ok(hashes.includes(fixture.renameCommit));
  });

  test('merge-коммит из реального лога — parents=[main, feature] в порядке слияния', () => {
    const commits = readGitLog(fixture.repoRoot);
    const merge = commits.find((c: RawCommit) => c.hash === fixture.mergeCommit);
    assert.ok(merge, 'merge-коммит обязан присутствовать');
    assert.deepStrictEqual(merge.parents, [fixture.mainCommit, fixture.featureCommit]);
  });

  test('maxCount=1 — уважает `--max-count`, возвращает только HEAD (renameCommit)', () => {
    const commits = readGitLog(fixture.repoRoot, 1);
    assert.strictEqual(commits.length, 1);
    assert.strictEqual(commits[0].hash, fixture.renameCommit);
  });

  test('maxCount=3 — ограничивает выборку тремя самыми свежими по топологии коммитами', () => {
    const commits = readGitLog(fixture.repoRoot, 3);
    assert.strictEqual(commits.length, 3);
  });

  test('вызов вне git-репозитория — мягкий фолбэк [], без исключения', () => {
    const outsideAnyRepo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-no-git-log-')));
    try {
      assert.deepStrictEqual(readGitLog(outsideAnyRepo), []);
      assert.deepStrictEqual(readGitLog(outsideAnyRepo, 5), []);
    } finally {
      fs.rmSync(outsideAnyRepo, { recursive: true, force: true });
    }
  });
});
