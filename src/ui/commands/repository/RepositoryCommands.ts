import * as path from 'path';
import * as vscode from 'vscode';
import { RepositoryBinding, RepositoryNodeRef, RepositoryService, RepositoryTarget } from '../../../infra/repository/RepositoryService';
import { CommandServices, NodeArg } from '../_shared';
import {
  runApplyDatabaseConfiguration,
  runDecompileExtension,
  runDecompileMainConfiguration,
  runUpdateExtension,
  runUpdateMainConfiguration,
} from '../ext/ExtensionCommandRunner';
import {
  RepositoryCliServices,
  runRepositoryCliCommand,
  runRepositoryCommitAction,
  runRepositoryLockAction,
  runRepositoryUnlockAction,
  runRepositoryUpdateAction,
} from './RepositoryCommandRunner';

interface BooleanPickItem extends vscode.QuickPickItem {
  value: boolean;
}

interface ReportFlagItem extends vscode.QuickPickItem {
  flag:
    | 'GroupByObject'
    | 'GroupByComment'
    | 'DoNotIncludeVersionsWithLabels'
    | 'IncludeOnlyVersionsWithLabels'
    | 'IncludeCommentLinesWithDoubleSlash';
}

interface RightsPickItem extends vscode.QuickPickItem {
  value: 'ReadOnly' | 'LockObjects' | 'ManageConfigurationVersions' | 'Administration';
}

type RepositoryCommandNode = NodeArg & RepositoryNodeRef;

/**
 * Регистрирует команды работы с хранилищем конфигурации.
 */
export function registerRepositoryCommands(
  context: vscode.ExtensionContext,
  services: CommandServices
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('v8vscedit.repository.connect', async (node: NodeArg) => {
      const target = requireRootTarget(services, node);
      if (!target) {
        return;
      }

      const initialBinding = services.repositoryService.loadBinding(target);
      await services.repositoryConnectionViewProvider.show('bind', target, initialBinding, async (formData) => {
        const validation = validateBindingForm(formData);
        if (!validation.ok) {
          return {
            success: false,
            errorMessage: validation.errorMessage,
          };
        }

        const ok = await runRepositoryCliCommand({
        command: 'repository-bind',
        target,
        bindingOverride: validation.binding,
        extraArgs: [
          ...(formData.forceBindAlreadyBindedUser ? ['-ForceBindAlreadyBindedUser'] : []),
          ...(formData.forceReplaceCfg ? ['-ForceReplaceCfg'] : []),
        ],
        progressTitle: `Подключение к хранилищу: ${target.displayName}`,
        progressStartMessage: 'Подключаю конфигурацию к хранилищу...',
        successMessage: `Конфигурация "${target.displayName}" подключена к хранилищу.`,
        errorTitle: `Ошибка подключения "${target.displayName}" к хранилищу.`,
        failureOperation: 'подключении к хранилищу',
        afterSuccess: async () => {
          services.repositoryService.saveBinding(target, validation.binding);
          services.repositoryService.setConnected(target, true);
          refreshRepositoryUi(services);
        },
        }, toCliServices(services));

        if (ok) {
          void runPostRepositorySync(target, services);
        }

        return {
          success: ok,
          errorMessage: ok ? undefined : 'Подключение не выполнено. Подробности уже выведены в уведомлении и журнале.',
        };
      });
    }),

    vscode.commands.registerCommand('v8vscedit.repository.create', async (node: NodeArg) => {
      const target = requireRootTarget(services, node);
      if (!target) {
        return;
      }

      const initialBinding = services.repositoryService.loadBinding(target);
      await services.repositoryConnectionViewProvider.show('create', target, initialBinding, async (formData) => {
        const validation = validateBindingForm(formData);
        if (!validation.ok) {
          return {
            success: false,
            errorMessage: validation.errorMessage,
          };
        }

        const ok = await runRepositoryCliCommand({
        command: 'repository-create',
        target,
        bindingOverride: validation.binding,
        extraArgs: [
          ...(formData.allowConfigurationChanges ? ['-AllowConfigurationChanges'] : []),
          ...(formData.changesAllowedRule ? ['-ChangesAllowedRule', formData.changesAllowedRule] : []),
          ...(formData.changesNotRecommendedRule ? ['-ChangesNotRecommendedRule', formData.changesNotRecommendedRule] : []),
          ...(formData.noBind ? ['-NoBind'] : []),
        ],
        progressTitle: `Создание хранилища: ${target.displayName}`,
        progressStartMessage: 'Создаю хранилище конфигурации...',
        successMessage: `Хранилище для "${target.displayName}" создано.`,
        errorTitle: `Ошибка создания хранилища для "${target.displayName}".`,
        failureOperation: 'создании хранилища',
        afterSuccess: async () => {
          services.repositoryService.saveBinding(target, validation.binding);
          services.repositoryService.setConnected(target, !formData.noBind);
          refreshRepositoryUi(services);
        },
        }, toCliServices(services));

        if (ok && !formData.noBind) {
          void runPostRepositorySync(target, services);
        }

        return {
          success: ok,
          errorMessage: ok ? undefined : 'Создание не выполнено. Подробности уже выведены в уведомлении и журнале.',
        };
      });
    }),

    vscode.commands.registerCommand('v8vscedit.repository.disconnect', async (node: NodeArg) => {
      const target = requireRootTarget(services, node);
      if (!target || !ensureConnected(services.repositoryService, target)) {
        return;
      }

      const force = await pickBoolean(
        'Отключение от хранилища',
        `Как отключить "${target.displayName}" от хранилища?`,
        'Принудительно',
        'Штатно'
      );
      if (force === undefined) {
        return;
      }

      await runRepositoryCliCommand({
        command: 'repository-unbind',
        target,
        extraArgs: force ? ['-Force'] : [],
        progressTitle: `Отключение от хранилища: ${target.displayName}`,
        progressStartMessage: 'Отключаю конфигурацию от хранилища...',
        successMessage: `Конфигурация "${target.displayName}" отключена от хранилища.`,
        errorTitle: `Ошибка отключения "${target.displayName}" от хранилища.`,
        failureOperation: 'отключении от хранилища',
        afterSuccess: async () => {
          services.repositoryService.clearBinding(target);
          refreshRepositoryUi(services);
        },
      }, toCliServices(services));
    }),

    vscode.commands.registerCommand('v8vscedit.repository.lock', async (node: NodeArg) => {
      const repositoryNode = requireRepositoryNode(services, node);
      if (!repositoryNode) {
        return;
      }

      const recursive = await askRecursiveMode('Захват объектов', repositoryNode.label ?? 'выбранный узел');
      if (recursive === undefined) {
        return;
      }

      const ok = await runRepositoryLockAction(toCliServices(services), repositoryNode, recursive);
      if (ok) {
        refreshRepositoryUi(services);
      }
    }),

    vscode.commands.registerCommand('v8vscedit.repository.unlock', async (node: NodeArg) => {
      const repositoryNode = requireRepositoryNode(services, node);
      if (!repositoryNode) {
        return;
      }

      const recursive = await askRecursiveMode('Освобождение объектов', repositoryNode.label ?? 'выбранный узел');
      if (recursive === undefined) {
        return;
      }
      const force = await pickBoolean(
        'Освобождение объектов',
        'Выполнять принудительное освобождение?',
        'С force',
        'Без force'
      );
      if (force === undefined) {
        return;
      }

      const ok = await runRepositoryUnlockAction(toCliServices(services), repositoryNode, recursive, force);
      if (ok) {
        refreshRepositoryUi(services);
      }
    }),

    vscode.commands.registerCommand('v8vscedit.repository.commit', async (node: NodeArg) => {
      const repositoryNode = requireRepositoryNode(services, node);
      if (!repositoryNode) {
        return;
      }

      const target = requireTarget(services.repositoryService, repositoryNode);
      if (!target) {
        return;
      }

      const updatedBeforeCommit = await ensureTargetUpdatedBeforeCommit(target, services);
      if (!updatedBeforeCommit) {
        return;
      }

      const fullName = services.repositoryService.resolveFullName(repositoryNode);
      const initiallyLocked = fullName ? services.repositoryService.isLocked(target, fullName) : false;
      const formData = await services.repositoryCommitViewProvider.show(
        repositoryNode.label ?? target.displayName,
        initiallyLocked
      );
      if (!formData) {
        return;
      }
      if (!formData.comment.trim()) {
        await vscode.window.showWarningMessage('Для помещения требуется комментарий.');
        return;
      }

      const ok = await runRepositoryCommitAction(toCliServices(services), repositoryNode, formData);
      if (ok) {
        refreshRepositoryUi(services);
      }
    }),

    vscode.commands.registerCommand('v8vscedit.repository.update', async (node: NodeArg) => {
      const repositoryNode = requireRepositoryNode(services, node);
      if (!repositoryNode) {
        return;
      }

      const recursive = await askRecursiveMode('Получение из хранилища', repositoryNode.label ?? 'выбранный узел');
      if (recursive === undefined) {
        return;
      }
      const force = await pickBoolean(
        'Получение из хранилища',
        'Выполнять принудительное получение?',
        'С force',
        'Без force'
      );
      if (force === undefined) {
        return;
      }
      const version = await vscode.window.showInputBox({
        title: 'Получение из хранилища',
        prompt: 'Версия хранилища для получения. Оставьте пустым для актуальной.',
        placeHolder: 'Например: 125',
        ignoreFocusOut: true,
      });
      if (version === undefined) {
        return;
      }

      const ok = await runRepositoryUpdateAction(toCliServices(services), repositoryNode, {
        recursive,
        force,
        version: version.trim() || undefined,
      });
      if (ok) {
        refreshRepositoryUi(services);
      }
    }),

    vscode.commands.registerCommand('v8vscedit.repository.addUser', async (node: NodeArg) => {
      const target = requireConnectedRootTarget(services, node);
      if (!target) {
        return;
      }

      const userName = await promptRequiredText('Добавление пользователя', 'Имя пользователя хранилища');
      if (!userName) {
        return;
      }
      const password = await promptRequiredText('Добавление пользователя', 'Пароль пользователя', true);
      if (!password) {
        return;
      }
      const rights = await pickRights();
      if (!rights) {
        return;
      }
      const restoreDeletedUser = await pickBoolean(
        'Добавление пользователя',
        'Восстанавливать пользователя, если он был удалён?',
        'Да, восстановить',
        'Нет'
      );
      if (restoreDeletedUser === undefined) {
        return;
      }

      await runRepositoryCliCommand({
        command: 'repository-add-user',
        target,
        extraArgs: [
          '-User', userName,
          '-Pwd', password,
          '-Rights', rights,
          ...(restoreDeletedUser ? ['-RestoreDeletedUser'] : []),
        ],
        progressTitle: `Пользователь хранилища: ${target.displayName}`,
        progressStartMessage: 'Добавляю пользователя в хранилище...',
        successMessage: `Пользователь "${userName}" добавлен в хранилище.`,
        errorTitle: `Ошибка добавления пользователя в хранилище "${target.displayName}".`,
        failureOperation: 'добавлении пользователя в хранилище',
      }, toCliServices(services));
    }),

    vscode.commands.registerCommand('v8vscedit.repository.copyUsers', async (node: NodeArg) => {
      const target = requireConnectedRootTarget(services, node);
      if (!target) {
        return;
      }

      const sourcePath = await promptRequiredText('Копирование пользователей', 'Путь к исходному хранилищу или его каталогу');
      if (!sourcePath) {
        return;
      }
      const userName = await promptRequiredText('Копирование пользователей', 'Имя пользователя исходного хранилища');
      if (!userName) {
        return;
      }
      const password = await promptRequiredText('Копирование пользователей', 'Пароль пользователя исходного хранилища', true);
      if (!password) {
        return;
      }
      const restoreDeletedUser = await pickBoolean(
        'Копирование пользователей',
        'Восстанавливать удалённых пользователей?',
        'Да, восстанавливать',
        'Нет'
      );
      if (restoreDeletedUser === undefined) {
        return;
      }

      await runRepositoryCliCommand({
        command: 'repository-copy-users',
        target,
        extraArgs: [
          '-Path', sourcePath,
          '-User', userName,
          '-Pwd', password,
          ...(restoreDeletedUser ? ['-RestoreDeletedUser'] : []),
        ],
        progressTitle: `Копирование пользователей: ${target.displayName}`,
        progressStartMessage: 'Копирую пользователей из другого хранилища...',
        successMessage: `Пользователи для "${target.displayName}" скопированы.`,
        errorTitle: `Ошибка копирования пользователей в хранилище "${target.displayName}".`,
        failureOperation: 'копировании пользователей хранилища',
      }, toCliServices(services));
    }),

    vscode.commands.registerCommand('v8vscedit.repository.dump', async (node: NodeArg) => {
      const target = requireConnectedRootTarget(services, node);
      if (!target) {
        return;
      }

      const fileUri = await vscode.window.showSaveDialog({
        title: 'Выгрузка версии из хранилища',
        defaultUri: vscode.Uri.file(path.join(
          services.workspaceFolder.uri.fsPath,
          '.v8vscedit',
          `${sanitizeFileName(target.displayName)}.cf`
        )),
        filters: {
          'Файл конфигурации 1С': ['cf'],
          'Все файлы': ['*'],
        },
      });
      if (!fileUri) {
        return;
      }

      const version = await vscode.window.showInputBox({
        title: 'Выгрузка версии из хранилища',
        prompt: 'Версия для выгрузки. Оставьте пустым для актуальной.',
        placeHolder: 'Например: 125',
        ignoreFocusOut: true,
      });
      if (version === undefined) {
        return;
      }

      await runRepositoryCliCommand({
        command: 'repository-dump',
        target,
        extraArgs: [
          '-File', fileUri.fsPath,
          ...(version.trim() ? ['-Version', version.trim()] : []),
        ],
        progressTitle: `Выгрузка версии: ${target.displayName}`,
        progressStartMessage: 'Выгружаю конфигурацию из хранилища...',
        successMessage: `Версия хранилища "${target.displayName}" выгружена в "${fileUri.fsPath}".`,
        errorTitle: `Ошибка выгрузки версии хранилища "${target.displayName}".`,
        failureOperation: 'выгрузке версии из хранилища',
      }, toCliServices(services));
    }),

    vscode.commands.registerCommand('v8vscedit.repository.report', async (node: NodeArg) => {
      const target = requireConnectedRootTarget(services, node);
      if (!target) {
        return;
      }

      const format = await pickReportFormat();
      if (!format) {
        return;
      }
      const defaultExtension = format === 'mxl' ? 'mxl' : 'txt';
      const fileUri = await vscode.window.showSaveDialog({
        title: 'Отчёт по хранилищу',
        defaultUri: vscode.Uri.file(path.join(
          services.workspaceFolder.uri.fsPath,
          '.v8vscedit',
          `repository-report-${sanitizeFileName(target.displayName)}.${defaultExtension}`
        )),
        filters: {
          'Файлы отчёта': [defaultExtension],
          'Все файлы': ['*'],
        },
      });
      if (!fileUri) {
        return;
      }

      const nBegin = await promptOptionalText('Отчёт по хранилищу', 'Начальная версия');
      if (nBegin === undefined) {
        return;
      }
      const nEnd = await promptOptionalText('Отчёт по хранилищу', 'Конечная версия');
      if (nEnd === undefined) {
        return;
      }
      const dateBegin = await promptOptionalText('Отчёт по хранилищу', 'Начальная дата');
      if (dateBegin === undefined) {
        return;
      }
      const dateEnd = await promptOptionalText('Отчёт по хранилищу', 'Конечная дата');
      if (dateEnd === undefined) {
        return;
      }
      const configurationVersion = await promptOptionalText(
        'Отчёт по хранилищу',
        'Фильтр по номеру версии конфигурации'
      );
      if (configurationVersion === undefined) {
        return;
      }

      const flags = await pickReportFlags();
      if (!flags) {
        return;
      }

      await runRepositoryCliCommand({
        command: 'repository-report',
        target,
        extraArgs: [
          '-File', fileUri.fsPath,
          ...(nBegin.trim() ? ['-NBegin', nBegin.trim()] : []),
          ...(nEnd.trim() ? ['-NEnd', nEnd.trim()] : []),
          ...(dateBegin.trim() ? ['-DateBegin', dateBegin.trim()] : []),
          ...(dateEnd.trim() ? ['-DateEnd', dateEnd.trim()] : []),
          ...(configurationVersion.trim() ? ['-ConfigurationVersion', configurationVersion.trim()] : []),
          '-ReportFormat', format,
          ...flags.flatMap((flag) => [`-${flag}`]),
        ],
        progressTitle: `Отчёт по хранилищу: ${target.displayName}`,
        progressStartMessage: 'Строю отчёт по истории хранилища...',
        successMessage: `Отчёт по хранилищу "${target.displayName}" сформирован.`,
        errorTitle: `Ошибка построения отчёта по хранилищу "${target.displayName}".`,
        failureOperation: 'построении отчёта по хранилищу',
      }, toCliServices(services));
    }),

    vscode.commands.registerCommand('v8vscedit.repository.setLabel', async (node: NodeArg) => {
      const target = requireConnectedRootTarget(services, node);
      if (!target) {
        return;
      }

      const labelName = await promptRequiredText('Установка метки', 'Имя метки');
      if (!labelName) {
        return;
      }
      const version = await promptOptionalText('Установка метки', 'Версия. Оставьте пустым для текущей.');
      if (version === undefined) {
        return;
      }
      const comment = await promptOptionalText('Установка метки', 'Комментарий к метке');
      if (comment === undefined) {
        return;
      }

      await runRepositoryCliCommand({
        command: 'repository-set-label',
        target,
        extraArgs: [
          '-LabelName', labelName,
          ...(version.trim() ? ['-Version', version.trim()] : []),
          ...(comment.trim() ? ['-Comment', comment.trim()] : []),
        ],
        progressTitle: `Установка метки: ${target.displayName}`,
        progressStartMessage: 'Устанавливаю метку версии в хранилище...',
        successMessage: `Метка "${labelName}" установлена для "${target.displayName}".`,
        errorTitle: `Ошибка установки метки для "${target.displayName}".`,
        failureOperation: 'установке метки хранилища',
      }, toCliServices(services));
    })
  );
}

function toCliServices(services: CommandServices): RepositoryCliServices {
  return {
    workspaceFolder: services.workspaceFolder,
    outputChannel: services.outputChannel,
    repositoryService: services.repositoryService,
  };
}

function refreshRepositoryUi(services: CommandServices): void {
  services.treeProvider.refresh();
  services.refreshActionsView();
}

async function ensureTargetUpdatedBeforeCommit(
  target: RepositoryTarget,
  services: CommandServices
): Promise<boolean> {
  const changed = services.getChangedConfigurations().find(
    (item) => path.resolve(item.rootPath).toLowerCase() === path.resolve(target.configRoot).toLowerCase()
  );
  if (!changed) {
    return true;
  }

  const picked = await vscode.window.showQuickPick([
    {
      id: 'update',
      label: '$(sync) Обновить и продолжить',
      description: 'Сначала загрузить локальные изменения в базу, затем выполнить помещение',
      detail: `${changed.name}: изменённых файлов ${changed.changedFilesCount}`,
    },
    {
      id: 'cancel',
      label: '$(close) Отменить помещение',
      description: 'Помещение без предварительного обновления запрещено',
    },
  ], {
    title: 'Перед помещением требуется обновление конфигурации',
    placeHolder: 'В конфигурации есть локальные изменения, ещё не загруженные в базу',
    ignoreFocusOut: true,
  });

  if (picked?.id !== 'update') {
    return false;
  }

  const updated = target.configKind === 'cfe'
    ? await runUpdateExtension(
        target.extensionName ?? target.displayName,
        target.configRoot,
        services.workspaceFolder,
        services.outputChannel,
        false
      )
    : await runUpdateMainConfiguration(
        target.displayName,
        target.configRoot,
        services.workspaceFolder,
        services.outputChannel,
        false
      );
  if (!updated) {
    return false;
  }

  services.markConfigurationsClean([target.configRoot]);
  refreshRepositoryUi(services);
  return true;
}

async function runPostRepositorySync(target: RepositoryTarget, services: CommandServices): Promise<void> {
  try {
    const updated = await runApplyDatabaseConfiguration({
      kind: target.configKind,
      name: target.displayName,
      rootPath: target.configRoot,
      extensionName: target.extensionName,
    }, services.workspaceFolder, services.outputChannel, false);
    if (!updated) {
      return;
    }

    const imported = target.configKind === 'cfe'
      ? await runDecompileExtension(
          target.extensionName ?? target.displayName,
          target.configRoot,
          services.workspaceFolder,
          services.outputChannel
        )
      : await runDecompileMainConfiguration(
          target.displayName,
          target.configRoot,
          services.workspaceFolder,
          services.outputChannel
        );
    if (!imported) {
      return;
    }

    services.markConfigurationsClean([target.configRoot]);
    await services.reloadEntries();
    refreshRepositoryUi(services);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    services.outputChannel.appendLine(`[repository][post-sync][error] ${message}`);
  }
}

function requireRootTarget(services: CommandServices, node: NodeArg): RepositoryTarget | null {
  const repositoryNode = node as RepositoryCommandNode | undefined;
  if (!repositoryNode?.xmlPath || (repositoryNode.nodeKind !== 'configuration' && repositoryNode.nodeKind !== 'extension')) {
    void vscode.window.showWarningMessage('Команда хранилища доступна только для корня основной конфигурации или расширения.');
    return null;
  }

  return requireTarget(services.repositoryService, repositoryNode);
}

function requireConnectedRootTarget(services: CommandServices, node: NodeArg): RepositoryTarget | null {
  const target = requireRootTarget(services, node);
  if (!target || !ensureConnected(services.repositoryService, target)) {
    return null;
  }
  return target;
}

function requireRepositoryNode(services: CommandServices, node: NodeArg): RepositoryCommandNode | null {
  const repositoryNode = node as RepositoryCommandNode | undefined;
  if (!repositoryNode?.xmlPath) {
    void vscode.window.showWarningMessage('Команда хранилища доступна только для узлов конфигурации с XML.');
    return null;
  }

  const target = requireTarget(services.repositoryService, repositoryNode);
  if (!target || !ensureConnected(services.repositoryService, target)) {
    return null;
  }

  return repositoryNode;
}

function requireTarget(repositoryService: RepositoryService, node: RepositoryNodeRef): RepositoryTarget | null {
  if (!node.xmlPath) {
    return null;
  }
  return repositoryService.resolveTargetByXmlPath(node.xmlPath);
}

function ensureConnected(repositoryService: RepositoryService, target: RepositoryTarget): boolean {
  if (!repositoryService.hasBinding(target) || !repositoryService.isConnected(target)) {
    void vscode.window.showWarningMessage(`Для "${target.displayName}" нет активного подключения к хранилищу.`);
    return false;
  }
  return true;
}

function validateBindingForm(
  formData: { repoPath: string; repoUser: string; repoPassword: string }
): { ok: true; binding: RepositoryBinding } | { ok: false; errorMessage: string } {
  const repoPath = formData.repoPath.trim();
  const repoUser = formData.repoUser.trim();
  if (!repoPath) {
    return {
      ok: false,
      errorMessage: '\u041d\u0443\u0436\u043d\u043e \u0443\u043a\u0430\u0437\u0430\u0442\u044c \u043f\u0443\u0442\u044c \u043a \u0445\u0440\u0430\u043d\u0438\u043b\u0438\u0449\u0443 \u0438\u043b\u0438 \u0430\u0434\u0440\u0435\u0441 \u0441\u0435\u0440\u0432\u0435\u0440\u0430.',
    };
  }
  if (!repoUser) {
    return {
      ok: false,
      errorMessage: '\u041d\u0443\u0436\u043d\u043e \u0443\u043a\u0430\u0437\u0430\u0442\u044c \u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044f \u0445\u0440\u0430\u043d\u0438\u043b\u0438\u0449\u0430.',
    };
  }
  return {
    ok: true,
    binding: {
      repoPath,
      repoUser,
      repoPassword: formData.repoPassword,
    },
  };
}

async function askRecursiveMode(title: string, nodeLabel: string): Promise<boolean | undefined> {
  return pickBoolean(
    title,
    `Как выполнить операцию для "${nodeLabel}"?`,
    'Рекурсивно',
    'Только выбранный объект'
  );
}

async function pickBoolean(
  title: string,
  placeHolder: string,
  trueLabel: string,
  falseLabel: string
): Promise<boolean | undefined> {
  const items: BooleanPickItem[] = [
    { label: trueLabel, value: true },
    { label: falseLabel, value: false },
  ];
  const picked = await vscode.window.showQuickPick(items, {
    title,
    placeHolder,
    ignoreFocusOut: true,
  });
  return picked?.value;
}

async function pickRights(): Promise<RightsPickItem['value'] | undefined> {
  const items: RightsPickItem[] = [
    {
      label: 'Administration',
      description: 'Полный административный доступ к хранилищу',
      value: 'Administration',
    },
    {
      label: 'ManageConfigurationVersions',
      description: 'Управление версиями и метками',
      value: 'ManageConfigurationVersions',
    },
    {
      label: 'LockObjects',
      description: 'Захват, освобождение и помещение объектов',
      value: 'LockObjects',
    },
    {
      label: 'ReadOnly',
      description: 'Только чтение истории и версий',
      value: 'ReadOnly',
    },
  ];
  const picked = await vscode.window.showQuickPick(items, {
    title: 'Права пользователя хранилища',
    placeHolder: 'Выберите набор прав',
    ignoreFocusOut: true,
  });
  return picked?.value;
}

async function pickReportFormat(): Promise<'txt' | 'mxl' | undefined> {
  const picked = await vscode.window.showQuickPick([
    { label: 'txt', description: 'Текстовый отчёт' },
    { label: 'mxl', description: 'Табличный документ 1С' },
  ], {
    title: 'Формат отчёта по хранилищу',
    placeHolder: 'Выберите формат файла отчёта',
    ignoreFocusOut: true,
  });

  if (picked?.label === 'txt' || picked?.label === 'mxl') {
    return picked.label;
  }
  return undefined;
}

async function pickReportFlags(): Promise<ReportFlagItem['flag'][] | undefined> {
  const items: ReportFlagItem[] = [
    {
      label: 'Группировать по объектам',
      description: 'Параметр GroupByObject',
      flag: 'GroupByObject',
    },
    {
      label: 'Группировать по комментариям',
      description: 'Параметр GroupByComment',
      flag: 'GroupByComment',
    },
    {
      label: 'Исключить версии с метками',
      description: 'Параметр DoNotIncludeVersionsWithLabels',
      flag: 'DoNotIncludeVersionsWithLabels',
    },
    {
      label: 'Включить только версии с метками',
      description: 'Параметр IncludeOnlyVersionsWithLabels',
      flag: 'IncludeOnlyVersionsWithLabels',
    },
    {
      label: 'Включать строки комментариев с //',
      description: 'Параметр IncludeCommentLinesWithDoubleSlash',
      flag: 'IncludeCommentLinesWithDoubleSlash',
    },
  ];

  const picked = await vscode.window.showQuickPick(items, {
    title: 'Дополнительные параметры отчёта',
    placeHolder: 'Можно выбрать несколько флагов или не выбирать ни одного',
    canPickMany: true,
    ignoreFocusOut: true,
  });
  return picked?.map((item) => item.flag);
}

async function promptRequiredText(title: string, prompt: string, password = false): Promise<string | undefined> {
  const value = await vscode.window.showInputBox({
    title,
    prompt,
    password,
    ignoreFocusOut: true,
    validateInput: (input) => (input.trim() ? undefined : 'Значение обязательно'),
  });
  return value?.trim();
}

async function promptOptionalText(title: string, prompt: string): Promise<string | undefined> {
  return vscode.window.showInputBox({
    title,
    prompt,
    ignoreFocusOut: true,
  });
}

function sanitizeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, '_');
}
