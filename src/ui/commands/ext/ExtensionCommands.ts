import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ChangedConfiguration } from '../../../infra/fs/ConfigurationChangeDetector';
import { ConfigEntry } from '../../../domain/Configuration';
import { parseConfigXml } from '../../../infra/xml';
import { CommandServices, NodeArg } from '../_shared';
import {
  extractExtensionTarget,
  runCompileExtension,
  runDecompileExtension,
  runDecompileMainConfiguration,
  setConfigurationOperationStatus,
  runUpdateMainConfiguration,
  runUpdateExtension,
} from './ExtensionCommandRunner';

interface ActionItem extends vscode.QuickPickItem {
  actionId: 'decompileext' | 'updateext' | 'compileAndUpdateExt';
}

interface ImportTarget {
  kind: 'cf' | 'cfe';
  name: string;
  rootPath: string;
}

let isUpdatingConfigurations = false;

/** Регистрирует команды управления расширением 1С. */
export function registerExtensionCommands(
  context: vscode.ExtensionContext,
  services: CommandServices
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('v8vscedit.importConfigurations', async () => {
      if (isUpdatingConfigurations) {
        return;
      }

      const targets = collectImportTargets(
        services.treeProvider.getEntries(),
        services.workspaceFolder.uri.fsPath
      );
      if (targets.length === 0) {
        await vscode.window.showWarningMessage('Нет каталога src/cf для импорта основной конфигурации.');
        return;
      }

      const selected = await pickImportTargets(targets);
      if (!selected || selected.length === 0) {
        return;
      }

      isUpdatingConfigurations = true;
      await vscode.commands.executeCommand('setContext', 'v8vscedit.isUpdatingConfigurations', true);
      setConfigurationOperationStatus('Импорт конфигураций', 'подготовка', true);
      await yieldToUi();
      const completedRootPaths: string[] = [];
      try {
        const ordered = orderImportTargets(selected);
        for (let index = 0; index < ordered.length; index += 1) {
          const target = ordered[index];
          setConfigurationOperationStatus(
            'Импорт конфигураций',
            `${index + 1}/${ordered.length}: ${target.name}`,
            true
          );
          const ok = target.kind === 'cf'
            ? await runDecompileMainConfiguration(
                target.name,
                target.rootPath,
                services.workspaceFolder,
                services.outputChannel
              )
            : await runDecompileExtension(
                target.name,
                target.rootPath,
                services.workspaceFolder,
                services.outputChannel
              );

          if (!ok) {
            setConfigurationOperationStatus('Импорт конфигураций', `остановлено на "${target.name}"`, false);
            return;
          }
          completedRootPaths.push(target.rootPath);
        }

        if (ordered.length > 1) {
          await vscode.window.showInformationMessage(`Импортировано конфигураций: ${ordered.length}.`);
        }
        setConfigurationOperationStatus('Импорт конфигураций', 'завершено', false);
        await services.reloadEntries();
      } catch (error) {
        setConfigurationOperationStatus('Импорт конфигураций', 'ошибка', false);
        showConfigurationCommandError('Ошибка импорта конфигураций.', error, services);
      } finally {
        isUpdatingConfigurations = false;
        await vscode.commands.executeCommand('setContext', 'v8vscedit.isUpdatingConfigurations', false);
        services.markConfigurationsClean(completedRootPaths);
      }
    }),

    vscode.commands.registerCommand('v8vscedit.updateChangedConfigurations', async () => {
      if (isUpdatingConfigurations) {
        return false;
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
          return true;
        }

        const selected = changed.length === 1
          ? changed
          : await pickChangedConfigurations(changed);
        if (!selected || selected.length === 0) {
          setConfigurationOperationStatus('Обновление конфигураций', 'отменено', false);
          return false;
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
            return false;
          }
          completedRootPaths.push(target.rootPath);
        }

        if (ordered.length > 1) {
          await vscode.window.showInformationMessage(`Обновлено конфигураций: ${ordered.length}.`);
        }
        setConfigurationOperationStatus('Обновление конфигураций', 'завершено', false);
        return true;
      } catch (error) {
        setConfigurationOperationStatus('Обновление конфигураций', 'ошибка', false);
        showConfigurationCommandError('Ошибка обновления конфигураций.', error, services);
        return false;
      } finally {
        isUpdatingConfigurations = false;
        await vscode.commands.executeCommand('setContext', 'v8vscedit.isUpdatingConfigurations', false);
        services.markConfigurationsClean(completedRootPaths);
      }
    }),

    vscode.commands.registerCommand('v8vscedit.connectExtension', async () => {
      const extensionName = await vscode.window.showInputBox({
        title: 'Подключить расширение',
        prompt: 'Введите имя расширения как оно называется в базе',
        placeHolder: 'ИмяРасширения',
        validateInput: validateExtensionName,
      });
      const normalizedExtensionName = extensionName?.trim();
      if (!normalizedExtensionName) {
        return;
      }

      const extensionRoot = path.join(services.workspaceFolder.uri.fsPath, 'src', 'cfe', normalizedExtensionName);
      if (!isPathInside(extensionRoot, path.join(services.workspaceFolder.uri.fsPath, 'src', 'cfe'))) {
        await vscode.window.showErrorMessage('Имя расширения приводит к пути вне src/cfe.');
        return;
      }
      if (fs.existsSync(extensionRoot)) {
        await vscode.window.showErrorMessage(`Каталог расширения уже существует: ${extensionRoot}`);
        return;
      }

      fs.mkdirSync(extensionRoot, { recursive: true });
      const ok = await runDecompileExtension(
        normalizedExtensionName,
        extensionRoot,
        services.workspaceFolder,
        services.outputChannel
      );
      if (!ok) {
        fs.rmSync(extensionRoot, { recursive: true, force: true });
        await services.reloadEntries();
        return;
      }

      services.markConfigurationsClean([extensionRoot]);
      await services.reloadEntries();
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

function collectImportTargets(entries: ConfigEntry[], workspaceRoot: string): ImportTarget[] {
  const targets = entries.map((entry) => {
    const name = readConfigName(entry);
    return {
      kind: entry.kind,
      name,
      rootPath: entry.rootPath,
    };
  });
  appendInitialMainConfigurationTarget(targets, workspaceRoot);
  return targets.sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === 'cf' ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });
}

function appendInitialMainConfigurationTarget(targets: ImportTarget[], workspaceRoot: string): void {
  const mainConfigRoot = path.join(workspaceRoot, 'src', 'cf');
  if (!isDirectory(mainConfigRoot)) {
    return;
  }

  const normalizedRoot = path.resolve(mainConfigRoot).toLowerCase();
  const hasMainConfig = targets.some((target) =>
    target.kind === 'cf' && path.resolve(target.rootPath).toLowerCase() === normalizedRoot
  );
  if (hasMainConfig) {
    return;
  }

  targets.push({
    kind: 'cf',
    name: 'Основная конфигурация',
    rootPath: mainConfigRoot,
  });
}

function readConfigName(entry: ConfigEntry): string {
  try {
    const info = parseConfigXml(path.join(entry.rootPath, 'Configuration.xml'));
    if (info.name) {
      return info.name;
    }
  } catch {
    // При повреждённом XML оставляем путь как диагностически полезное имя в списке выбора.
  }
  return path.basename(entry.rootPath);
}

function isDirectory(directoryPath: string): boolean {
  try {
    return fs.statSync(directoryPath).isDirectory();
  } catch {
    return false;
  }
}

function validateExtensionName(value: string): string | undefined {
  const name = value.trim();
  if (!name) {
    return 'Укажите имя расширения.';
  }
  if (/[\\/:*?"<>|]/.test(name) || name === '.' || name === '..') {
    return 'Имя не должно содержать символы пути.';
  }
  return undefined;
}

function isPathInside(filePath: string, rootPath: string): boolean {
  const normalizedFilePath = path.resolve(filePath).toLowerCase();
  const normalizedRootPath = path.resolve(rootPath).toLowerCase();
  const relative = path.relative(normalizedRootPath, normalizedFilePath);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function showConfigurationCommandError(
  title: string,
  error: unknown,
  services: CommandServices
): void {
  const message = error instanceof Error ? error.message : String(error);
  services.outputChannel.appendLine(`[actions][error] ${title} ${message}`);
  void vscode.window.showErrorMessage(`${title}\n${message}`, 'Открыть журнал').then((action) => {
    if (action === 'Открыть журнал') {
      services.outputChannel.show(true);
    }
  });
}

interface ImportTargetPickItem extends vscode.QuickPickItem {
  target?: ImportTarget;
  selectAll?: boolean;
}

async function pickImportTargets(
  targets: ImportTarget[]
): Promise<ImportTarget[] | undefined> {
  return new Promise((resolve) => {
    const quickPick = vscode.window.createQuickPick<ImportTargetPickItem>();
    let resolved = false;
    const selectAllItem: ImportTargetPickItem = {
      label: '$(check-all) Все',
      description: `${targets.length}`,
      selectAll: true,
    };
    const targetItems = targets.map((target): ImportTargetPickItem => ({
      label: `${target.kind === 'cf' ? '$(database)' : '$(extensions)'} ${target.name}`,
      description: target.kind === 'cf' ? 'Основная конфигурация' : 'Расширение',
      detail: target.rootPath,
      target,
    }));

    let applyingSelectAll = false;
    let selectAllActive = false;
    quickPick.canSelectMany = true;
    quickPick.title = 'Что импортировать';
    quickPick.placeholder = 'Выберите конфигурации для импорта из базы';
    quickPick.items = [selectAllItem, ...targetItems];
    quickPick.selectedItems = targets.length === 1 ? targetItems : [];

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
      const result = selected.some((item) => item.selectAll)
        ? targets
        : selected
            .map((item) => item.target)
            .filter((item): item is ImportTarget => Boolean(item));
      resolved = true;
      quickPick.hide();
      resolve(result);
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

function orderImportTargets(targets: ImportTarget[]): ImportTarget[] {
  return [...targets].sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === 'cf' ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });
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
