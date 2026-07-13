import type { GraphLayout } from '../../../infra/git/GitGraphLayout';
import type { ChangesModel } from '../../../infra/git/MetadataChangeAggregator';
import {
  buildObjectNode,
  buildOtherSection,
  type ChangesSectionDto,
  type IconResolver,
} from '../changes/changesDtoBuilder';
import { assembleNavigatorSection, synthesizeAncestors } from '../changes/changesTreeAssembler';

/**
 * Чистая (без `vscode`) сборка DTO панели «История» (граф истории git).
 *
 * `src-ui` исключён из `tsconfig.test.json`, поэтому здесь объявлены ЛОКАЛЬНЫЕ
 * зеркала shared-типов (по конвенции `changesDtoBuilder.ts`) — их форма обязана
 * совпадать с той, что реально ждёт Vue-приложение панели истории.
 *
 * Раскладку по дорожкам ({@link GraphLayout}) готовит Слой 1
 * (`GitGraphLayout.assignLanes` над `GitLogParser.parseGitLog`); здесь она лишь
 * маппится в плоские DTO с человекочитаемыми датами. Секцию «Изменения коммита»
 * переиспользует навигаторную сборку панели изменений в read-only режиме.
 */

/** Зеркало ссылки git на коммите (ветка/тег/HEAD) для webview. */
export interface RefDto {
  readonly name: string;
  readonly kind: 'head' | 'localBranch' | 'remoteBranch' | 'tag';
}

/** Ребро графа между дорожкой коммита и дорожкой родителя. */
export interface LaneEdgeDto {
  readonly fromLane: number;
  readonly toLane: number;
  readonly color: number;
}

/** Одна строка графа истории для отрисовки в webview. */
export interface GraphRowDto {
  readonly hash: string;
  readonly shortHash: string;
  readonly parents: string[];
  readonly lane: number;
  readonly laneColor: number;
  readonly edges: LaneEdgeDto[];
  readonly refs: RefDto[];
  readonly author: string;
  readonly relativeDate: string;
  readonly absoluteDate: string;
  readonly subject: string;
}

/** Полное состояние webview-панели «История». */
export interface HistoryGraphState {
  readonly rows: GraphRowDto[];
  readonly laneCount: number;
  readonly hasMore: boolean;
  readonly selectedHash?: string;
}

const SECOND = 1;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const DAYS_IN_MONTH = 30;
const DAYS_IN_YEAR = 365;

/**
 * Русская плюрализация числительного: выбор словоформы по последней цифре с
 * учётом особой группы 11–14 (всегда форма «многих»).
 */
function pluralize(n: number, forms: readonly [string, string, string]): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) {
    return forms[2];
  }
  if (mod10 === 1) {
    return forms[0];
  }
  if (mod10 >= 2 && mod10 <= 4) {
    return forms[1];
  }
  return forms[2];
}

/**
 * Относительная дата на русском: «только что» для разницы < 60 с, иначе
 * «<число> <единица> назад» с корректной плюрализацией. Единицы:
 * минуты(<1 ч), часы(<1 сут), дни(<30 сут), месяцы(<365 сут, floor(дни/30)),
 * годы(floor(дни/365)). Разница может быть отрицательной (коммит «из будущего»
 * при рассинхроне часов) — попадает в ветку «только что», исключений не бросает.
 */
export function formatRelativeDate(timestampSec: number, nowSec: number): string {
  const diff = nowSec - timestampSec;
  if (diff < MINUTE) {
    return 'только что';
  }
  if (diff < HOUR) {
    const minutes = Math.floor(diff / MINUTE);
    return `${String(minutes)} ${pluralize(minutes, ['минуту', 'минуты', 'минут'])} назад`;
  }
  if (diff < DAY) {
    const hours = Math.floor(diff / HOUR);
    return `${String(hours)} ${pluralize(hours, ['час', 'часа', 'часов'])} назад`;
  }
  const days = Math.floor(diff / DAY);
  if (days < DAYS_IN_MONTH) {
    return `${String(days)} ${pluralize(days, ['день', 'дня', 'дней'])} назад`;
  }
  if (days < DAYS_IN_YEAR) {
    const months = Math.floor(days / DAYS_IN_MONTH);
    return `${String(months)} ${pluralize(months, ['месяц', 'месяца', 'месяцев'])} назад`;
  }
  const years = Math.floor(days / DAYS_IN_YEAR);
  return `${String(years)} ${pluralize(years, ['год', 'года', 'лет'])} назад`;
}

/** Абсолютная человекочитаемая дата (`ru-RU`, с 4-значным годом). */
function formatAbsoluteDate(timestampSec: number): string {
  return new Date(timestampSec * 1000).toLocaleString('ru-RU');
}

/**
 * Маппит {@link GraphLayout} в плоские {@link GraphRowDto} — по одной строке на
 * каждую строку раскладки, без искажения дорожек/рёбер/ссылок/родителей.
 */
export function buildGraphRows(layout: GraphLayout, nowSec: number): GraphRowDto[] {
  return layout.rows.map((row) => {
    const commit = row.commit;
    return {
      hash: commit.hash,
      shortHash: commit.hash.slice(0, 7),
      parents: [...commit.parents],
      lane: row.lane,
      laneColor: row.lane,
      edges: row.edges.map((edge) => ({ fromLane: edge.fromLane, toLane: edge.toLane, color: edge.color })),
      refs: commit.refs.map((ref) => ({ name: ref.name, kind: ref.kind })),
      author: commit.authorName,
      relativeDate: formatRelativeDate(commit.authorTimestamp, nowSec),
      absoluteDate: formatAbsoluteDate(commit.authorTimestamp),
      subject: commit.subject,
    };
  });
}

/** Собирает полное состояние панели истории из раскладки и параметров отображения. */
export function buildHistoryGraphState(
  layout: GraphLayout,
  nowSec: number,
  hasMore: boolean,
  selectedHash?: string,
): HistoryGraphState {
  return {
    rows: buildGraphRows(layout, nowSec),
    laneCount: layout.laneCount,
    hasMore,
    selectedHash,
  };
}

/**
 * Строит единственную read-only секцию «Изменения коммита»: навигаторная
 * иерархия по `model.staged` (как в панели изменений, но без stage/unstage), а
 * в конце — плоские узлы `model.unresolved` (файлы вне структуры выгрузки).
 */
export function buildCommitChangesSection(model: ChangesModel, iconResolver: IconResolver): ChangesSectionDto {
  const label = 'Изменения коммита';
  const chains = model.staged.map((group, index) => ({
    ancestors: synthesizeAncestors(group, iconResolver),
    leaf: buildObjectNode('staged', group, index, iconResolver, { readonly: true }),
  }));
  const navSection = assembleNavigatorSection('staged', chains, label);
  const unresolvedNodes = buildOtherSection(model.unresolved).nodes;
  return { kind: 'staged', label, nodes: [...navSection.nodes, ...unresolvedNodes] };
}
