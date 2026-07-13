import { execFileSync } from 'child_process';
import { unquotePorcelainPath, type PorcelainEntry } from './GitPorcelainReader';

/**
 * Чистый парсер и тонкий раннер `git diff-tree --name-status` для графа истории
 * (Слой 1): состав изменений одного коммита относительно его первого родителя.
 *
 * Форма результата — существующий {@link PorcelainEntry}: `--name-status` даёт
 * ОДИН статусный символ на строку (без раздельных X/Y индекса/дерева), поэтому
 * `worktree` всегда заполняется пробелом. Декодирование octal-escape путей
 * переиспользует {@link unquotePorcelainPath} (без дублей).
 */

const MAX_BUFFER = 128 * 1024 * 1024;

/**
 * Разбирает вывод `git diff-tree --name-status` в массив записей.
 *
 * Формат строки: `<status>\t<path>` либо `<status>\t<old>\t<new>` для
 * переименований/копий (`R100`/`C100`). Степень сходства после `R`/`C`
 * отбрасывается — в `index` попадает только первый символ статуса.
 */
export function parseNameStatus(output: string): PorcelainEntry[] {
  const entries: PorcelainEntry[] = [];
  if (!output) {
    return entries;
  }
  for (const rawLine of output.split(/\r?\n/)) {
    if (!rawLine) {
      continue;
    }
    const parts = rawLine.split('\t');
    if (parts.length < 2) {
      continue;
    }
    const index = parts[0][0];
    if ((index === 'R' || index === 'C') && parts.length >= 3) {
      entries.push({
        index,
        worktree: ' ',
        relPath: unquotePorcelainPath(parts[2]),
        oldRelPath: unquotePorcelainPath(parts[1]),
      });
      continue;
    }
    entries.push({ index, worktree: ' ', relPath: unquotePorcelainPath(parts[1]) });
  }
  return entries;
}

/**
 * Возвращает состав изменений коммита относительно его первого родителя
 * (`--first-parent`), с обнаружением переименований (`-M`). Для корневого
 * коммита передайте `options.root = true` (`--root`), иначе diff-tree выдаст
 * пусто. Мягкий фолбэк `[]` при недоступном git.
 */
export function readCommitChanges(
  gitRoot: string,
  commit: string,
  options?: { readonly root?: boolean }
): PorcelainEntry[] {
  const args = [
    '-C', gitRoot,
    'diff-tree', '--no-commit-id', '--name-status', '-r', '-M', '--first-parent',
  ];
  if (options?.root) {
    args.push('--root');
  }
  args.push(commit);
  try {
    const output = execFileSync('git', args, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: MAX_BUFFER,
    });
    return parseNameStatus(output);
  } catch {
    return [];
  }
}
