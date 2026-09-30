/**
 * Команды выгрузки/загрузки конфигурации и расширений в бинарные файлы
 * CF/CFE через пакетный Конфигуратор.
 *
 * Диалоги здесь, вся работа с процессом — в `CfFileCommandRunner`, валидация —
 * в `infra/cfFile` (те же guard'ы и тексты, что у CLI и MCP-инструментов).
 */
import * as path from 'path';
import * as vscode from 'vscode';
import type { CommandServices, NodeArg } from '../_shared';
import { runDumpConfigurationToCf, runLoadConfigurationFromCf } from './CfFileCommandRunner';
import { buildCfApplyTarget, resolveCfFileTargetFromNode } from './CfFileTarget';
import { listConnectedDatabaseExtensions, runApplyDatabaseConfiguration } from './ExtensionCommandRunner';
import {
  endConfigurationOperation,
  isConfigurationOperationRunning,
  tryBeginConfigurationOperation,
} from './configurationOperationLock';

const MAIN_CONFIGURATION_LABEL = 'Основная конфигурация';
const EXTENSION_LABEL = 'Расширение';
const NEW_EXTENSION_LABEL = 'Новое расширение…';

interface CfFileTarget {
  readonly extensionName: string;
}

/** Регистрирует команды выгрузки/загрузки CF/CFE. */
export function registerCfFileCommands(
  context: vscode.ExtensionContext,
  services: CommandServices
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('v8vscedit.dumpConfigurationToCf', async (node?: NodeArg) => {
      await dumpConfigurationToCf(services, node);
    }),
    vscode.commands.registerCommand('v8vscedit.loadConfigurationFromCf', async (node?: NodeArg) => {
      await loadConfigurationFromCf(services, node);
    })
  );
}

async function dumpConfigurationToCf(services: CommandServices, node?: NodeArg): Promise<void> {
  if (isConfigurationOperationRunning()) {
    showOperationAlreadyRunning();
    return;
  }

  /* c8 ignore start -- сценарии ниже целиком состоят из модальных диалогов vscode (QuickPick/SaveDialog/OpenDialog) и спавна CLI: в CI без пользователя и без платформы 1С не исполнимы. Покрыты: guard замка (cfFileCommandsRegistration.test.ts), разрешение цели по узлу (universalPanelCfFileMenu.test.ts), валидация (cfFileValidation.test.ts), вектор аргументов (cfFileArgs.test.ts), поведение CLI (cfFileCliCommands.test.ts). */
  // Вызов из контекстного меню корневого узла: цель уже известна из узла —
  // сразу к системному окну выбора файла, без вопроса «что выгрузить».
  const target = toDialogTarget(node) ?? await pickDumpTarget(services);
  if (!target) {
    return;
  }

  const outputFile = await pickDumpFile(services, target.extensionName);
  if (!outputFile) {
    return;
  }

  if (!await tryBeginConfigurationOperation()) {
    showOperationAlreadyRunning();
    return;
  }
  try {
    await runDumpConfigurationToCf({
      workspaceFolder: services.workspaceFolder,
      outputChannel: services.outputChannel,
      outputFile,
      extensionName: target.extensionName,
      // Перезапись уже подтверждена самим showSaveDialog.
      overwrite: true,
    });
  } catch (error) {
    showOperationError('Не удалось выгрузить конфигурацию в файл.', error, services);
  } finally {
    await endConfigurationOperation();
  }
  /* c8 ignore stop */
}

async function loadConfigurationFromCf(services: CommandServices, node?: NodeArg): Promise<void> {
  if (isConfigurationOperationRunning()) {
    showOperationAlreadyRunning();
    return;
  }

  /* c8 ignore start -- сценарии ниже целиком состоят из модальных диалогов vscode (QuickPick/SaveDialog/OpenDialog) и спавна CLI: в CI без пользователя и без платформы 1С не исполнимы. Покрыты: guard замка (cfFileCommandsRegistration.test.ts), разрешение цели по узлу (universalPanelCfFileMenu.test.ts), валидация (cfFileValidation.test.ts), вектор аргументов (cfFileArgs.test.ts), поведение CLI (cfFileCliCommands.test.ts). */
  const target = toDialogTarget(node) ?? await pickLoadTarget(services);
  if (!target) {
    return;
  }

  const inputFile = await pickLoadFile(target.extensionName);
  if (!inputFile) {
    return;
  }

  const confirmed = await confirmIrreversibleLoad(inputFile, target.extensionName);
  if (!confirmed) {
    return;
  }

  if (!await tryBeginConfigurationOperation()) {
    showOperationAlreadyRunning();
    return;
  }
  let loaded = false;
  try {
    loaded = await runLoadConfigurationFromCf({
      workspaceFolder: services.workspaceFolder,
      outputChannel: services.outputChannel,
      inputFile,
      extensionName: target.extensionName,
    });
  } catch (error) {
    showOperationError(
      'Не удалось загрузить конфигурацию из файла. Часть изменений могла быть применена — проверьте состояние базы.',
      error,
      services
    );
  } finally {
    // Замок освобождаем ДО вопросов пользователю: `await` на нотификации
    // внутри критической секции держал бы «операция уже выполняется» до
    // закрытия окна пользователем (см. запрет №18 CLAUDE.md).
    await endConfigurationOperation();
  }

  if (loaded) {
    await offerPostLoadSteps(services, target.extensionName);
  }
  /* c8 ignore stop */
}

/* c8 ignore start -- сценарии ниже целиком состоят из модальных диалогов vscode (QuickPick/SaveDialog/OpenDialog) и спавна CLI: в CI без пользователя и без платформы 1С не исполнимы. Покрыты: guard замка (cfFileCommandsRegistration.test.ts), валидация (cfFileValidation.test.ts), вектор аргументов (cfFileArgs.test.ts), поведение CLI (cfFileCliCommands.test.ts). */
/**
 * После успешной загрузки: конфигурация БАЗЫ ещё не обновлена (`/LoadCfg` её
 * не трогает — замерено на 8.3.27.1989), а XML-выгрузка в проекте больше не
 * соответствует базе. Предлагаем оба шага явно; «изменённой» конфигурацию
 * проекта НЕ помечаем — иначе «обновить изменённые конфигурации» залило бы
 * СТАРЫЕ файлы проекта обратно в базу поверх только что загруженного CF.
 */
async function offerPostLoadSteps(services: CommandServices, extensionName: string): Promise<void> {
  const applyAction = 'Применить к базе';
  const action = await vscode.window.showWarningMessage(
    'Конфигурация загружена, но конфигурация базы ещё не обновлена. Применить изменения к базе?',
    applyAction,
    'Позже'
  );
  if (action === applyAction) {
    // Замок мог перехватить кто-то ещё, пока пользователь читал вопрос. Молча
    // ничего не делать нельзя: пользователь нажал кнопку и вправе понимать,
    // почему ничего не произошло. Выход при этом НЕ ранний — предупреждение о
    // рассинхроне выгрузки и базы ниже пользователь должен получить в любом
    // случае, оно не зависит от того, применили мы изменения или нет.
    if (await tryBeginConfigurationOperation()) {
      try {
        await runApplyDatabaseConfiguration(
          buildCfApplyTarget(services.workspaceFolder.uri.fsPath, extensionName),
          services.workspaceFolder,
          services.outputChannel,
          true
        );
      } catch (error) {
        showOperationError('Не удалось применить изменения к базе.', error, services);
      } finally {
        await endConfigurationOperation();
      }
    } else {
      showOperationAlreadyRunning();
    }
  }

  const importAction = 'Импортировать из базы';
  const importChoice = await vscode.window.showWarningMessage(
    'XML-выгрузка в проекте больше не соответствует базе. Импортировать конфигурации из базы?',
    importAction,
    'Позже'
  );
  if (importChoice === importAction) {
    await vscode.commands.executeCommand('v8vscedit.importConfigurations');
  }
}

async function pickDumpTarget(services: CommandServices): Promise<CfFileTarget | undefined> {
  const kind = await pickTargetKind('Что выгрузить в файл?');
  if (!kind) {
    return undefined;
  }
  if (kind === 'cf') {
    return { extensionName: '' };
  }

  // Имя расширения берём ТОЛЬКО из базы: выгрузить можно лишь то расширение,
  // которое в базе реально есть, а ручной ввод дал бы ошибку платформы уже
  // после спавна Конфигуратора.
  const extensions = await listConnectedDatabaseExtensions(services.workspaceFolder, services.outputChannel);
  if (!extensions) {
    void vscode.window.showErrorMessage(
      'Не удалось получить список расширений базы: проверьте параметры подключения (env.json) и доступность платформы.'
    );
    return undefined;
  }
  if (extensions.length === 0) {
    void vscode.window.showInformationMessage('В базе нет подключённых расширений — выгружать нечего.');
    return undefined;
  }

  const selected = await vscode.window.showQuickPick(extensions, { title: 'Расширение базы для выгрузки' });
  if (!selected) {
    return undefined;
  }
  return { extensionName: selected };
}

async function pickLoadTarget(services: CommandServices): Promise<CfFileTarget | undefined> {
  const kind = await pickTargetKind('Что загрузить из файла?');
  if (!kind) {
    return undefined;
  }
  if (kind === 'cf') {
    return { extensionName: '' };
  }

  const extensions = await listConnectedDatabaseExtensions(services.workspaceFolder, services.outputChannel);
  if (!extensions) {
    void vscode.window.showErrorMessage(
      'Не удалось получить список расширений базы: проверьте параметры подключения (env.json) и доступность платформы.'
    );
    return undefined;
  }

  // Пункт «Новое расширение…» — полноценный сценарий, а не обход списка:
  // `/LoadCfg -Extension <новое имя>` создаёт расширение в базе (проверено на
  // 8.3.27.1989), поэтому загрузка в ещё не подключённое расширение легальна.
  const selected = await vscode.window.showQuickPick([...extensions, NEW_EXTENSION_LABEL], {
    title: 'Расширение базы для загрузки',
  });
  if (!selected) {
    return undefined;
  }
  if (selected !== NEW_EXTENSION_LABEL) {
    return { extensionName: selected };
  }

  const newName = await vscode.window.showInputBox({
    title: 'Имя нового расширения',
    prompt: 'Расширение будет создано в базе при загрузке файла',
    validateInput: (value) => (value.trim() ? undefined : 'Имя расширения не может быть пустым'),
  });
  const trimmed = newName?.trim();
  if (!trimmed) {
    return undefined;
  }
  return { extensionName: trimmed };
}

async function pickTargetKind(title: string): Promise<'cf' | 'cfe' | undefined> {
  const selected = await vscode.window.showQuickPick([MAIN_CONFIGURATION_LABEL, EXTENSION_LABEL], { title });
  if (!selected) {
    return undefined;
  }
  return selected === MAIN_CONFIGURATION_LABEL ? 'cf' : 'cfe';
}

async function pickDumpFile(services: CommandServices, extensionName: string): Promise<string | undefined> {
  const isExtension = extensionName.length > 0;
  const suggestedName = `${isExtension ? extensionName : 'configuration'}.${isExtension ? 'cfe' : 'cf'}`;
  const uri = await vscode.window.showSaveDialog({
    title: isExtension ? `Выгрузка расширения "${extensionName}"` : 'Выгрузка основной конфигурации',
    defaultUri: vscode.Uri.file(path.join(services.workspaceFolder.uri.fsPath, suggestedName)),
    filters: isExtension ? { 'Расширение 1С': ['cfe'] } : { 'Конфигурация 1С': ['cf'] },
  });
  return uri?.fsPath;
}

async function pickLoadFile(extensionName: string): Promise<string | undefined> {
  const isExtension = extensionName.length > 0;
  const uris = await vscode.window.showOpenDialog({
    title: isExtension ? `Загрузка расширения "${extensionName}"` : 'Загрузка основной конфигурации',
    canSelectMany: false,
    openLabel: 'Загрузить',
    filters: isExtension ? { 'Расширение 1С': ['cfe'] } : { 'Конфигурация 1С': ['cf'] },
  });
  return uris?.[0]?.fsPath;
}

async function confirmIrreversibleLoad(inputFile: string, extensionName: string): Promise<boolean> {
  const confirmButton = 'Загрузить';
  const targetLabel = extensionName ? `расширение "${extensionName}"` : 'основную конфигурацию';
  const answer = await vscode.window.showWarningMessage(
    `Загрузка полностью заменит ${targetLabel} в базе содержимым файла:\n${inputFile}\n\n`
    + 'Операция необратима, текущее содержимое будет потеряно. Продолжить?',
    { modal: true },
    confirmButton
  );
  return answer === confirmButton;
}

/* c8 ignore stop */

/**
 * Цель, заданная узлом контекстного меню, в форме диалогов этого модуля.
 * Для расширения имя берётся из узла — список расширений базы тут не нужен.
 *
 * Пустая строка в `extensionName` — принятое здесь обозначение основной
 * конфигурации (так же её возвращает `pickDumpTarget`/`pickLoadTarget`),
 * поэтому функция вынесена из диалогового `c8 ignore`-региона: она чистая и
 * кодирует соглашение, замена которого на `undefined` сломала бы выгрузку
 * основной конфигурации молча.
 */
export function toDialogTarget(node: NodeArg | undefined): CfFileTarget | undefined {
  const target = resolveCfFileTargetFromNode(node);
  if (!target) {
    return undefined;
  }
  return { extensionName: target.kind === 'extension' ? target.extensionName : '' };
}

function showOperationAlreadyRunning(): void {
  // Без await: уведомление не должно удерживать состояние «операция идёт».
  void vscode.window.showInformationMessage('Операция с конфигурацией уже выполняется. Дождитесь её завершения.');
}

function showOperationError(title: string, error: unknown, services: CommandServices): void {
  const message = error instanceof Error ? error.message : String(error);
  services.outputChannel.appendLine(`[cf-file][error] ${message}`);
  void vscode.window.showErrorMessage(`${title}\n${message}`);
}
