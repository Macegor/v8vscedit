import { execFileSync } from 'child_process';
import { parsePorcelain, type PorcelainEntry } from './GitPorcelainReader';

/**
 * Тонкий раннер `git status --porcelain` для UI-слоя. Держит запуск git-процесса
 * в инфраструктуре (как {@link GitBlobReader}/{@link GitWriteService}), чтобы
 * провайдер дерева изменений не исполнял процессы сам и оставался тонким.
 *
 * Не мутирует репозиторий; при отсутствии git/репозитория возвращает мягкие
 * значения (пустой список записей / `null` для корня), а не бросает исключение.
 */

const MAX_BUFFER = 64 * 1024 * 1024;

/**
 * Возвращает записи рабочего дерева через `git status --porcelain
 * --untracked-files=all`. Untracked-файлы перечисляются поштучно (не свёрнуто
 * в каталог) — так каждый новый файл выгрузки попадает в модель изменений.
 */
export function readPorcelainEntries(gitRoot: string): PorcelainEntry[] {
  try {
    const output = execFileSync(
      'git',
      ['-C', gitRoot, 'status', '--porcelain', '--untracked-files=all'],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: MAX_BUFFER }
    );
    return parsePorcelain(output);
  } catch {
    return [];
  }
}

/** Возвращает корень git-репозитория для каталога или `null`, если это не репозиторий. */
export function resolveGitRoot(startDir: string): string | null {
  try {
    return execFileSync('git', ['-C', startDir, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}
