/**
 * Тесты общих файловых примитивов CLI (`cli/core/onecCommon.ts`):
 * `moveStagingToTarget` и `safeRemoveFile`.
 *
 * Обе функции — ЕДИНСТВЕННАЯ реализация переноса staging-файла на целевой путь
 * для всех выгрузок (`dump-cf` и `dump-cfe-all`). До объединения копий было две,
 * обе под `c8 ignore` внутри команд, и расхождение между ними не поймал бы
 * никто: сценарий «перезапись существующего бэкапа» на Windows расходится с
 * POSIX (`rename` поверх существующего файла падает), а проверялся только
 * кодом возврата платформы, который об этом ничего не знает.
 *
 * Тесты работают на реальных временных файлах — ни заглушек, ни моков ФС.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { moveStagingToTarget, safeRemoveFile } from '../../cli/core/onecCommon';

suite('onecCommon — staging-файл выгрузки', () => {
  let tempDir: string;

  setup(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-cli-staging-'));
  });

  teardown(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('moveStagingToTarget: содержимое переносится байт-в-байт, staging-файла больше нет', () => {
    const staging = path.join(tempDir, '.result.cf.1-2-3.v8vscedit.part');
    const target = path.join(tempDir, 'result.cf');
    const bytes = Buffer.from([0x00, 0xff, 0x10, 0x20]);
    fs.writeFileSync(staging, bytes);

    moveStagingToTarget(staging, target);

    assert.ok(fs.readFileSync(target).equals(bytes));
    assert.ok(!fs.existsSync(staging), 'staging-файл не должен пережить перенос');
  });

  test('moveStagingToTarget: существующая цель заменяется целиком (на Windows rename поверх файла падает — цель снимается явно)', () => {
    const staging = path.join(tempDir, '.result.cf.1-2-3.v8vscedit.part');
    const target = path.join(tempDir, 'result.cf');
    fs.writeFileSync(target, 'СТАРЫЙ БЭКАП');
    fs.writeFileSync(staging, 'свежая выгрузка');

    moveStagingToTarget(staging, target);

    assert.strictEqual(fs.readFileSync(target, 'utf-8'), 'свежая выгрузка');
    assert.deepStrictEqual(fs.readdirSync(tempDir), ['result.cf']);
  });

  test('moveStagingToTarget: соседние файлы каталога не затрагиваются', () => {
    const staging = path.join(tempDir, '.result.cf.1-2-3.v8vscedit.part');
    fs.writeFileSync(staging, 'свежая выгрузка');
    fs.writeFileSync(path.join(tempDir, 'notes.txt'), 'мои заметки');

    moveStagingToTarget(staging, path.join(tempDir, 'result.cf'));

    assert.strictEqual(fs.readFileSync(path.join(tempDir, 'notes.txt'), 'utf-8'), 'мои заметки');
  });

  test('moveStagingToTarget: отсутствующий staging-файл — громкая ошибка, цель не создаётся', () => {
    // Молчаливый успех здесь означал бы «выгрузка прошла», хотя файла нет.
    const target = path.join(tempDir, 'result.cf');
    assert.throws(() => moveStagingToTarget(path.join(tempDir, 'no-such.part'), target));
    assert.ok(!fs.existsSync(target));
  });

  test('safeRemoveFile: существующий файл удаляется, соседние остаются', () => {
    const victim = path.join(tempDir, '.result.cf.1-2-3.v8vscedit.part');
    fs.writeFileSync(victim, '0123456789abcdef');
    fs.writeFileSync(path.join(tempDir, 'result.cf'), 'бэкап');

    safeRemoveFile(victim);

    assert.deepStrictEqual(fs.readdirSync(tempDir), ['result.cf']);
  });

  test('safeRemoveFile: отсутствующего файла достаточно для тишины — исключения нет', () => {
    // Вызывается в `finally` каждой итерации: исключение здесь подменило бы
    // собой настоящую причину сбоя операции.
    assert.doesNotThrow(() => safeRemoveFile(path.join(tempDir, 'no-such-file.part')));
  });

  test('safeRemoveFile: каталог вместо файла не роняет операцию и каталог не сносит', () => {
    const dirPath = path.join(tempDir, 'directory.part');
    fs.mkdirSync(dirPath);

    assert.doesNotThrow(() => safeRemoveFile(dirPath));

    assert.ok(fs.existsSync(dirPath), 'рекурсивного удаления каталога здесь быть не должно');
  });
});
