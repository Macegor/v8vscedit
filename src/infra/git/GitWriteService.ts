import { execFileSync } from 'child_process';
import * as fs from 'fs';

/**
 * Мутации git над НАБОРОМ файлов, без vscode. Каждая операция запускается одним
 * git-процессом; при отсутствии git-репозитория операция падает управляемой
 * ошибкой (execFileSync бросает исключение с stderr git), а не теряет правку.
 */

/** Вид изменения файла для точечной отмены. */
export type DiscardStatus = 'modified' | 'untracked' | 'deleted';

/** Один файл к отмене вместе с его текущим состоянием. */
export interface DiscardEntry {
  readonly absPath: string;
  readonly status: DiscardStatus;
}

/** Индексирует переданные файлы (`git add`). */
export function stage(gitRoot: string, absPaths: readonly string[]): void {
  if (absPaths.length === 0) {
    return;
  }
  runGit(gitRoot, ['add', '--', ...absPaths]);
}

/**
 * Убирает файлы из индекса, сохраняя правки в рабочем дереве
 * (`git reset HEAD` — совместим и со старыми версиями git).
 */
export function unstage(gitRoot: string, absPaths: readonly string[]): void {
  if (absPaths.length === 0) {
    return;
  }
  runGit(gitRoot, ['reset', '-q', 'HEAD', '--', ...absPaths]);
}

/**
 * Отменяет локальные изменения по каждому файлу согласно его состоянию:
 *  - `modified`/`deleted` — восстановление содержимого из индекса/HEAD (`git checkout`);
 *  - `untracked` — удаление файла с диска.
 */
export function discard(gitRoot: string, entries: readonly DiscardEntry[]): void {
  const checkoutPaths = entries
    .filter((e) => e.status === 'modified' || e.status === 'deleted')
    .map((e) => e.absPath);
  const untrackedPaths = entries.filter((e) => e.status === 'untracked').map((e) => e.absPath);

  if (checkoutPaths.length > 0) {
    runGit(gitRoot, ['checkout', '--', ...checkoutPaths]);
  }
  for (const filePath of untrackedPaths) {
    fs.rmSync(filePath, { force: true });
  }
}

/** Коммитит застейдженные изменения переданным сообщением. */
export function commit(gitRoot: string, message: string): void {
  runGit(gitRoot, ['commit', '-q', '-m', message]);
}

function runGit(gitRoot: string, args: readonly string[]): void {
  execFileSync('git', ['-C', gitRoot, ...args], {
    stdio: ['ignore', 'ignore', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
}
