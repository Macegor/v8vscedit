import * as path from 'path';

/**
 * Нормализованная форма абсолютного пути для сравнения git-корней.
 * Совпадает по логике с `normalizePath` в `GitMetadataStatusService`:
 * `path.resolve` → унификация разделителей на forward slash → нижний регистр.
 * Дополнительно срезается хвостовой `/`: git toplevel из Git Extension API и
 * рабочий `gitRoot` панели могут отличаться только завершающим слэшем, а это
 * один и тот же каталог.
 */
export function normalizeGitPath(filePath: string): string {
  const normalized = path.resolve(filePath).split(/[\\/]/).join('/').toLowerCase();
  return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

/**
 * Возвращает индекс репозитория из `repoRoots`, чей корень нормализованно
 * совпадает с `gitRoot`, иначе `-1`. Сравнение — точное, без ancestor-fallback:
 * обе стороны заведомо git toplevel, а не произвольный путь внутри репозитория,
 * поэтому подстрочное вхождение недопустимо (иначе вложенный подкаталог-репо
 * ложно совпал бы с внешним).
 */
export function selectGitRepository(repoRoots: readonly string[], gitRoot: string): number {
  const target = normalizeGitPath(gitRoot);
  return repoRoots.findIndex((root) => normalizeGitPath(root) === target);
}
