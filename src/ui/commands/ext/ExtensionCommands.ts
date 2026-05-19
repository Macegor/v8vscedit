import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { ChangedConfiguration } from '../../../infra/fs/ConfigurationChangeDetector';
import type { ConfigEntry } from '../../../domain/Configuration';
import { parseConfigXml } from '../../../infra/xml';
import type { CommandServices, NodeArg } from '../_shared';
import {
  type ConfigurationImportHooks,
  type ConfigurationProgressHooks,
  extractExtensionTarget,
  runCompileExtension,
  runDecompileExtension,
  runDecompileMainConfiguration,
  setConfigurationOperationStatus,
  runUpdateMainConfiguration,
  runUpdateExtension,
} from './ExtensionCommandRunner';

interface ActionItem extends vscode.QuickPickItem {
  actionId: 'import' | 'update' | 'compileAndUpdateExt';
}

interface ImportTarget {
  kind: 'cf' | 'cfe';
  name: string;
  rootPath: string;
}

interface RootConfigurationTarget extends ImportTarget {
  extensionName?: string;
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
        await showOperationAlreadyRunningMessage();
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
      setConfigurationProgress(services, 'Импорт конфигураций', 'подготовка', true);
      await yieldToUi();
      const completedRootPaths: string[] = [];
      try {
        const ok = await runWithStandaloneServerStopped(services, 'Импорт конфигураций', async () => {
          const ordered = orderImportTargets(selected);
          for (let index = 0; index < ordered.length; index += 1) {
            const target = ordered[index];
            setConfigurationProgress(
              services,
              'Импорт конфигураций',
              `${String(index + 1)}/${String(ordered.length)}: ${target.name}`,
              true
            );
            const progressPrefix = `${String(index + 1)}/${String(ordered.length)}: ${target.name}`;
            const hooks = createImportHooks(services, 'Импорт конфигураций', progressPrefix);
            const imported = target.kind === 'cf'
              ? await runDecompileMainConfiguration(
                  target.name,
                  target.rootPath,
                  services.workspaceFolder,
                  services.outputChannel,
                  hooks
                )
              : await runDecompileExtension(
                  target.name,
                  target.rootPath,
                  services.workspaceFolder,
                  services.outputChannel,
                  hooks
                );

            if (!imported) {
              setConfigurationProgress(services, 'Импорт конфигураций', `остановлено на "${target.name}"`, false);
              return false;
            }
            completedRootPaths.push(target.rootPath);
          }

          if (ordered.length > 1) {
            void vscode.window.showInformationMessage(`Импортировано конфигураций: ${String(ordered.length)}.`);
          }
          setConfigurationProgress(services, 'Импорт конфигураций', 'обновление дерева метаданных', true);
          await yieldToUi();
          await services.reloadEntries();
          setConfigurationProgress(services, 'Импорт конфигураций', 'завершено', false);
          return true;
        });
        if (!ok) {
          return;
        }
      } catch (error) {
        setConfigurationProgress(services, 'Импорт конфигураций', 'ошибка', false);
        showConfigurationCommandError('Ошибка импорта конфигураций.', error, services);
      } finally {
        isUpdatingConfigurations = false;
        await vscode.commands.executeCommand('setContext', 'v8vscedit.isUpdatingConfigurations', false);
        services.markConfigurationsClean(completedRootPaths);
        clearConfigurationProgress(services);
      }
    }),

    vscode.commands.registerCommand('v8vscedit.updateChangedConfigurations', async () => {
      if (isUpdatingConfigurations) {
        await showOperationAlreadyRunningMessage();
        return false;
      }

      isUpdatingConfigurations = true;
      await vscode.commands.executeCommand('setContext', 'v8vscedit.isUpdatingConfigurations', true);
      setConfigurationProgress(services, 'Обновление конфигураций', 'проверка изменений', true);
      await yieldToUi();
      const completedRootPaths: string[] = [];
      try {
        const changed = services.getChangedConfigurations();

        if (changed.length === 0) {
          setConfigurationProgress(services, 'Обновление конфигураций', 'изменений нет', false);
          await vscode.window.showInformationMessage('Изменений в конфигурациях не обнаружено.');
          return true;
        }

        const selected = changed.length === 1
          ? changed
          : await pickChangedConfigurations(changed);
        if (!selected || selected.length === 0) {
          setConfigurationProgress(services, 'Обновление конфигураций', 'отменено', false);
          return false;
        }

        return await runWithStandaloneServerStopped(services, 'Обновление конфигураций', async () => {
          const ordered = orderUpdateTargets(selected);
          for (let index = 0; index < ordered.length; index += 1) {
            const target = ordered[index];
            setConfigurationProgress(
              services,
              'Обновление конфигураций',
              `${String(index + 1)}/${String(ordered.length)}: ${target.name}`,
              true
            );
            const updated = target.kind === 'cf'
              ? await runUpdateMainConfiguration(
                  target.name,
                  target.rootPath,
                  services.workspaceFolder,
                  services.outputChannel,
                  ordered.length === 1,
                  createProgressHooks(services, 'Обновление конфигураций', `${String(index + 1)}/${String(ordered.length)}: ${target.name}`)
                )
              : await runUpdateExtension(
                  target.name,
                  target.rootPath,
                  services.workspaceFolder,
                  services.outputChannel,
                  ordered.length === 1,
                  createProgressHooks(services, 'Обновление конфигураций', `${String(index + 1)}/${String(ordered.length)}: ${target.name}`)
                );

            if (!updated) {
              setConfigurationProgress(services, 'Обновление конфигураций', `остановлено на "${target.name}"`, false);
              return false;
            }
            completedRootPaths.push(target.rootPath);
          }

          if (ordered.length > 1) {
            void vscode.window.showInformationMessage(`Обновлено конфигураций: ${String(ordered.length)}.`);
          }
          setConfigurationProgress(services, 'Обновление конфигураций', 'завершено', false);
          return true;
        });
      } catch (error) {
        setConfigurationProgress(services, 'Обновление конфигураций', 'ошибка', false);
        showConfigurationCommandError('Ошибка обновления конфигураций.', error, services);
        return false;
      } finally {
        isUpdatingConfigurations = false;
        await vscode.commands.executeCommand('setContext', 'v8vscedit.isUpdatingConfigurations', false);
        services.markConfigurationsClean(completedRootPaths);
        clearConfigurationProgress(services);
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
      await runExclusiveConfigurationOperation(
        {
          title: `Подключение расширения ${normalizedExtensionName}`,
          startMessage: 'подготовка',
          services,
          afterSuccess: async () => {
            services.markConfigurationsClean([extensionRoot]);
            await services.reloadEntries();
            services.bslAnalyzerConfigService.updateSource(getConnectedExtensionRoots(services, extensionRoot));
          },
          afterFailure: async () => {
            fs.rmSync(extensionRoot, { recursive: true, force: true });
            await services.reloadEntries();
          },
        },
        () =>
          runDecompileExtension(
            normalizedExtensionName,
            extensionRoot,
            services.workspaceFolder,
            services.outputChannel
          )
      );
    }),

    vscode.commands.registerCommand('v8vscedit.showConfigActions', async (node: NodeArg) => {
      const target = extractRootConfigurationTarget(node);
      if (!target) {
        return;
      }

      const items: ActionItem[] = [
        { actionId: 'import', label: '$(cloud-download) Импортировать из базы' },
        { actionId: 'update', label: '$(sync) Обновить в базе' },
      ];
      if (target.kind === 'cfe') {
        items.push({ actionId: 'compileAndUpdateExt', label: '$(run-all) Полное обновление расширения' });
      }
      const picked = await vscode.window.showQuickPick<ActionItem>(items, {
        title: `Команды: ${target.name}`,
        placeHolder: 'Выберите действие',
      });

      if (!picked) {
        return;
      }

      if (picked.actionId === 'import') {
        await vscode.commands.executeCommand('v8vscedit.importConfigurationFromDb', node);
      } else if (picked.actionId === 'update') {
        await vscode.commands.executeCommand('v8vscedit.updateConfigurationInDb', node);
      } else {
        await vscode.commands.executeCommand('v8vscedit.compileAndUpdateExtensionInDb', node);
      }
    }),

    vscode.commands.registerCommand('v8vscedit.importConfigurationFromDb', async (node: NodeArg) => {
      const target = extractRootConfigurationTarget(node);
      if (!target) {
        vscode.window.showWarningMessage('Команда доступна только для корневого узла конфигурации или расширения.');
        return;
      }

      await runExclusiveConfigurationOperation(
        {
          title: `Импорт ${target.name}`,
          startMessage: 'подготовка',
          cleanRootPath: target.rootPath,
          reloadEntriesAfterSuccess: true,
          services,
        },
        async () => {
          const ok = target.kind === 'cf'
            ? await runDecompileMainConfiguration(
                target.name,
                target.rootPath,
                services.workspaceFolder,
                services.outputChannel,
                createImportHooks(services, `Импорт ${target.name}`)
              )
            : await runDecompileExtension(
                target.name,
                target.rootPath,
                services.workspaceFolder,
                services.outputChannel,
                createImportHooks(services, `Импорт ${target.name}`)
              );
          return ok;
        }
      );
    }),

    vscode.commands.registerCommand('v8vscedit.updateConfigurationInDb', async (node: NodeArg) => {
      const target = extractRootConfigurationTarget(node);
      if (!target) {
        vscode.window.showWarningMessage('Команда доступна только для корневого узла конфигурации или расширения.');
        return false;
      }

      return runExclusiveConfigurationOperation(
        {
          title: `Обновление ${target.name}`,
          startMessage: 'подготовка',
          cleanRootPath: target.rootPath,
          services,
        },
        async () => {
          const ok = target.kind === 'cf'
            ? await runUpdateMainConfiguration(
                target.name,
                target.rootPath,
                services.workspaceFolder,
                services.outputChannel,
                true,
                createProgressHooks(services, `Обновление ${target.name}`)
              )
            : await runUpdateExtension(
                target.name,
                target.rootPath,
                services.workspaceFolder,
                services.outputChannel,
                true,
                createProgressHooks(services, `Обновление ${target.name}`)
              );
          return ok;
        }
      );
    }),

    vscode.commands.registerCommand('v8vscedit.decompileExtensionSources', async (node: NodeArg) => {
      const target = extractExtensionTarget(node);
      if (!target) {
        vscode.window.showWarningMessage('Команда доступна только для корневого узла расширения.');
        return;
      }

      await runExclusiveConfigurationOperation(
        {
          title: `Импорт расширения ${target.extensionName}`,
          startMessage: 'подготовка',
          cleanRootPath: target.extensionRoot,
          reloadEntriesAfterSuccess: true,
          services,
        },
        () =>
          runDecompileExtension(
            target.extensionName,
            target.extensionRoot,
            services.workspaceFolder,
            services.outputChannel
          )
      );
    }),

    vscode.commands.registerCommand('v8vscedit.compileExtensionToDb', async (node: NodeArg) => {
      const target = extractExtensionTarget(node);
      if (!target) {
        vscode.window.showWarningMessage('Команда доступна только для корневого узла расширения.');
        return;
      }

      await runExclusiveConfigurationOperation(
        {
          title: `Загрузка расширения ${target.extensionName}`,
          startMessage: 'подготовка',
          cleanRootPath: target.extensionRoot,
          services,
        },
        () =>
          runCompileExtension(
            target.extensionName,
            target.extensionRoot,
            services.workspaceFolder,
            services.outputChannel
          )
      );
    }),

    vscode.commands.registerCommand('v8vscedit.updateExtensionInDb', async (node: NodeArg) => {
      const target = extractExtensionTarget(node);
      if (!target) {
        vscode.window.showWarningMessage('Команда доступна только для корневого узла расширения.');
        return;
      }

      await runExclusiveConfigurationOperation(
        {
          title: `Обновление расширения ${target.extensionName}`,
          startMessage: 'подготовка',
          cleanRootPath: target.extensionRoot,
          services,
        },
        () =>
          runUpdateExtension(
            target.extensionName,
            target.extensionRoot,
            services.workspaceFolder,
            services.outputChannel
          )
      );
    }),

    vscode.commands.registerCommand('v8vscedit.compileAndUpdateExtensionInDb', async (node: NodeArg) => {
      const target = extractExtensionTarget(node);
      if (!target) {
        vscode.window.showWarningMessage('Команда доступна только для корневого узла расширения.');
        return;
      }

      await runExclusiveConfigurationOperation(
        {
          title: `Полное обновление расширения ${target.extensionName}`,
          startMessage: 'подготовка',
          cleanRootPath: target.extensionRoot,
          services,
        },
        async () => {
          const compiled = await runCompileExtension(
            target.extensionName,
            target.extensionRoot,
            services.workspaceFolder,
            services.outputChannel,
            false
          );
          if (!compiled) {
            return false;
          }

          const updated = await runUpdateExtension(
            target.extensionName,
            target.extensionRoot,
            services.workspaceFolder,
            services.outputChannel,
            false
          );
          if (!updated) {
            return false;
          }

          void vscode.window.showInformationMessage(
            `Загрузка и обновление расширения "${target.extensionName}" в БД успешно завершены.`
          );
          return true;
        }
      );
    })
  );
}

async function runWithStandaloneServerStopped(
  services: CommandServices,
  operationTitle: string,
  operation: () => Promise<boolean>
): Promise<boolean> {
  const status = await services.standaloneServerService.refreshHealth();
  const shouldRestart = status.configured && (
    status.state === 'running' || status.state === 'unresponsive'
  );

  services.outputChannel.appendLine(
    `[standalone] Перед операцией "${operationTitle}": state=${status.state}, pid=${String(status.pid ?? '-')}, restart=${shouldRestart ? 'yes' : 'no'}`
  );

  if (!shouldRestart) {
    return operation();
  }

  services.outputChannel.appendLine(`[standalone] Перед операцией "${operationTitle}" автономный сервер будет остановлен.`);
  setConfigurationProgress(services, operationTitle, 'остановка автономного сервера', true);
  await services.standaloneServerService.stop();
  services.refreshActionsView();

  let ok = false;
  try {
    const result = await operation();
    ok = result;
    services.outputChannel.appendLine(`[standalone] Операция "${operationTitle}" вернула: ${String(result)}`);
    return ok;
  } finally {
    if (ok) {
      services.outputChannel.appendLine(`[standalone] Операция "${operationTitle}" завершена успешно, запускаю автономный сервер.`);
      setConfigurationProgress(services, operationTitle, 'запуск автономного сервера', true);
      try {
        const restartedStatus = await services.standaloneServerService.start();
        services.outputChannel.appendLine(
          `[standalone] После операции "${operationTitle}": state=${restartedStatus.state}, pid=${String(restartedStatus.pid ?? '-')}, url=${restartedStatus.url ?? '-'}`
        );
        if (restartedStatus.state !== 'running') {
          void vscode.window.showWarningMessage(
            `Операция "${operationTitle}" выполнена, но автономный сервер не перешёл в состояние "запущен": ${restartedStatus.message}`
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        services.outputChannel.appendLine(`[standalone][error] Не удалось запустить сервер после операции "${operationTitle}": ${message}`);
        void vscode.window.showErrorMessage(
          `Операция "${operationTitle}" выполнена, но автономный сервер не запустился.\n${message}`
        );
      } finally {
        setConfigurationProgress(services, operationTitle, 'завершено', false);
        services.refreshActionsView();
      }
    } else {
      services.outputChannel.appendLine(`[standalone] Операция "${operationTitle}" завершилась неуспешно, автономный сервер не запускается.`);
      setConfigurationProgress(services, operationTitle, 'остановлено', false);
      services.refreshActionsView();
    }
  }
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

function getConnectedExtensionRoots(services: CommandServices, extensionRoot: string): string[] {
  const roots = new Set(
    services.treeProvider
      .getEntries()
      .filter((entry) => entry.kind === 'cfe')
      .map((entry) => entry.rootPath)
  );
  roots.add(extensionRoot);
  return [...roots];
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
    return 'Имя не должно содержать символов пути.';
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

function setConfigurationProgress(
  services: CommandServices,
  title: string,
  message: string,
  running: boolean
): void {
  setConfigurationOperationStatus(title, message, running);
  if (running) {
    services.setTreeProcessingState({ active: true, title, message });
    return;
  }

  services.setTreeProcessingState({ active: false });
}

function clearConfigurationProgress(services: CommandServices): void {
  services.setTreeProcessingState({ active: false });
}

function createImportHooks(
  services: CommandServices,
  title: string,
  messagePrefix?: string
): ConfigurationImportHooks {
  return {
    ...createProgressHooks(services, title, messagePrefix),
    beforeProjectFilesChanged: (filePaths) => {
      services.suppressConfigurationReloadForFiles(filePaths);
    },
  };
}

function createProgressHooks(
  services: CommandServices,
  title: string,
  messagePrefix?: string
): ConfigurationProgressHooks {
  return {
    onProgressMessage: (message) => {
      const fullMessage = messagePrefix ? `${messagePrefix}: ${message}` : message;
      setConfigurationProgress(services, title, fullMessage, true);
    },
  };
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
      description: String(targets.length),
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
      description: String(changed.length),
      selectAll: true,
    };
    const targetItems = changed.map((target): ChangedConfigurationPickItem => ({
      label: `${target.kind === 'cf' ? '$(database)' : '$(extensions)'} ${target.name}`,
      description: target.kind === 'cf' ? 'Основная конфигурация' : 'Расширение',
      detail: `${String(target.changedFilesCount)} изменённых файлов`,
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

function extractRootConfigurationTarget(node: NodeArg): RootConfigurationTarget | null {
  const nodeKind = node.nodeKind;
  const xmlPath = node.xmlPath;
  if (!xmlPath) {
    return null;
  }

  if (nodeKind === 'configuration') {
    return {
      kind: 'cf',
      name: typeof node.label === 'string' ? node.label : node.label?.label ?? 'Основная конфигурация',
      rootPath: path.dirname(xmlPath),
    };
  }

  if (nodeKind === 'extension') {
    const extensionName = typeof node.label === 'string' ? node.label : node.label?.label ?? '';
    if (!extensionName) {
      return null;
    }
    return {
      kind: 'cfe',
      name: extensionName,
      rootPath: path.dirname(xmlPath),
      extensionName,
    };
  }

  return null;
}

async function runExclusiveConfigurationOperation(
  options: {
    title: string;
    startMessage: string;
    cleanRootPath?: string;
    reloadEntriesAfterSuccess?: boolean;
    afterSuccess?: () => void | Promise<void>;
    afterFailure?: () => void | Promise<void>;
    services: CommandServices;
  },
  operation: () => Promise<boolean>
): Promise<boolean> {
  if (isUpdatingConfigurations) {
    await showOperationAlreadyRunningMessage();
    return false;
  }

  isUpdatingConfigurations = true;
  await vscode.commands.executeCommand('setContext', 'v8vscedit.isUpdatingConfigurations', true);
  setConfigurationProgress(options.services, options.title, options.startMessage, true);
  await yieldToUi();
  let failureHookCalled = false;
  const runAfterFailure = async (): Promise<void> => {
    if (failureHookCalled) {
      return;
    }
    failureHookCalled = true;
    await options.afterFailure?.();
  };
  try {
    const ok = await runWithStandaloneServerStopped(options.services, options.title, operation);
    if (ok) {
      if (options.reloadEntriesAfterSuccess) {
        setConfigurationProgress(options.services, options.title, 'обновление дерева метаданных', true);
        await yieldToUi();
        await options.services.reloadEntries();
      }
      if (options.cleanRootPath) {
        options.services.markConfigurationsClean([options.cleanRootPath]);
      }
      await options.afterSuccess?.();
      setConfigurationProgress(options.services, options.title, 'завершено', false);
    } else {
      await runAfterFailure();
      setConfigurationProgress(options.services, options.title, 'остановлено', false);
    }
    return ok;
  } catch (error) {
    await runAfterFailure();
    setConfigurationProgress(options.services, options.title, 'ошибка', false);
    showConfigurationCommandError(`Ошибка операции "${options.title}".`, error, options.services);
    return false;
  } finally {
    isUpdatingConfigurations = false;
    await vscode.commands.executeCommand('setContext', 'v8vscedit.isUpdatingConfigurations', false);
    clearConfigurationProgress(options.services);
  }
}

async function showOperationAlreadyRunningMessage(): Promise<void> {
  await vscode.window.showInformationMessage('Операция с конфигурацией уже выполняется. Дождитесь её завершения.');
}
