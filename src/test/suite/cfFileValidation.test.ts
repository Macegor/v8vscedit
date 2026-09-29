/**
 * Тесты guard-функций `infra/cfFile/CfFileValidation.ts` — реальные временные
 * файлы/каталоги (`fs.mkdtempSync`), без заглушек. Эти функции — единственная
 * защита от повреждающих операций с базой (см. `cfFileArgs.test.ts` про
 * `-AllExtensions`) и от порчи существующих CF/CFE-файлов на диске.
 *
 * `CfFileValidation.ts` на фазе «красный» ещё не существует — лениво грузится
 * через `tryRequireProductionModule` (см. её JSDoc).
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { tryRequireProductionModule } from './support/tryRequireProductionModule';

type CfFileOperation = 'dump' | 'load';

interface CfFileRequest {
  readonly operation: CfFileOperation;
  readonly filePath: string;
  readonly isExtension: boolean;
  readonly allExtensionsFlag?: boolean;
  readonly overwrite?: boolean;
}

interface CfFileValidationModule {
  expectedCfFileSuffix(isExtension: boolean): '.cfe' | '.cf';
  validateCfFileSuffix(filePath: string, isExtension: boolean): string | undefined;
  assertNoAllExtensionsFlag(flag: boolean, operation: CfFileOperation): void;
  validateCfFileInputFile(filePath: string): string | undefined;
  validateCfFileOutputTarget(filePath: string, overwrite: boolean): string | undefined;
  resolveDumpStagingPath(outputFile: string, uniqueSuffix: string): string;
  isDumpStagingFileName(fileName: string): boolean;
  validateCfFileRequest(request: CfFileRequest): void;
}

suite('CfFileValidation — guard-функции CF/CFE (реальные временные файлы)', () => {
  let mod: CfFileValidationModule | undefined;
  let tempDir: string;

  suiteSetup(() => {
    mod = tryRequireProductionModule('../../../infra/cfFile/CfFileValidation') as CfFileValidationModule | undefined;
  });

  setup(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-cffile-validation-'));
  });

  teardown(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('модуль infra/cfFile/CfFileValidation.ts существует и экспортирует все guard-функции', () => {
    assert.ok(mod, 'infra/cfFile/CfFileValidation.ts ещё не реализован (ожидаемо на фазе «красный» TDD)');
  });

  function m(): CfFileValidationModule {
    if (!mod) {
      assert.fail('CfFileValidation.ts не реализован — см. первый тест сьюта');
    }
    return mod;
  }

  // ─── expectedCfFileSuffix / validateCfFileSuffix — матрица 12 кейсов (Часть 3, п.4) ───

  const suffixCases: { readonly suffix: string; readonly isExtension: boolean; readonly ok: boolean }[] = [
    { suffix: '.cf', isExtension: false, ok: true },
    { suffix: '.CF', isExtension: false, ok: true },
    { suffix: '.cfe', isExtension: false, ok: false },
    { suffix: '.CFE', isExtension: false, ok: false },
    { suffix: '.dat', isExtension: false, ok: false },
    { suffix: '', isExtension: false, ok: false },
    { suffix: '.cf', isExtension: true, ok: false },
    { suffix: '.CF', isExtension: true, ok: false },
    { suffix: '.cfe', isExtension: true, ok: true },
    { suffix: '.CFE', isExtension: true, ok: true },
    { suffix: '.dat', isExtension: true, ok: false },
    { suffix: '', isExtension: true, ok: false },
  ];

  test('expectedCfFileSuffix: .cfe для расширения, .cf для основной конфигурации', () => {
    assert.strictEqual(m().expectedCfFileSuffix(true), '.cfe');
    assert.strictEqual(m().expectedCfFileSuffix(false), '.cf');
  });

  for (const testCase of suffixCases) {
    test(`validateCfFileSuffix: suffix="${testCase.suffix}", isExtension=${String(testCase.isExtension)} → ${testCase.ok ? 'без ошибки' : 'ошибка'}`, () => {
      const filePath = `/data/file${testCase.suffix}`;
      const message = m().validateCfFileSuffix(filePath, testCase.isExtension);
      if (testCase.ok) {
        assert.strictEqual(message, undefined, `суффикс "${testCase.suffix}" при isExtension=${String(testCase.isExtension)} обязан считаться допустимым (регистр не влияет)`);
      } else {
        assert.ok(typeof message === 'string' && message.length > 0, `суффикс "${testCase.suffix}" при isExtension=${String(testCase.isExtension)} обязан быть отвергнут`);
      }
    });
  }

  // ─── validateCfFileInputFile — 4 ветки (Часть 3, п.9 / Часть 4, B.7) ───

  test('validateCfFileInputFile: несуществующий путь → сообщение об ошибке', () => {
    const message = m().validateCfFileInputFile(path.join(tempDir, 'no-such.cf'));
    assert.ok(typeof message === 'string' && message.length > 0);
  });

  test('validateCfFileInputFile: путь — каталог, а не файл → сообщение об ошибке', () => {
    const dirPath = path.join(tempDir, 'a-directory.cf');
    fs.mkdirSync(dirPath);
    const message = m().validateCfFileInputFile(dirPath);
    assert.ok(typeof message === 'string' && message.length > 0);
  });

  test('validateCfFileInputFile: файл размером 0 байт → сообщение об ошибке', () => {
    const filePath = path.join(tempDir, 'empty.cf');
    fs.writeFileSync(filePath, Buffer.alloc(0));
    const message = m().validateCfFileInputFile(filePath);
    assert.ok(typeof message === 'string' && message.length > 0);
  });

  test('validateCfFileInputFile: валидный непустой файл → undefined', () => {
    const filePath = path.join(tempDir, 'valid.cf');
    fs.writeFileSync(filePath, Buffer.from([1, 2, 3, 4]));
    assert.strictEqual(m().validateCfFileInputFile(filePath), undefined);
  });

  // ─── validateCfFileOutputTarget — 4 ветки (Часть 4, B.8) ───

  test('validateCfFileOutputTarget: каталог назначения не существует → сообщение об ошибке', () => {
    const outputFile = path.join(tempDir, 'no-such-dir', 'out.cf');
    const message = m().validateCfFileOutputTarget(outputFile, false);
    assert.ok(typeof message === 'string' && message.length > 0);
  });

  test('validateCfFileOutputTarget: файл уже существует и overwrite=false → сообщение об ошибке', () => {
    const outputFile = path.join(tempDir, 'exists.cf');
    fs.writeFileSync(outputFile, 'data');
    const message = m().validateCfFileOutputTarget(outputFile, false);
    assert.ok(typeof message === 'string' && message.length > 0);
  });

  test('validateCfFileOutputTarget: файл уже существует и overwrite=true → undefined (проверка снята)', () => {
    const outputFile = path.join(tempDir, 'exists-ow.cf');
    fs.writeFileSync(outputFile, 'data');
    assert.strictEqual(m().validateCfFileOutputTarget(outputFile, true), undefined);
  });

  test('validateCfFileOutputTarget: файла ещё нет, каталог существует → undefined', () => {
    const outputFile = path.join(tempDir, 'brand-new.cf');
    assert.strictEqual(m().validateCfFileOutputTarget(outputFile, false), undefined);
  });

  // ─── assertNoAllExtensionsFlag — Часть 4, B.9 ───

  for (const operation of ['dump', 'load'] as const) {
    test(`assertNoAllExtensionsFlag(true, "${operation}") бросает Error с упоминанием -Extension и list-db-extensions`, () => {
      // Обоснование текста ошибки: реальный прогон Конфигуратора 8.3.27.1989
      // (`/DumpCfg <файл> -AllExtensions` → exit 0, но результат совпадает с
      // обычной выгрузкой ОСНОВНОЙ конфигурации без единой диагностики) —
      // единственный практичный выход для агента/пользователя — узнать
      // реальный список расширений через `list-db-extensions` и вызывать
      // выгрузку поштучно через `-Extension <имя>`.
      assert.throws(
        () => m().assertNoAllExtensionsFlag(true, operation),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.ok(error.message.includes('-Extension'), `сообщение обязано упоминать -Extension: "${error.message}"`);
          assert.ok(error.message.includes('list-db-extensions'), `сообщение обязано упоминать list-db-extensions: "${error.message}"`);
          return true;
        }
      );
    });

    test(`assertNoAllExtensionsFlag(false, "${operation}") не бросает`, () => {
      assert.doesNotThrow(() => m().assertNoAllExtensionsFlag(false, operation));
    });
  }

  // ─── resolveDumpStagingPath — Часть 4, B.10 ───

  test('resolveDumpStagingPath: тот же каталог, что и у целевого файла, но другое имя', () => {
    const outputFile = path.join(tempDir, 'result.cf');
    const staging = m().resolveDumpStagingPath(outputFile, 'abc123');
    assert.strictEqual(path.dirname(staging), path.dirname(outputFile), 'staging-файл обязан лежать в том же каталоге назначения');
    assert.notStrictEqual(staging, outputFile, 'staging-путь обязан отличаться от целевого — иначе не защищает от 16-байтного мусора при сбое (см. эмпирику платформы)');
  });

  test('resolveDumpStagingPath: детерминирован по переданному suffix (для одинакового входа — одинаковый результат)', () => {
    const outputFile = path.join(tempDir, 'result.cf');
    const first = m().resolveDumpStagingPath(outputFile, 'fixed-suffix');
    const second = m().resolveDumpStagingPath(outputFile, 'fixed-suffix');
    assert.strictEqual(first, second);
  });

  test('resolveDumpStagingPath: разные suffix дают разные staging-пути', () => {
    const outputFile = path.join(tempDir, 'result.cf');
    const first = m().resolveDumpStagingPath(outputFile, 'suffix-a');
    const second = m().resolveDumpStagingPath(outputFile, 'suffix-b');
    assert.notStrictEqual(first, second);
  });

  // ─── isDumpStagingFileName — узнавание собственного staging-остатка ───

  test('isDumpStagingFileName: имя, реально построенное resolveDumpStagingPath, узнаётся — при ОБЕИХ формах уникального суффикса', () => {
    // Форм суффикса две: `pid-время` у одиночной выгрузки (dumpCfFile) и
    // `pid-время-индекс` у пакетной (dumpCfeAll). Узнавание обязано читать
    // результат САМОЙ функции построения и покрывать обе — предикат, знающий
    // одну форму, оставил бы остатки второй в каталоге навсегда.
    const suffixes = [`${String(process.pid)}-${String(Date.now())}`, `${String(process.pid)}-${String(Date.now())}-7`];
    for (const target of ['Ext01.cfe', 'A_B.cfe', 'Расш Тест.cfe', 'result.cf']) {
      for (const suffix of suffixes) {
        const staging = m().resolveDumpStagingPath(path.join(tempDir, target), suffix);
        assert.ok(m().isDumpStagingFileName(path.basename(staging)), `не узнан собственный staging-файл: ${staging}`);
      }
    }
  });

  test('isDumpStagingFileName: посторонние, бэкапы и чужие ".part" НЕ узнаются (их уборка стёрла бы чужие данные)', () => {
    for (const name of [
      'Ext01.cfe', 'cfe-dump.json', 'notes.txt', 'Main.cf',
      // Пользовательский файл, чья форма имени случайно похожа на «дата-с-дефисами»:
      // именно на нём предикат «по форме суффикса» уничтожал бы чужие данные.
      '.backup.2024-01-15.part', '.2024-01-15.part',
      '.hidden.part', '.Ext01.cfe.part', '.Ext01.cfe.123-456.part',
      '.Ext01.cfe.1-2-3.v8vscedit.part.bak', 'Ext01.cfe.1-2-3.v8vscedit.part', '.v8vscedit.part',
    ]) {
      assert.strictEqual(m().isDumpStagingFileName(name), false, name);
    }
  });

  // ─── validateCfFileRequest — композиция, порядок guard'ов (Часть 4, B.11) ───

  test('validateCfFileRequest: порядок — allExtensionsFlag нарушен ПЕРВЫМ, даже если путь тоже пуст и суффикс неверный', () => {
    assert.throws(
      () => m().validateCfFileRequest({
        operation: 'dump',
        filePath: '', // одновременно нарушает «обязательность пути»
        isExtension: true, // и суффикс (пустой путь не .cfe)
        allExtensionsFlag: true,
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(error.message.includes('-Extension') && error.message.includes('list-db-extensions'),
          `при одновременном нарушении нескольких правил обязано сработать именно правило AllExtensions (первое по порядку): "${error.message}"`);
        return true;
      }
    );
  });

  test('validateCfFileRequest: путь обязателен — пустая строка без allExtensionsFlag даёт отдельную ошибку (не про AllExtensions)', () => {
    assert.throws(
      () => m().validateCfFileRequest({ operation: 'dump', filePath: '', isExtension: false }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        // Важно НЕ ослаблять эту проверку до «просто что-то бросило»: если
        // модуль ещё не реализован, `m()` сам бросает свой sentinel-Error
        // («не реализован — см. первый тест сьюта»), и голый assert.throws
        // без проверки текста ложно позеленел бы ещё ДО реализации guard'а.
        assert.ok(!error.message.includes('не реализован'), `сработал sentinel «модуль не реализован», а не реальная бизнес-логика guard'а: "${error.message}"`);
        assert.ok(!error.message.includes('list-db-extensions'), `ошибка обязательности пути не должна путаться с ошибкой AllExtensions: "${error.message}"`);
        return true;
      }
    );
  });

  test('validateCfFileRequest: путь обязателен — та же проверка для operation="load" (текст ошибки про «загрузки», а не «выгрузки»)', () => {
    // Дополняет предыдущий тест: там был только operation="dump" — тернарник
    // выбора текста ошибки (`'выгрузки' : 'загрузки'`) без этого теста
    // проверялся только одной веткой.
    assert.throws(
      () => m().validateCfFileRequest({ operation: 'load', filePath: '', isExtension: false }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(error.message.includes('загрузки'), `для operation="load" ошибка обязана упоминать «загрузки»: "${error.message}"`);
        assert.ok(!error.message.includes('выгрузки'), `текст ошибки не должен путать «load» с «выгрузкой»: "${error.message}"`);
        return true;
      }
    );
  });

  test('validateCfFileRequest: суффикс проверяется после обязательности пути, но до fs-проверок (несуществующий каталог с неверным суффиксом → ошибка про суффикс)', () => {
    const badPath = path.join(tempDir, 'no-such-dir-at-all', 'file.dat');
    assert.throws(
      () => m().validateCfFileRequest({ operation: 'dump', filePath: badPath, isExtension: false }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        // fs-проверка (validateCfFileOutputTarget) сообщила бы про каталог,
        // а не про формат — раз суффикс проверяется РАНЬШЕ, сообщение обязано
        // быть про суффикс (см. expectedCfFileSuffix — ожидался .cf).
        assert.ok(error.message.includes('.cf'), `ожидалось сообщение о несоответствии суффикса .cf: "${error.message}"`);
        return true;
      }
    );
  });

  test('validateCfFileRequest: dump с валидным путём и суффиксом, но занятым fs-целевым файлом (overwrite не задан) → ошибка fs-уровня', () => {
    const outputFile = path.join(tempDir, 'taken.cf');
    fs.writeFileSync(outputFile, 'x');
    assert.throws(
      () => m().validateCfFileRequest({ operation: 'dump', filePath: outputFile, isExtension: false }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        // См. комментарий в тесте про «путь обязателен» — та же ловушка:
        // без явной проверки текста тест ложно зеленеет на sentinel-Error
        // из m(), а не на реальной проверке существующего fs-целевого файла.
        assert.ok(!error.message.includes('не реализован'), `сработал sentinel «модуль не реализован», а не реальная fs-проверка: "${error.message}"`);
        return true;
      }
    );
  });

  test('validateCfFileRequest: load с полностью валидным входом (существующий непустой .cf) не бросает', () => {
    const inputFile = path.join(tempDir, 'good.cf');
    fs.writeFileSync(inputFile, Buffer.from([1, 2, 3]));
    assert.doesNotThrow(() => m().validateCfFileRequest({ operation: 'load', filePath: inputFile, isExtension: false }));
  });

  test('validateCfFileRequest: dump с полностью валидным входом (новый файл, каталог существует) не бросает', () => {
    const outputFile = path.join(tempDir, 'new-output.cf');
    assert.doesNotThrow(() => m().validateCfFileRequest({ operation: 'dump', filePath: outputFile, isExtension: false, overwrite: false }));
  });
});
