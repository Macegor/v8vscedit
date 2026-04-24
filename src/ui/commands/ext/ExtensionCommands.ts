import * as vscode from 'vscode';
import { ChangedConfiguration } from '../../../infra/fs/ConfigurationChangeDetector';
import { CommandServices, NodeArg } from '../_shared';
import {
  extractExtensionTarget,
  runCompileExtension,
  runDecompileExtension,
  setConfigurationOperationStatus,
  runUpdateMainConfiguration,
  runUpdateExtension,
} from './ExtensionCommandRunner';

interface ActionItem extends vscode.QuickPickItem {
  actionId: 'decompileext' | 'updateext' | 'compileAndUpdateExt';
}

let isUpdatingConfigurations = false;

/** Регистрирует команды управления расширением 1С. */
export function registerExtensionCommands(
  context: vscode.ExtensionContext,
  services: CommandServices
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('v8vscedit.updateChangedConfigurations', async () => {
      if (isUpdatingConfigurations) {
        return;
      }

      isUpdatingConfigurations = true;
      await vscode.commands.executeCommand('setContext', 'v8vscedit.isUpdatingConfigurations', true);
      setConfigurationOperationStatus('Обновление конфигураций', 'проверка изменений', true);
      await yieldToUi();
      const completedRootPaths: string[] = [];
      try {
        const changed = services.getChangedConfigurations();

        if (changed.length === 0) {
          setConfigurationOperationStatus('Обновление конфигураций', 'изменений нет', false);
          await vscode.window.showInformationMessage('Изменений в конфигурациях не обнаружено.');
          return;
        }

        const selected = changed.length === 1
          ? changed
          : await pickChangedConfigurations(changed);
        if (!selected || selected.length === 0) {
          setConfigurationOperationStatus('Обновление конфигураций', 'отменено', false);
          return;
        }

        const ordered = orderUpdateTargets(selected);
        for (let index = 0; index < ordered.length; index += 1) {
          const target = ordered[index];
          setConfigurationOperationStatus(
            'Обновление конфигураций',
            `${index + 1}/${ordered.length}: ${target.name}`,
            true
          );
          const ok = target.kind === 'cf'
            ? await runUpdateMainConfiguration(
                target.name,
                target.rootPath,
                services.workspaceFolder,
                services.outputChannel,
                ordered.length === 1
              )
            : await runUpdateExtension(
                target.name,
                target.rootPath,
                services.workspaceFolder,
                services.outputChannel,
                ordered.length === 1
              );

          if (!ok) {
            setConfigurationOperationStatus('Обновление конфигураций', `остановлено на "${target.name}"`, false);
            return;
          }
          completedRootPaths.push(target.rootPath);
        }

        if (ordered.length > 1) {
          await vscode.window.showInformationMessage(`Обновлено конфигураций: ${ordered.length}.`);
        }
        setConfigurationOperationStatus('Обновление конфигураций', 'завершено', false);
      } finally {
        isUpdatingConfigurations = false;
        await vscode.commands.executeCommand('setContext', 'v8vscedit.isUpdatingConfigurations', false);
        services.markConfigurationsClean(completedRootPaths);
      }
    }),

    vscode.commands.registerCommand('v8vscedit.showConfigActions', async (node: NodeArg) => {
      const nodeKind = node?.nodeKind;
      const xmlPath = node?.xmlPath;
      if (!nodeKind || !xmlPath) {
        return;
      }

      if (nodeKind !== 'extension') {
        vscode.window.showInformationMessage(`Для "${String(node.label ?? '')}" пока нет доступных команд.`);
        return;
      }

      const targetLabel = String(node.label ?? '');
      const picked = await vscode.window.showQuickPick<ActionItem>([
        { actionId: 'decompileext', label: '$(cloud-download) Импортировать' },
        { actionId: 'updateext', label: '$(sync) Обновить' },
        { actionId: 'compileAndUpdateExt', label: '$(run-all) Полное обновление' },
      ], {
        title: `Команды: ${targetLabel}`,
        placeHolder: 'Выберите действие',
      });

      if (!picked) {
        return;
      }

      if (picked.actionId === 'decompileext') {
        await vscode.commands.executeCommand('v8vscedit.decompileExtensionSources', node);
      } else if (picked.actionId === 'updateext') {
        await vscode.commands.executeCommand('v8vscedit.updateExtensionInDb', node);
      } else if (picked.actionId === 'compileAndUpdateExt') {
        await vscode.commands.executeCommand('v8vscedit.compileAndUpdateExtensionInDb', node);
      }
    }),

    vscode.commands.registerCommand('v8vscedit.decompileExtensionSources', async (node: NodeArg) => {
      const target = extractExtensionTarget(node);
      if (!target) {
        vscode.window.showWarningMessage('Команда доступна только для корневого узла расширения.');
        return;
      }

      const ok = await runDecompileExtension(
        target.extensionName,
        target.extensionRoot,
        services.workspaceFolder,
        services.outputChannel
      );
      if (ok) {
        services.markConfigurationsClean([target.extensionRoot]);
      }
    }),

    vscode.commands.registerCommand('v8vscedit.compileExtensionToDb', async (node: NodeArg) => {
      const target = extractExtensionTarget(node);
      if (!target) {
        vscode.window.showWarningMessage('Команда доступна только для корневого узла расширения.');
        return;
      }

      const ok = await runCompileExtension(
        target.extensionName,
        target.extensionRoot,
        services.workspaceFolder,
        services.outputChannel
      );
      if (ok) {
        services.markConfigurationsClean([target.extensionRoot]);
      }
    }),

    vscode.commands.registerCommand('v8vscedit.updateExtensionInDb', async (node: NodeArg) => {
      const target = extractExtensionTarget(node);
      if (!target) {
        vscode.window.showWarningMessage('Команда доступна только для корневого узла расширения.');
        return;
      }

      const ok = await runUpdateExtension(
        target.extensionName,
        target.extensionRoot,
        services.workspaceFolder,
        services.outputChannel
      );
      if (ok) {
        services.markConfigurationsClean([target.extensionRoot]);
      }
    }),

    vscode.commands.registerCommand('v8vscedit.compileAndUpdateExtensionInDb', async (node: NodeArg) => {
      const target = extractExtensionTarget(node);
      if (!target) {
        vscode.window.showWarningMessage('Команда доступна только для корневого узла расширения.');
        return;
      }

      const compiled = await runCompileExtension(
        target.extensionName,
        target.extensionRoot,
        services.workspaceFolder,
        services.outputChannel,
        false
      );
      if (!compiled) {
        return;
      }

      const updated = await runUpdateExtension(
        target.extensionName,
        target.extensionRoot,
        services.workspaceFolder,
        services.outputChannel,
        false
      );
      if (!updated) {
        return;
      }

      await vscode.window.showInformationMessage(
        `Загрузка и обновление расширения "${target.extensionName}" в БД успешно завершены.`
      );
      services.markConfigurationsClean([target.extensionRoot]);
    })
  );
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

interface ChangedConfigurationPickItem extends vscode.QuickPickItem {
  target?: ChangedConfiguration;
  selectAll?: boolean;
}

async function pickChangedConfigurations(
  changed: ChangedConfiguration[]
): Promise<ChangedConfiguration[] | undefined> {
  return new Promise((resolve) => {
    const quickPick = vscode.window.createQuickPick<ChangedConfigurationPickItem>();
    let resolved = false;
    const selectAllItem: ChangedConfigurationPickItem = {
      label: '$(check-all) Все изменённые',
      description: `${changed.length}`,
      selectAll: true,
    };
    const targetItems = changed.map((target): ChangedConfigurationPickItem => ({
      label: `${target.kind === 'cf' ? '$(database)' : '$(extensions)'} ${target.name}`,
      description: target.kind === 'cf' ? 'Основная конфигурация' : 'Расширение',
      detail: `${target.changedFilesCount} изменённых файлов`,
      target,
    }));

    let applyingSelectAll = false;
    let selectAllActive = false;
    quickPick.canSelectMany = true;
    quickPick.title = 'Что обновлять';
    quickPick.placeholder = 'Выберите конфигурации для обновления';
    quickPick.items = [selectAllItem, ...targetItems];
    quickPick.selectedItems = [];

    quickPick.onDidChangeSelection((selection) => {
      if (applyingSelectAll) {
        return;
      }
      const hasSelectAll = selection.some((item) => item.selectAll);
      const selectedTargets = selection.filter((item) => item.target);
      if (hasSelectAll && !selectAllActive) {
        applyingSelectAll = true;
        quickPick.selectedItems = [selectAllItem, ...targetItems];
        selectAllActive = true;
        applyingSelectAll = false;
        return;
      }
      if (hasSelectAll && selectAllActive && selectedTargets.length < targetItems.length) {
        applyingSelectAll = true;
        quickPick.selectedItems = selectedTargets;
        selectAllActive = false;
        applyingSelectAll = false;
        return;
      }
      if (!hasSelectAll && selectedTargets.length === targetItems.length) {
        applyingSelectAll = true;
        quickPick.selectedItems = [selectAllItem, ...targetItems];
        selectAllActive = true;
        applyingSelectAll = false;
        return;
      }
      selectAllActive = hasSelectAll;
    });

    quickPick.onDidAccept(() => {
      const selected = quickPick.selectedItems;
      const targets = selected.some((item) => item.selectAll)
        ? changed
        : selected
            .map((item) => item.target)
            .filter((item): item is ChangedConfiguration => Boolean(item));
      resolved = true;
      quickPick.hide();
      resolve(targets);
    });
    quickPick.onDidHide(() => {
      quickPick.dispose();
      if (!resolved) {
        resolve(undefined);
      }
    });
    quickPick.show();
  });
}

function orderUpdateTargets(targets: ChangedConfiguration[]): ChangedConfiguration[] {
  return [...targets].sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === 'cf' ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });
}
