import type { ConfigEntry } from '../../../domain/Configuration';
import type { ChangesModel } from '../../../infra/git/MetadataChangeAggregator';
import {
  loadCommitChanges,
  loadHistoryState,
  resolveCommitDiff,
  type CommitDiff,
} from '../history/historyGraphController';
import { buildCommitChangesSection, type HistoryGraphState } from '../history/historyGraphDtoBuilder';
import type { ChangesSectionDto, IconResolver } from './changesDtoBuilder';

/** Внешние зависимости секции истории: корень git и корни выгрузки 1С. */
export interface ChangesHistoryServices {
  readonly gitRoot: string;
  readonly getConfigRoots: () => readonly ConfigEntry[];
}

/** Шаг увеличения окна графа истории (`git log --max-count`). */
export const PAGE_SIZE_STEP = 200;

/**
 * Чистое (без `vscode`) состояние графа истории панели «Изменения метаданных».
 * СКЛЕИВАЕТ уже реализованные и покрытые слои
 * ({@link loadHistoryState}/{@link loadCommitChanges}/{@link resolveCommitDiff} +
 * {@link buildCommitChangesSection}), не дублируя их логику: хранит окно
 * пагинации (`pageSize`), выбранный коммит и его модель, флаг ленивой загрузки.
 *
 * Ленивость: `git log` истории читается только по явным командам
 * (`load`/`loadMore`/`selectCommit`), а `refresh` до первой загрузки —
 * `undefined` (запрет №11).
 */
export class ChangesHistorySection {
  private pageSize = PAGE_SIZE_STEP;
  private selectedHash: string | undefined;
  private selectedModel: ChangesModel | undefined;
  private loaded = false;

  constructor(private readonly services: ChangesHistoryServices) {}

  /** Загружена ли история хотя бы раз (иначе git log вхолостую не читается). */
  isLoaded(): boolean {
    return this.loaded;
  }

  /** Первичная загрузка графа: помечает историю загруженной и возвращает состояние. */
  load(nowSec: number): HistoryGraphState {
    this.loaded = true;
    return this.readState(nowSec);
  }

  /** Пересчёт графа только при уже загруженной истории; иначе `undefined` (ленивость). */
  refresh(nowSec: number): HistoryGraphState | undefined {
    if (!this.loaded) {
      return undefined;
    }
    return this.readState(nowSec);
  }

  /** Увеличивает окно пагинации и (пере)читает граф, переводя историю в загруженное состояние. */
  loadMore(nowSec: number): HistoryGraphState {
    this.pageSize += PAGE_SIZE_STEP;
    this.loaded = true;
    return this.readState(nowSec);
  }

  /**
   * Выбирает коммит: определяет корневой ли он (по `parents` строки графа),
   * агрегирует состав изменений в модель, кеширует выбор и строит read-only
   * секцию «Изменения коммита». `nowSec` здесь не нужен — из состояния берутся
   * только `parents`, не относительные даты.
   */
  selectCommit(hash: string, iconResolver: IconResolver): { section: ChangesSectionDto } {
    const state = this.readState(0);
    const row = state.rows.find((candidate) => candidate.hash === hash);
    const isRoot = row ? row.parents.length === 0 : false;
    const model = loadCommitChanges(this.services.gitRoot, this.services.getConfigRoots(), hash, isRoot);
    this.selectedHash = hash;
    this.selectedModel = model;
    return { section: buildCommitChangesSection(model, iconResolver) };
  }

  /** Адрес одиночного файла узла выбранного коммита для `vscode.diff`; без выбора — `undefined`. */
  resolveDiff(nodeId: string): CommitDiff | undefined {
    if (!this.selectedModel || !this.selectedHash) {
      return undefined;
    }
    return resolveCommitDiff(this.selectedModel, this.selectedHash, nodeId);
  }

  private readState(nowSec: number): HistoryGraphState {
    return loadHistoryState(this.services.gitRoot, this.pageSize, nowSec, this.selectedHash);
  }
}
