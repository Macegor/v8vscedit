import * as assert from 'assert';
import * as vscode from 'vscode';
import {
  disposeRepositoryCommandStatusBar,
  endRepositoryOperationStatus,
  setRepositoryOperationStatus,
  updateRepositoryOperationStatus,
} from '../../ui/commands/repository/RepositoryCommandRunner';

/**
 * Мок ТОЛЬКО внешней недоступной системы: реальный vscode.window.createStatusBarItem
 * создаёт видимый UI-элемент статус-бара редактора. Подмена возвращает полностью
 * контролируемый fake-объект — единственный способ детерминированно наблюдать
 * состояние module-scoped статус-бар-синглтона RepositoryCommandRunner.
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
 * B2.4 — RepositoryCommandRunner.setOperationStatus (~647) создаёт собственный
 * модульный статус-бар-синглтон лениво, но нигде не диспозится (только hide()).
 * ExtensionCommandRunner симметрично диспозится через disposeCachedAgentOperationServices,
 * вызываемую из Container.deactivate; у RepositoryCommandRunner такого пути нет —
 * статус-бар остаётся недиспозенным при остановке расширения (утечка UI-ресурса).
 *
 * КОНТРАКТ для разработчика:
 * - setOperationStatus должен экспортироваться (по аналогии с
 *   ExtensionCommandRunner.setConfigurationOperationStatus) как setRepositoryOperationStatus —
 *   иначе dispose нельзя протестировать и вызвать извне модуля.
 * - disposeRepositoryCommandStatusBar(): void — останавливает отложенный hide-таймер,
 *   вызывает item.dispose(), обнуляет модульный синглтон statusBarItem.
 * - Container.deactivate должен вызывать disposeRepositoryCommandStatusBar() наравне
 *   с disposeCachedAgentOperationServices().
 */
suite('Status-bar dispose — RepositoryCommandRunner (B2.4)', () => {
  let originalCreateStatusBarItem: typeof vscode.window.createStatusBarItem;
  let fakeItems: FakeStatusBarItem[];

  // Мутабельная проекция vscode.window для подмены фабрики без `any`.
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

  teardown(() => {
    windowRef.createStatusBarItem = originalCreateStatusBarItem;
  });

  test('disposeRepositoryCommandStatusBar вызывает item.dispose(), а не только hide()', () => {
    setRepositoryOperationStatus('Хранилище', 'подключение', true);
    const item = fakeItems.at(-1);
    assert.ok(item, 'статус-бар хранилища должен быть создан лениво при первом вызове');

    disposeRepositoryCommandStatusBar();

    assert.strictEqual(item.disposed, true, 'disposeRepositoryCommandStatusBar обязан вызвать item.dispose()');
  });

  test('после dispose повторный setRepositoryOperationStatus создаёт НОВЫЙ item, а не работает с disposed-объектом', () => {
    setRepositoryOperationStatus('Хранилище', 'подключение', true);
    disposeRepositoryCommandStatusBar();

    setRepositoryOperationStatus('Хранилище', 'снова подключение', true);
    assert.strictEqual(fakeItems.length, 2, 'после dispose синглтон должен обнулиться, следующий вызов создаёт новый item');
    assert.strictEqual(fakeItems[1]?.disposed, false, 'новый item не должен быть в disposed-состоянии');

    // Возвращаем module-scoped синглтон в чистое состояние для следующих тестов сьюта:
    // без этого statusBarItem продолжает указывать на созданный здесь недиспозенный item,
    // и ensureRepositoryStatusItem() в следующем тесте не вызовет фабрику повторно.
    disposeRepositoryCommandStatusBar();
  });

  test('updateRepositoryOperationStatus обновляет текст спиннера, не создавая новый item и не завершая операцию', () => {
    setRepositoryOperationStatus('Хранилище', 'начало', true);
    const item = fakeItems.at(-1);
    assert.ok(item);

    updateRepositoryOperationStatus('Хранилище', 'этап 2 из 3');

    assert.strictEqual(fakeItems.length, 1, 'update не должен создавать новый статус-бар');
    assert.ok(item.text.includes('этап 2 из 3'), 'текст спиннера обязан отражать промежуточное сообщение update');
    assert.strictEqual(item.visible, true);

    disposeRepositoryCommandStatusBar();
  });

  test('endRepositoryOperationStatus напрямую переводит текст в финальный check-статус', () => {
    setRepositoryOperationStatus('Хранилище', 'начало', true);
    const item = fakeItems.at(-1);
    assert.ok(item);

    endRepositoryOperationStatus('Хранилище', 'завершено');

    assert.ok(item.text.includes('завершено'), 'после end текст обязан содержать финальное сообщение');
    assert.strictEqual(item.visible, true, 'end показывает финальный текст перед отложенным скрытием');

    disposeRepositoryCommandStatusBar();
  });

  test('компат setRepositoryOperationStatus(...,false) делегирует в endRepositoryOperationStatus', () => {
    setRepositoryOperationStatus('Хранилище', 'начало', true);
    const item = fakeItems.at(-1);
    assert.ok(item);

    setRepositoryOperationStatus('Хранилище', 'готово', false);

    assert.ok(item.text.includes('готово'), 'компат-обёртка с running=false обязана завершать операцию как end');

    disposeRepositoryCommandStatusBar();
  });

  test('повторный begin ДО истечения таймера скрытия отменяет ранее запланированный hide (ветка cancelRepositoryHideTimer с активным таймером)', () => {
    setRepositoryOperationStatus('Хранилище', 'начало', true);
    setRepositoryOperationStatus('Хранилище', 'завершено', false);
    // Таймер скрытия уже запланирован (счётчик достиг 0). Немедленный повторный begin
    // обязан попасть в ветку `if (clearStatusTimer)` внутри cancelRepositoryHideTimer
    // и отменить его, иначе новая операция скроется по старому таймеру.
    setRepositoryOperationStatus('Хранилище', 'снова начало', true);

    const item = fakeItems.at(-1);
    assert.ok(item);
    assert.strictEqual(item.visible, true, 'повторный begin обязан отменить запланированный hide и показать статус снова');

    disposeRepositoryCommandStatusBar();
  });

  test('после единственного end статус-бар хранилища реально скрывается по истечении 5с таймера', function () {
    // Реальное ожидание 5с (а не фиктивная проверка сразу после end), чтобы покрыть
    // сам колбэк setTimeout (statusBarItem?.hide()) внутри endRepositoryOperationStatus —
    // символично тесту счётчика в ExtensionCommandRunner (operationStatusBarCounter.test.ts).
    this.timeout(8000);

    setRepositoryOperationStatus('Хранилище', 'начало', true);
    setRepositoryOperationStatus('Хранилище', 'завершено', false);

    const item = fakeItems.at(-1);
    assert.ok(item);

    return new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        try {
          assert.strictEqual(item.visible, false, 'после завершения единственной операции статус-бар хранилища обязан скрыться');
          resolve();
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        } finally {
          disposeRepositoryCommandStatusBar();
        }
      }, 5300);
    });
  });

  test('disposeRepositoryCommandStatusBar с уже запланированным таймером скрытия отменяет его перед dispose', () => {
    setRepositoryOperationStatus('Хранилище', 'начало', true);
    setRepositoryOperationStatus('Хранилище', 'завершено', false);
    // На этот момент clearStatusTimer уже установлен (счётчик = 0). dispose обязан
    // попасть в ветку `if (clearStatusTimer)` и явно очистить таймер перед dispose().
    const item = fakeItems.at(-1);
    assert.ok(item);

    disposeRepositoryCommandStatusBar();

    assert.strictEqual(item.disposed, true);
  });
});
