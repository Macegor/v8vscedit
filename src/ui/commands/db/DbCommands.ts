import * as vscode from 'vscode';
import { CommandServices } from '../_shared';
import { runDbClientFromWorkspace } from './DbRunCommandRunner';

/** Регистрирует команды запуска 1С из настроек рабочей области. */
export function registerDbCommands(
  context: vscode.ExtensionContext,
  services: CommandServices
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('v8vscedit.runThinClient', async () => {
      const shouldContinue = await confirmUpdateBeforeThinClient(services);
      if (!shouldContinue) {
        return;
      }

      await runDbClientFromWorkspace(services.workspaceFolder, services.outputChannel, { mode: 'ENTERPRISE' });
    }),

    vscode.commands.registerCommand('v8vscedit.runConfigurator', async () => {
      await runDbClientFromWorkspace(services.workspaceFolder, services.outputChannel, { mode: 'DESIGNER' });
    })
  );
}

async function confirmUpdateBeforeThinClient(services: CommandServices): Promise<boolean> {
  const changed = services.getChangedConfigurations();
  if (changed.length === 0) {
    return true;
  }

  const picked = await vscode.window.showQuickPick([
    {
      id: 'update',
      label: '$(sync) Обновить и запустить',
      description: 'Загрузить изменения в базу перед запуском',
      detail: `Изменено конфигураций: ${changed.length}`,
    },
    {
      id: 'run',
      label: '$(play) Запустить без обновления',
      description: 'Оставить изменения только в файлах',
    },
  ], {
    title: 'Перед запуском тонкого клиента',
    placeHolder: 'Есть изменения, которые ещё не загружены в базу',
  });

  if (picked?.id === 'run') {
    return true;
  }
  if (picked?.id !== 'update') {
    return false;
  }

  const updated = await vscode.commands.executeCommand<boolean>('v8vscedit.updateChangedConfigurations');
  return updated === true;
}
