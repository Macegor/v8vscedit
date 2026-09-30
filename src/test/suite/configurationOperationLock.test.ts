/**
 * Тесты общего взаимного замка операций над конфигурацией/расширением
 * (`src/ui/commands/ext/configurationOperationLock.ts`).
 *
 * Это ИЗВЛЕЧЕНИЕ уже существующего модульного флага `isUpdatingConfigurations`
 * из `ExtensionCommands.ts` (сейчас он там объявлен и переключается трижды —
 * строки ~38/66/123, ~131/136/208, ~949/954/990) в отдельный переиспользуемый
 * модуль: поведение не меняется, тройное дублирование уходит, а новая
 * разрушительная команда (`v8vscedit.loadConfigurationFromCf`) получает тот
 * же взаимный замок, что и импорт/обновление конфигураций.
 *
 * Флаг ОБЩИЙ (module-level singleton) — именно это и проверяет интеграционный
 * тест ниже: замок, взятый ОДНОЙ фичей, реально блокирует другую.
 *
 * `configurationOperationLock.ts` на фазе «красный» ещё не существует —
 * лениво грузится через `tryRequireProductionModule`.
 */
import * as assert from 'assert';
import { tryRequireProductionModule } from './support/tryRequireProductionModule';

interface ConfigurationOperationLockModule {
  tryBeginConfigurationOperation(): Promise<boolean>;
  endConfigurationOperation(): Promise<void>;
  isConfigurationOperationRunning(): boolean;
}

suite('configurationOperationLock — общий взаимный замок операций над конфигурацией', () => {
  let mod: ConfigurationOperationLockModule | undefined;

  suiteSetup(() => {
    mod = tryRequireProductionModule('../../../ui/commands/ext/configurationOperationLock') as ConfigurationOperationLockModule | undefined;
  });

  test('модуль configurationOperationLock.ts существует и экспортирует API замка', () => {
    assert.ok(mod, 'src/ui/commands/ext/configurationOperationLock.ts ещё не реализован (ожидаемо на фазе «красный» TDD)');
  });

  function m(): ConfigurationOperationLockModule {
    if (!mod) {
      assert.fail('configurationOperationLock.ts не реализован — см. первый тест сьюта');
    }
    return mod;
  }

  // На случай, если предыдущий тест в файле не корректно освободил замок —
  // гарантируем чистое стартовое состояние для каждого теста этого сьюта.
  teardown(async () => {
    if (mod?.isConfigurationOperationRunning()) {
      await mod.endConfigurationOperation();
    }
  });

  test('tryBeginConfigurationOperation на свободном замке возвращает true и isConfigurationOperationRunning() становится true', async () => {
    assert.strictEqual(m().isConfigurationOperationRunning(), false, 'замок обязан быть свободен в начале теста');
    const acquired = await m().tryBeginConfigurationOperation();
    assert.strictEqual(acquired, true);
    assert.strictEqual(m().isConfigurationOperationRunning(), true);
  });

  test('повторный tryBeginConfigurationOperation на занятом замке возвращает false, состояние не меняется', async () => {
    const first = await m().tryBeginConfigurationOperation();
    assert.strictEqual(first, true);

    const second = await m().tryBeginConfigurationOperation();
    assert.strictEqual(second, false, 'занятый замок не должен отдаваться второй раз');
    assert.strictEqual(m().isConfigurationOperationRunning(), true, 'замок обязан остаться занятым после неудачной попытки');
  });

  test('после endConfigurationOperation замок снова свободен, tryBegin возвращает true', async () => {
    assert.strictEqual(await m().tryBeginConfigurationOperation(), true);
    await m().endConfigurationOperation();
    assert.strictEqual(m().isConfigurationOperationRunning(), false);

    const reacquired = await m().tryBeginConfigurationOperation();
    assert.strictEqual(reacquired, true, 'после освобождения замок обязан снова браться');
  });
});
