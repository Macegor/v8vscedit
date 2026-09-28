/**
 * Выбор тестовых файлов для регистрации в Mocha: весь набор либо порция
 * (шард) из файла-манифеста.
 *
 * Дробление прогона на шарды нужно гейту покрытия: долгоживущий процесс тестов
 * теряет поблочную детализацию V8 (замерено: полный прогон даёт 0 блочных
 * покрытий из 615 скриптов), из-за чего покрытие веток становится
 * недостоверным. Цена дробления — риск, что часть тестов молча не прогонится,
 * поэтому файл манифеста, которого нет среди скомпилированных тестов, — это
 * ОШИБКА, а не пропуск: молчаливый пропуск тестов уже приводил к ложно-зелёному
 * гейту (регресс 2026-09-26).
 *
 * I/O внедряется параметром `readFile` — модуль остаётся чистым и проверяемым.
 *
 * @param allFiles все найденные скомпилированные `*.test.js` (относительные пути)
 * @param shardListPath путь к манифесту шарда; `undefined` — прогон целиком
 * @param readFile чтение манифеста
 */
export function resolveTestFiles(
  allFiles: string[],
  shardListPath: string | undefined,
  readFile: (path: string) => string
): string[] {
  if (shardListPath === undefined) {
    return allFiles;
  }
  const requested = readFile(shardListPath)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const known = new Set(allFiles);
  const missing = requested.filter((file) => !known.has(file));
  if (missing.length > 0) {
    throw new Error(
      `Манифест шарда ${shardListPath}: файлы отсутствуют среди скомпилированных тестов — ${missing.join(', ')}`
    );
  }
  return requested;
}
