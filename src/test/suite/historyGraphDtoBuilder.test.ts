import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
/**
 * Граф истории git, Слой 3a (задача D): чистая (без `vscode`) сборка DTO
 * панели «История» — модуль ещё не реализован, импорт обязан провалиться до
 * появления `src/ui/views/history/historyGraphDtoBuilder.ts`.
 *
 * Раскладка `assignLanes`/`parseGitLog` (Слой 1) уже реализована и ЧИСТАЯ —
 * здесь она прогоняется на РЕАЛЬНОМ временном git-репозитории с ветвлением и
 * merge (`buildHistoryRepo`), чтобы `buildGraphRows`/`buildHistoryGraphState`
 * проверялись на настоящей раскладке, а не на выдуманном литерале.
 * `buildCommitChangesSection` проверяется на реальной модели изменений
 * (`aggregateMetadataChanges` + `buildChangesBaselineRepo`, тот же фундамент,
 * что у `changesDtoBuilder.test.ts`).
 */
import { assignLanes, type GraphLayout } from '../../infra/git/GitGraphLayout';
import { parseGitLog, type RawCommit } from '../../infra/git/GitLogParser';
import { aggregateMetadataChanges, type ChangesModel } from '../../infra/git/MetadataChangeAggregator';
import { readPorcelainEntries } from '../../infra/git/GitStatusReader';
import type { ChangesSectionDto, IconDto, IconResolver, TreeNodeDto } from '../../ui/views/changes/changesDtoBuilder';
import {
  buildCommitChangesSection,
  buildGraphRows,
  buildHistoryGraphState,
  formatRelativeDate,
  type GraphRowDto,
} from '../../ui/views/history/historyGraphDtoBuilder';
import {
  buildChangesBaselineRepo,
  buildHistoryRepo,
  git,
  removeFixtureRepo,
  removeHistoryRepo,
  type ChangesFixture,
  type HistoryFixture,
} from './support/changesFixtures';

// ─── formatRelativeDate ──────────────────────────────────────────────────

suite('historyGraphDtoBuilder — formatRelativeDate: относительная дата на русском с плюрализацией числительных', () => {
  // Фиксированная опорная точка «сейчас» — тест не должен зависеть от
  // реального времени запуска (в отличие от diff, который явно параметризован).
  const NOW = 2_000_000_000;

  /**
   * Конкретные словоформы ниже — ПРЕДЛОЖЕННЫЙ контракт (developer может
   * уточнить формулировку по согласованию), но инвариант обязателен всегда:
   * для diff < 60с — «только что», иначе строка вида «<число> <единица>
   * назад» с корректной русской плюрализацией (1→ед.ч., 2-4/22-24→им.мн.
   * краткая форма, 5-20/25-30→род.мн., 11-14→род.мн. даже при последней
   * цифре 1). Единицы измерения: минуты(<3600с), часы(<86400с),
   * дни(<30 дней), месяцы(<365 дней, floor(дни/30)), годы(floor(дни/365)).
   */
  const cases: readonly [number, string][] = [
    [0, 'только что'],
    [30, 'только что'],
    [59, 'только что'],
    [60, '1 минуту назад'],
    [2 * 60, '2 минуты назад'],
    [5 * 60, '5 минут назад'],
    [11 * 60, '11 минут назад'],
    [21 * 60, '21 минуту назад'],
    [3600, '1 час назад'],
    [2 * 3600, '2 часа назад'],
    [5 * 3600, '5 часов назад'],
    [86400, '1 день назад'],
    [2 * 86400, '2 дня назад'],
    [5 * 86400, '5 дней назад'],
    [60 * 86400, '2 месяца назад'],
    [150 * 86400, '5 месяцев назад'],
    [400 * 86400, '1 год назад'],
    [800 * 86400, '2 года назад'],
    [1825 * 86400, '5 лет назад'],
  ];

  for (const [diffSec, expected] of cases) {
    test(`nowSec - ts = ${String(diffSec)} с → «${expected}»`, () => {
      const result = formatRelativeDate(NOW - diffSec, NOW);
      assert.strictEqual(result, expected);
    });
  }

  test('инвариант: коммит из будущего (ts > nowSec, напр. рассинхрон часов) не бросает исключение', () => {
    assert.doesNotThrow(() => formatRelativeDate(NOW + 60, NOW));
  });

  test('инвариант формы: результат для diff>=60с начинается с числительного и заканчивается на «назад»', () => {
    const result = formatRelativeDate(NOW - 10 * 60, NOW);
    assert.ok(/^\d+\s/.test(result), `ожидалось числительное в начале строки, получено: ${result}`);
    assert.ok(result.endsWith('назад'), `ожидалось «назад» в конце строки, получено: ${result}`);
  });
});

// ─── buildGraphRows / buildHistoryGraphState ────────────────────────────

suite('historyGraphDtoBuilder — buildGraphRows/buildHistoryGraphState на реальной раскладке ветвления+merge', () => {
  let fixture: HistoryFixture;
  let layout: GraphLayout;

  suiteSetup(() => {
    fixture = buildHistoryRepo();
    const output = git(fixture.repoRoot, [
      'log', '--all', '--decorate=full', '--parents', '--topo-order',
      '--pretty=format:%H%x1f%P%x1f%D%x1f%an%x1f%at%x1f%s%x1e',
    ]);
    const commits: RawCommit[] = parseGitLog(output);
    layout = assignLanes(commits);
  });

  suiteTeardown(() => {
    removeHistoryRepo(fixture);
  });

  test('buildGraphRows: одна DTO-строка на каждую строку раскладки, hash/parents/lane/edges/subject/author перенесены без искажений', () => {
    const nowSec = Math.floor(Date.now() / 1000) + 60;

    const rows: GraphRowDto[] = buildGraphRows(layout, nowSec);

    assert.strictEqual(rows.length, layout.rows.length, 'число DTO-строк обязано совпадать с числом строк раскладки');
    const sourceRow = layout.rows.find((r) => r.commit.hash === fixture.mergeCommit);
    assert.ok(sourceRow, 'merge-коммит обязан присутствовать в раскладке');
    const mergeRow = rows.find((r) => r.hash === fixture.mergeCommit);
    assert.ok(mergeRow, 'merge-коммит обязан присутствовать среди DTO-строк');

    assert.strictEqual(mergeRow.shortHash, fixture.mergeCommit.slice(0, 7), 'shortHash — первые 7 символов полного хеша');
    assert.deepStrictEqual(mergeRow.parents, [fixture.mainCommit, fixture.featureCommit], 'порядок родителей merge сохранён (main, затем feature)');
    assert.strictEqual(mergeRow.lane, sourceRow.lane);
    assert.deepStrictEqual(
      mergeRow.edges.map((e: { fromLane: number; toLane: number; color: number }) => [e.fromLane, e.toLane, e.color]),
      sourceRow.edges.map((e) => [e.fromLane, e.toLane, e.color]),
      'рёбра переносятся из GraphRow.edges без изменений'
    );
    assert.strictEqual(mergeRow.subject, 'слияние feature в main');
    assert.strictEqual(mergeRow.author, sourceRow.commit.authorName);
    assert.strictEqual(
      mergeRow.relativeDate,
      formatRelativeDate(sourceRow.commit.authorTimestamp, nowSec),
      'relativeDate обязан быть результатом formatRelativeDate(commit.authorTimestamp, nowSec)'
    );
    assert.ok(/\d{4}/.test(mergeRow.absoluteDate), `absoluteDate обязан содержать год (4 цифры), получено: ${mergeRow.absoluteDate}`);
  });

  test('buildGraphRows: refs коммита переносятся как RefDto с теми же name/kind (точка ветвления — тег v1.0 + remoteBranch origin/main)', () => {
    const nowSec = Math.floor(Date.now() / 1000);

    const rows: GraphRowDto[] = buildGraphRows(layout, nowSec);
    const branchRow = rows.find((r) => r.hash === fixture.branchPoint);
    assert.ok(branchRow, 'точка ветвления обязана присутствовать среди DTO-строк');

    const kinds = branchRow.refs.map((r: { name: string; kind: string }) => r.kind).sort();
    assert.deepStrictEqual(kinds, ['remoteBranch', 'tag']);
    assert.ok(
      branchRow.refs.some((r: { name: string; kind: string }) => r.name === 'v1.0' && r.kind === 'tag'),
      'тег v1.0 обязан присутствовать среди refs'
    );
    assert.ok(
      branchRow.refs.some((r: { name: string; kind: string }) => r.name === 'origin/main' && r.kind === 'remoteBranch'),
      'remoteBranch origin/main обязан присутствовать среди refs'
    );
  });

  test('buildGraphRows: коммит без refs (main после ветвления, до merge) — пустой массив refs', () => {
    const rows: GraphRowDto[] = buildGraphRows(layout, Math.floor(Date.now() / 1000));
    const mainRow = rows.find((r) => r.hash === fixture.mainCommit);
    assert.ok(mainRow);
    assert.deepStrictEqual(mainRow.refs, []);
  });

  test('buildHistoryGraphState: агрегирует rows/laneCount/hasMore/selectedHash без искажений', () => {
    const nowSec = Math.floor(Date.now() / 1000);

    const state = buildHistoryGraphState(layout, nowSec, true, fixture.mergeCommit);

    assert.strictEqual(state.rows.length, layout.rows.length);
    assert.strictEqual(state.laneCount, layout.laneCount);
    assert.strictEqual(state.hasMore, true);
    assert.strictEqual(state.selectedHash, fixture.mergeCommit);
  });

  test('buildHistoryGraphState: selectedHash не передан → undefined (ничего не выбрано), hasMore=false отражается как есть', () => {
    const state = buildHistoryGraphState(layout, Math.floor(Date.now() / 1000), false);

    assert.strictEqual(state.selectedHash, undefined);
    assert.strictEqual(state.hasMore, false);
  });
});

// ─── buildCommitChangesSection ───────────────────────────────────────────

/** Собирает ВСЕ узлы дерева (рекурсивно) — по образцу helper'ов остальных тестов панели изменений. */
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

function findByLabel(nodes: readonly TreeNodeDto[], label: string): TreeNodeDto | undefined {
  return collectAllNodes(nodes).find((n) => n.label === label);
}

function findDescendantByLabel(node: TreeNodeDto, label: string): TreeNodeDto | undefined {
  return collectAllNodes(node.children ?? []).find((n) => n.label === label);
}

function fakeIconResolver(): IconResolver {
  return (kind): IconDto => ({ kind: 'metadata', name: kind });
}

suite('historyGraphDtoBuilder — buildCommitChangesSection: read-only секция изменений коммита (staged + unresolved)', () => {
  let fixture: ChangesFixture;

  setup(() => {
    fixture = buildChangesBaselineRepo();
  });

  teardown(() => {
    removeFixtureRepo(fixture);
  });

  function buildModel(): ChangesModel {
    const entries = readPorcelainEntries(fixture.gitRoot);
    return aggregateMetadataChanges(entries, fixture.gitRoot, fixture.configRoots);
  }

  test('объектный узел из model.staged собран с навигаторной иерархией (синтезированный предок «Справочники») и БЕЗ inlineActions', () => {
    fs.appendFileSync(fixture.objectModuleBsl, '\n// правка для секции изменений коммита\n', 'utf-8');
    git(fixture.gitRoot, ['add', path.relative(fixture.gitRoot, fixture.objectModuleBsl)]);

    const model = buildModel();
    const section: ChangesSectionDto = buildCommitChangesSection(model, fakeIconResolver());

    assert.strictEqual(section.label, 'Изменения коммита', 'метка секции коммита — предложенный контракт');
    const catalogsGroup = findByLabel(section.nodes, 'Справочники');
    assert.ok(catalogsGroup, `ожидался узел-коллекция «Справочники» в секции коммита, получено: ${JSON.stringify(section.nodes.map((n) => n.label))}`);
    const objectNode = findDescendantByLabel(catalogsGroup, 'ПричиныВозврата');
    assert.ok(objectNode, 'ожидался объектный узел «ПричиныВозврата» под «Справочники»');
    assert.strictEqual(objectNode.inlineActions, undefined, 'объект в секции коммита read-only — stage/unstage запрещены');
    assert.ok(objectNode.children && objectNode.children.length > 0);
    assert.ok(
      objectNode.children.every((c: TreeNodeDto) => c.inlineActions === undefined),
      'части read-only объекта тоже без инлайн-кнопок'
    );
  });

  test('unresolved (файл вне структуры выгрузки) — плоский узел в ТОЙ ЖЕ секции, в конце (после навигаторной иерархии)', () => {
    fs.appendFileSync(fixture.objectModuleBsl, '\n// staged-правка для секции коммита\n', 'utf-8');
    git(fixture.gitRoot, ['add', path.relative(fixture.gitRoot, fixture.objectModuleBsl)]);
    fs.writeFileSync(path.join(fixture.cfRoot, 'RANDOM_NOTES.txt'), 'вне структуры выгрузки\n', 'utf-8');

    const model = buildModel();
    const section: ChangesSectionDto = buildCommitChangesSection(model, fakeIconResolver());

    const rawNode = section.nodes.find((n) => n.label === 'src/cf/RANDOM_NOTES.txt');
    assert.ok(rawNode, `ожидался плоский узел из unresolved на верхнем уровне секции, получено: ${JSON.stringify(section.nodes.map((n) => n.label))}`);
    assert.strictEqual(rawNode.kind, 'changeRaw');
    assert.strictEqual(rawNode.inlineActions, undefined);
    assert.strictEqual(section.nodes[section.nodes.length - 1].label, 'src/cf/RANDOM_NOTES.txt', 'плоские unresolved-узлы идут в КОНЦЕ секции');
  });

  test('пустая модель (нет staged, нет unresolved) → секция без узлов', () => {
    const model = buildModel();

    const section: ChangesSectionDto = buildCommitChangesSection(model, fakeIconResolver());

    assert.deepStrictEqual(section.nodes, []);
  });
});
