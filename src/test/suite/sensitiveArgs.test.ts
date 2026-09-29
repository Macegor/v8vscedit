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
  maskSensitiveCliArgs(args: readonly string[]): string[];
  formatCommandLineForLog(executable: string, args: readonly string[]): string;
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

  /**
   * Пароль попадает в вектор в ДВУХ формах, и вторая долго оставалась незакрытой:
   * конфигуратор принимает пароль базы СЛИТНО с ключом (`/P<пароль>` — это один
   * аргумент), а не отдельным значением. Проверка по ключам такой аргумент не
   * видит вовсе.
   */
  test('слитная форма /P<пароль> маскируется, сам ключ остаётся читаемым', () => {
    const result = mask(['DESIGNER', '/F', '/data/base', '/NАдмин', '/Pочень-секретно']);
    assert.strictEqual(result[3], '/NАдмин', 'имя пользователя не секрет и не маскируется');
    assert.notStrictEqual(result[4], '/Pочень-секретно');
    assert.match(result[4], /^\/P\*+$/, 'ключ обязан остаться читаемым, маскируется только значение');
  });

  test('одиночный /P без значения не трогается — маскировать нечего', () => {
    assert.deepStrictEqual(mask(['/P']), ['/P']);
  });

  test('/ConfigurationRepositoryP не путается со слитной формой /P', () => {
    // Ключ хранилища начинается с `/C`, а значение идёт отдельным аргументом.
    // Наивное правило «аргумент начинается с /P» его бы не задело, но проверка
    // фиксирует это явно: перепутать две формы — значит либо раскрыть пароль
    // хранилища, либо испортить читаемость ключа.
    const result = mask(['/ConfigurationRepositoryF', '\\\\srv\\repo', '/ConfigurationRepositoryP', 'repo-secret']);
    assert.strictEqual(result[2], '/ConfigurationRepositoryP');
    assert.match(result[3], MASK_PATTERN);
    assert.strictEqual(result[0], '/ConfigurationRepositoryF');
  });

  test('ключи конфигуратора регистронезависимы — маскирование тоже', () => {
    assert.match(mask(['-pwd', 'secret'])[1], MASK_PATTERN);
    assert.match(mask(['/pсекрет'])[0], /^\/p\*+$/);
  });

  /**
   * Главная проверка сьюта: она не про форму записи, а про сам дефект.
   * Берём реалистичные векторы ВСЕХ трёх мест, где строка запуска пишется
   * в журнал, и требуем, чтобы пароля не осталось в строке ни в каком виде.
   * Такой тест переживает добавление нового ключа: если новый секрет забудут
   * внести в список, он останется видимым и тест покраснеет.
   */
  test('ни в одной реальной строке запуска пароль не остаётся видимым', () => {
    if (!mod) {
      assert.fail('SensitiveArgs.ts не реализован — см. первый тест сьюта');
    }
    const secret = 'П@роль-Который-Нельзя-Печатать';
    const vectors: readonly (readonly [string, readonly string[]])[] = [
      // Хранилище конфигурации: пароль базы слитно + пароль хранилища парой.
      ['/opt/1cv8/1cv8', ['DESIGNER', '/F', '/base', `/P${secret}`, '/ConfigurationRepositoryP', secret]],
      // Запуск базы из навигатора.
      ['/opt/1cv8/1cv8', ['ENTERPRISE', '/F', '/base', '/NАдмин', `/P${secret}`]],
      // Внутренний CLI расширения.
      ['node', ['dist/cli/onec-tools.js', 'import', '-Password', secret]],
      // Команды хранилища через CLI.
      ['node', ['dist/cli/onec-tools.js', 'repo-lock', '-Pwd', secret]],
      // MCP-профиль bsl-analyzer.
      ['/usr/local/bin/bsl-analyzer', ['mcp', '--source-dir', '/src', '--onec-password', secret]],
    ];
    for (const [executable, args] of vectors) {
      const line = mod.formatCommandLineForLog(executable, args);
      assert.ok(!line.includes(secret), `пароль остался в строке запуска: ${line}`);
      assert.ok(line.startsWith(executable), 'исполняемый файл обязан остаться в строке');
    }
  });

  test('formatCommandLineForLog не мутирует переданный вектор', () => {
    if (!mod) {
      assert.fail('SensitiveArgs.ts не реализован — см. первый тест сьюта');
    }
    const input = ['-Password', 'secret', '/Psecret'];
    const original = [...input];
    mod.formatCommandLineForLog('node', input);
    assert.deepStrictEqual(input, original);
  });

  test('исходный массив аргументов не мутируется', () => {
    const input = ['-Password', 'secret'];
    const original = [...input];
    mask(input);
    assert.deepStrictEqual(input, original, 'функция обязана возвращать новый массив, а не мутировать переданный');
  });
});
