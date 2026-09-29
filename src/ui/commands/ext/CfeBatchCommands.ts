/**
 * Команды пакетной выгрузки/загрузки ВСЕХ расширений базы в CFE-файлы.
 *
 * Диалоги здесь, работа с процессом — в `CfeBatchCommandRunner`, решения — в
 * `infra/cfFile` (те же функции, что у CLI и MCP-инструментов).
 *
 * Общий замок операций (`configurationOperationLock`) берётся ОДИН раз на весь
 * пакет и не отпускается между расширениями: чужая операция, вклинившаяся в
 * середину, изменила бы базу под работающим пакетом, и на выходе получился бы
 * набор CFE с двух разных состояний. Все вопросы и уведомления — вне занятой
 * секции (запрет №18 CLAUDE.md).
 */
import * as vscode from 'vscode';
import type { CommandServices } from '../_shared';
import { runDumpAllExtensionsToCfe, runLoadAllExtensionsFromCfe } from './CfeBatchCommandRunner';
import { CFE_MANIFEST_FILE_NAME, type CfeBatchReport, type CfeBatchReportItem } from '../../../infra/cfFile';
import {
  endConfigurationOperation,
  isConfigurationOperationRunning,
  tryBeginConfigurationOperation,
} from './configurationOperationLock';

/** Регистрирует команды пакетной выгрузки/загрузки расширений. */
export function registerCfeBatchCommands(
  context: vscode.ExtensionContext,
  services: CommandServices
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('v8vscedit.dumpAllExtensionsToCfe', async () => {
      await dumpAllExtensionsToCfe(services);
    }),
    vscode.commands.registerCommand('v8vscedit.loadAllExtensionsFromCfe', async () => {
      await loadAllExtensionsFromCfe(services);
    })
  );
}

/**
 * Текст итога прогона пользователю; `undefined` — сообщать не о чем.
 *
 * `failed` и `notAttempted` разводятся намеренно: «не удалось Ext03, Ext04» про
 * расширения, которые даже не пробовали (прогон прервали), — это ложь, по
 * которой пользователь пойдёт искать несуществующую проблему. Про сам факт
 * прерывания говорим явно — иначе неполный набор бэкапов выглядит как полный.
 *
 * Функция чистая и экспортируется, чтобы этот разбор проверялся тестом, а не
 * оставался внутри области модальных диалогов, непроверяемой в CI.
 */
export function buildBatchOutcomeMessage(
  report: CfeBatchReport | undefined,
  failureTitle: string
): string | undefined {
  if (!report) {
    return undefined;
  }
  const namesWith = (status: CfeBatchReportItem['status']): string[] =>
    report.items.filter((item) => item.status === status).map((item) => item.extensionName);

  const parts: string[] = [];
  const failed = namesWith('failed');
  if (failed.length > 0) {
    parts.push(`Не удалось: ${failed.join(', ')}.`);
  }
  if (report.interrupted) {
    parts.push('Операция прервана.');
  }
  const notAttempted = namesWith('notAttempted');
  if (notAttempted.length > 0) {
    parts.push(`Не обрабатывались: ${notAttempted.join(', ')}.`);
  }
  return parts.length > 0 ? `${failureTitle} ${parts.join(' ')}` : undefined;
}

/**
 * Предупреждение о файлах, имя расширения для которых взято из ИМЕНИ ФАЙЛА, а
 * не из манифеста: `A_B.cfe` — это и `A:B`, и `A/B`. Так выглядит каталог,
 * собранный вручную или оставшийся от прерванной выгрузки (её манифест
 * описывает лишь успевшую часть), то есть единственный признак того, что в базу
 * могло уехать чужое поколение бэкапа. `undefined` — таких файлов нет.
 */
export function buildRestoredByFileNameMessage(report: CfeBatchReport | undefined): string | undefined {
  const restored = report?.restoredByFileName ?? [];
  if (restored.length === 0) {
    return undefined;
  }
  return `Имя расширения восстановлено по имени файла, а не по манифесту ${CFE_MANIFEST_FILE_NAME}: ${restored.join(', ')}. `
    + 'Проверьте, что загружено то, что ожидалось.';
}

async function dumpAllExtensionsToCfe(services: CommandServices): Promise<void> {
  // Guard замка — ПЕРВЫМ действием: пакет работает с той же базой, что импорт и
  // обновление, и спрашивать каталог у пользователя, когда операцию всё равно
  // нельзя начать, незачем.
  if (isConfigurationOperationRunning()) {
    showOperationAlreadyRunning();
    return;
  }
  /* c8 ignore start -- сценарий целиком состоит из модальных диалогов vscode (OpenDialog/WarningMessage) и спавна CLI: в CI без пользователя и без платформы 1С не исполним. Покрыты: guard замка (cfeBatchCommandsRegistration.test.ts), пункты меню (universalPanelCfeBatchMenu.test.ts), обёртка CLI (cfeBatchCommandRunner.test.ts), решения (cfeBatchPlan/Naming/Manifest/Report.test.ts), цикл (cfeBatchCliRun.test.ts). */
  const outputDir = await pickDirectory('Каталог для выгрузки всех расширений', 'Выгрузить сюда');
  if (!outputDir) {
    return;
  }

  const overwrite = await confirmOverwrite(outputDir);
  if (overwrite === undefined) {
    return;
  }

  if (!await tryBeginConfigurationOperation()) {
    showOperationAlreadyRunning();
    return;
  }
  let report: CfeBatchReport | undefined;
  try {
    report = (await runDumpAllExtensionsToCfe({
      workspaceFolder: services.workspaceFolder,
      outputChannel: services.outputChannel,
      outputDir,
      overwrite,
    })).report;
  } catch (error) {
    showOperationError('Не удалось выгрузить расширения базы в файлы.', error, services);
  } finally {
    await endConfigurationOperation();
  }

  showWarning(buildBatchOutcomeMessage(report, 'Выгружены не все расширения.'));
}
/* c8 ignore stop -- закрывающая скобка входит в игнорируемую область: единственный исполнимый в тестах путь через эту функцию — ранний выход по занятому замку, до неё управление не доходит. */

async function loadAllExtensionsFromCfe(services: CommandServices): Promise<void> {
  if (isConfigurationOperationRunning()) {
    showOperationAlreadyRunning();
    return;
  }
  /* c8 ignore start -- сценарий целиком состоит из модальных диалогов vscode (OpenDialog/WarningMessage) и спавна CLI: в CI без пользователя и без платформы 1С не исполним. Покрытие — см. комментарий в dumpAllExtensionsToCfe. */
  const inputDir = await pickDirectory('Каталог с CFE-файлами расширений', 'Загрузить отсюда');
  if (!inputDir) {
    return;
  }

  const createMissing = await confirmIrreversibleLoad(inputDir);
  if (createMissing === undefined) {
    return;
  }

  if (!await tryBeginConfigurationOperation()) {
    showOperationAlreadyRunning();
    return;
  }
  let report: CfeBatchReport | undefined;
  try {
    report = (await runLoadAllExtensionsFromCfe({
      workspaceFolder: services.workspaceFolder,
      outputChannel: services.outputChannel,
      inputDir,
      createMissing,
    })).report;
  } catch (error) {
    showOperationError(
      'Не удалось загрузить расширения в базу. Часть расширений могла быть загружена — проверьте состояние базы.',
      error,
      services
    );
  } finally {
    // Замок освобождаем ДО вопросов пользователю: `await` на нотификации внутри
    // критической секции держал бы «операция уже выполняется» до закрытия окна.
    await endConfigurationOperation();
  }

  if (report?.failedAt) {
    void vscode.window.showErrorMessage(
      `Загрузка остановлена на расширении "${report.failedAt.extensionName}". `
      + 'Состояние этого расширения в базе неопределённо — проверьте его вручную. '
      + 'Остальные расширения набора не загружались.'
    );
    return;
  }
  showWarning(buildRestoredByFileNameMessage(report));
  showWarning(buildBatchOutcomeMessage(report, 'Загружены не все расширения.'));
  if (report && !report.interrupted) {
    await offerPostLoadSteps();
  }
}
/* c8 ignore stop -- см. комментарий в dumpAllExtensionsToCfe. */

/* c8 ignore start -- модальные диалоги vscode: в CI без пользователя не исполнимы (см. комментарии выше). */
/**
 * После успешной загрузки конфигурация БАЗЫ ещё не обновлена (`/LoadCfg` её не
 * трогает), а XML-выгрузка проекта больше не соответствует базе. «Изменённой»
 * конфигурацию проекта НЕ помечаем: иначе «обновить изменённые конфигурации»
 * залило бы СТАРЫЕ файлы проекта обратно в базу поверх только что загруженного.
 */
async function offerPostLoadSteps(): Promise<void> {
  const importAction = 'Импортировать из базы';
  const choice = await vscode.window.showWarningMessage(
    'Расширения загружены, но конфигурация базы ещё не обновлена, а XML-выгрузка проекта больше не соответствует базе. '
    + 'Примените изменения к базе по каждому расширению и импортируйте конфигурации.',
    importAction,
    'Позже'
  );
  if (choice === importAction) {
    await vscode.commands.executeCommand('v8vscedit.importConfigurations');
  }
}

async function pickDirectory(title: string, openLabel: string): Promise<string | undefined> {
  const uris = await vscode.window.showOpenDialog({
    title,
    openLabel,
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
  });
  return uris?.[0]?.fsPath;
}

/** `undefined` — пользователь отказался от операции. */
async function confirmOverwrite(outputDir: string): Promise<boolean | undefined> {
  const replaceAction = 'Заменять существующие';
  const keepAction = 'Отказаться при совпадении';
  const answer = await vscode.window.showWarningMessage(
    `Выгрузка всех расширений базы в каталог:\n${outputDir}\n\nЧто делать с уже существующими файлами?`,
    { modal: true },
    replaceAction,
    keepAction
  );
  if (answer === replaceAction) {
    return true;
  }
  return answer === keepAction ? false : undefined;
}

/** `undefined` — пользователь отказался; значение — разрешено ли создавать расширения в базе. */
async function confirmIrreversibleLoad(inputDir: string): Promise<boolean | undefined> {
  const loadAction = 'Загрузить только существующие';
  const createAction = 'Загрузить и создать отсутствующие';
  const answer = await vscode.window.showWarningMessage(
    `Загрузка полностью заменит в базе содержимое расширений файлами из каталога:\n${inputDir}\n\n`
    + 'Операция необратима, текущее содержимое расширений будет потеряно. Продолжить?',
    { modal: true },
    loadAction,
    createAction
  );
  if (answer === createAction) {
    return true;
  }
  return answer === loadAction ? false : undefined;
}

/**
 * Тонкий адаптер показа: вся композиция текста — в чистых
 * `buildBatchOutcomeMessage`/`buildRestoredByFileNameMessage` выше, здесь
 * остаётся только вызов VS Code API (потому и под общим игнором диалогов).
 */
function showWarning(message: string | undefined): void {
  if (message !== undefined) {
    void vscode.window.showWarningMessage(message);
  }
}

function showOperationError(title: string, error: unknown, services: CommandServices): void {
  const message = error instanceof Error ? error.message : String(error);
  services.outputChannel.appendLine(`[cfe-batch][error] ${message}`);
  void vscode.window.showErrorMessage(`${title}\n${message}`);
}
/* c8 ignore stop */

function showOperationAlreadyRunning(): void {
  // Без await: уведомление не должно удерживать состояние «операция идёт».
  void vscode.window.showInformationMessage('Операция с конфигурацией уже выполняется. Дождитесь её завершения.');
}
