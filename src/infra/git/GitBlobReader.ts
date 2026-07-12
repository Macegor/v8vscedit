import { execFileSync } from 'child_process';
import * as path from 'path';

/**
 * Тонкий ридер содержимого blob-ов git из HEAD и индекса.
 *
 * Не запускает мутаций и не бросает исключений: отсутствие blob-а (файл не
 * коммичен / не индексирован) или отсутствие git-репозитория дают мягкий `null`.
 */

const MAX_BUFFER = 64 * 1024 * 1024;

/**
 * Читает содержимое файла из HEAD (последнего коммита). Возвращает `null`, если
 * файл отсутствует в HEAD или git недоступен.
 */
export function readBlobAtHead(gitRoot: string, absFilePath: string): string | null {
  return showBlob(gitRoot, 'HEAD:', absFilePath);
}

/**
 * Читает застейдженное (индексное) содержимое файла. Возвращает `null`, если
 * файл не находится в индексе или git недоступен.
 */
export function readBlobAtIndex(gitRoot: string, absFilePath: string): string | null {
  return showBlob(gitRoot, ':', absFilePath);
}

/**
 * Читает содержимое файла на произвольном ref/commit-ish (`git show <ref>:<rel>`).
 * Обобщение {@link readBlobAtHead} для панели графа: любой коммит истории, не
 * только HEAD. Возвращает `null`, если ref не существует, файла в нём нет или
 * git недоступен.
 */
export function readBlobAtRef(gitRoot: string, ref: string, absFilePath: string): string | null {
  return showBlob(gitRoot, `${ref}:`, absFilePath);
}

function showBlob(gitRoot: string, refPrefix: string, absFilePath: string): string | null {
  const relPath = path.relative(gitRoot, absFilePath).split(path.sep).join('/');
  try {
    return execFileSync('git', ['-C', gitRoot, 'show', `${refPrefix}${relPath}`], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: MAX_BUFFER,
    });
  } catch {
    return null;
  }
}
