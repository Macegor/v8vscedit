import * as assert from 'assert';
import * as vscode from 'vscode';
/**
 * `registerHistoryCommands` — тонкая обёртка `vscode.commands.registerCommand`
 * над `services.historyGraphViewProvider.open()`. Ни один из существующих
 * наборов не выполняет саму команду `v8vscedit.history.open` через реальный
 * `vscode.commands.executeCommand` (в отличие от unit-тестов
 * `historyGraphController`/`historyGraphViewProvider`, проверяющих оболочку
 * и ядро напрямую, минуя слой регистрации команд) — этот тест закрывает
 * именно регистрацию и диспетчеризацию команды.
 */
import { registerHistoryCommands } from '../../ui/commands/history/HistoryCommands';
import type { CommandServices } from '../../ui/commands/_shared';

suite('HistoryCommands — регистрация и выполнение v8vscedit.history.open', () => {
  test('executeCommand(v8vscedit.history.open) вызывает services.historyGraphViewProvider.open() ровно один раз', async () => {
    let openCalls = 0;
    const services = {
      historyGraphViewProvider: {
        open: () => { openCalls += 1; },
        refresh: () => undefined,
        dispose: () => undefined,
      },
    } as unknown as CommandServices;

    const subscriptions: vscode.Disposable[] = [];
    const context = { subscriptions } as unknown as vscode.ExtensionContext;

    try {
      registerHistoryCommands(context, services);
      await vscode.commands.executeCommand('v8vscedit.history.open');

      assert.strictEqual(openCalls, 1, 'команда обязана вызвать historyGraphViewProvider.open() ровно один раз');
    } finally {
      subscriptions.forEach((d) => { d.dispose(); });
    }
  });
});
