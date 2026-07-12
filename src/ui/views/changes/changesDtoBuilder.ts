import type { MetaKind } from '../../../domain/MetaTypes';
import type {
  ChangeStatus,
  ChangesModel,
  ObjectChangeGroup,
  PartChange,
  RawChange,
} from '../../../infra/git/MetadataChangeAggregator';
import type { DiscardStatus } from '../../../infra/git/GitWriteService';

/**
 * Чистое (без `vscode`) построение DTO представления «Изменения метаданных» из
 * модели ВЕХИ 1 (`ChangesModel`). Результат — те же `TreeNodeDto`, что рисует
 * Vue-дерево универсальной панели, поэтому webview переиспользует его без правок.
 *
 * `src-ui` исключён из `tsconfig.test.json`, поэтому здесь объявлены ЛОКАЛЬНЫЕ
 * зеркала shared-типов (`src-ui/shared/types/{tree,icon,changes}.ts`) по
 * конвенции `ui/views/<область>/_types.ts` — их форма обязана совпадать с той, что
 * реально кладёт `UniversalPanelViewProvider.toDto`.
 */

/** Зеркало `src-ui/shared/types/icon.ts` (`IconDto`). */
export interface IconDto {
  readonly kind: 'codicon' | 'metadata' | 'asset' | 'none';
  readonly name?: string;
  readonly lightUri?: string;
  readonly darkUri?: string;
  readonly ariaLabel?: string;
}

/** Действие узла — форма из `src-ui/shared/types/tree.ts` (здесь всегда пустой список). */
export interface TreeNodeActionDto {
  readonly id: string;
  readonly label: string;
  readonly icon?: IconDto;
  readonly command: string;
  readonly enabled?: boolean;
}

/** Зеркало `TreeNodeDto` (`src-ui/shared/types/tree.ts`) — минимально необходимая часть. */
export interface TreeNodeDto {
  readonly id: string;
  readonly key: string;
  readonly label: string;
  readonly description?: string;
  readonly tooltip?: string;
  readonly icon?: IconDto;
  readonly kind?: string;
  readonly hasChildren: boolean;
  readonly loaded: boolean;
  readonly children?: TreeNodeDto[];
  readonly actions: TreeNodeActionDto[];
  readonly inlineActions?: TreeNodeActionDto[];
  readonly gitStatus?: 'added' | 'modified' | 'deleted';
}

/** Секция изменений (проиндексировано / не проиндексировано / прочие). */
export interface ChangesSectionDto {
  readonly kind: 'staged' | 'unstaged' | 'other';
  readonly label: string;
  readonly nodes: TreeNodeDto[];
}

/** Полное состояние webview-панели «Изменения метаданных». */
export interface ChangesViewState {
  readonly staged: ChangesSectionDto;
  readonly unstaged: ChangesSectionDto;
  readonly unresolved: ChangesSectionDto;
  readonly canCommit: boolean;
  readonly commitMessage: string;
}

/** Резолвер иконки объекта по типу корневого метаданного (инъекция вместо `vscode`). */
export type IconResolver = (kind: MetaKind) => IconDto;

/** Сопоставление схлопнутого git-статуса части/объекта с меткой DTO. */
function toGitStatus(status: ChangeStatus): 'added' | 'modified' | 'deleted' {
  if (status === 'A') { return 'added'; }
  if (status === 'D') { return 'deleted'; }
  return 'modified';
}

/** Метка части: «Форма.<Имя>» при наличии `childName`, иначе — сама метка части. */
function partLabelOf(part: PartChange): string {
  return part.childName ? `${part.partLabel}.${part.childName}` : part.partLabel;
}

/**
 * Инлайн-кнопка индексации/снятия по стороне узла (как в штатном SCM):
 * unstaged → «+» (проиндексировать), staged → «−» (снять индексацию).
 * `id` совпадает со значением `command` протокола — `ChangesApp` шлёт его
 * как `{command: id, payload:{nodeId}}`, провайдер маршрутизирует в `GitWriteService`.
 */
function stageUnstageInline(side: 'staged' | 'unstaged'): TreeNodeActionDto[] {
  return side === 'staged'
    ? [{ id: 'unstage', label: 'Снять индексацию', command: 'unstage', icon: { kind: 'codicon', name: 'remove' } }]
    : [{ id: 'stage', label: 'Проиндексировать', command: 'stage', icon: { kind: 'codicon', name: 'add' } }];
}

function rawStatus(raw: RawChange): ChangeStatus {
  if (raw.index === 'D' || raw.worktree === 'D') { return 'D'; }
  if (raw.index === 'A' || raw.worktree === 'A' || raw.index === '?' || raw.worktree === '?') {
    return 'A';
  }
  return 'M';
}

/** Метки секций (проиндексировано / не проиндексировано / прочие). */
export const SECTION_LABELS = {
  staged: 'Проиндексировано',
  unstaged: 'Не проиндексировано',
  other: 'Прочие',
} as const;

/**
 * Строит объектный узел одной {@link ObjectChangeGroup}: метка — ИМЯ объекта
 * (не канонический путь), т.к. тип уже виден по узлу-коллекции навигаторной
 * иерархии над объектом («Общие модули», «Справочники» и т.п.) — префикс
 * `Тип.` был бы дублированием. Иконка — по `rootKind`, дети — части объекта
 * через {@link buildPartNode}. Навигаторную иерархию над узлом строит
 * вызывающая сторона (провайдер).
 */
export function buildObjectNode(
  side: 'staged' | 'unstaged',
  group: ObjectChangeGroup,
  groupIndex: number,
  iconResolver: IconResolver,
): TreeNodeDto {
  const id = `${side}#${String(groupIndex)}`;
  const children = group.parts.map((part, partIndex) => buildPartNode(id, part, partIndex));
  return {
    id,
    key: id,
    label: group.rootName,
    icon: iconResolver(group.rootKind),
    kind: 'changeObject',
    hasChildren: true,
    loaded: true,
    children,
    actions: [],
    inlineActions: stageUnstageInline(side),
    gitStatus: toGitStatus(group.aggregateStatus),
  };
}

/** Строит узел одной изменённой части объекта по id-схеме `${objectId}.${partIndex}`. */
export function buildPartNode(objectId: string, part: PartChange, partIndex: number): TreeNodeDto {
  const id = `${objectId}.${String(partIndex)}`;
  // Сторона узла закодирована в objectId (`staged#…`/`unstaged#…`) — из неё
  // выбирается инлайн-кнопка индексации/снятия для части (отдельный файл).
  const side = objectId.startsWith('staged#') ? 'staged' : 'unstaged';
  return {
    id,
    key: id,
    label: partLabelOf(part),
    kind: 'changePart',
    hasChildren: false,
    loaded: true,
    actions: [],
    inlineActions: stageUnstageInline(side),
    gitStatus: toGitStatus(part.status),
  };
}

/** Строит плоскую секцию «Прочие» (файлы вне структуры выгрузки). */
export function buildOtherSection(unresolved: readonly RawChange[]): ChangesSectionDto {
  const nodes = unresolved.map((raw, rawIndex) => {
    const id = `other#${String(rawIndex)}`;
    return {
      id,
      key: id,
      label: raw.relPath,
      kind: 'changeRaw',
      hasChildren: false,
      loaded: true,
      actions: [],
      gitStatus: toGitStatus(rawStatus(raw)),
    } satisfies TreeNodeDto;
  });
  return { kind: 'other', label: SECTION_LABELS.other, nodes };
}

// ─── Восстановление адреса узла для провайдера ────────────────────────────

/** Сторона изменения, к которой относится узел. */
export type ChangeSide = 'staged' | 'unstaged' | 'other';

/** Один файл к отмене (относительный путь + вид изменения). */
export interface RelDiscardEntry {
  readonly relPath: string;
  readonly status: DiscardStatus;
}

/** Разобранный адрес узла: сторона, файлы и записи для точечной отмены. */
export interface ChangeAddress {
  readonly side: ChangeSide;
  readonly relFiles: string[];
  readonly discards: RelDiscardEntry[];
  readonly single: boolean;
}

const NODE_ID_RE = /^(staged|unstaged|other)#(\d+)(?:\.(\d+))?$/;

/** Выбирает части объекта: одну по индексу либо все (для объектного узла). */
function selectParts(allParts: readonly PartChange[], partIndex: number | undefined): PartChange[] {
  if (partIndex === undefined) {
    return [...allParts];
  }
  // Приведение фиксирует возможный выход за границы: без `noUncheckedIndexedAccess`
  // индексация иначе давала бы не-опциональный тип и проверка считалась бы лишней.
  const part = allParts[partIndex] as PartChange | undefined;
  return part ? [part] : [];
}

/**
 * Восстанавливает адрес узла из его `id` по той же модели, из которой строилось
 * состояние. Возвращает относительные пути файлов и записи отмены; провайдер
 * доводит их до абсолютных через `path.resolve(gitRoot, relPath)`.
 */
export function resolveChangeAddress(model: ChangesModel, nodeId: string): ChangeAddress | undefined {
  const match = NODE_ID_RE.exec(nodeId);
  if (!match) {
    return undefined;
  }
  const side = match[1] as ChangeSide;
  const primary = Number(match[2]);
  // Индексация массивов может выйти за границы (`noUncheckedIndexedAccess` off),
  // поэтому явно допускаем `undefined` и проверяем перед использованием.
  const partIndexRaw = match[3] as string | undefined;
  const partIndex = partIndexRaw === undefined ? undefined : Number(partIndexRaw);

  if (side === 'other') {
    const raw = model.unresolved[primary] as RawChange | undefined;
    if (!raw) {
      return undefined;
    }
    return {
      side,
      relFiles: [raw.relPath],
      discards: [{ relPath: raw.relPath, status: discardStatusFromRaw(raw) }],
      single: true,
    };
  }

  const groups = side === 'staged' ? model.staged : model.unstaged;
  const group = groups[primary] as ObjectChangeGroup | undefined;
  if (!group) {
    return undefined;
  }

  const parts = selectParts(group.parts, partIndex);
  if (parts.length === 0) {
    return undefined;
  }

  const relFiles: string[] = [];
  const discards: RelDiscardEntry[] = [];
  for (const part of parts) {
    for (const relPath of part.files) {
      relFiles.push(relPath);
      discards.push({ relPath, status: discardStatusFromChange(part.status, side) });
    }
  }
  return { side, relFiles, discards, single: relFiles.length === 1 };
}

/**
 * Вид отмены по схлопнутому статусу части: добавление в рабочем дереве —
 * «untracked» (удалить файл), удаление — «deleted» (восстановить), иначе —
 * «modified» (откатить к индексу/HEAD).
 */
function discardStatusFromChange(status: ChangeStatus, side: ChangeSide): DiscardStatus {
  if (status === 'A' && side !== 'staged') {
    return 'untracked';
  }
  if (status === 'D') {
    return 'deleted';
  }
  return 'modified';
}

function discardStatusFromRaw(raw: RawChange): DiscardStatus {
  if (raw.index === '?' || raw.worktree === '?') {
    return 'untracked';
  }
  if (raw.index === 'D' || raw.worktree === 'D') {
    return 'deleted';
  }
  return 'modified';
}
