import { decode } from 'iconv-lite';

/**
 * Восстанавливает кириллицу из «битого» UTF-8: если UTF-8-декодирование дало
 * символы замены '�', пробует cp866/win1251 и выбирает наиболее читаемый
 * вариант. Чистая функция без платформенной привязки — используется для юнит-
 * проверки эвристики независимо от ОС теста.
 */
export function recoverGarbledText(chunk: Buffer): string {
  const utf8Text = chunk.toString('utf-8');
  if (!utf8Text.includes('�')) {
    return utf8Text;
  }

  const cp866Text = decode(chunk, 'cp866');
  const cp1251Text = decode(chunk, 'win1251');
  return pickMostReadableText([cp866Text, cp1251Text, utf8Text]);
}

/**
 * Нормализует кодировку вывода внешней команды.
 * Декодер обрабатывает stdout процесса, запущенного на ЭТОЙ же машине, поэтому
 * кодировка вывода соответствует платформе хоста. На Windows консольные утилиты
 * 1С/vrunner часто пишут в OEM-866/Win1251 — там применяем восстановление; на
 * *nix вывод UTF-8, и трогать его нельзя, иначе легитимный '�' будет ошибочно
 * переинтерпретирован как cp866/win1251 (эвристика `pickMostReadableText` не
 * структурная и может выбрать неверный вариант).
 */
export function decodeProcessOutput(chunk: Buffer): string {
  if (process.platform !== 'win32') {
    return chunk.toString('utf-8');
  }
  return recoverGarbledText(chunk);
}

/**
 * Построчный декодер вывода процесса.
 *
 * Chunked-поток внешнего процесса (1С/vrunner) может разрезать многобайтовый
 * кириллический символ ровно на стыке двух чанков, поэтому декодировать каждый
 * чанк по отдельности нельзя — на месте разрыва появится '�'. Декодер держит
 * весь накопленный Buffer, при каждом push декодирует его целиком через
 * decodeProcessOutput и отдаёт только новые (ещё не выданные) готовые строки.
 */
export class LineBufferedDecoder {
  private buffer: Buffer = Buffer.alloc(0);
  private emittedLineCount = 0;

  /** Добавляет чанк и возвращает готовые строки (по границе 0x0A), появившиеся с прошлого push. */
  push(chunk: Buffer): string[] {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);

    // Готовые строки — это всё до последнего перевода строки в накопленном буфере.
    const lastNewline = this.buffer.lastIndexOf(0x0a);
    if (lastNewline < 0) {
      return [];
    }

    const decoded = decodeProcessOutput(this.buffer.subarray(0, lastNewline));
    const allLines = decoded.split('\n').map((line) => stripCarriageReturn(line));
    const fresh = allLines.slice(this.emittedLineCount);
    this.emittedLineCount = allLines.length;
    return fresh;
  }

  /** Возвращает незавершённый хвост (без \n) один раз; повторный вызов — undefined. */
  flush(): string | undefined {
    const lastNewline = this.buffer.lastIndexOf(0x0a);
    const tailBuffer = this.buffer.subarray(lastNewline + 1);
    if (tailBuffer.length === 0) {
      return undefined;
    }

    const tail = stripCarriageReturn(decodeProcessOutput(tailBuffer));
    // Помечаем хвост как выданный, чтобы повторный flush вернул undefined.
    this.buffer = this.buffer.subarray(0, lastNewline + 1);
    return tail;
  }
}

function stripCarriageReturn(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

/** Выбирает вариант строки с наибольшим числом кириллических символов. */
export function pickMostReadableText(candidates: string[]): string {
  let best = candidates[0] ?? '';
  let bestScore = -1;

  for (const candidate of candidates) {
    const cyr = (candidate.match(/[А-Яа-яЁё]/g) ?? []).length;
    const replacement = (candidate.match(/�/g) ?? []).length;
    const score = cyr * 2 - replacement * 3;
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}
