import * as assert from 'assert';
import * as vscode from 'vscode';
import {
  disposeCachedAgentOperationServices,
  setConfigurationOperationStatus,
  updateConfigurationOperationStatus,
} from '../../ui/commands/ext/ExtensionCommandRunner';

/**
 * Мок ТОЛЬКО внешней недоступной системы: реальный vscode.window.createStatusBarItem
 * создаёт видимый UI-элемент статус-бара редактора — тестовый прогон не должен
 * зависеть от реального рендеринга VS Code UI. Подмена возвращает полностью
 * контролируемый fake-объект вместо похода в реальный UI-рендер — это единственный
 * способ детерминированно наблюдать состояние module-scoped статус-бар-синглтона
 * (statusBarItem — приватная переменная модуля ExtensionCommandRunner).
 */
class FakeStatusBarItem {
  text = '';
  tooltip: string | vscode.MarkdownString | undefined;
  name: string | undefined;
  visible = false;
  disposed = false;

  show(): void {
    this.visible = true;
  }

  hide(): void {
    this.visible = false;
  }

  dispose(): void {
    this.disposed = true;
    this.visible = false;
  }
}

/**
 * B2.4 — ExtensionCommandRunner.setOperationStatus (~1309) использует модульный
 * синглтон statusBarItem с ОДНИМ boolean `running`, а не счётчик активных операций.
 * Завершение ОДНОЙ из параллельно идущих операций планирует hide() через 5с — даже
 * если другая операция всё ещё выполняется. ЦЕЛЬ (контракт): скрывать статус-бар
 * нужно только когда число активных операций достигает нуля.
 */
suite('Status-bar счётчик активных операций — ExtensionCommandRunner (B2.4)', () => {
  let originalCreateStatusBarItem: typeof vscode.window.createStatusBarItem;
  let fakeItems: FakeStatusBarItem[];

  // Мутабельная проекция строго типизированного vscode.window: единственный способ
  // подставить контролируемый StatusBarItem вместо реального UI без `any`.
  const windowRef = vscode.window as { createStatusBarItem: typeof vscode.window.createStatusBarItem };

  setup(() => {
    fakeItems = [];
    originalCreateStatusBarItem = vscode.window.createStatusBarItem;
    windowRef.createStatusBarItem = () => {
      const item = new FakeStatusBarItem();
      fakeItems.push(item);
      return item as unknown as vscode.StatusBarItem;
    };
  });

  teardown(async () => {
    // Модульный синглтон statusBarItem переживает между тестами (нет сброса без
    // dispose) — освобождаем его тем же путём, что и Container.deactivate, чтобы
    // следующий тест начинал с чистого состояния (новый item на новую подмену фабрики).
    await disposeCachedAgentOperationServices();
    windowRef.createStatusBarItem = originalCreateStatusBarItem;
  });

  test('завершение ПЕРВОЙ из двух параллельных операций не должно скрывать статус, пока активна вторая', function () {
    // Таймер скрытия — 5 секунд (см. ExtensionCommandRunner.setOperationStatus). Ждём
    // реальным временем, чтобы зафиксировать реальную race-condition, а не её симуляцию.
    this.timeout(8000);

    setConfigurationOperationStatus('Операция А', 'начало', true);
    setConfigurationOperationStatus('Операция Б', 'начало', true);
    // Завершаем ПЕРВУЮ операцию — на модульном синглтоне это единственный статус-бар,
    // общий для обеих операций (нет счётчика активных операций).
    setConfigurationOperationStatus('Операция А', 'завершено', false);

    const item = fakeItems.at(-1);
    assert.ok(item, 'статус-бар должен быть создан хотя бы один раз');

    return new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        try {
          // ЦЕЛЬ (контракт): скрывать статус-бар нужно только когда АКТИВНЫХ операций
          // становится 0. Операция "Б" всё ещё running=true, поэтому item обязан
          // остаться видимым и через 5+ секунд после завершения операции "А".
          // КРАСНЫЙ: сейчас статус скрывается по единственному глобальному таймеру,
          // не знающему о второй активной операции.
          assert.strictEqual(item.visible, true, 'статус-бар не должен скрываться, пока активна вторая операция');
          resolve();
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      }, 5300);
    });
  });

  test('скрытие происходит только когда счётчик активных операций достигает нуля', function () {
    this.timeout(8000);

    setConfigurationOperationStatus('Операция А', 'начало', true);
    setConfigurationOperationStatus('Операция Б', 'начало', true);
    setConfigurationOperationStatus('Операция А', 'завершено', false);
    setConfigurationOperationStatus('Операция Б', 'завершено', false);

    const item = fakeItems.at(-1);
    assert.ok(item);

    return new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        try {
          // Когда ОБЕ операции завершены (счётчик активных = 0), статус обязан скрыться.
          assert.strictEqual(item.visible, false, 'после завершения ВСЕХ операций статус-бар должен скрыться');
          resolve();
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      }, 5300);
    });
  });

  test('одна операция с прогрессом: begin + N×update + end → счётчик 0, статус скрывается', function () {
    // Регресс M9 (возврат ревьюера): прогресс-обновления (onStdout/onStderr, импорт)
    // раньше шли через setOperationStatus(...,true) и инкрементировали счётчик на КАЖДОМ
    // сообщении → одна операция оставляла счётчик N>0, статус никогда не скрывался.
    // Контракт: прогресс идёт через updateConfigurationOperationStatus (счётчик не трогает),
    // поэтому begin(+1) + N×update(0) + end(-1) → 0, статус-бар обязан скрыться.
    this.timeout(8000);

    setConfigurationOperationStatus('Импорт', 'подготовка', true);
    for (let i = 0; i < 5; i += 1) {
      updateConfigurationOperationStatus('Импорт', `шаг ${String(i + 1)}`);
    }
    setConfigurationOperationStatus('Импорт', 'завершено', false);

    const item = fakeItems.at(-1);
    assert.ok(item, 'статус-бар должен быть создан при begin');

    return new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        try {
          assert.strictEqual(
            item.visible,
            false,
            'после единственного end (при только текстовых update) статус-бар обязан скрыться — счётчик вернулся к 0'
          );
          resolve();
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      }, 5300);
    });
  });

  test('повторный begin ДО истечения таймера скрытия отменяет ранее запланированный hide (ветка cancelConfigurationHideTimer с активным таймером)', function () {
    // После end счётчик = 0 и запланирован таймер скрытия на 5с. Немедленный повторный
    // begin обязан попасть в ветку `if (clearStatusTimer)` внутри cancelConfigurationHideTimer
    // и отменить его — иначе статус-бар новой операции скроется по старому таймеру
    // независимо от того, что новая операция ещё активна.
    this.timeout(8000);

    setConfigurationOperationStatus('Операция', 'начало', true);
    setConfigurationOperationStatus('Операция', 'завершено', false);
    setConfigurationOperationStatus('Операция', 'снова начало', true);

    const item = fakeItems.at(-1);
    assert.ok(item);
    assert.strictEqual(item.visible, true);

    return new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        try {
          assert.strictEqual(
            item.visible,
            true,
            'старый таймер скрытия должен был быть отменён повторным begin — статус не скрывается по нему'
          );
          resolve();
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      }, 5300);
    });
  });
});
