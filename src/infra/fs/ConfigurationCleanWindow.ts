import * as path from 'path';

/**
 * Окно «тишины» по корню конфигурации, открываемое после успешной операции с базой
 * (импорт из базы / обновление в базе).
 *
 * Зачем: файловый watcher VS Code доставляет события записанных файлов с задержкой —
 * уже ПОСЛЕ того, как операция завершилась и состояние сброшено в «чистое». Быстрый
 * путь пометки «конфигурация изменена» (по одному событию, без чтения хеш-кэша)
 * срабатывал на этих запоздавших событиях и снова помечал только что
 * синхронизированную конфигурацию изменённой — расширение предлагало обновить базу
 * сразу после импорта.
 *
 * Пока окно открыто, событие игнорируется ЦЕЛИКОМ: хеш-кэш операция только что
 * актуализировала, а полный пересчёт (`ConfigurationChangeDetector.detect` обходит
 * и хеширует всю выгрузку) на каждом из тысяч событий заблокировал бы Extension
 * Host. Единственный авторитетный пересчёт по окончании окна планирует тот же код,
 * который окно открыл (`Container.markConfigurationsClean`).
 *
 * Класс намеренно не знает про `vscode`: источник времени внедряется, чтобы тест
 * проверял истечение окна без ожидания реального таймера.
 */
export class ConfigurationCleanWindow {
  /**
   * Запас на доставку событий watcher после записи файлов. Меньше — и хвост
   * событий большой выгрузки успевает пройти мимо окна; больше — дольше
   * откладывается реакция на правки, сделанные сразу после операции.
   */
  static readonly defaultDurationMs = 15_000;

  private readonly openedUntil = new Map<string, number>();

  constructor(
    private readonly durationMs = ConfigurationCleanWindow.defaultDurationMs,
    private readonly now: () => number = () => Date.now()
  ) {}

  /** Открывает окно для перечисленных корней конфигураций. */
  open(rootPaths: readonly string[]): void {
    const expiresAt = this.now() + this.durationMs;
    for (const rootPath of rootPaths) {
      this.openedUntil.set(normalizePath(rootPath), expiresAt);
    }
  }

  /** Истина, если файл лежит в корне с ещё не истёкшим окном тишины. */
  isOpenFor(filePath: string): boolean {
    const normalizedFilePath = normalizePath(filePath);
    const currentTime = this.now();
    for (const [rootPath, expiresAt] of this.openedUntil) {
      if (!isPathInside(normalizedFilePath, rootPath)) {
        continue;
      }
      if (expiresAt >= currentTime) {
        return true;
      }
      this.openedUntil.delete(rootPath);
    }
    return false;
  }
}

function normalizePath(value: string): string {
  return path.resolve(value).toLowerCase();
}

function isPathInside(normalizedFilePath: string, normalizedRootPath: string): boolean {
  const relative = path.relative(normalizedRootPath, normalizedFilePath);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}
