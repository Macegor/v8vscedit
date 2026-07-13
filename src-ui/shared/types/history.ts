/**
 * Ui-зеркало DTO графа истории git (Vue-сторона). Зеркалит
 * `src/ui/views/history/historyGraphDtoBuilder.ts` (host-сторона исключена из
 * webview-сборки, поэтому типы дублируются по конвенции протокола). Форма ОБЯЗАНА
 * совпадать с host-зеркалом, иначе рассинхрон протокола.
 */

/** Зеркало ссылки git на коммите (ветка/тег/HEAD). */
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

/** Одна строка графа истории для отрисовки. */
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
