import * as assert from 'assert';
// Граф истории git, Слой 1: чистая раскладка «рельсов» (lanes) поверх уже
// разобранных коммитов. Модуль ещё не реализован — импорт обязан провалиться
// до появления `src/infra/git/GitGraphLayout.ts`.
//
// Раскладка — чистая функция, поэтому все сценарии смоделированы литеральными
// `RawCommit[]` вручную (реальный git тут не нужен — топология важнее
// конкретных хешей). Порядок входного массива — топологический «сверху вниз»,
// как в `git log --topo-order`: ребёнок стоит РАНЬШЕ родителя.
import { assignLanes, type GraphLayout, type GraphRow, type LaneEdge } from '../../infra/git/GitGraphLayout';
import type { RawCommit } from '../../infra/git/GitLogParser';

/** Собирает минимальный `RawCommit` для теста раскладки — refs/автор/дата раскладке не важны. */
function commit(hash: string, parents: readonly string[]): RawCommit {
  return { hash, parents: [...parents], refs: [], authorName: 'a', authorTimestamp: 0, subject: hash };
}

function rowOf(layout: GraphLayout, hash: string): GraphRow {
  const row = layout.rows.find((r: GraphRow) => r.commit.hash === hash);
  assert.ok(row, `строка для коммита ${hash} обязана присутствовать в раскладке`);
  return row;
}

/** Сравнивает рёбра как МНОЖЕСТВО пар {fromLane,toLane} — цвет дорожки в этом наборе тестов не фиксируется. */
function edgePairs(edges: readonly LaneEdge[]): [number, number][] {
  return edges
    .map((e: LaneEdge): [number, number] => [e.fromLane, e.toLane])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

suite('GitGraphLayout — раскладка коммитов по дорожкам (assignLanes)', () => {
  test('линейная история (A→B→C): все коммиты на дорожке 0, ребро 0→0 к следующему, у корня рёбер нет', () => {
    const commits = [commit('C', ['B']), commit('B', ['A']), commit('A', [])];

    const layout = assignLanes(commits);

    assert.strictEqual(rowOf(layout, 'C').lane, 0);
    assert.strictEqual(rowOf(layout, 'B').lane, 0);
    assert.strictEqual(rowOf(layout, 'A').lane, 0);
    assert.deepStrictEqual(edgePairs(rowOf(layout, 'C').edges), [[0, 0]]);
    assert.deepStrictEqual(edgePairs(rowOf(layout, 'B').edges), [[0, 0]]);
    assert.deepStrictEqual(edgePairs(rowOf(layout, 'A').edges), [], 'у корня (parents=[]) вниз ничего не идёт');
    assert.strictEqual(layout.laneCount, 1);
  });

  test('merge с двумя родителями без общего предка: 2 исходящих ребра, вторая дорожка новая (не занятая)', () => {
    // M — merge, D/C — независимые ветки со своими корнями (без сходящегося
    // предка), чтобы не усложнять тест конвергенцией дорожек на общем узле.
    const commits = [
      commit('M', ['D', 'C']),
      commit('D', ['Dbase']),
      commit('C', ['Cbase']),
      commit('Dbase', []),
      commit('Cbase', []),
    ];

    const layout = assignLanes(commits);

    assert.strictEqual(rowOf(layout, 'M').lane, 0, 'merge наследует дорожку первого родителя (D)');
    assert.strictEqual(rowOf(layout, 'D').lane, 0);
    assert.strictEqual(rowOf(layout, 'C').lane, 1, 'второй родитель merge получает новую дорожку');
    assert.deepStrictEqual(edgePairs(rowOf(layout, 'M').edges), [[0, 0], [0, 1]]);
    assert.strictEqual(layout.laneCount, 2);
  });

  test('octopus-merge (3 родителя): N исходящих рёбер, N-1 новых дорожек выделено', () => {
    const commits = [
      commit('O', ['P1', 'P2', 'P3']),
      commit('P1', []),
      commit('P2', []),
      commit('P3', []),
    ];

    const layout = assignLanes(commits);

    assert.strictEqual(rowOf(layout, 'O').lane, 0);
    assert.strictEqual(rowOf(layout, 'P1').lane, 0, 'первый родитель наследует дорожку merge-коммита');
    assert.strictEqual(rowOf(layout, 'P2').lane, 1);
    assert.strictEqual(rowOf(layout, 'P3').lane, 2);
    assert.deepStrictEqual(edgePairs(rowOf(layout, 'O').edges), [[0, 0], [0, 1], [0, 2]]);
    assert.strictEqual(layout.laneCount, 3);
  });

  test('два независимых корня/сироты: раскладываются на РАЗНЫХ дорожках, у обоих корней рёбер нет', () => {
    // A1→A0 — одно дерево; B1 — независимый одиночный коммит-сирота без связи с A*.
    const commits = [commit('A1', ['A0']), commit('B1', []), commit('A0', [])];

    const layout = assignLanes(commits);

    const laneA1 = rowOf(layout, 'A1').lane;
    const laneB1 = rowOf(layout, 'B1').lane;
    assert.notStrictEqual(laneA1, laneB1, 'независимые деревья не должны делить одну дорожку');
    assert.strictEqual(rowOf(layout, 'A0').lane, laneA1, 'A0 — родитель A1, продолжает ту же дорожку');
    assert.deepStrictEqual(edgePairs(rowOf(layout, 'B1').edges), [], 'B1 — сирота (parents=[]), рёбер вниз нет');
    assert.deepStrictEqual(edgePairs(rowOf(layout, 'A0').edges), [], 'A0 — корень дерева A*, рёбер вниз нет');
    assert.strictEqual(layout.laneCount, 2);
  });

  test('переиспользование освободившейся дорожки: второй merge берёт САМУЮ ЛЕВУЮ свободную, а не добавляет новую справа', () => {
    // Head — первый merge, открывает дорожку 1 под Side1 (сирота — сразу же
    // освобождает её). Merge1 — второй merge, второй родитель Side2 обязан
    // переиспользовать освободившуюся дорожку 1, а не получить дорожку 2.
    const commits = [
      commit('Head', ['Main1', 'Side1']),
      commit('Main1', ['Merge1']),
      commit('Side1', []),
      commit('Merge1', ['Main0', 'Side2']),
      commit('Main0', []),
      commit('Side2', []),
    ];

    const layout = assignLanes(commits);

    assert.strictEqual(rowOf(layout, 'Head').lane, 0);
    assert.strictEqual(rowOf(layout, 'Main1').lane, 0);
    assert.strictEqual(rowOf(layout, 'Side1').lane, 1, 'первая открытая боковая дорожка — 1');
    assert.strictEqual(rowOf(layout, 'Merge1').lane, 0);
    assert.strictEqual(
      rowOf(layout, 'Side2').lane, 1,
      'вторая боковая ветка обязана переиспользовать освободившуюся дорожку 1, а не открыть дорожку 2'
    );
    assert.strictEqual(
      layout.laneCount, 2,
      'дорожек за всю историю не должно становиться больше двух — иначе освободившаяся дорожка не переиспользуется'
    );
  });

  test('обрыв на границе пагинации: родитель отсутствует среди commits — не падает, дорожка остаётся висящей', () => {
    // 'ffffffffffffffffffffffffffffffffffffffff' — правдоподобный по форме
    // хеш родителя, который в переданное окно коммитов не попал (типичная
    // ситуация постраничной подгрузки истории).
    const outOfWindowParent = 'ffffffffffffffffffffffffffffffffffffffff';
    const commits = [commit('Tip', ['Mid']), commit('Mid', [outOfWindowParent])];

    assert.doesNotThrow(() => assignLanes(commits));
    const layout = assignLanes(commits);

    assert.strictEqual(layout.rows.length, 2);
    const midRow = rowOf(layout, 'Mid');
    assert.strictEqual(midRow.edges.length, 1, 'висящий родитель всё равно даёт одно ожидающее ребро');
    assert.strictEqual(midRow.edges[0].fromLane, midRow.lane);
    assert.ok(Number.isInteger(midRow.edges[0].toLane) && midRow.edges[0].toLane >= 0);
    assert.strictEqual(layout.laneCount, 1, 'висящий родитель не должен провоцировать лишнюю дорожку');
  });

  test('развилка без merge (два tip-коммита с общим первым родителем на РАЗНЫХ дорожках): вторая дорожка схлопывается при обработке общего родителя', () => {
    // Tip1 и Tip2 — независимые ветки-«листья» (без merge), у обеих ПЕРВЫЙ
    // (единственный) родитель — Base. К моменту обработки Tip2 дорожка 0 уже
    // занята ожиданием Base (после Tip1), поэтому Tip2 получает НОВУЮ дорожку
    // 1 — и она тоже начинает ждать Base. Итог: ДВЕ дорожки одновременно
    // ждут один и тот же хеш Base — ветка схлопывания (assignLanes, l.75-79)
    // обязана освободить лишнюю (не совпадающую с commitLane) дорожку.
    const commits = [
      commit('Tip1', ['Base']),
      commit('Tip2', ['Base']),
      commit('Base', []),
    ];

    const layout = assignLanes(commits);

    assert.strictEqual(rowOf(layout, 'Tip1').lane, 0);
    assert.strictEqual(rowOf(layout, 'Tip2').lane, 1, 'дорожка 0 уже занята ожиданием Base — Tip2 получает новую');
    assert.strictEqual(rowOf(layout, 'Base').lane, 0, 'Base занимает самую левую дорожку, ожидавшую его хеш');
    assert.deepStrictEqual(edgePairs(rowOf(layout, 'Base').edges), [], 'у Base (parents=[]) рёбер вниз нет');
    assert.strictEqual(
      layout.laneCount, 2,
      'схлопнувшаяся дорожка 1 не должна порождать новую дорожку у следующих коммитов'
    );
  });

  test('пустой список коммитов — пустая раскладка без исключения', () => {
    const layout = assignLanes([]);
    assert.deepStrictEqual(layout.rows, []);
    assert.strictEqual(layout.laneCount, 0);
  });
});
