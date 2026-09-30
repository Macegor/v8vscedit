import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildMetadataCacheSnapshot, loadMetadataCache, saveMetadataCache } from '../../infra/cache/MetadataCache';
import { buildScopeKey, loadHashCache, saveHashCache } from '../../infra/cache/HashCache';
import { MetadataXmlCreator } from '../../infra/xml/MetadataXmlCreator';
import { writeTextFilePreservingBomAndEol } from '../../infra/xml/XmlUtils';
import { tryRequireProductionModule } from './support/tryRequireProductionModule';

/**
 * Запись метаданных должна быть АТОМАРНОЙ: обрыв на середине `writeFileSync`
 * оставляет обрезанный файл, а битый XML одного объекта делает нечитаемой ВСЮ
 * конфигурацию, а не одно поле. Решение — запись во временный файл рядом и
 * `rename` поверх цели (модуль `infra/fs/AtomicFileWriter.ts`).
 *
 * Атомарность проверяется НАБЛЮДАЕМЫМИ свойствами, а не «мы же переименовываем»:
 *  - подмена, а не перезапись на месте — меняется inode (с обязательным
 *    контролем: тот же сценарий через голый `writeFileSync` inode сохраняет,
 *    иначе ассерт тавтологичен);
 *  - отказ на любом этапе не портит цель и не оставляет временных файлов —
 *    отказы воспроизводятся настоящей файловой системой, без моков.
 *
 * Временный путь обязан НЕ оканчиваться на `.xml`: watcher слушает
 * `src/**\/*.xml` (`Container.ts`), и временный `.xml` поднимал бы лишний
 * reload дерева на каждую запись.
 *
 * Модуль загружается лениво через `tryRequireProductionModule`: до реализации
 * статический import уронил бы загрузку ВСЕХ файлов раннера.
 */

interface AtomicModule {
  resolveAtomicTempPath(targetPath: string, uniqueSuffix: string): string;
  writeFileAtomic(targetPath: string, data: string): void;
}

function atomic(): AtomicModule {
  const loaded = tryRequireProductionModule('../../../infra/fs/AtomicFileWriter') as AtomicModule | undefined;
  assert.ok(loaded, 'infra/fs/AtomicFileWriter.ts ещё не реализован (ожидаемо на фазе «красный» TDD)');
  return loaded;
}

function tmpDir(prefix = 'v8vscedit-atomic-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const IS_WINDOWS = process.platform === 'win32';
/** От root проверка прав доступа бессмысленна: он пишет в любой каталог. */
const IS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0;

suite('AtomicFileWriter.resolveAtomicTempPath (T-B2.22)', () => {
  const targets: readonly string[] = [
    'Каталог.xml',
    'Form.xml',
    'Module.bsl',
    'БезРасширения',
    'имя.с.точками.xml',
    'Каталог с пробелами.xml',
    'ВЕРХНИЙ.XML',
    'Конфигурация Ё.xml',
  ];

  for (const name of targets) {
    test(`цель «${name}»: тот же каталог, путь не равен цели и не оканчивается на .xml`, () => {
      const dir = path.join(os.tmpdir(), 'v8vscedit-x', 'Catalogs');
      const target = path.join(dir, name);
      const temp = atomic().resolveAtomicTempPath(target, '123-1');
      assert.strictEqual(path.dirname(temp), dir, 'rename атомарен только в пределах одного каталога/тома');
      assert.notStrictEqual(temp, target);
      assert.ok(!temp.toLowerCase().endsWith('.xml'), `временный путь ${temp} попал бы под watcher src/**/*.xml`);
    });
  }

  test('разные суффиксы дают разные пути, один и тот же — один и тот же (чистая функция)', () => {
    const target = path.join(os.tmpdir(), 'Каталог.xml');
    const a = atomic().resolveAtomicTempPath(target, 'a');
    const b = atomic().resolveAtomicTempPath(target, 'b');
    assert.notStrictEqual(a, b);
    assert.strictEqual(atomic().resolveAtomicTempPath(target, 'a'), a);
  });

  test('временные пути разных целей одного каталога не совпадают при одинаковом суффиксе', () => {
    const dir = os.tmpdir();
    const a = atomic().resolveAtomicTempPath(path.join(dir, 'A.xml'), 's');
    const b = atomic().resolveAtomicTempPath(path.join(dir, 'B.xml'), 's');
    assert.notStrictEqual(a, b);
  });
});

suite('AtomicFileWriter.writeFileAtomic (T-B2.23-28)', function () {
  this.timeout(30000);

  test('новый файл создаётся с содержимым (кириллица, UTF-8)', () => {
    const target = path.join(tmpDir(), 'Новый.xml');
    atomic().writeFileAtomic(target, '<a>Привет</a>\n');
    assert.strictEqual(fs.readFileSync(target, 'utf-8'), '<a>Привет</a>\n');
  });

  test('перезапись существующего файла: содержимое заменено целиком (короче прежнего — без хвоста)', () => {
    const target = path.join(tmpDir(), 'Файл.xml');
    fs.writeFileSync(target, 'очень длинное прежнее содержимое', 'utf-8');
    atomic().writeFileAtomic(target, 'коротко');
    assert.strictEqual(fs.readFileSync(target, 'utf-8'), 'коротко');
  });

  test('ПОДМЕНА, а не перезапись на месте: inode цели меняется (контроль: голый writeFileSync сохраняет inode)', function () {
    if (IS_WINDOWS) {
      this.skip();
    }
    const dir = tmpDir();

    // Контроль: без него ассерт «inode изменился» ничего бы не различал.
    const control = path.join(dir, 'control.xml');
    fs.writeFileSync(control, 'old', 'utf-8');
    const controlBefore = fs.statSync(control).ino;
    fs.writeFileSync(control, 'new', 'utf-8');
    assert.strictEqual(fs.statSync(control).ino, controlBefore, 'контроль: запись на месте обязана сохранять inode');

    const target = path.join(dir, 'target.xml');
    fs.writeFileSync(target, 'old', 'utf-8');
    const before = fs.statSync(target).ino;
    atomic().writeFileAtomic(target, 'new');
    assert.notStrictEqual(fs.statSync(target).ino, before, 'запись обязана подменять файл (rename), а не переписывать на месте');
    assert.strictEqual(fs.readFileSync(target, 'utf-8'), 'new');
  });

  test('ОТКАЗ НА RENAME не портит цель и не оставляет временных файлов (цель — непустой каталог)', () => {
    const dir = tmpDir();
    const target = path.join(dir, 'Занято.xml');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'внутри.txt'), 'важное', 'utf-8');

    const writer = atomic();
    assert.throws(() => { writer.writeFileAtomic(target, 'новое'); });
    assert.ok(fs.statSync(target).isDirectory(), 'цель осталась каталогом');
    assert.strictEqual(fs.readFileSync(path.join(target, 'внутри.txt'), 'utf-8'), 'важное');
    assert.deepStrictEqual(fs.readdirSync(dir), ['Занято.xml'], 'временный файл не убран после отказа rename');
  });

  test('ОТКАЗ НА ЗАПИСИ (каталога нет): исключение, ничего не создано', () => {
    const dir = tmpDir();
    const missing = path.join(dir, 'нет-такого', 'Файл.xml');
    const writer = atomic();
    assert.throws(() => { writer.writeFileAtomic(missing, 'x'); });
    assert.deepStrictEqual(fs.readdirSync(dir), [], 'мусор после отказа');
  });

  test('ОТКАЗ НА ЗАПИСИ (каталог без права записи): исключение, цель не изменена, мусора нет', function () {
    if (IS_WINDOWS || IS_ROOT) {
      this.skip();
    }
    const dir = tmpDir();
    const target = path.join(dir, 'Файл.xml');
    fs.writeFileSync(target, 'прежнее', 'utf-8');
    const writer = atomic();
    fs.chmodSync(dir, 0o500);
    try {
      assert.throws(() => { writer.writeFileAtomic(target, 'новое'); });
    } finally {
      fs.chmodSync(dir, 0o700);
    }
    assert.strictEqual(fs.readFileSync(target, 'utf-8'), 'прежнее');
    assert.deepStrictEqual(fs.readdirSync(dir), ['Файл.xml']);
  });

  for (const mode of [0o600, 0o640, 0o755]) {
    test(`права цели сохраняются после перезаписи: ${mode.toString(8)}`, function () {
      if (IS_WINDOWS) {
        this.skip();
      }
      const target = path.join(tmpDir(), 'Файл.xml');
      fs.writeFileSync(target, 'old', 'utf-8');
      fs.chmodSync(target, mode);
      atomic().writeFileAtomic(target, 'new');
      assert.strictEqual(fs.statSync(target).mode & 0o777, mode, 'временный файл подменил права цели на дефолтные');
    });
  }

  test('СИМВОЛИЧЕСКАЯ ССЫЛКА (решение: следовать по ссылке): ссылка остаётся ссылкой, обновляется файл, на который она указывает', function () {
    if (IS_WINDOWS) {
      this.skip();
    }
    // Выбранное поведение: запись идёт в разрешённый (realpath) файл, а не
    // заменяет саму ссылку обычным файлом. Иначе выгрузка, подключённая в
    // проект симлинком, молча «отвалилась» бы от источника после первой правки.
    const linkDir = tmpDir('v8vscedit-atomic-link-');
    const realDir = tmpDir('v8vscedit-atomic-real-');
    const real = path.join(realDir, 'Настоящий.xml');
    const link = path.join(linkDir, 'Ссылка.xml');
    fs.writeFileSync(real, 'old', 'utf-8');
    fs.symlinkSync(real, link);

    atomic().writeFileAtomic(link, 'new');

    assert.ok(fs.lstatSync(link).isSymbolicLink(), 'ссылка заменена обычным файлом');
    assert.strictEqual(fs.readlinkSync(link), real);
    assert.strictEqual(fs.readFileSync(real, 'utf-8'), 'new');
    assert.deepStrictEqual(fs.readdirSync(linkDir), ['Ссылка.xml'], 'мусор рядом со ссылкой');
    assert.deepStrictEqual(fs.readdirSync(realDir), ['Настоящий.xml'], 'мусор рядом с файлом-назначением');
  });

  test('серия из 50 записей в один файл: мусора нет, итог — последняя запись', () => {
    const dir = tmpDir();
    const target = path.join(dir, 'Серия.xml');
    for (let i = 0; i < 50; i += 1) {
      atomic().writeFileAtomic(target, `запись ${String(i)}`);
    }
    assert.deepStrictEqual(fs.readdirSync(dir), ['Серия.xml']);
    assert.strictEqual(fs.readFileSync(target, 'utf-8'), 'запись 49');
  });

  test('серия записей в разные файлы одного каталога не оставляет временных файлов', () => {
    const dir = tmpDir();
    const names = ['A.xml', 'B.xml', 'Module.bsl', 'без-расширения'];
    for (const name of names) {
      atomic().writeFileAtomic(path.join(dir, name), name);
    }
    assert.deepStrictEqual(fs.readdirSync(dir).sort(), [...names].sort());
  });
});

suite('writeTextFilePreservingBomAndEol после делегирования атомарной записи (T-B2.29)', () => {
  const styles: readonly { label: string; eol: string; bom: boolean }[] = [
    { label: 'LF без BOM', eol: '\n', bom: false },
    { label: 'LF с BOM', eol: '\n', bom: true },
    { label: 'CRLF без BOM', eol: '\r\n', bom: false },
    { label: 'CRLF с BOM', eol: '\r\n', bom: true },
  ];

  for (const style of styles) {
    test(`[${style.label}] BOM и EOL исходного файла сохранены, новый текст нормализован, запись — подменой файла`, function () {
      const dir = tmpDir();
      const file = path.join(dir, 'Объект.xml');
      const original = `${style.bom ? '\ufeff' : ''}<a>${style.eol}\t<b>1</b>${style.eol}</a>${style.eol}`;
      fs.writeFileSync(file, original, 'utf-8');
      const inoBefore = fs.statSync(file).ino;

      // Новый текст намеренно собран с «голыми» \n — так его строят генераторы.
      writeTextFilePreservingBomAndEol(file, original, '<a>\n\t<b>2</b>\n\t<c/>\n</a>\n');

      const expected = `${style.bom ? '\ufeff' : ''}<a>${style.eol}\t<b>2</b>${style.eol}\t<c/>${style.eol}</a>${style.eol}`;
      assert.strictEqual(fs.readFileSync(file, 'utf-8'), expected);
      assert.deepStrictEqual(fs.readdirSync(dir), ['Объект.xml'], 'временный файл остался рядом');
      if (!IS_WINDOWS) {
        assert.notStrictEqual(fs.statSync(file).ino, inoBefore, 'запись обязана идти через атомарную подмену');
      }
    });
  }

  test('исходный файл без переводов строк → LF; BOM в результате не задваивается, если он уже есть в новом тексте', () => {
    const file = path.join(tmpDir(), 'Одна.xml');
    fs.writeFileSync(file, '\ufeff<a/>', 'utf-8');
    writeTextFilePreservingBomAndEol(file, '\ufeff<a/>', '\ufeff<a>\r\n</a>');
    const text = fs.readFileSync(file, 'utf-8');
    assert.strictEqual(text, '\ufeff<a>\n</a>');
  });
});

suite('Дедупликация temp+rename: кэши используют общий примитив (T-B2.30)', function () {
  this.timeout(30000);

  test('saveHashCache: запись → чтение → эквивалентный снимок, повторная запись не оставляет мусора', () => {
    const projectRoot = tmpDir('v8vscedit-hash-atomic-');
    const scopeKey = buildScopeKey('cf', path.join(projectRoot, 'src', 'cf'));
    const snapshot = {
      schemaVersion: 1 as const,
      scopeKey,
      generatedAt: '2026-01-01T00:00:00.000Z',
      files: { 'Catalogs/Тест.xml': 'hash-1', 'Documents/Заказ.xml': 'hash-2' },
    };
    saveHashCache(projectRoot, snapshot);
    saveHashCache(projectRoot, { ...snapshot, files: { 'Catalogs/Тест.xml': 'hash-3' } });
    assert.deepStrictEqual(loadHashCache(projectRoot, scopeKey).files, { 'Catalogs/Тест.xml': 'hash-3' });
    assert.strictEqual(listFilesRecursive(projectRoot).length, 1, 'в каталоге кэша должен остаться ровно один файл');
  });

  test('saveMetadataCache: запись → чтение → эквивалентный снимок, повторная запись не оставляет мусора', () => {
    const configRoot = tmpDir('v8vscedit-meta-atomic-cfg-');
    fs.writeFileSync(path.join(configRoot, 'Configuration.xml'), [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<MetaDataObject version="2.21">',
      '\t<Configuration>',
      '\t\t<Properties><Name>Тест</Name><Synonym/></Properties>',
      '\t\t<ChildObjects/>',
      '\t</Configuration>',
      '</MetaDataObject>',
      '',
    ].join('\n'), 'utf-8');
    assert.strictEqual(new MetadataXmlCreator().addRootObject({ configRoot, kind: 'Catalog', name: 'Товары' }).success, true);

    const projectRoot = tmpDir('v8vscedit-meta-atomic-prj-');
    const snapshot = buildMetadataCacheSnapshot('atomic-scope', { rootPath: configRoot, kind: 'cf' });
    saveMetadataCache(projectRoot, snapshot);
    saveMetadataCache(projectRoot, snapshot);

    const loaded = loadMetadataCache(projectRoot, 'atomic-scope');
    assert.ok(loaded, 'кэш не прочитался — снимок повреждён или отпечаток разошёлся');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(loaded.root)), JSON.parse(JSON.stringify(snapshot.root)));
    assert.strictEqual(listFilesRecursive(projectRoot).length, 1, 'в каталоге кэша должен остаться ровно один файл');
  });

  test('собственной реализации temp+rename в HashCache.ts и MetadataCache.ts не осталось — оба зовут AtomicFileWriter', () => {
    // Структурная проверка сознательна: третья копия temp+rename уже была
    // заведена один раз (две копии до этой задачи); наблюдаемым поведением
    // «rename где-то есть» дубликат не отличить от общего примитива.
    const root = path.resolve(__dirname, '../../..');
    for (const rel of ['src/infra/cache/HashCache.ts', 'src/infra/cache/MetadataCache.ts']) {
      const source = fs.readFileSync(path.join(root, rel), 'utf-8');
      assert.ok(!source.includes('renameSync'), `${rel}: остался собственный rename`);
      assert.ok(source.includes('AtomicFileWriter'), `${rel}: не использует общий AtomicFileWriter`);
    }
  });

  test('writeTextFilePreservingBomAndEol не содержит голого fs.writeFileSync в конце (запись делегирована)', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/infra/xml/XmlUtils.ts'), 'utf-8');
    const body = /export function writeTextFilePreservingBomAndEol[\s\S]*?\n}\n/.exec(source)?.[0] ?? '';
    assert.ok(body.length > 0, 'функция не найдена');
    assert.ok(!body.includes('fs.writeFileSync'), 'запись метаданных обязана идти через writeFileAtomic');
    assert.ok(body.includes('writeFileAtomic'));
  });
});

function listFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFilesRecursive(full));
    } else {
      out.push(full);
    }
  }
  return out;
}
