import * as fs from 'fs';
import * as path from 'path';

/**
 * Атомарная запись текстового файла: запись во временный файл рядом с целью и
 * `rename` поверх неё.
 *
 * Зачем: прерывание `fs.writeFileSync` на середине оставляет ОБРЕЗАННЫЙ файл, а
 * битый XML одного объекта делает нечитаемой ВСЮ конфигурацию, а не один
 * объект. `rename` в пределах одного каталога — атомарная подмена: читатель
 * видит либо прежнее содержимое целиком, либо новое целиком.
 *
 * Граница гарантии: защищает от обрыва ПРОЦЕССА (исключение, kill), но НЕ от
 * потери питания — `fsync` файла и каталога сознательно не делается, потому
 * что генерация создаёт десятки файлов за операцию, а защищаемый класс
 * отказа — прерывание записи, а не отказ диска.
 *
 * Единственная реализация temp+rename в проекте: до неё копий было две
 * (`HashCache`, `MetadataCache`), и каждая новая запись плодила третью.
 */

/** Счётчик вызовов — вместе с pid и временем даёт уникальное имя временного файла в пределах процесса. */
let writeCounter = 0;

/**
 * Путь временного файла для атомарной записи в `targetPath`.
 *
 * Два обязательных свойства:
 *  - тот же каталог, что у цели — `rename` атомарен только в пределах одного тома;
 *  - расширение НЕ `.xml` — расширение слушает `src/**\/*.xml`
 *    (`Container.wireFileWatcher`), и временный `.xml` поднимал бы лишний
 *    reload дерева на каждую запись метаданных. Поэтому суффикс ставится
 *    ПОСЛЕ исходного расширения, а не вместо него.
 *
 * Функция чистая: одинаковые аргументы дают одинаковый путь, ФС не трогается.
 */
export function resolveAtomicTempPath(targetPath: string, uniqueSuffix: string): string {
  const dir = path.dirname(targetPath);
  // Точка в начале имени прячет временный файл от обычного листинга и от
  // обходов выгрузки, а имя цели в составе — от коллизии двух записей в разные
  // файлы одного каталога с одним и тем же суффиксом.
  return path.join(dir, `.${path.basename(targetPath)}.${uniqueSuffix}.tmp`);
}

/**
 * Пишет `data` в `targetPath` подменой файла.
 *
 * Отказ на любом этапе — громкий: исходное исключение пробрасывается, цель
 * остаётся нетронутой, временный файл убирается. Молчаливого отката на прямую
 * `writeFileSync` здесь нет сознательно — он вернул бы ровно тот дефект
 * (обрезанный файл), ради которого функция и написана.
 */
export function writeFileAtomic(targetPath: string, data: string): void {
  const target = resolveWriteTarget(targetPath);
  writeCounter += 1;
  const tempPath = resolveAtomicTempPath(
    target,
    `${String(process.pid)}.${String(Date.now())}.${String(writeCounter)}`
  );
  try {
    fs.writeFileSync(tempPath, data, 'utf-8');
    const mode = existingFileMode(target);
    if (mode !== undefined) {
      // `rename` подменяет inode, значит и права: без переноса режима цели
      // файл после первой же правки получил бы режим по умолчанию.
      fs.chmodSync(tempPath, mode);
    }
    fs.renameSync(tempPath, target);
  } catch (error) {
    // Мусор убирается безусловно (`force` гасит ENOENT, если временный файл так
    // и не создался), а исходная причина отказа пробрасывается наружу: тихий
    // откат на прямую запись вернул бы ровно тот дефект, ради которого написан
    // этот модуль.
    fs.rmSync(tempPath, { force: true });
    throw error;
  }
}

/**
 * Путь, по которому реально идёт запись. Для символической ссылки — файл, на
 * который она указывает: иначе `rename` заменил бы саму ссылку обычным файлом,
 * и выгрузка, подключённая в проект симлинком, молча «отвалилась» бы от
 * источника после первой правки.
 */
function resolveWriteTarget(targetPath: string): string {
  let stats: fs.Stats;
  try {
    stats = fs.lstatSync(targetPath);
  } catch {
    return targetPath; // цели ещё нет — создаём новый файл по исходному пути
  }
  return stats.isSymbolicLink() ? fs.realpathSync(targetPath) : targetPath;
}

/** Права существующей цели (`undefined`, если цели ещё нет). */
function existingFileMode(target: string): number | undefined {
  try {
    return fs.statSync(target).mode & 0o777;
  } catch {
    return undefined;
  }
}
