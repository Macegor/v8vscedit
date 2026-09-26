/**
 * Тесты чистого построителя вектора аргументов Конфигуратора для
 * выгрузки/загрузки CF/CFE (`infra/cfFile/CfFileArgs.ts`).
 *
 * Контекст (эмпирика реальной платформы 8.3.27.1989, зафиксирована
 * оркестратором и НЕ перепроверяется здесь — прямой спавн Конфигуратора в
 * этих тестах недопустим):
 *  - `/DumpCfg <файл> -AllExtensions` → exit 0, но результат БАЙТ-В-БАЙТ
 *    совпадает с обычной выгрузкой ОСНОВНОЙ конфигурации — платформа флаг
 *    молча проглатывает и подсовывает неверные данные без единой ошибки.
 *  - `/DumpCfg <файл> -ЗаведомоНетТакого` → тоже exit 0 — платформа не
 *    диагностирует неизвестные ключи вовсе.
 *  - `-Extension <имя>` и `/DumpCfg`/`/LoadCfg` — реально разбираемый,
 *    задокументированный синтаксис (совпадает со справкой 1С и
 *    github.com/v8platform/designer).
 *
 * Следствие: единственная реальная защита от порчи данных — это сам ВЕКТОР
 * аргументов (он и есть контракт с платформой), поэтому центральные тесты —
 * точные `deepStrictEqual`, а не проверка «что-то отработало».
 *
 * `CfFileArgs.ts` на фазе «красный» ещё не существует — модуль грузится
 * лениво через `tryRequireProductionModule`, иначе статический импорт
 * несуществующего модуля оборвёт загрузку ВСЕХ файлов раннера (см. JSDoc
 * `support/tryRequireProductionModule.ts`).
 */
import * as assert from 'assert';
import * as path from 'path';
import { tryRequireProductionModule } from './support/tryRequireProductionModule';

type CfFileOperation = 'dump' | 'load';

interface CfFileDesignerArgsOptions {
  readonly operation: CfFileOperation;
  readonly filePath: string;
  readonly extensionName?: string;
  readonly outLogFile: string;
}

interface CfFileArgsModule {
  buildCfFileDesignerArgs(options: CfFileDesignerArgsOptions): string[];
}

suite('CfFileArgs.buildCfFileDesignerArgs — вектор аргументов Конфигуратора', () => {
  let mod: CfFileArgsModule | undefined;

  suiteSetup(() => {
    mod = tryRequireProductionModule('../../../infra/cfFile/CfFileArgs') as CfFileArgsModule | undefined;
  });

  test('модуль infra/cfFile/CfFileArgs.ts существует и экспортирует buildCfFileDesignerArgs', () => {
    assert.ok(mod, 'infra/cfFile/CfFileArgs.ts ещё не реализован (ожидаемо на фазе «красный» TDD)');
  });

  function build(options: CfFileDesignerArgsOptions): string[] {
    if (!mod) {
      assert.fail('CfFileArgs.ts не реализован — см. первый тест сьюта');
    }
    return mod.buildCfFileDesignerArgs(options);
  }

  const LOG = '/tmp/v8vscedit-dump-log.txt';

  test('dump основной конфигурации: точный вектор без -Extension', () => {
    const args = build({ operation: 'dump', filePath: '/data/base.cf', outLogFile: LOG });
    assert.deepStrictEqual(args, [
      '/DumpCfg', path.resolve('/data/base.cf'),
      '/Out', LOG,
      '/DisableStartupDialogs',
    ]);
  });

  test('dump расширения: точный вектор с -Extension между путём и /Out', () => {
    const args = build({ operation: 'dump', filePath: '/data/ext.cfe', extensionName: 'EVOLC', outLogFile: LOG });
    assert.deepStrictEqual(args, [
      '/DumpCfg', path.resolve('/data/ext.cfe'),
      '-Extension', 'EVOLC',
      '/Out', LOG,
      '/DisableStartupDialogs',
    ]);
  });

  test('load основной конфигурации: точный вектор без -Extension', () => {
    const args = build({ operation: 'load', filePath: '/data/base.cf', outLogFile: LOG });
    assert.deepStrictEqual(args, [
      '/LoadCfg', path.resolve('/data/base.cf'),
      '/Out', LOG,
      '/DisableStartupDialogs',
    ]);
  });

  test('load расширения: точный вектор с -Extension между путём и /Out', () => {
    const args = build({ operation: 'load', filePath: '/data/ext.cfe', extensionName: 'EVOLC', outLogFile: LOG });
    assert.deepStrictEqual(args, [
      '/LoadCfg', path.resolve('/data/ext.cfe'),
      '-Extension', 'EVOLC',
      '/Out', LOG,
      '/DisableStartupDialogs',
    ]);
  });

  // ─── Измерение 3 (Часть 3, п.3): extensionName ∈ {непустое с пробелом/дефисом, пусто, только пробелы} ───

  const extensionNameCases: { readonly label: string; readonly value: string | undefined; readonly expectFlag: boolean }[] = [
    { label: 'простое имя', value: 'Расш', expectFlag: true },
    { label: 'имя с пробелом', value: 'Имя С Пробелом', expectFlag: true },
    { label: 'имя с дефисом', value: 'Имя-С-Дефисом', expectFlag: true },
    { label: 'не задано (undefined)', value: undefined, expectFlag: false },
    { label: 'пустая строка', value: '', expectFlag: false },
    { label: 'только пробелы', value: '   ', expectFlag: false },
  ];

  for (const operation of ['dump', 'load'] as const) {
    for (const testCase of extensionNameCases) {
      test(`${operation}: extensionName="${testCase.label}" → -Extension ${testCase.expectFlag ? 'присутствует со значением после trim' : 'отсутствует'}`, () => {
        const args = build({ operation, filePath: '/data/f.cfe', extensionName: testCase.value, outLogFile: LOG });
        const extensionIndex = args.indexOf('-Extension');
        if (testCase.expectFlag) {
          assert.notStrictEqual(extensionIndex, -1, '-Extension должен присутствовать в векторе');
          assert.strictEqual(args[extensionIndex + 1], testCase.value?.trim(), 'значение после -Extension должно быть обрезано (trim)');
          // Ровно один -Extension в векторе.
          assert.strictEqual(args.filter((item) => item === '-Extension').length, 1);
        } else {
          assert.strictEqual(extensionIndex, -1, 'при пустом/пробельном extensionName флага -Extension быть не должно');
        }
      });
    }
  }

  // ─── Регресс (Часть 4, A.3): ни в одном векторе не должно быть -AllExtensions ───
  //
  // ПРИЧИНА (см. эмпирику платформы выше): реальный Конфигуратор принимает
  // `-AllExtensions` МОЛЧА (exit 0) и при этом отдаёт выгрузку ОСНОВНОЙ
  // конфигурации вместо расширений — то есть баг не диагностируется по
  // exitCode/логу вообще. Единственная защита — не дать этому флагу попасть
  // в вектор НИКОГДА, что и проверяется здесь на всей матрице значений, а
  // не на одном представителе.

  test('РЕГРЕСС: ни для одной комбинации operation×target×extensionName×путь вектор не содержит -AllExtensions (и вообще ничего, начинающегося с -All)', () => {
    const pathVariants = [
      '/abs/path/base.cfe',
      'relative/base.cfe',
      '/abs/path with spaces/base.cfe',
      '/abs/путь/кириллица.cfe',
    ];

    for (const operation of ['dump', 'load'] as const) {
      for (const pathVariant of pathVariants) {
        for (const testCase of extensionNameCases) {
          const args = build({ operation, filePath: pathVariant, extensionName: testCase.value, outLogFile: LOG });
          const forbidden = args.filter((item) => item.toLowerCase().startsWith('-all'));
          assert.deepStrictEqual(
            forbidden,
            [],
            `вектор для operation=${operation}, path="${pathVariant}", extensionName="${testCase.label}" содержит запрещённый флаг: ${JSON.stringify(args)}`
          );
        }
      }
    }
  });

  // ─── Порядок элементов вектора ───

  test('порядок: три последних элемента всегда /Out, <log>, /DisableStartupDialogs; -Extension строго между путём и /Out', () => {
    for (const operation of ['dump', 'load'] as const) {
      const withExt = build({ operation, filePath: '/f.cfe', extensionName: 'Ext1', outLogFile: LOG });
      assert.deepStrictEqual(withExt.slice(-3), ['/Out', LOG, '/DisableStartupDialogs']);
      const extIdx = withExt.indexOf('-Extension');
      const pathIdx = 1;
      const outIdx = withExt.indexOf('/Out');
      assert.ok(extIdx > pathIdx && extIdx < outIdx, `-Extension обязан быть строго между путём (idx=${String(pathIdx)}) и /Out (idx=${String(outIdx)}); фактически idx=${String(extIdx)}`);

      const withoutExt = build({ operation, filePath: '/f.cf', outLogFile: LOG });
      assert.deepStrictEqual(withoutExt.slice(-3), ['/Out', LOG, '/DisableStartupDialogs']);
    }
  });

  test('первый элемент вектора — ровно /DumpCfg для dump и /LoadCfg для load', () => {
    assert.strictEqual(build({ operation: 'dump', filePath: '/f.cf', outLogFile: LOG })[0], '/DumpCfg');
    assert.strictEqual(build({ operation: 'load', filePath: '/f.cf', outLogFile: LOG })[0], '/LoadCfg');
  });

  // ─── Нормализация пути (Часть 3, п.7): вектор всегда содержит абсолютный путь, без кавычек/экранирования ───

  test('относительный путь нормализуется в абсолютный через path.resolve', () => {
    const args = build({ operation: 'dump', filePath: 'src/cf/base.cf', outLogFile: LOG });
    assert.strictEqual(args[1], path.resolve('src/cf/base.cf'));
    assert.notStrictEqual(args[1], 'src/cf/base.cf');
  });

  test('пробелы в пути сохраняются как есть, без кавычек (shell:false — экранирование не нужно)', () => {
    const args = build({ operation: 'dump', filePath: '/data/my base/base.cf', outLogFile: LOG });
    assert.strictEqual(args[1], path.resolve('/data/my base/base.cf'));
    assert.ok(!args[1].startsWith('"'), 'путь не должен оборачиваться в кавычки — процесс запускается с shell:false');
  });

  test('кириллица в пути сохраняется без искажений', () => {
    const args = build({ operation: 'dump', filePath: '/data/конфигурация/база.cf', outLogFile: LOG });
    assert.strictEqual(args[1], path.resolve('/data/конфигурация/база.cf'));
  });

  test('абсолютный путь уже абсолютным и остаётся (path.resolve — идемпотентен)', () => {
    const absolute = path.resolve('/data/abs/base.cf');
    const args = build({ operation: 'dump', filePath: absolute, outLogFile: LOG });
    assert.strictEqual(args[1], absolute);
  });
});
