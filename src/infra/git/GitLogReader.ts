import { execFileSync } from 'child_process';
import { parseGitLog, type RawCommit } from './GitLogParser';

/**
 * Тонкий раннер `git log` для графа истории. Держит запуск git-процесса в
 * инфраструктуре (как {@link GitStatusReader}/{@link GitBlobReader}), чтобы
 * UI-слой оставался тонким. Основной разбор — в {@link parseGitLog}.
 *
 * Не мутирует репозиторий; при отсутствии git/репозитория возвращает пустой
 * список, а не бросает исключение.
 */

const MAX_BUFFER = 128 * 1024 * 1024;

/**
 * Формат `--pretty`: поля `%H %P %D %an %at %s`, разделитель полей `\x1f`,
 * разделитель записей `\x1e`. `--decorate=full` обязателен — иначе не отличить
 * локальную ветку от удалённой при разборе `%D`.
 */
const PRETTY_FORMAT = '%H%x1f%P%x1f%D%x1f%an%x1f%at%x1f%s%x1e';

/**
 * Возвращает коммиты истории всего репозитория (`--all`) в топологическом
 * порядке. `maxCount` (если задан) ограничивает выборку для постраничной
 * подгрузки (`--max-count`).
 */
export function readGitLog(gitRoot: string, maxCount?: number): RawCommit[] {
  const args = [
    '-C', gitRoot,
    'log', '--all', '--decorate=full', '--parents', '--topo-order',
    `--pretty=format:${PRETTY_FORMAT}`,
  ];
  if (maxCount !== undefined) {
    args.push(`--max-count=${String(maxCount)}`);
  }
  try {
    const output = execFileSync('git', args, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: MAX_BUFFER,
    });
    return parseGitLog(output);
  } catch {
    return [];
  }
}
