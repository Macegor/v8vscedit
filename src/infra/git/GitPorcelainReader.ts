/**
 * Чистый парсер вывода `git status --porcelain` (формат v1).
 *
 * Разбирает каждую строку в {@link PorcelainEntry} с РАЗДЕЛЬНЫМИ символами
 * индекса (X) и рабочего дерева (Y) — схлопывание X/Y в один статус остаётся
 * зоной ответственности потребителей (декоратор, агрегатор), а не парсера.
 *
 * Не запускает git и не трогает ФС — принимает готовую строку вывода.
 */

/** Одна запись `git status --porcelain` с раздельными X/Y. */
export interface PorcelainEntry {
  /** Символ статуса индекса (X). Пробел означает «в индексе без изменений». */
  readonly index: string;
  /** Символ статуса рабочего дерева (Y). Пробел означает «в дереве без изменений». */
  readonly worktree: string;
  /** Относительный путь (для переименования — путь назначения). */
  readonly relPath: string;
  /** Исходный путь для переименований/копий (`R old -> new`). */
  readonly oldRelPath?: string;
}

/**
 * Разбирает вывод `git status --porcelain` (v1) в массив записей.
 *
 * Формат строки: `XY <path>` либо `XY <old> -> <new>` для переименований/копий.
 * Позиции 0/1 — коды X/Y, позиция 2 — пробел-разделитель, далее путь.
 */
export function parsePorcelain(output: string): PorcelainEntry[] {
  const entries: PorcelainEntry[] = [];
  if (!output) {
    return entries;
  }
  for (const rawLine of output.split(/\r?\n/)) {
    if (rawLine.length < 4) {
      continue;
    }
    const index = rawLine[0];
    const worktree = rawLine[1];
    const pathPart = rawLine.slice(3);

    const arrowAt = pathPart.indexOf(' -> ');
    if (arrowAt !== -1) {
      const oldRaw = pathPart.slice(0, arrowAt);
      const newRaw = pathPart.slice(arrowAt + 4);
      entries.push({
        index,
        worktree,
        relPath: unquotePorcelainPath(newRaw),
        oldRelPath: unquotePorcelainPath(oldRaw),
      });
      continue;
    }

    entries.push({ index, worktree, relPath: unquotePorcelainPath(pathPart) });
  }
  return entries;
}

/**
 * Снимает кавычки и декодирует C-style escape-последовательности, которые git
 * добавляет при `core.quotepath=true` (по умолчанию). Восьмеричные escapes
 * `\NNN` собираются в байты и декодируются как UTF-8 — так восстанавливаются
 * кириллические имена файлов в выгрузке 1С.
 *
 * Если строка не в кавычках — возвращается как есть.
 *
 * Экспортируется для переиспользования из {@link GitCommitChangesReader}
 * (`git diff-tree --name-status` квотит кириллические пути тем же octal-escape).
 */
export function unquotePorcelainPath(raw: string): string {
  if (!(raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2)) {
    return raw;
  }
  const body = raw.slice(1, -1);
  let result = '';
  let index = 0;
  const bytes: number[] = [];
  const flushBytes = (): void => {
    if (bytes.length > 0) {
      result += Buffer.from(bytes).toString('utf-8');
      bytes.length = 0;
    }
  };
  while (index < body.length) {
    const ch = body[index];
    if (ch !== '\\') {
      flushBytes();
      result += ch;
      index += 1;
      continue;
    }
    if (index + 1 >= body.length) {
      break;
    }
    const next = body[index + 1];
    if (next >= '0' && next <= '7') {
      // Восьмеричный escape \NNN — один байт UTF-8-последовательности.
      const octal = body.slice(index + 1, index + 4);
      bytes.push(parseInt(octal, 8));
      index += 4;
      continue;
    }
    flushBytes();
    switch (next) {
      case 'n': result += '\n'; break;
      case 't': result += '\t'; break;
      case 'r': result += '\r'; break;
      case '\\': result += '\\'; break;
      case '"': result += '"'; break;
      default: result += next; break;
    }
    index += 2;
  }
  flushBytes();
  return result;
}
