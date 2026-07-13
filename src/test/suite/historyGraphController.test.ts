import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
/**
 * Граф истории git, Слой 3b (задача D): чистый (без `vscode`) контроллер
 * панели «История» — модуль ещё не реализован, импорт обязан провалиться до
 * появления `src/ui/views/history/historyGraphController.ts`.
 *
 * Контроллер лишь СКЛЕИВАЕТ уже реализованные и протестированные Слои 1
 * (`GitLogReader`/`GitGraphLayout`/`GitCommitChangesReader`), Слой 2
 * (`MetadataChangeAggregator`) и Слой 3a (`historyGraphDtoBuilder`,
 * `changesDtoBuilder.resolveChangeAddress`) — поэтому здесь проверяется именно
 * СКЛЕЙКА (передача параметров, проброс результата), а не повторная проверка
 * уже покрытой логики нижних слоёв. Всё — на РЕАЛЬНЫХ временных
 * git-репозиториях (`buildHistoryRepo`/`buildChangesBaselineRepo`), без
 * заглушек: единственная внешняя система здесь — сам git-процесс, который
 * реален и в этом наборе тестов.
 */
import type { ChangesModel, ObjectChangeGroup } from '../../infra/git/MetadataChangeAggregator';
import { loadCommitChanges, loadHistoryState, resolveCommitDiff } from '../../ui/views/history/historyGraphController';
import type { GraphRowDto } from '../../ui/views/history/historyGraphDtoBuilder';
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

// ─── loadHistoryState ────────────────────────────────────────────────────

suite('historyGraphController — loadHistoryState: readGitLog + assignLanes + buildHistoryGraphState на реальном ветвлении+merge', () => {
  let fixture: HistoryFixture;

  suiteSetup(() => {
    fixture = buildHistoryRepo();
  });

  suiteTeardown(() => {
    removeHistoryRepo(fixture);
  });

  function nowSec(): number {
    return Math.floor(Date.now() / 1000);
  }

  test('pageSize (10) больше числа коммитов истории (6) — все строки в state, hasMore=false', () => {
    const state = loadHistoryState(fixture.repoRoot, 10, nowSec());

    assert.strictEqual(state.rows.length, 6, `ожидались все 6 коммитов истории, получено: ${String(state.rows.length)}`);
    assert.strictEqual(state.hasMore, false, 'коммитов меньше pageSize — признака «есть ещё» быть не должно');
  });

  test('pageSize РОВНО равен числу коммитов истории (6) — hasMore=true (--max-count вернул ровно столько, сколько запрошено)', () => {
    const state = loadHistoryState(fixture.repoRoot, 6, nowSec());

    assert.strictEqual(state.rows.length, 6);
    assert.strictEqual(state.hasMore, true, 'rows.length === pageSize обязан трактоваться как «возможно есть ещё»');
  });

  test('laneCount >= 1 на реальной раскладке с точкой ветвления и merge', () => {
    const state = loadHistoryState(fixture.repoRoot, 10, nowSec());

    assert.ok(state.laneCount >= 1, `ожидалось laneCount >= 1, получено: ${String(state.laneCount)}`);
  });

  test('selectedHash пробрасывается в итоговое состояние без изменений', () => {
    const state = loadHistoryState(fixture.repoRoot, 10, nowSec(), fixture.mergeCommit);

    assert.strictEqual(state.selectedHash, fixture.mergeCommit);
  });

  test('selectedHash не передан — undefined (ничего не выбрано)', () => {
    const state = loadHistoryState(fixture.repoRoot, 10, nowSec());

    assert.strictEqual(state.selectedHash, undefined);
  });

  test('merge-коммит присутствует среди строк графа с 2 родителями (main, затем feature) — раскладка assignLanes реально прогнана', () => {
    const state = loadHistoryState(fixture.repoRoot, 10, nowSec());

    const mergeRow = state.rows.find((row: GraphRowDto) => row.hash === fixture.mergeCommit);
    assert.ok(mergeRow, 'merge-коммит обязан присутствовать среди строк графа');
    assert.deepStrictEqual(mergeRow.parents, [fixture.mainCommit, fixture.featureCommit]);
  });
});

// ─── loadCommitChanges / resolveCommitDiff ──────────────────────────────

suite('historyGraphController — loadCommitChanges: агрегирует readCommitChanges(isRoot) в ChangesModel на реальном объекте метаданных', () => {
  let fixture: ChangesFixture;

  setup(() => {
    fixture = buildChangesBaselineRepo();
  });

  teardown(() => {
    removeFixtureRepo(fixture);
  });

  test('корневой коммит с isRoot=true — непустой список добавлений (A), объект «ПричиныВозврата» присутствует в model.staged', () => {
    const rootCommit = git(fixture.gitRoot, ['rev-parse', 'HEAD']).trim();

    const model = loadCommitChanges(fixture.gitRoot, fixture.configRoots, rootCommit, true);

    assert.ok(model.staged.length > 0, `корневой коммит обязан дать непустой список добавлений, получено: ${JSON.stringify(model.staged)}`);
    const catalogGroup = model.staged.find((g: ObjectChangeGroup) => g.rootName === 'ПричиныВозврата');
    assert.ok(catalogGroup, 'ожидалась группа объекта «ПричиныВозврата», добавленного корневым коммитом');
    assert.strictEqual(catalogGroup.aggregateStatus, 'A');
  });

  test('тот же корневой коммит с isRoot=false — diff-tree не может сравнить с несуществующим родителем, результат пуст', () => {
    const rootCommit = git(fixture.gitRoot, ['rev-parse', 'HEAD']).trim();

    const model = loadCommitChanges(fixture.gitRoot, fixture.configRoots, rootCommit, false);

    assert.deepStrictEqual(model.staged, []);
    assert.deepStrictEqual(model.unresolved, []);
  });

  test('коммит правки модуля объекта и модуля его команды (isRoot=false) — одна объектная группа с 2 частями и ожидаемыми rootKind/rootName', () => {
    appendLine(fixture.objectModuleBsl, '// правка модуля объекта для графа истории');
    appendLine(fixture.commandModuleBsl, '// правка модуля команды для графа истории');
    git(fixture.gitRoot, ['add', '-A']);
    git(fixture.gitRoot, ['commit', '-q', '-m', 'правка модуля и команды объекта']);
    const editCommit = git(fixture.gitRoot, ['rev-parse', 'HEAD']).trim();

    const model = loadCommitChanges(fixture.gitRoot, fixture.configRoots, editCommit, false);

    assert.strictEqual(model.staged.length, 1, `ожидалась ровно одна объектная группа, получено: ${JSON.stringify(model.staged)}`);
    const [group] = model.staged;
    assert.strictEqual(group.rootKind, 'Catalog');
    assert.strictEqual(group.rootName, 'ПричиныВозврата');
    assert.strictEqual(group.parts.length, 2, 'ожидались 2 части: модуль объекта и модуль команды');
    assert.strictEqual(group.aggregateStatus, 'M');
    assert.strictEqual(model.unresolved.length, 0);
  });

  test('коммит с файлом вне структуры выгрузки — файл попадает в model.unresolved, а не в staged', () => {
    fs.writeFileSync(path.join(fixture.workspaceRoot, 'OUTSIDE_HISTORY.txt'), 'вне структуры выгрузки\n', 'utf-8');
    git(fixture.gitRoot, ['add', '-A']);
    git(fixture.gitRoot, ['commit', '-q', '-m', 'файл вне структуры выгрузки']);
    const outsideCommit = git(fixture.gitRoot, ['rev-parse', 'HEAD']).trim();

    const model = loadCommitChanges(fixture.gitRoot, fixture.configRoots, outsideCommit, false);

    assert.strictEqual(model.staged.length, 0, 'изменений объектов метаданных в этом коммите быть не должно');
    assert.strictEqual(model.unresolved.length, 1);
    assert.strictEqual(model.unresolved[0].relPath, 'OUTSIDE_HISTORY.txt');
    assert.strictEqual(model.unresolved[0].index, 'A');
  });

  suite('resolveCommitDiff: восстановление адреса файла для vscode.diff по узлу секции коммита', () => {
    let editCommit: string;
    let model: ChangesModel;
    let relObjectModule: string;
    let relCommandModule: string;

    setup(() => {
      relObjectModule = path.relative(fixture.gitRoot, fixture.objectModuleBsl).split(path.sep).join('/');
      relCommandModule = path.relative(fixture.gitRoot, fixture.commandModuleBsl).split(path.sep).join('/');
      appendLine(fixture.objectModuleBsl, '// правка модуля объекта для diff');
      appendLine(fixture.commandModuleBsl, '// правка модуля команды для diff');
      git(fixture.gitRoot, ['add', '-A']);
      git(fixture.gitRoot, ['commit', '-q', '-m', 'правка для resolveCommitDiff']);
      editCommit = git(fixture.gitRoot, ['rev-parse', 'HEAD']).trim();
      model = loadCommitChanges(fixture.gitRoot, fixture.configRoots, editCommit, false);
    });

    test('одиночная часть объекта (nodeId staged#0.0) — определённый CommitDiff с ref-диапазоном коммит^..коммит на реальном файле', () => {
      assert.strictEqual(model.staged.length, 1, 'подготовка теста: ожидалась одна объектная группа с 2 частями');

      const diff = resolveCommitDiff(model, editCommit, 'staged#0.0');

      assert.ok(diff, 'ожидался определённый CommitDiff для одиночной части объекта');
      assert.ok(
        diff.relFile === relObjectModule || diff.relFile === relCommandModule,
        `relFile обязан быть одним из изменённых файлов объекта, получено: ${diff.relFile}`
      );
      assert.strictEqual(diff.leftRef, `${editCommit}^`, 'leftRef — родитель коммита (commit-ish "hash^")');
      assert.strictEqual(diff.rightRef, editCommit, 'rightRef — сам коммит');
      const shortHash = editCommit.slice(0, 7);
      assert.ok(diff.title.includes(shortHash), `title обязан содержать короткий хеш коммита, получено: ${diff.title}`);
      assert.ok(
        diff.title.includes(path.basename(diff.relFile)),
        `title обязан содержать имя файла, получено: ${diff.title}`
      );
    });

    test('целый объект из нескольких частей (nodeId staged#0, без индекса части) — undefined, у diff нет единственного файла', () => {
      const diff = resolveCommitDiff(model, editCommit, 'staged#0');

      assert.strictEqual(diff, undefined);
    });

    test('несуществующий узел (индекс группы за пределами модели) — undefined, без исключения', () => {
      const diff = resolveCommitDiff(model, editCommit, 'staged#99');

      assert.strictEqual(diff, undefined);
    });

    test('нераспознаваемый/битый nodeId — undefined, без исключения', () => {
      assert.strictEqual(resolveCommitDiff(model, editCommit, 'не-похоже-на-id'), undefined);
    });
  });
});
