/**
 * Раскладка коммитов по «рельсам» (lanes) для графа истории (Слой 1).
 *
 * Чистая функция над уже разобранными {@link RawCommit} в топологическом
 * порядке (ребёнок раньше родителя, как в `git log --topo-order`). Не знает про
 * git/ФС/vscode. Ведёт массив активных дорожек и переиспользует самую левую
 * освободившуюся, чтобы граф не «расползался» вширь после закрытия ветки.
 */
import type { RawCommit } from './GitLogParser';

/** Ребро графа: связь дорожки коммита с дорожкой его родителя (идёт вниз). */
export interface LaneEdge {
  /** Дорожка коммита-источника (всегда дорожка текущей строки). */
  readonly fromLane: number;
  /** Дорожка, на которую встанет родитель. */
  readonly toLane: number;
  /** Цвет дорожки родителя (стабильный per-lane индекс для отрисовки). */
  readonly color: number;
}

/** Одна строка графа: коммит, его дорожка и рёбра вниз к родителям. */
export interface GraphRow {
  readonly commit: RawCommit;
  readonly lane: number;
  readonly edges: readonly LaneEdge[];
}

/** Результат раскладки: строки в исходном порядке и максимальное число дорожек. */
export interface GraphLayout {
  readonly rows: readonly GraphRow[];
  readonly laneCount: number;
}

/**
 * Раскладывает коммиты по дорожкам. Для каждого коммита:
 * дорожка коммита — левейшая, уже ожидающая его хеш, иначе левейшая свободная,
 * иначе новая справа; прочие дорожки, ожидавшие тот же хеш, схлопываются;
 * первый родитель продолжает дорожку коммита, каждый следующий переиспользует
 * дорожку, уже ожидающую его хеш, иначе левейшую свободную/новую.
 */
export function assignLanes(commits: readonly RawCommit[]): GraphLayout {
  const rows: GraphRow[] = [];
  // Значение дорожки — хеш коммита, который она сейчас ожидает, либо null (свободна).
  const lanes: (string | null)[] = [];

  const leftmostLane = (predicate: (value: string | null) => boolean): number => {
    for (let index = 0; index < lanes.length; index += 1) {
      if (predicate(lanes[index])) {
        return index;
      }
    }
    return -1;
  };

  const takeLaneFor = (hash: string): number => {
    let lane = leftmostLane((value) => value === hash);
    if (lane !== -1) {
      return lane;
    }
    lane = leftmostLane((value) => value === null);
    if (lane !== -1) {
      return lane;
    }
    lanes.push(null);
    return lanes.length - 1;
  };

  for (const commit of commits) {
    // Дорожка коммита: ожидающая его хеш, иначе свободная/новая.
    const commitLane = takeLaneFor(commit.hash);
    lanes[commitLane] = null;

    // Прочие дорожки, ожидавшие тот же коммит (сходящиеся ветки), схлопываются
    // в дорожку коммита; их восходящие рёбра уже записаны у детей.
    for (let index = 0; index < lanes.length; index += 1) {
      if (index !== commitLane && lanes[index] === commit.hash) {
        lanes[index] = null;
      }
    }

    const edges: LaneEdge[] = [];
    commit.parents.forEach((parentHash, parentIndex) => {
      // Первый родитель продолжает дорожку коммита; остальные — своя дорожка.
      const parentLane = parentIndex === 0 ? commitLane : takeLaneFor(parentHash);
      lanes[parentLane] = parentHash;
      edges.push({ fromLane: commitLane, toLane: parentLane, color: parentLane });
    });

    rows.push({ commit, lane: commitLane, edges });
  }

  return { rows, laneCount: lanes.length };
}
