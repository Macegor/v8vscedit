/**
 * Чистый парсер вывода `git log` для графа истории (Слой 1).
 *
 * Разбирает вывод команды
 *   git log --all --decorate=full --parents --topo-order \
 *     --pretty=format:'%H%x1f%P%x1f%D%x1f%an%x1f%at%x1f%s%x1e'
 * в массив {@link RawCommit}. Поля записи разделены `\x1f`, записи — `\x1e`
 * (git автоматически дописывает `\n` после каждого `\x1e`, парсер это обрезает).
 *
 * `--decorate=full` даёт ПОЛНЫЕ пути ref (`refs/heads/…`, `refs/remotes/…`,
 * `refs/tags/…`), без которых нельзя отличить локальную ветку от удалённой по
 * одному лишь `%D`. Не запускает git и не трогает ФС — принимает готовую строку.
 */

/** Вид ссылки git, привязанной к коммиту. */
export type RawRefKind = 'head' | 'localBranch' | 'remoteBranch' | 'tag';

/** Одна ссылка git на коммите (ветка/тег), разобранная из поля `%D`. */
export interface RawRef {
  /** Имя без префикса `refs/heads/`, `refs/tags/` и т.п. (для remote включает имя remote). */
  readonly name: string;
  readonly kind: RawRefKind;
}

/** Один коммит истории, разобранный из строки `git log --pretty=format`. */
export interface RawCommit {
  /** Полный хеш коммита (`%H`). */
  readonly hash: string;
  /** Хеши родителей (`%P`) в исходном порядке; для корневого коммита — пустой массив. */
  readonly parents: readonly string[];
  /** Ссылки на коммите (`%D`); пусто, если декораций нет. */
  readonly refs: readonly RawRef[];
  /** Имя автора (`%an`), сырой UTF-8. */
  readonly authorName: string;
  /** Время автора как unix-секунды (`%at`). */
  readonly authorTimestamp: number;
  /** Тема коммита (`%s`), сырой UTF-8. */
  readonly subject: string;
}

const RECORD_SEPARATOR = '\x1e';
const FIELD_SEPARATOR = '\x1f';

/**
 * Разбирает вывод `git log --pretty=format` в массив коммитов в исходном
 * (топологическом) порядке. Пустые записи (в т.ч. хвостовой перевод строки)
 * отбрасываются.
 */
export function parseGitLog(output: string): RawCommit[] {
  const commits: RawCommit[] = [];
  if (!output) {
    return commits;
  }
  for (const rawRecord of output.split(RECORD_SEPARATOR)) {
    const record = rawRecord.trim();
    if (!record) {
      continue;
    }
    const fields = record.split(FIELD_SEPARATOR);
    if (fields.length < 6) {
      continue;
    }
    const [hash, parentsRaw, decorateRaw, authorName, timestampRaw, subject] = fields;
    commits.push({
      hash,
      parents: parentsRaw ? parentsRaw.split(' ').filter(Boolean) : [],
      refs: parseRefs(decorateRaw),
      authorName,
      authorTimestamp: Number(timestampRaw),
      subject,
    });
  }
  return commits;
}

const HEAD_ARROW = 'HEAD -> ';
const HEADS_PREFIX = 'refs/heads/';
const REMOTES_PREFIX = 'refs/remotes/';
const TAG_PREFIX = 'tag: refs/tags/';
const TAGS_PREFIX = 'refs/tags/';

/**
 * Разбирает поле `%D` (`--decorate=full`) в список ссылок. Декорации разделены
 * `, `. `HEAD -> refs/heads/<name>` схлопывается в ОДНУ запись `kind='head'`
 * (флаг текущей ветки для потребителя графа), а не в пару HEAD+localBranch.
 * Одиночный `HEAD` (detached) пропускается.
 */
function parseRefs(decorate: string): RawRef[] {
  const refs: RawRef[] = [];
  if (!decorate) {
    return refs;
  }
  for (const rawPart of decorate.split(', ')) {
    const part = rawPart.trim();
    if (!part || part === 'HEAD') {
      continue;
    }
    if (part.startsWith(HEAD_ARROW)) {
      refs.push({ name: stripPrefix(part.slice(HEAD_ARROW.length), HEADS_PREFIX), kind: 'head' });
      continue;
    }
    if (part.startsWith(TAG_PREFIX)) {
      refs.push({ name: part.slice(TAG_PREFIX.length), kind: 'tag' });
      continue;
    }
    if (part.startsWith(TAGS_PREFIX)) {
      refs.push({ name: part.slice(TAGS_PREFIX.length), kind: 'tag' });
      continue;
    }
    if (part.startsWith(HEADS_PREFIX)) {
      refs.push({ name: part.slice(HEADS_PREFIX.length), kind: 'localBranch' });
      continue;
    }
    if (part.startsWith(REMOTES_PREFIX)) {
      refs.push({ name: part.slice(REMOTES_PREFIX.length), kind: 'remoteBranch' });
      continue;
    }
  }
  return refs;
}

function stripPrefix(value: string, prefix: string): string {
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}
