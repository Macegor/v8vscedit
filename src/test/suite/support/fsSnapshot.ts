import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Слепок каталога: относительный путь → хеш содержимого файла (или маркер каталога).
 *
 * Нужен тестам «ничего лишнего не тронуто»: дефект формо-инструментов проявлялся не
 * только перезаписью XML объекта, но и появлением каталогов с именем `X.xml`
 * (ENOTDIR-ловушка) и `CommonForms/X/Forms/**`. Точечные `existsSync` ловят только
 * заранее угаданные следы, а слепок целиком — любое изменение состава и содержимого.
 */
export type FsSnapshot = ReadonlyMap<string, string>;

const DIRECTORY_MARK = '<dir>';

export function snapshotTree(root: string): FsSnapshot {
  const result = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full);
      if (entry.isDirectory()) {
        result.set(rel, DIRECTORY_MARK);
        walk(full);
      } else {
        result.set(rel, crypto.createHash('sha1').update(fs.readFileSync(full)).digest('hex'));
      }
    }
  };
  walk(root);
  return result;
}

/** Отсортированный список относительных путей, у которых слепки различаются (изменён, добавлен, удалён). */
export function diffSnapshots(before: FsSnapshot, after: FsSnapshot): string[] {
  const keys = new Set<string>([...before.keys(), ...after.keys()]);
  return [...keys].filter((key) => before.get(key) !== after.get(key)).sort();
}

/** Все каталоги слепка, имя которых оканчивается на `.xml` (признак «файл использован как компонент пути»). */
export function directoriesNamedAsXml(snapshot: FsSnapshot): string[] {
  return [...snapshot.entries()]
    .filter(([rel, mark]) => mark === DIRECTORY_MARK && path.basename(rel).endsWith('.xml'))
    .map(([rel]) => rel)
    .sort();
}
