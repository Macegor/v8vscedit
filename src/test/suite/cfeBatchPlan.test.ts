/**
 * Тесты `infra/cfFile/CfeBatchPlan.ts` — предполётная проверка каталога выгрузки
 * и план загрузки (`validateCfeDumpDirectory`, `planCfeLoad`).
 *
 * Оба решения принимаются ДО первого спавна Конфигуратора и до первого
 * изменения базы: `/LoadCfg` необратимо меняет базу, а неудачная загрузка НОВОГО
 * расширения всё равно регистрирует его в базе (замерено на 8.3.27.1989) —
 * поэтому всё, что можно отвергнуть заранее (расширение есть в каталоге, но нет
 * в базе; манифест обещает файл, которого нет), обязано отвергаться в плане.
 *
 * Принцип сопоставления файл ↔ имя расширения (жёсткий приоритет):
 *  1. манифест — единственный способ восстановить `A:B` из `A_B.cfe`;
 *  2. иначе имя файла без `.cfe`, элемент помечается `manifestMissing`.
 * Содержимое `.cfe` НЕ парсится никогда (формат закрытый).
 *
 * Тесты работают на реальных временных каталогах; записи каталога для
 * `planCfeLoad` строятся из настоящего `readdir` + `stat` (имя и размер —
 * размер нужен, чтобы пустые файлы не попадали в план).
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { CfeManifest } from '../../infra/cfFile/CfeBatchManifest';
import { planCfeLoad, validateCfeDumpDirectory } from '../../infra/cfFile/CfeBatchPlan';

interface DirEntry {
  readonly name: string;
  readonly sizeBytes: number;
}

/** Записи файлов первого уровня каталога — как их видит вызывающий код. */
function readDirEntries(dir: string): DirEntry[] {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => ({ name: entry.name, sizeBytes: fs.statSync(path.join(dir, entry.name)).size }));
}

function manifestOf(items: CfeManifest['items']): CfeManifest {
  return { version: 1, createdAt: '2026-09-29T00:00:00.000Z', items };
}

suite('CfeBatchPlan.validateCfeDumpDirectory — каталог выгрузки', () => {
  let dir: string;

  setup(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-cfe-plan-dump-'));
  });

  teardown(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('каталога нет → ошибка с путём каталога', () => {
    const missing = path.join(dir, 'no-such-dir');
    const error = validateCfeDumpDirectory(missing, ['A.cfe'], false);
    assert.ok(error, 'ожидалась ошибка');
    assert.ok(error.includes(missing), `в ошибке нет пути каталога: ${error}`);
  });

  test('вместо каталога — файл → ошибка (создавать/затирать ничего нельзя)', () => {
    const filePath = path.join(dir, 'just-a-file');
    fs.writeFileSync(filePath, 'x');
    const error = validateCfeDumpDirectory(filePath, ['A.cfe'], true);
    assert.ok(error, 'файл вместо каталога обязан быть отвергнут даже с overwrite');
    assert.ok(error.includes(filePath), error);
  });

  for (const overwrite of [false, true]) {
    test(`пустой каталог, overwrite=${String(overwrite)} → нет ошибки`, () => {
      assert.strictEqual(validateCfeDumpDirectory(dir, ['A.cfe', 'B.cfe'], overwrite), undefined);
    });

    test(`пустой план (0 расширений), overwrite=${String(overwrite)} → нет ошибки`, () => {
      assert.strictEqual(validateCfeDumpDirectory(dir, [], overwrite), undefined);
    });

    test(`посторонние файлы (не входящие в план) игнорируются, overwrite=${String(overwrite)}`, () => {
      // Каталог выгрузки может быть общей папкой пользователя: посторонние
      // файлы не конфликтуют и не трогаются НИКОГДА.
      fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
      fs.writeFileSync(path.join(dir, 'Other.cfe'), 'x');
      fs.writeFileSync(path.join(dir, 'cfe-dump.json'), '{}');
      assert.strictEqual(validateCfeDumpDirectory(dir, ['A.cfe'], overwrite), undefined);
    });
  }

  test('конфликт с существующим файлом, overwrite=false → ошибка с именем файла', () => {
    fs.writeFileSync(path.join(dir, 'A.cfe'), 'old');
    const error = validateCfeDumpDirectory(dir, ['A.cfe', 'B.cfe'], false);
    assert.ok(error, 'без -Overwrite существующий бэкап затирать нельзя');
    assert.ok(error.includes('A.cfe'), error);
    assert.ok(!error.includes('B.cfe'), `B.cfe не конфликтует, но упомянут: ${error}`);
  });

  test('конфликт с существующим файлом, overwrite=true → нет ошибки', () => {
    fs.writeFileSync(path.join(dir, 'A.cfe'), 'old');
    assert.strictEqual(validateCfeDumpDirectory(dir, ['A.cfe', 'B.cfe'], true), undefined);
  });

  test('конфликт регистронезависим (ключ сравнения — нижний регистр): "a.CFE" на диске, "A.cfe" в плане', () => {
    fs.writeFileSync(path.join(dir, 'a.CFE'), 'old');
    const error = validateCfeDumpDirectory(dir, ['A.cfe'], false);
    assert.ok(error, 'на регистронезависимых ФС это ТОТ ЖЕ файл');
    assert.ok(/a\.cfe/i.test(error), error);
  });

  test('несколько конфликтов перечисляются в ошибке все', () => {
    fs.writeFileSync(path.join(dir, 'A.cfe'), 'old');
    fs.writeFileSync(path.join(dir, 'C.cfe'), 'old');
    const error = validateCfeDumpDirectory(dir, ['A.cfe', 'B.cfe', 'C.cfe'], false);
    assert.ok(error);
    assert.ok(error.includes('A.cfe') && error.includes('C.cfe'), error);
  });

  test('на месте будущего файла — каталог: ошибка даже с overwrite=true (rename поверх каталога невозможен)', () => {
    fs.mkdirSync(path.join(dir, 'A.cfe'));
    for (const overwrite of [false, true]) {
      const error = validateCfeDumpDirectory(dir, ['A.cfe'], overwrite);
      assert.ok(error, `overwrite=${String(overwrite)}: каталог с именем бэкапа обязан быть отвергнут`);
      assert.ok(error.includes('A.cfe'), error);
    }
  });
});

suite('CfeBatchPlan.planCfeLoad — план загрузки', () => {
  let dir: string;

  setup(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-cfe-plan-load-'));
  });

  teardown(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function put(fileName: string, content = 'binary'): void {
    fs.writeFileSync(path.join(dir, fileName), content);
  }

  test('манифест полный: имя берётся из манифеста ("A_B.cfe" → "A:B"), элементы без флага manifestMissing, ошибок нет', () => {
    put('A_B.cfe');
    put('Ext01.cfe');
    const manifest = manifestOf([
      { extensionName: 'A:B', fileName: 'A_B.cfe', status: 'ok', sizeBytes: 6 },
      { extensionName: 'Ext01', fileName: 'Ext01.cfe', status: 'ok', sizeBytes: 6 },
    ]);
    const plan = planCfeLoad(readDirEntries(dir), manifest, ['A:B', 'Ext01'], { createMissing: false });
    assert.deepStrictEqual(
      plan.items.map((item) => ({ name: item.extensionName, file: item.fileName, manifestMissing: item.manifestMissing })),
      [
        { name: 'A:B', file: 'A_B.cfe', manifestMissing: false },
        { name: 'Ext01', file: 'Ext01.cfe', manifestMissing: false },
      ]
    );
    assert.deepStrictEqual(plan.errors, []);
    assert.deepStrictEqual(plan.missingInDb, []);
    assert.deepStrictEqual(plan.notInDirectory, []);
    assert.deepStrictEqual(plan.ignoredFiles.filter((file) => file !== 'cfe-dump.json'), []);
  });

  test('приоритет манифеста: имя файла не совпадает с именем расширения — верно имя из манифеста', () => {
    put('Whatever.cfe');
    const manifest = manifestOf([{ extensionName: 'Ext01', fileName: 'Whatever.cfe', status: 'ok', sizeBytes: 6 }]);
    const plan = planCfeLoad(readDirEntries(dir), manifest, ['Ext01', 'Whatever'], { createMissing: false });
    assert.deepStrictEqual(plan.items.map((item) => item.extensionName), ['Ext01']);
    assert.deepStrictEqual(plan.notInDirectory, ['Whatever'], 'расширение "Whatever" в базе есть, но файла для него нет');
  });

  test('манифеста нет: имя расширения — имя файла без ".cfe", каждый элемент помечен manifestMissing', () => {
    put('Ext01.cfe');
    put('Расш Тест.cfe');
    const plan = planCfeLoad(readDirEntries(dir), undefined, ['Ext01', 'Расш Тест'], { createMissing: false });
    // Порядок элементов между алфавитами (латиница/кириллица) здесь не проверяется —
    // он зависит от ICU-локали; порядок в пределах одного алфавита — в тесте детерминизма ниже.
    assert.deepStrictEqual(
      plan.items.map((item) => [item.extensionName, item.fileName, item.manifestMissing] as const)
        .sort((left, right) => (left[0] < right[0] ? -1 : 1)),
      [['Ext01', 'Ext01.cfe', true], ['Расш Тест', 'Расш Тест.cfe', true]]
    );
    assert.deepStrictEqual(plan.errors, []);
  });

  test('манифеста нет и "A:B" в базе: файл "A_B.cfe" не угадывается как "A:B" — это "A_B", а в базе такого нет', () => {
    // Имя восстановить нельзя (A:B и A/B дали бы тот же файл), а угадывание по
    // базе загрузило бы чужой бэкап в чужое расширение.
    put('A_B.cfe');
    const plan = planCfeLoad(readDirEntries(dir), undefined, ['A:B'], { createMissing: false });
    assert.deepStrictEqual(plan.missingInDb, ['A_B']);
    assert.deepStrictEqual(plan.notInDirectory, ['A:B']);
    assert.ok(plan.errors.length > 0, 'без createMissing расширение из каталога, которого нет в базе, — ошибка');
  });

  test('манифест частичный: записанные — из манифеста, остальные — по имени файла с manifestMissing', () => {
    put('A_B.cfe');
    put('Ext02.cfe');
    const manifest = manifestOf([{ extensionName: 'A:B', fileName: 'A_B.cfe', status: 'ok', sizeBytes: 6 }]);
    const plan = planCfeLoad(readDirEntries(dir), manifest, ['A:B', 'Ext02'], { createMissing: false });
    const byName = new Map(plan.items.map((item) => [item.extensionName, item]));
    assert.strictEqual(byName.get('A:B')?.manifestMissing, false);
    assert.strictEqual(byName.get('Ext02')?.manifestMissing, true);
    assert.deepStrictEqual(plan.errors, []);
  });

  test('игнорируются: файлы без ".cfe", ".cf", "*.cfe.bak", пустые ".cfe", staging-остатки ".part" — они в ignoredFiles и не в items', () => {
    put('Ext01.cfe');
    put('notes.txt');
    put('Main.cf');
    put('Ext01.cfe.bak');
    put('noextension');
    put('Empty.cfe', '');
    put('.Ext09.cfe.1-2-3.v8vscedit.part');
    const plan = planCfeLoad(readDirEntries(dir), undefined, ['Ext01', 'Empty'], { createMissing: false });
    assert.deepStrictEqual(plan.items.map((item) => item.extensionName), ['Ext01']);
    assert.deepStrictEqual(
      [...plan.ignoredFiles].sort(),
      ['.Ext09.cfe.1-2-3.v8vscedit.part', 'Empty.cfe', 'Ext01.cfe.bak', 'Main.cf', 'noextension', 'notes.txt'].sort()
    );
    assert.deepStrictEqual(plan.notInDirectory, ['Empty'], 'у пустого файла нет годного .cfe — расширение "без файла"');
  });

  test('сам cfe-dump.json в план не берётся никогда', () => {
    put('Ext01.cfe');
    put('cfe-dump.json', '{"version":1}');
    const plan = planCfeLoad(readDirEntries(dir), undefined, ['Ext01'], { createMissing: false });
    assert.deepStrictEqual(plan.items.map((item) => item.fileName), ['Ext01.cfe']);
    assert.ok(!plan.items.some((item) => item.extensionName.toLowerCase().includes('cfe-dump')));
  });

  test('суффикс ".CFE" в верхнем регистре принимается, имя расширения — без суффикса', () => {
    put('Upper.CFE');
    const plan = planCfeLoad(readDirEntries(dir), undefined, ['Upper'], { createMissing: false });
    assert.deepStrictEqual(plan.items.map((item) => item.extensionName), ['Upper']);
    assert.deepStrictEqual(plan.ignoredFiles, []);
  });

  for (const createMissing of [false, true]) {
    test(`расширение из каталога отсутствует в базе, createMissing=${String(createMissing)}: ${createMissing ? 'загрузка разрешена (создаст в базе), ошибок нет' : 'ошибка pre-flight'}`, () => {
      put('Ext01.cfe');
      put('New.cfe');
      const plan = planCfeLoad(readDirEntries(dir), undefined, ['Ext01'], { createMissing });
      assert.deepStrictEqual(plan.missingInDb, ['New'], 'missingInDb — справочный список «есть в каталоге, нет в базе»');
      if (createMissing) {
        assert.deepStrictEqual(plan.errors, []);
        assert.deepStrictEqual(plan.items.map((item) => item.extensionName), ['Ext01', 'New']);
      } else {
        assert.ok(plan.errors.length > 0, 'без createMissing план обязан содержать ошибку');
        assert.ok(plan.errors.some((error) => error.includes('New')), `ошибка не называет расширение: ${plan.errors.join(' | ')}`);
      }
    });
  }

  test('расширение есть в базе, а файла нет: не трогается, попадает в notInDirectory, ошибкой не считается', () => {
    put('Ext01.cfe');
    const plan = planCfeLoad(readDirEntries(dir), undefined, ['Ext01', 'OnlyInDb'], { createMissing: false });
    assert.deepStrictEqual(plan.items.map((item) => item.extensionName), ['Ext01']);
    assert.deepStrictEqual(plan.notInDirectory, ['OnlyInDb']);
    assert.deepStrictEqual(plan.errors, []);
  });

  test('пустой план: каталог без .cfe — items пуст, все расширения базы в notInDirectory', () => {
    put('notes.txt');
    const plan = planCfeLoad(readDirEntries(dir), undefined, ['Ext01', 'Ext02'], { createMissing: false });
    assert.deepStrictEqual(plan.items, []);
    assert.deepStrictEqual(plan.notInDirectory, ['Ext01', 'Ext02']);
    assert.deepStrictEqual(plan.ignoredFiles, ['notes.txt']);
  });

  test('полностью пустые вход и база: всё пусто, ошибок нет', () => {
    const plan = planCfeLoad([], undefined, [], { createMissing: false });
    assert.deepStrictEqual(plan, { items: [], missingInDb: [], notInDirectory: [], ignoredFiles: [], errors: [] });
  });

  test('запись манифеста со status:failed не берётся в загрузку (файл — остаток прошлой выгрузки), сам файл остаётся в ignoredFiles', () => {
    // Выгрузка при отказе оставляет прежний одноимённый файл нетронутым — он
    // старше остальных бэкапов набора, и загрузка его вместе с новыми смешала бы поколения.
    put('Ext01.cfe');
    put('Ext02.cfe');
    const manifest = manifestOf([
      { extensionName: 'Ext01', fileName: 'Ext01.cfe', status: 'ok', sizeBytes: 6 },
      { extensionName: 'Ext02', fileName: 'Ext02.cfe', status: 'failed' },
    ]);
    const plan = planCfeLoad(readDirEntries(dir), manifest, ['Ext01', 'Ext02'], { createMissing: false });
    assert.deepStrictEqual(plan.items.map((item) => item.extensionName), ['Ext01']);
    assert.ok(plan.ignoredFiles.includes('Ext02.cfe'), `ignoredFiles: ${plan.ignoredFiles.join(', ')}`);
  });

  test('запись манифеста на несуществующий файл: в items не попадает, план содержит ошибку с именем файла', () => {
    // Манифест обещает бэкап, которого нет (файл удалили/не докопировали):
    // молча загрузить остальное значило бы получить набор без части расширений.
    put('Ext01.cfe');
    const manifest = manifestOf([
      { extensionName: 'Ext01', fileName: 'Ext01.cfe', status: 'ok', sizeBytes: 6 },
      { extensionName: 'Ghost', fileName: 'Ghost.cfe', status: 'ok', sizeBytes: 6 },
    ]);
    const plan = planCfeLoad(readDirEntries(dir), manifest, ['Ext01', 'Ghost'], { createMissing: true });
    assert.deepStrictEqual(plan.items.map((item) => item.extensionName), ['Ext01']);
    assert.ok(plan.errors.some((error) => error.includes('Ghost.cfe')), `ошибка не называет файл: ${plan.errors.join(' | ')}`);
  });

  test('запись манифеста на существующий, но ПУСТОЙ файл не берётся (пустой .cfe не грузится никогда)', () => {
    put('Ext01.cfe', '');
    const manifest = manifestOf([{ extensionName: 'Ext01', fileName: 'Ext01.cfe', status: 'ok', sizeBytes: 6 }]);
    const plan = planCfeLoad(readDirEntries(dir), manifest, ['Ext01'], { createMissing: false });
    assert.deepStrictEqual(plan.items, []);
  });

  test('детерминизм: порядок элементов не зависит от порядка записей каталога и совпадает с порядком выгрузки (ru, без учёта регистра)', () => {
    for (const name of ['Яблоко', 'арбуз', 'Банан', 'вишня']) {
      put(`${name}.cfe`);
    }
    const entries = readDirEntries(dir);
    const dbNames = ['Яблоко', 'арбуз', 'Банан', 'вишня'];
    const forward = planCfeLoad(entries, undefined, dbNames, { createMissing: false });
    const backward = planCfeLoad([...entries].reverse(), undefined, [...dbNames].reverse(), { createMissing: false });
    assert.deepStrictEqual(forward, backward);
    assert.deepStrictEqual(forward.items.map((item) => item.extensionName), ['арбуз', 'Банан', 'вишня', 'Яблоко']);
  });

  test('вход не мутируется', () => {
    put('Ext01.cfe');
    const entries = readDirEntries(dir);
    const snapshot = JSON.stringify(entries);
    const dbNames = ['Ext01'];
    planCfeLoad(entries, undefined, dbNames, { createMissing: false });
    assert.strictEqual(JSON.stringify(entries), snapshot);
    assert.deepStrictEqual(dbNames, ['Ext01']);
  });
});
