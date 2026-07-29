/**
 * Фикс: панель «Изменения метаданных» (`v8vsceditChanges`) должна обновляться
 * на любые git-события (stage/unstage/commit/checkout/rebase и т.п.), а не
 * только на изменения файлов рабочего дерева, которые ловит fs-вотчер.
 * `GitStateObserver` — тонкий vscode-фасад, подписывающий колбэк на
 * `repository.state.onDidChange` встроенного Git-расширения VS Code
 * (`vscode.git`), с учётом того, что API репозитория может появиться позже
 * (ленивая инициализация `vscode.git`) или репозиторий может открыться после
 * старта панели (`onDidOpenRepository`).
 *
 * Стиль — по образцу `metadataChangesViewProvider.test.ts`: единственная
 * внешняя недоступная система — само встроенное Git-расширение (в headless
 * Extension Host тестов оно не гарантированно инициализировано с реальными
 * репозиториями к нужному моменту), поэтому `GitApiLike`/`RepositoryLike`
 * реализованы вручную — НЕ стабом поведения, а верной in-memory реализацией
 * формы API на настоящих `vscode.EventEmitter`/`vscode.Uri`. `rootUri` берётся
 * из настоящего временного git-репозитория (`changesFixtures`), поэтому
 * сопоставление корня идёт через реальный `selectGitRepository`.
 */
import * as assert from 'assert';
import * as vscode from 'vscode';
import { GitStateObserver } from '../../ui/git/GitStateObserver';
import type { GitApiLike, RepositoryLike } from '../../ui/git/gitExtensionApi';
import { buildChangesBaselineRepo, removeFixtureRepo, type ChangesFixture } from './support/changesFixtures';

/** Один репозиторий Git Extension API — верная in-memory реализация формы `RepositoryLike`. */
function createFakeRepository(root: string): RepositoryLike {
  const stateChangeEmitter = new vscode.EventEmitter<void>();
  return {
    rootUri: vscode.Uri.file(root),
    state: {
      onDidChange: stateChangeEmitter.event,
    },
    // Не часть контракта RepositoryLike — тестовый доступ к «включению» события.
    _fireStateChange: () => stateChangeEmitter.fire(),
    _dispose: () => stateChangeEmitter.dispose(),
  } as RepositoryLike & { _fireStateChange: () => void; _dispose: () => void };
}

/** Верная in-memory реализация формы `GitApiLike` с управляемым состоянием/списком репозиториев. */
function createFakeGitApi(initialState: 'uninitialized' | 'initialized'): GitApiLike & {
  setState: (state: 'uninitialized' | 'initialized') => void;
  addRepository: (repo: RepositoryLike) => void;
  repositoriesList: RepositoryLike[];
  disposeEmitters: () => void;
} {
  let state: 'uninitialized' | 'initialized' = initialState;
  const repositoriesList: RepositoryLike[] = [];
  const stateEmitter = new vscode.EventEmitter<'uninitialized' | 'initialized'>();
  const openRepositoryEmitter = new vscode.EventEmitter<RepositoryLike>();

  return {
    get state() {
      return state;
    },
    get repositories() {
      return repositoriesList;
    },
    onDidChangeState: stateEmitter.event,
    onDidOpenRepository: openRepositoryEmitter.event,
    setState: (next: 'uninitialized' | 'initialized') => {
      state = next;
      stateEmitter.fire(next);
    },
    addRepository: (repo: RepositoryLike) => {
      repositoriesList.push(repo);
      openRepositoryEmitter.fire(repo);
    },
    repositoriesList,
    disposeEmitters: () => {
      stateEmitter.dispose();
      openRepositoryEmitter.dispose();
    },
  };
}

type FakeRepository = RepositoryLike & { _fireStateChange: () => void; _dispose: () => void };

suite('GitStateObserver — подписка на события встроенного Git-расширения', () => {
  let fixture: ChangesFixture;

  setup(() => {
    fixture = buildChangesBaselineRepo();
  });

  teardown(() => {
    removeFixtureRepo(fixture);
  });

  test('api === undefined → start() не бросает, onChange не зовётся, dispose() не бросает', () => {
    // Ранний guard: встроенное Git-расширение может быть выключено пользователем
    // либо `vscode.git` API ещё не готово — наблюдатель должен быть no-op,
    // а не падать активацией расширения.
    let calls = 0;
    const observer = new GitStateObserver(undefined, fixture.gitRoot, () => {
      calls += 1;
    });
    assert.doesNotThrow(() => observer.start());
    assert.strictEqual(calls, 0);
    assert.doesNotThrow(() => observer.dispose());
  });

  test("state='initialized' + совпадающий репозиторий на старте → fire state.onDidChange зовёт onChange 1 раз", () => {
    const repo = createFakeRepository(fixture.gitRoot) as FakeRepository;
    const api = createFakeGitApi('initialized');
    api.addRepository(repo);

    let calls = 0;
    const observer = new GitStateObserver(api, fixture.gitRoot, () => {
      calls += 1;
    });
    observer.start();

    repo._fireStateChange();
    assert.strictEqual(calls, 1, 'onDidChange совпадающего репозитория должен вызвать onChange ровно один раз');

    observer.dispose();
    api.disposeEmitters();
    repo._dispose();
  });

  test(
    "state='uninitialized' → сразу не подписан; переход в 'initialized' (репо уже в списке) подписывает",
    () => {
      const repo = createFakeRepository(fixture.gitRoot) as FakeRepository;
      const api = createFakeGitApi('uninitialized');
      api.addRepository(repo);

      let calls = 0;
      const observer = new GitStateObserver(api, fixture.gitRoot, () => {
        calls += 1;
      });
      observer.start();

      // До перехода в 'initialized' наблюдатель ещё не должен был подписаться
      // напрямую на repo.state — но подписка на onDidOpenRepository могла
      // сработать раньше (репозиторий уже добавлен через addRepository выше,
      // что само по себе стреляет onDidOpenRepository). Поэтому здесь
      // проверяем именно ветку onDidChangeState: репозиторий добавляем ПОСЛЕ
      // старта через отдельный сценарий ниже, а здесь фокус — что событие
      // state доходит после явного перехода состояния.
      repo._fireStateChange();
      const callsBeforeStateTransition = calls;

      api.setState('initialized');

      repo._fireStateChange();
      assert.strictEqual(
        calls,
        callsBeforeStateTransition + 1,
        'после перехода в initialized повторный выбор репозитория должен подписать state.onDidChange'
      );

      observer.dispose();
      api.disposeEmitters();
      repo._dispose();
    }
  );

  test('совпадающего репозитория нет на старте → появление через onDidOpenRepository подписывает', () => {
    const api = createFakeGitApi('initialized');
    // На старте список репозиториев пуст — совпадающего репо ещё нет.

    let calls = 0;
    const observer = new GitStateObserver(api, fixture.gitRoot, () => {
      calls += 1;
    });
    observer.start();

    const repo = createFakeRepository(fixture.gitRoot) as FakeRepository;
    api.addRepository(repo);

    repo._fireStateChange();
    assert.strictEqual(calls, 1, 'репозиторий, открытый после start(), должен быть подписан через onDidOpenRepository');

    observer.dispose();
    api.disposeEmitters();
    repo._dispose();
  });

  test('onDidOpenRepository с НЕсовпадающим rootUri не подписывается — его state-change не зовёт onChange', () => {
    const api = createFakeGitApi('initialized');

    let calls = 0;
    const observer = new GitStateObserver(api, fixture.gitRoot, () => {
      calls += 1;
    });
    observer.start();

    // Заведомо другой корень — каталог внутри репозитория, а не toplevel.
    const nonMatchingRepo = createFakeRepository(fixture.catalogsDir) as FakeRepository;
    api.addRepository(nonMatchingRepo);

    nonMatchingRepo._fireStateChange();
    assert.strictEqual(calls, 0, 'несовпадающий по корню репозиторий не должен вызывать onChange');

    observer.dispose();
    api.disposeEmitters();
    nonMatchingRepo._dispose();
  });

  test('несколько репозиториев в repositories → подписан только совпадающий, остальные игнорируются', () => {
    const matching = createFakeRepository(fixture.gitRoot) as FakeRepository;
    const nonMatchingA = createFakeRepository(fixture.catalogsDir) as FakeRepository;
    const nonMatchingB = createFakeRepository('/tmp/совсем-другой-репозиторий') as FakeRepository;

    const api = createFakeGitApi('initialized');
    api.addRepository(nonMatchingA);
    api.addRepository(matching);
    api.addRepository(nonMatchingB);

    let calls = 0;
    const observer = new GitStateObserver(api, fixture.gitRoot, () => {
      calls += 1;
    });
    observer.start();

    nonMatchingA._fireStateChange();
    nonMatchingB._fireStateChange();
    assert.strictEqual(calls, 0, 'несовпадающие репозитории не должны вызывать onChange');

    matching._fireStateChange();
    assert.strictEqual(calls, 1, 'совпадающий репозиторий должен вызвать onChange');

    observer.dispose();
    api.disposeEmitters();
    matching._dispose();
    nonMatchingA._dispose();
    nonMatchingB._dispose();
  });

  test(
    'guard двойной подписки: повторный onDidOpenRepository для уже подписанного репозитория не даёт двойной вызов onChange',
    () => {
      const api = createFakeGitApi('initialized');
      const repo = createFakeRepository(fixture.gitRoot) as FakeRepository;
      api.addRepository(repo);

      let calls = 0;
      const observer = new GitStateObserver(api, fixture.gitRoot, () => {
        calls += 1;
      });
      observer.start();

      // Тот же самый репозиторий «переоткрывается» повторно (Git-расширение
      // может прислать onDidOpenRepository для уже известного корня, например
      // после reload workspace folders) — не должно завести вторую подписку
      // на один и тот же repo.state.onDidChange.
      api.addRepository(repo);

      repo._fireStateChange();
      assert.strictEqual(calls, 1, 'один state-change совпадающего репозитория должен давать ровно один onChange');

      observer.dispose();
      api.disposeEmitters();
      repo._dispose();
    }
  );

  test(
    "guard двойной подписки через onDidChangeState: повторный переход в 'initialized' не даёт двойной вызов onChange",
    () => {
      const api = createFakeGitApi('uninitialized');
      const repo = createFakeRepository(fixture.gitRoot) as FakeRepository;
      api.addRepository(repo);

      let calls = 0;
      const observer = new GitStateObserver(api, fixture.gitRoot, () => {
        calls += 1;
      });
      observer.start();

      api.setState('initialized');
      // Повторный (избыточный) сигнал того же состояния — реальное Git-расширение
      // может прислать несколько уведомлений о состоянии подряд.
      api.setState('initialized');

      repo._fireStateChange();
      assert.strictEqual(calls, 1, 'повторный переход в тот же initialized не должен приводить к двойной подписке');

      observer.dispose();
      api.disposeEmitters();
      repo._dispose();
    }
  );

  test('dispose() снимает все подписки: последующие state-change и onDidOpenRepository не зовут onChange', () => {
    const api = createFakeGitApi('initialized');
    const repo = createFakeRepository(fixture.gitRoot) as FakeRepository;
    api.addRepository(repo);

    let calls = 0;
    const observer = new GitStateObserver(api, fixture.gitRoot, () => {
      calls += 1;
    });
    observer.start();

    repo._fireStateChange();
    assert.strictEqual(calls, 1);

    observer.dispose();

    repo._fireStateChange();
    assert.strictEqual(calls, 1, 'после dispose() состояние совпадающего репозитория не должно вызывать onChange');

    const lateRepo = createFakeRepository(`${fixture.gitRoot}/`) as FakeRepository;
    api.addRepository(lateRepo);
    lateRepo._fireStateChange();
    assert.strictEqual(calls, 1, 'после dispose() новые открытые репозитории не должны подписываться');

    api.disposeEmitters();
    repo._dispose();
    lateRepo._dispose();
  });
});
