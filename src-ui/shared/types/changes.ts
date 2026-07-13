import type { TreeNodeDto } from './tree';

/**
 * Состояние webview-панели «Изменения метаданных» (Vue-сторона). Зеркалит
 * `src/ui/views/changes/changesDtoBuilder.ts` (host-сторона исключена из
 * webview-сборки, поэтому типы дублируются по конвенции протокола).
 */

/**
 * Вариант фиксации из split-кнопки «Фиксация» (webview-сторона протокола).
 * Зеркалит `CommitMode` из `src/ui/views/changes/MetadataChangesViewProvider.ts`
 * (host-сторона исключена из webview-сборки — типы протокола дублируются по конвенции).
 */
export type CommitMode = 'commit' | 'push' | 'sync';

/** Секция изменений: проиндексировано / не проиндексировано / прочие. */
export interface ChangesSectionDto {
  readonly kind: 'staged' | 'unstaged' | 'other';
  readonly label: string;
  readonly nodes: TreeNodeDto[];
}

/** Полное состояние панели изменений. */
export interface ChangesViewState {
  readonly staged: ChangesSectionDto;
  readonly unstaged: ChangesSectionDto;
  readonly unresolved: ChangesSectionDto;
  readonly canCommit: boolean;
  readonly commitMessage: string;
}
