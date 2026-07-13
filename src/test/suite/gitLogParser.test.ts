import * as assert from 'assert';
// Граф истории git, Слой 1: чистый парсер вывода `git log`. Модуль ещё не
// реализован — импорт обязан провалиться до появления
// `src/infra/git/GitLogParser.ts`.
//
// Контракт (уточнение относительно исходного плана): парсер разбирает вывод
//   git log --all --decorate=full --parents --topo-order \
//     --pretty=format:'%H%x1f%P%x1f%D%x1f%an%x1f%at%x1f%s%x1e'
// — поля записи разделены `\x1f`, записи — `\x1e` (git добавляет `\n` следом
// за каждым `\x1e` автоматически, парсер обязан это игнорировать/обрезать).
// `--decorate=full` даёт ПОЛНЫЕ пути ref (`refs/heads/…`, `refs/remotes/…`,
// `refs/tags/…`) вместо голых имён — без этого разделить localBranch и
// remoteBranch по одному лишь `%D` было бы нельзя (см. обоснование в отчёте
// автора тестов). `HEAD -> refs/heads/<name>` разбирается в ОДНУ запись
// `{ name: <name>, kind: 'head' }` (не в пару HEAD+localBranch) — так проще
// потребителю графа определить текущую ветку по единственному флагу kind.
import { parseGitLog, type RawCommit } from '../../infra/git/GitLogParser';
import { buildHistoryRepo, git, removeHistoryRepo } from './support/changesFixtures';

/** Собирает один "сырой" фрагмент вывода git log из полей записи. */
function record(fields: readonly [string, string, string, string, string, string]): string {
  return `${fields.join('\x1f')}\x1e\n`;
}

suite('GitLogParser — разбор вывода `git log --pretty=format`', () => {
  test('один коммит без родителей и без refs', () => {
    const output = record(['aaa111', '', '', 'Иван Иванов', '1700000000', 'первый коммит']);

    const commits = parseGitLog(output);

    assert.strictEqual(commits.length, 1);
    const [commit] = commits;
    assert.strictEqual(commit.hash, 'aaa111');
    assert.deepStrictEqual(commit.parents, []);
    assert.deepStrictEqual(commit.refs, []);
    assert.strictEqual(commit.authorName, 'Иван Иванов');
    assert.strictEqual(commit.authorTimestamp, 1700000000);
    assert.strictEqual(typeof commit.authorTimestamp, 'number');
    assert.strictEqual(commit.subject, 'первый коммит');
  });

  test('несколько коммитов подряд разбираются в том же порядке, что и во входе', () => {
    const output =
      record(['ccc333', 'bbb222', '', 'a', '1700000002', 'третий']) +
      record(['bbb222', 'aaa111', '', 'a', '1700000001', 'второй']) +
      record(['aaa111', '', '', 'a', '1700000000', 'первый']);

    const commits = parseGitLog(output);

    assert.deepStrictEqual(commits.map((c: RawCommit) => c.hash), ['ccc333', 'bbb222', 'aaa111']);
  });

  test('один родитель — parents из одного элемента', () => {
    const output = record(['bbb', 'aaa', '', 'a', '1700000000', 'subj']);
    const [commit] = parseGitLog(output);
    assert.deepStrictEqual(commit.parents, ['aaa']);
  });

  test('merge с двумя родителями — parents разбит по пробелу в исходном порядке', () => {
    const output = record(['mmm', 'ddd ccc', '', 'a', '1700000000', 'merge']);
    const [commit] = parseGitLog(output);
    assert.deepStrictEqual(commit.parents, ['ddd', 'ccc']);
  });

  test('octopus-merge с тремя родителями — все элементы сохранены', () => {
    const output = record(['ooo', 'p1 p2 p3', '', 'a', '1700000000', 'octopus']);
    const [commit] = parseGitLog(output);
    assert.deepStrictEqual(commit.parents, ['p1', 'p2', 'p3']);
  });

  test('пустое поле %P (корневой коммит) даёт пустой массив, а не массив с пустой строкой', () => {
    const output = record(['root', '', '', 'a', '1700000000', 'root commit']);
    const [commit] = parseGitLog(output);
    assert.deepStrictEqual(commit.parents, []);
    assert.strictEqual(commit.parents.length, 0);
  });

  test('subject с запятыми и юникодом сохраняется целиком', () => {
    const subject = 'исправление, доработка «форм», кавычки „ёлочки“ — не потеряны';
    const output = record(['h', '', '', 'a', '1700000000', subject]);
    const [commit] = parseGitLog(output);
    assert.strictEqual(commit.subject, subject);
  });

  test('пустой вход даёт пустой массив', () => {
    assert.deepStrictEqual(parseGitLog(''), []);
  });

  test('запись с недостаточным числом полей (< 6) пропускается — защита от обрезанного вывода', () => {
    // Реалистичный сценарий — обрыв вывода на границе maxBuffer/пайпа: неполная
    // запись без завершающих полей. Такую запись нельзя безопасно разобрать,
    // парсер обязан её отбросить, а не упасть/додумать пустые значения.
    const truncated = 'aaa\x1f\x1f\x1e\n';
    const output = truncated + record(['bbb', '', '', 'a', '1700000000', 'полная запись после обрыва']);

    const commits = parseGitLog(output);

    assert.strictEqual(commits.length, 1);
    assert.strictEqual(commits[0].hash, 'bbb');
  });

  suite('разбор %D (--decorate=full) в RawRef', () => {
    test('пустое поле %D — refs=[]', () => {
      const output = record(['h', '', '', 'a', '1700000000', 's']);
      const [commit] = parseGitLog(output);
      assert.deepStrictEqual(commit.refs, []);
    });

    test('"HEAD -> refs/heads/main" — одна запись kind=head с именем ветки', () => {
      const output = record(['h', '', 'HEAD -> refs/heads/main', 'a', '1700000000', 's']);
      const [commit] = parseGitLog(output);
      assert.deepStrictEqual(commit.refs, [{ name: 'main', kind: 'head' }]);
    });

    test('"HEAD -> " без префикса "refs/heads/" в имени — stripPrefix оставляет значение как есть', () => {
      // Практически недостижимо через реальный git (HEAD как символьная ссылка
      // указывает только на refs/heads/*), но stripPrefix — защитная утилита
      // общего назначения внутри parseRefs: false-ветвь (значение не начинается
      // с ожидаемого префикса) обязана вернуть исходную строку без изменений.
      const output = record(['h', '', 'HEAD -> нестандартное-имя', 'a', '1700000000', 's']);
      const [commit] = parseGitLog(output);
      assert.deepStrictEqual(commit.refs, [{ name: 'нестандартное-имя', kind: 'head' }]);
    });

    test('одиночный "HEAD" (detached HEAD) — пропускается, не попадает в refs', () => {
      // Реальный вывод git при отсоединённом HEAD на коммите с тегами:
      // "HEAD, tag: refs/tags/v1.0" — голый "HEAD" идёт первым элементом без
      // "-> ", в отличие от прикреплённого HEAD ("HEAD -> refs/heads/main").
      // Проверено вручную на реальном git: `git checkout --detach <tag>` даёт
      // именно такую декорацию.
      const output = record(['h', '', 'HEAD, tag: refs/tags/v1.0', 'a', '1700000000', 's']);
      const [commit] = parseGitLog(output);
      assert.deepStrictEqual(commit.refs, [{ name: 'v1.0', kind: 'tag' }]);
    });

    test('"refs/heads/feature" (не текущая ветка) — kind=localBranch', () => {
      const output = record(['h', '', 'refs/heads/feature', 'a', '1700000000', 's']);
      const [commit] = parseGitLog(output);
      assert.deepStrictEqual(commit.refs, [{ name: 'feature', kind: 'localBranch' }]);
    });

    test('"refs/remotes/origin/main" — kind=remoteBranch, имя включает remote-префикс', () => {
      const output = record(['h', '', 'refs/remotes/origin/main', 'a', '1700000000', 's']);
      const [commit] = parseGitLog(output);
      assert.deepStrictEqual(commit.refs, [{ name: 'origin/main', kind: 'remoteBranch' }]);
    });

    test('"tag: refs/tags/v1.0" — kind=tag, имя без префикса "tag: refs/tags/"', () => {
      const output = record(['h', '', 'tag: refs/tags/v1.0', 'a', '1700000000', 's']);
      const [commit] = parseGitLog(output);
      assert.deepStrictEqual(commit.refs, [{ name: 'v1.0', kind: 'tag' }]);
    });

    test('"refs/tags/v1.0" без обёртки "tag: " — тоже kind=tag (защитная ветка формата)', () => {
      // Реальный `git log --decorate=full` ВСЕГДА оборачивает refs/tags/* в
      // "tag: " (проверено вручную, включая теги, созданные напрямую через
      // `git update-ref refs/tags/x`) — эта ветка защитная, на случай будущих
      // версий git/иных источников %D без обёртки. Раз документированный
      // формат допускает голый "refs/tags/…", парсер обязан его тоже понимать.
      const output = record(['h', '', 'refs/tags/v1.0', 'a', '1700000000', 's']);
      const [commit] = parseGitLog(output);
      assert.deepStrictEqual(commit.refs, [{ name: 'v1.0', kind: 'tag' }]);
    });

    test('несколько ref через ", " на одном коммите разбираются в отдельные записи', () => {
      const output = record([
        'h', '', 'tag: refs/tags/v1.0, refs/remotes/origin/main', 'a', '1700000000', 's',
      ]);
      const [commit] = parseGitLog(output);
      assert.deepStrictEqual(commit.refs, [
        { name: 'v1.0', kind: 'tag' },
        { name: 'origin/main', kind: 'remoteBranch' },
      ]);
    });
  });

  /**
   * Интеграционный тест на РЕАЛЬНОМ временном git-репозитории с ветвлением и
   * merge (`buildHistoryRepo`) — страхует от неверных предположений о точном
   * формате `--pretty=format` и `--decorate=full` (разделители, порядок
   * родителей у merge, состав %D), которые были сверены вручную с реальным
   * git при подготовке этого набора тестов.
   */
  suite('на реальном репозитории с ветвлением и merge', () => {
    let fixture: ReturnType<typeof buildHistoryRepo>;
    let commits: RawCommit[];

    suiteSetup(() => {
      fixture = buildHistoryRepo();
      const output = git(fixture.repoRoot, [
        'log', '--all', '--decorate=full', '--parents', '--topo-order',
        '--pretty=format:%H%x1f%P%x1f%D%x1f%an%x1f%at%x1f%s%x1e',
      ]);
      commits = parseGitLog(output);
    });

    suiteTeardown(() => {
      removeHistoryRepo(fixture);
    });

    function byHash(hash: string): RawCommit {
      const found = commits.find((c: RawCommit) => c.hash === hash);
      assert.ok(found, `коммит ${hash} обязан присутствовать в разобранном логе`);
      return found;
    }

    test('в лог попадают все 6 коммитов истории (--all включает недостигнутую с main ветку feature)', () => {
      assert.strictEqual(commits.length, 6);
    });

    test('корневой коммит — parents=[]', () => {
      assert.deepStrictEqual(byHash(fixture.root).parents, []);
    });

    test('точка ветвления — один родитель (корень)', () => {
      assert.deepStrictEqual(byHash(fixture.branchPoint).parents, [fixture.root]);
    });

    test('merge-коммит — родители [main, feature] в порядке слияния', () => {
      assert.deepStrictEqual(byHash(fixture.mergeCommit).parents, [fixture.mainCommit, fixture.featureCommit]);
    });

    test('точка ветвления несёт тег v1.0 и remoteBranch origin/main', () => {
      const refs = byHash(fixture.branchPoint).refs;
      assert.deepStrictEqual(
        [...refs].sort((a, b) => a.kind.localeCompare(b.kind)),
        [
          { name: 'origin/main', kind: 'remoteBranch' },
          { name: 'v1.0', kind: 'tag' },
        ].sort((a, b) => a.kind.localeCompare(b.kind))
      );
    });

    test('коммит feature вне HEAD — localBranch, а не head', () => {
      assert.deepStrictEqual(byHash(fixture.featureCommit).refs, [{ name: 'feature', kind: 'localBranch' }]);
    });

    test('последний коммит (HEAD) — ref kind=head для main', () => {
      assert.deepStrictEqual(byHash(fixture.renameCommit).refs, [{ name: 'main', kind: 'head' }]);
    });

    test('коммит без ref (main после ветвления, до merge) — refs=[]', () => {
      assert.deepStrictEqual(byHash(fixture.mainCommit).refs, []);
    });

    test('subject с юникодом (кириллица) сохраняется целиком без искажений', () => {
      assert.strictEqual(byHash(fixture.renameCommit).subject, 'переименование и кириллический файл');
    });

    test('authorTimestamp — число для каждого коммита', () => {
      for (const commit of commits) {
        assert.strictEqual(typeof commit.authorTimestamp, 'number');
        assert.ok(Number.isFinite(commit.authorTimestamp));
        assert.ok(commit.authorTimestamp > 0);
      }
    });
  });
});
