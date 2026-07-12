import * as path from 'path';
import type { ConfigEntry } from '../../../domain/Configuration';
import { readCommitChanges } from '../../../infra/git/GitCommitChangesReader';
import { assignLanes } from '../../../infra/git/GitGraphLayout';
import { readGitLog } from '../../../infra/git/GitLogReader';
import { aggregateMetadataChanges, type ChangesModel } from '../../../infra/git/MetadataChangeAggregator';
import { resolveChangeAddress } from '../changes/changesDtoBuilder';
import { buildHistoryGraphState, type HistoryGraphState } from './historyGraphDtoBuilder';

/**
 * Чистый (без `vscode`) контроллер панели «История» — СКЛЕИВАЕТ уже готовые и
 * покрытые слои: чтение/разбор лога и раскладку по дорожкам (Слой 1), агрегацию
 * изменений коммита в {@link ChangesModel} (Слой 2) и построение DTO графа
 * (`historyGraphDtoBuilder`, Слой 3a). Собственной бизнес-логики не несёт —
 * только передаёт параметры и пробрасывает результат; `vscode` и мутации ФС
 * здесь запрещены, `path` допустим (лишь построение имени файла для заголовка
 * diff). Тонкая vscode-оболочка над ним — {@link HistoryGraphViewProvider}.
 */

/** Адрес одиночного файла для `vscode.diff`: ref-диапазон коммит^..коммит. */
export interface CommitDiff {
  readonly relFile: string;
  readonly leftRef: string;
  readonly rightRef: string;
  readonly title: string;
}

/**
 * Читает лог, раскладывает по дорожкам и строит состояние графа. `hasMore`
 * трактуется как «возможно есть ещё», если `git log --max-count` вернул ровно
 * запрошенное число строк (`rows.length === pageSize`).
 */
export function loadHistoryState(
  gitRoot: string,
  pageSize: number,
  nowSec: number,
  selectedHash?: string,
): HistoryGraphState {
  const layout = assignLanes(readGitLog(gitRoot, pageSize));
  return buildHistoryGraphState(layout, nowSec, layout.rows.length === pageSize, selectedHash);
}

/**
 * Агрегирует состав изменений коммита в {@link ChangesModel}. Для корневого
 * коммита (`isRoot`) diff-tree выполняется с `--root`, иначе — относительно
 * первого родителя.
 */
export function loadCommitChanges(
  gitRoot: string,
  configRoots: readonly ConfigEntry[],
  hash: string,
  isRoot: boolean,
): ChangesModel {
  return aggregateMetadataChanges(readCommitChanges(gitRoot, hash, { root: isRoot }), gitRoot, configRoots);
}

/**
 * Восстанавливает адрес одиночного файла узла секции коммита для `vscode.diff`.
 * Возвращает `undefined`, если узел не адресуется в единственный файл (объект из
 * нескольких частей, несуществующий/битый `nodeId`).
 */
export function resolveCommitDiff(model: ChangesModel, hash: string, nodeId: string): CommitDiff | undefined {
  const address = resolveChangeAddress(model, nodeId);
  if (!address?.single) {
    return undefined;
  }
  const relFile = address.relFiles[0];
  const short = hash.slice(0, 7);
  return {
    relFile,
    leftRef: `${hash}^`,
    rightRef: hash,
    title: `${path.basename(relFile)} (${short}^ ↔ ${short})`,
  };
}
