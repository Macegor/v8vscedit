import * as assert from 'assert';
import * as path from 'path';
/**
 * Редизайн графа истории (host-часть, задача переноса в панель «Изменения
 * метаданных»): чистый (без `vscode`) helper `ChangesHistorySection` —
 * модуль ещё не реализован, импорт обязан провалиться до появления
 * `src/ui/views/changes/changesHistorySection.ts`.
 *
 * Helper инкапсулирует состояние графа истории (`pageSize`/`selectedHash`/
 * `selectedModel`/`loaded`) и лишь СКЛЕИВАЕТ уже реализованные и покрытые
 * `loadHistoryState`/`loadCommitChanges`/`resolveCommitDiff`
 * (`historyGraphController.ts`) и `buildCommitChangesSection`
 * (`historyGraphDtoBuilder.ts`) — поэтому здесь проверяется именно СКЛЕЙКА
 * (ленивость, проброс параметров/pageSize, кеш выбранного коммита), а не
 * повторно логика нижних слоёв (она уже покрыта `historyGraphController.test.ts`/
 * `historyGraphDtoBuilder.test.ts`). Всё — на РЕАЛЬНЫХ временных
 * git-репозиториях (`buildHistoryRepo`/`buildChangesBaselineRepo`), без
 * заглушек: единственная внешняя система здесь — сам git-процесс.
 */
import type { ConfigEntry } from '../../domain/Configuration';
import type { ChangesSectionDto, IconResolver, TreeNodeDto } from '../../ui/views/changes/changesDtoBuilder';
import { ChangesHistorySection } from '../../ui/views/changes/changesHistorySection';
import {
  appendLine,
  buildChangesBaselineRepo,
  buildHistoryRepo,
  git,
  removeFixtureRepo,
  removeHistoryRepo,
  type ChangesFixture,
  type HistoryFixture,
} from './support/changesFixtures';

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/** Резолвер иконки-заглушка: единственная внешняя недоступная здесь система —
 *  реальный webview-URI (нужен `vscode`), которого в чистом helper-тесте нет. */
const fakeIconResolver: IconResolver = () => ({ kind: 'none' });

/** Собирает ВСЕ узлы дерева секции (рекурсивно) — по образцу `metadataChangesViewProvider.test.ts`. */
function collectAllNodes(nodes: readonly TreeNodeDto[]): TreeNodeDto[] {
  const result: TreeNodeDto[] = [];
  const visit = (list: readonly TreeNodeDto[]): void => {
    for (const node of list) {
      result.push(node);
      if (node.children) {
        visit(node.children);
      }
    }
  };
  visit(nodes);
  return result;
}

function findByLabel(section: ChangesSectionDto, label: string): TreeNodeDto | undefined {
  return collectAllNodes(section.nodes).find((n) => n.label === label);
}

suite('ChangesHistorySection — состояние графа истории панели «Изменения метаданных» (склейка historyGraphController)', () => {
  // ─── load/refresh/loadMore — ленивость и пересчёт состояния графа ──────
  suite('load/refresh/loadMore — на реальном ветвлении+merge (buildHistoryRepo, configRoots не нужны)', () => {
    let fixture: HistoryFixture;
    let getConfigRoots: () => readonly ConfigEntry[];

    setup(() => {
      fixture = buildHistoryRepo();
      getConfigRoots = () => [];
    });

    teardown(() => {
      removeHistoryRepo(fixture);
    });

    test('isLoaded() до вызова load() — false', () => {
      const helper = new ChangesHistorySection({ gitRoot: fixture.repoRoot, getConfigRoots });

      assert.strictEqual(helper.isLoaded(), false);
    });

    test('load() возвращает HistoryGraphState с непустыми rows и laneCount>=1; isLoaded() становится true', () => {
      const helper = new ChangesHistorySection({ gitRoot: fixture.repoRoot, getConfigRoots });

      const state = helper.load(nowSec());

      assert.ok(state.rows.length > 0, `ожидались непустые rows реального графа истории, получено: ${String(state.rows.length)}`);
      assert.ok(state.laneCount >= 1, `ожидался laneCount>=1, получено: ${String(state.laneCount)}`);
      assert.strictEqual(helper.isLoaded(), true);
    });

    test('refresh() ДО load() — undefined (ленивость: git log вхолостую не читается)', () => {
      const helper = new ChangesHistorySection({ gitRoot: fixture.repoRoot, getConfigRoots });

      assert.strictEqual(helper.refresh(nowSec()), undefined);
    });

    test('refresh() ПОСЛЕ load() — возвращает пересчитанный state, а не undefined', () => {
      const helper = new ChangesHistorySection({ gitRoot: fixture.repoRoot, getConfigRoots });
      helper.load(nowSec());

      const refreshed = helper.refresh(nowSec());

      assert.ok(refreshed, 'после load() refresh() обязан вернуть состояние');
      assert.ok(refreshed.rows.length > 0);
      assert.strictEqual(helper.isLoaded(), true);
    });

    test('loadMore() увеличивает окно pageSize (число строк не убывает) и оставляет isLoaded()=true', () => {
      // Фикстура содержит всего 6 коммитов, а pageSize стартует с 200 — рост
      // окна не проявляется через hasMore (он и так false), поэтому здесь
      // проверяется общий инвариант: loadMore не может ВЫКИНУТЬ уже видимые
      // строки графа, а окно (стартовое либо выросшее) покрывает все 6.
      const helper = new ChangesHistorySection({ gitRoot: fixture.repoRoot, getConfigRoots });
      const initial = helper.load(nowSec());

      const grown = helper.loadMore(nowSec());

      assert.strictEqual(helper.isLoaded(), true);
      assert.ok(grown.rows.length >= initial.rows.length, 'после loadMore число строк графа не должно уменьшаться');
      assert.strictEqual(grown.rows.length, 6, 'все 6 коммитов фикстуры обязаны уместиться в выросшее окно');
      assert.strictEqual(grown.hasMore, false);
    });

    test('loadMore() БЕЗ предварительного load() — тоже переводит helper в загруженное состояние (loaded=true)', () => {
      const helper = new ChangesHistorySection({ gitRoot: fixture.repoRoot, getConfigRoots });

      const state = helper.loadMore(nowSec());

      assert.ok(state.rows.length > 0);
      assert.strictEqual(helper.isLoaded(), true);
    });
  });

  // ─── selectCommit/resolveDiff — агрегация изменений реального объекта ──
  suite('selectCommit/resolveDiff — на реальном объекте метаданных (buildChangesBaselineRepo)', () => {
    let fixture: ChangesFixture;
    let getConfigRoots: () => readonly ConfigEntry[];

    setup(() => {
      fixture = buildChangesBaselineRepo();
      getConfigRoots = () => fixture.configRoots;
    });

    teardown(() => {
      removeFixtureRepo(fixture);
    });

    test('resolveDiff БЕЗ предварительного selectCommit — undefined (нет выбранного коммита)', () => {
      const helper = new ChangesHistorySection({ gitRoot: fixture.gitRoot, getConfigRoots });

      assert.strictEqual(helper.resolveDiff('staged#0.0'), undefined);
    });

    test('selectCommit(rootCommit) — {section} с меткой «Изменения коммита» и объектным узлом «ПричиныВозврата» (статус added)', () => {
      const helper = new ChangesHistorySection({ gitRoot: fixture.gitRoot, getConfigRoots });
      const rootCommit = git(fixture.gitRoot, ['rev-parse', 'HEAD']).trim();

      const { section } = helper.selectCommit(rootCommit, fakeIconResolver);

      assert.strictEqual(section.label, 'Изменения коммита');
      const objectNode = findByLabel(section, 'ПричиныВозврата');
      assert.ok(objectNode, `ожидался объектный узел «ПричиныВозврата», получено: ${JSON.stringify(section.nodes)}`);
      assert.strictEqual(objectNode.gitStatus, 'added', 'корневой коммит добавляет объект целиком');
    });

    test('selectCommit по коммиту вне истории (parents.length===0 не определяется по rows) — не бросает, секция может быть пустой', () => {
      // Синтетический, синтаксически валидный, но отсутствующий хеш: isRoot
      // трактуется как false (строка не найдена в свежем loadHistoryState), а
      // readCommitChanges по несуществующему коммиту мягко возвращает пусто.
      const helper = new ChangesHistorySection({ gitRoot: fixture.gitRoot, getConfigRoots });

      assert.doesNotThrow(() => {
        helper.selectCommit('0123456789012345678901234567890123456789', fakeIconResolver);
      });
    });

    test('selectCommit по коммиту с ОДНОЙ изменённой частью — resolveDiff(staged#0.0) даёт CommitDiff с ref-диапазоном коммит^..коммит', () => {
      appendLine(fixture.objectModuleBsl, '// правка модуля объекта для diff (ChangesHistorySection)');
      git(fixture.gitRoot, ['add', path.relative(fixture.gitRoot, fixture.objectModuleBsl)]);
      git(fixture.gitRoot, ['commit', '-q', '-m', 'правка модуля объекта']);
      const editCommit = git(fixture.gitRoot, ['rev-parse', 'HEAD']).trim();
      const helper = new ChangesHistorySection({ gitRoot: fixture.gitRoot, getConfigRoots });

      helper.selectCommit(editCommit, fakeIconResolver);
      const diff = helper.resolveDiff('staged#0.0');

      assert.ok(diff, 'ожидался определённый CommitDiff для одиночной изменённой части объекта');
      assert.strictEqual(diff.leftRef, `${editCommit}^`, 'leftRef — родитель коммита');
      assert.strictEqual(diff.rightRef, editCommit, 'rightRef — сам коммит');
      const shortHash = editCommit.slice(0, 7);
      assert.ok(diff.title.includes(shortHash), `title обязан содержать короткий хеш, получено: ${diff.title}`);
    });

    test('selectCommit по коммиту с ДВУМЯ изменёнными частями — resolveDiff(staged#0) без индекса части — undefined (не single)', () => {
      appendLine(fixture.objectModuleBsl, '// правка модуля объекта');
      appendLine(fixture.commandModuleBsl, '// правка модуля команды');
      git(fixture.gitRoot, ['add', '-A']);
      git(fixture.gitRoot, ['commit', '-q', '-m', 'правка модуля и команды объекта']);
      const editCommit = git(fixture.gitRoot, ['rev-parse', 'HEAD']).trim();
      const helper = new ChangesHistorySection({ gitRoot: fixture.gitRoot, getConfigRoots });

      helper.selectCommit(editCommit, fakeIconResolver);

      assert.strictEqual(helper.resolveDiff('staged#0'), undefined, 'целый объект из 2 частей не адресует единственный файл');
    });

    test('resolveDiff с нераспознаваемым/битым nodeId после selectCommit — undefined, без исключения', () => {
      const rootCommit = git(fixture.gitRoot, ['rev-parse', 'HEAD']).trim();
      const helper = new ChangesHistorySection({ gitRoot: fixture.gitRoot, getConfigRoots });

      helper.selectCommit(rootCommit, fakeIconResolver);

      assert.strictEqual(helper.resolveDiff('не-похоже-на-id'), undefined);
    });

    test('повторный selectCommit другим коммитом обновляет кеш выбранной модели — resolveDiff отвечает по ПОСЛЕДНЕМУ выбранному коммиту', () => {
      appendLine(fixture.objectModuleBsl, '// первая правка модуля объекта');
      git(fixture.gitRoot, ['add', path.relative(fixture.gitRoot, fixture.objectModuleBsl)]);
      git(fixture.gitRoot, ['commit', '-q', '-m', 'первая правка']);
      const firstEdit = git(fixture.gitRoot, ['rev-parse', 'HEAD']).trim();

      appendLine(fixture.commandModuleBsl, '// вторая правка модуля команды');
      git(fixture.gitRoot, ['add', path.relative(fixture.gitRoot, fixture.commandModuleBsl)]);
      git(fixture.gitRoot, ['commit', '-q', '-m', 'вторая правка']);
      const secondEdit = git(fixture.gitRoot, ['rev-parse', 'HEAD']).trim();

      const helper = new ChangesHistorySection({ gitRoot: fixture.gitRoot, getConfigRoots });
      helper.selectCommit(firstEdit, fakeIconResolver);
      helper.selectCommit(secondEdit, fakeIconResolver);

      const diff = helper.resolveDiff('staged#0.0');
      assert.ok(diff, 'ожидался CommitDiff по последнему выбранному коммиту');
      assert.strictEqual(diff.rightRef, secondEdit, 'resolveDiff обязан отвечать по ПОСЛЕДНЕМУ выбранному коммиту, а не по первому');
    });
  });
});
