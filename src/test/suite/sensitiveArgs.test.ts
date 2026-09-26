/**
 * Тесты `infra/process/SensitiveArgs.ts` — маскирование значения `-Password`
 * перед записью вектора аргументов в лог.
 *
 * Причина (ПРОВЕРЕННЫЙ дефект, не гипотеза): `buildConnectionCliArgs`
 * (`src/ui/commands/ext/ExtensionCommandRunner.ts:1767-1769`) кладёт
 * `-Password <пароль открытым текстом>` в аргументы процесса, а
 * `runInternalCliCommand` (там же, ~строка 949) пишет
 * `node ${processArgs.join(' ')}` в OutputChannel «1С Редактор» — то есть
 * пароль базы утекает в журнал при каждом импорте/обновлении конфигурации.
 * Наши команды выгрузки/загрузки CF пойдут тем же путём логирования, поэтому
 * маскирование обязано быть отдельной переиспользуемой функцией.
 *
 * `SensitiveArgs.ts` на фазе «красный» ещё не существует — лениво грузится
 * через `tryRequireProductionModule`.
 */
import * as assert from 'assert';
import { tryRequireProductionModule } from './support/tryRequireProductionModule';

interface SensitiveArgsModule {
  maskSensitiveCliArgs(args: string[]): string[];
}

const MASK_PATTERN = /^\*+$/;

suite('SensitiveArgs.maskSensitiveCliArgs — маскирование пароля перед логированием', () => {
  let mod: SensitiveArgsModule | undefined;

  suiteSetup(() => {
    mod = tryRequireProductionModule('../../../infra/process/SensitiveArgs') as SensitiveArgsModule | undefined;
  });

  test('модуль infra/process/SensitiveArgs.ts существует и экспортирует maskSensitiveCliArgs', () => {
    assert.ok(mod, 'infra/process/SensitiveArgs.ts ещё не реализован (ожидаемо на фазе «красный» TDD)');
  });

  function mask(args: string[]): string[] {
    if (!mod) {
      assert.fail('SensitiveArgs.ts не реализован — см. первый тест сьюта');
    }
    return mod.maskSensitiveCliArgs(args);
  }

  test('значение после -Password заменяется маской, сам ключ -Password сохраняется', () => {
    const result = mask(['/F', '/data/base', '-Password', 'super-secret-1', '-UserName', 'admin']);
    assert.strictEqual(result[2], '-Password');
    assert.notStrictEqual(result[3], 'super-secret-1', 'реальный пароль не должен попасть в результат');
    assert.match(result[3], MASK_PATTERN, 'значение пароля обязано быть заменено маской');
  });

  test('-UserName и остальные аргументы не трогаются', () => {
    const result = mask(['/F', '/data/base', '-Password', 'secret', '-UserName', 'admin']);
    assert.deepStrictEqual([result[0], result[1], result[4], result[5]], ['/F', '/data/base', '-UserName', 'admin']);
  });

  test('пароля в аргументах нет — вектор возвращается без изменений (по содержимому)', () => {
    const input = ['/F', '/data/base', '-UserName', 'admin'];
    const result = mask(input);
    assert.deepStrictEqual(result, input);
  });

  test('несколько вхождений -Password маскируются все', () => {
    // Реалистичный на первый взгляд неправдоподобный, но безопасный кейс:
    // функция обязана быть простым фильтром по позиции, а не завязываться на
    // «ровно одно вхождение» — некорректно собранный вектор не должен раскрыть
    // хотя бы один из паролей.
    const result = mask(['-Password', 'first-secret', '-Something', 'x', '-Password', 'second-secret']);
    assert.notStrictEqual(result[1], 'first-secret');
    assert.notStrictEqual(result[5], 'second-secret');
    assert.match(result[1], MASK_PATTERN);
    assert.match(result[5], MASK_PATTERN);
  });

  test('-Password последним элементом без значения — граничный случай, функция не падает и ничего лишнего не добавляет', () => {
    const input = ['/F', '/data/base', '-Password'];
    const result = mask(input);
    assert.strictEqual(result.length, input.length, 'без значения после -Password маскировать нечего — длина вектора не меняется');
    assert.strictEqual(result[2], '-Password');
  });

  test('исходный массив аргументов не мутируется', () => {
    const input = ['-Password', 'secret'];
    const original = [...input];
    mask(input);
    assert.deepStrictEqual(input, original, 'функция обязана возвращать новый массив, а не мутировать переданный');
  });
});
