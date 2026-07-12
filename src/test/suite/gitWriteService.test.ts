import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
// ВЕХА 1 «Изменения метаданных», компонент №6 плана: мутации git над набором
// файлов, без vscode. Модуль ещё не реализован.
import { stage, unstage, discard, commit, type DiscardEntry } from '../../infra/git/GitWriteService';

const TRACKED_CONTENT = 'исходное содержимое\n';
const DELETED_CONTENT = 'будет удалён\n';
const OTHER_CONTENT = 'не трогаем\n';

function git(repo: string, args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf-8' });
}

/**
 * Статус одного файла по `git status --porcelain` (пустая строка — файл чист).
 * Обрезаем ТОЛЬКО завершающий перевод строки — `trim()` недопустим: он снёс бы
 * ведущий пробел кода статуса (` M` — unstaged), схлопнув его с `M ` (staged).
 */
function statusOf(repo: string, relPath: string): string {
  const output = git(repo, ['status', '--porcelain', '--', relPath]);
  return output.replace(/\r?\n$/, '');
}

function buildBaselineRepo(): string {
  // realpathSync: см. комментарий в gitPorcelainReader.test.ts.
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-git-write-service-')));
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 'test@test.local']);
  git(repo, ['config', 'user.name', 'test']);

  fs.writeFileSync(path.join(repo, 'tracked.txt'), TRACKED_CONTENT, 'utf-8');
  fs.writeFileSync(path.join(repo, 'deleted.txt'), DELETED_CONTENT, 'utf-8');
  fs.writeFileSync(path.join(repo, 'other-tracked.txt'), OTHER_CONTENT, 'utf-8');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'baseline']);

  return repo;
}

suite('GitWriteService — мутации git над набором файлов на реальном репозитории', () => {
  let repo: string;

  setup(() => {
    repo = buildBaselineRepo();
  });

  teardown(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  test('stage() индексирует переданные файлы: untracked → "A "', () => {
    const newFile = path.join(repo, 'new-file.txt');
    fs.writeFileSync(newFile, 'новый файл объекта\n', 'utf-8');
    assert.strictEqual(statusOf(repo, 'new-file.txt'), '?? new-file.txt');

    stage(repo, [newFile]);

    assert.strictEqual(statusOf(repo, 'new-file.txt'), 'A  new-file.txt');
  });

  test('unstage() возвращает файл из индекса в рабочее дерево, не теряя правку', () => {
    const trackedPath = path.join(repo, 'tracked.txt');
    const modified = 'изменено перед индексацией\n';
    fs.writeFileSync(trackedPath, modified, 'utf-8');
    git(repo, ['add', 'tracked.txt']);
    assert.strictEqual(statusOf(repo, 'tracked.txt'), 'M  tracked.txt');

    unstage(repo, [trackedPath]);

    assert.strictEqual(statusOf(repo, 'tracked.txt'), ' M tracked.txt');
    assert.strictEqual(fs.readFileSync(trackedPath, 'utf-8'), modified, 'правка не должна теряться при unstage');
  });

  test('discard() modified возвращает содержимое файла к HEAD', () => {
    const trackedPath = path.join(repo, 'tracked.txt');
    fs.writeFileSync(trackedPath, 'локальная правка, подлежащая отмене\n', 'utf-8');
    assert.strictEqual(statusOf(repo, 'tracked.txt'), ' M tracked.txt');

    const entries: DiscardEntry[] = [{ absPath: trackedPath, status: 'modified' }];
    discard(repo, entries);

    assert.strictEqual(fs.readFileSync(trackedPath, 'utf-8'), TRACKED_CONTENT);
    assert.strictEqual(statusOf(repo, 'tracked.txt'), '');
  });

  test('discard() untracked удаляет файл с диска', () => {
    const untrackedPath = path.join(repo, 'untracked.txt');
    fs.writeFileSync(untrackedPath, 'этот файл должен быть удалён discard\n', 'utf-8');
    assert.strictEqual(statusOf(repo, 'untracked.txt'), '?? untracked.txt');

    const entries: DiscardEntry[] = [{ absPath: untrackedPath, status: 'untracked' }];
    discard(repo, entries);

    assert.strictEqual(fs.existsSync(untrackedPath), false);
    assert.strictEqual(statusOf(repo, 'untracked.txt'), '');
  });

  test('discard() deleted восстанавливает удалённый файл из HEAD', () => {
    const deletedPath = path.join(repo, 'deleted.txt');
    fs.rmSync(deletedPath);
    assert.strictEqual(statusOf(repo, 'deleted.txt'), ' D deleted.txt');

    const entries: DiscardEntry[] = [{ absPath: deletedPath, status: 'deleted' }];
    discard(repo, entries);

    assert.strictEqual(fs.existsSync(deletedPath), true);
    assert.strictEqual(fs.readFileSync(deletedPath, 'utf-8'), DELETED_CONTENT);
    assert.strictEqual(statusOf(repo, 'deleted.txt'), '');
  });

  test('commit() коммитит только застейдженные файлы, не трогая unstaged-правки', () => {
    const trackedPath = path.join(repo, 'tracked.txt');
    const otherPath = path.join(repo, 'other-tracked.txt');
    const stagedContent = 'правка, которая должна попасть в коммит\n';
    const unstagedContent = 'правка, которая НЕ должна попасть в коммит\n';

    fs.writeFileSync(trackedPath, stagedContent, 'utf-8');
    git(repo, ['add', 'tracked.txt']);
    fs.writeFileSync(otherPath, unstagedContent, 'utf-8');

    const beforeLog = git(repo, ['log', '--oneline']).trim().split('\n').length;
    commit(repo, 'тестовый коммит только застейдженных файлов');
    const afterLog = git(repo, ['log', '--oneline']).trim().split('\n').length;

    assert.strictEqual(afterLog, beforeLog + 1, 'должен появиться ровно один новый коммит');
    assert.strictEqual(git(repo, ['show', 'HEAD:tracked.txt']), stagedContent, 'закоммиченное содержимое tracked.txt');
    assert.strictEqual(
      git(repo, ['show', 'HEAD:other-tracked.txt']),
      OTHER_CONTENT,
      'other-tracked.txt не должен быть закоммичен — правка была не застейджена'
    );
    // Незастейдженная правка other-tracked.txt должна остаться в рабочем дереве как есть.
    assert.strictEqual(statusOf(repo, 'other-tracked.txt'), ' M other-tracked.txt');
  });

  test('stage() с пустым списком путей — no-op, не запускает git-процесс', () => {
    // Пустой gitRoot доказывает, что при пустом списке путей runGit вообще не
    // вызывается: несуществующий каталог обязательно провалил бы execFileSync.
    const bogusRoot = path.join(repo, 'не-существует');
    assert.doesNotThrow(() => stage(bogusRoot, []));
  });

  test('unstage() с пустым списком путей — no-op, не запускает git-процесс', () => {
    const bogusRoot = path.join(repo, 'не-существует');
    assert.doesNotThrow(() => unstage(bogusRoot, []));
  });

  test('отсутствие git-репозитория — мутирующие операции падают управляемой ошибкой, а не тихо теряют изменение', () => {
    const outsideAnyRepo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-no-git-write-')));
    const somePath = path.join(outsideAnyRepo, 'файл.txt');
    fs.writeFileSync(somePath, 'содержимое\n', 'utf-8');
    try {
      assert.throws(() => stage(outsideAnyRepo, [somePath]));
      assert.throws(() => unstage(outsideAnyRepo, [somePath]));
      assert.throws(() => discard(outsideAnyRepo, [{ absPath: somePath, status: 'modified' }]));
      assert.throws(() => commit(outsideAnyRepo, 'сообщение'));
    } finally {
      fs.rmSync(outsideAnyRepo, { recursive: true, force: true });
    }
  });
});
