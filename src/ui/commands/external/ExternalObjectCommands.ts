import * as vscode from 'vscode';
import type { MetadataNode } from '../../tree/TreeNode';
import type { CommandServices } from '../_shared';

export function registerExternalObjectCommands(
  context: vscode.ExtensionContext,
  services: CommandServices
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('v8vscedit.help.add', async (node: MetadataNode | undefined) => {
      await addHelp(node, services);
    }),
    vscode.commands.registerCommand('v8vscedit.epf.create', async () => {
      await createExternalDataProcessor(services);
    }),
    vscode.commands.registerCommand('v8vscedit.erf.create', async () => {
      await createExternalReport(services);
    }),
    vscode.commands.registerCommand('v8vscedit.externalObject.validate', async (node: MetadataNode | undefined) => {
      await validateExternalObject(node, services);
    }),
    vscode.commands.registerCommand('v8vscedit.epf.bspInit', async (node: MetadataNode | undefined) => {
      await initBspRegistration(node, services);
    }),
    vscode.commands.registerCommand('v8vscedit.epf.bspAddCommand', async (node: MetadataNode | undefined) => {
      await addBspCommand(node, services);
    })
  );
}

async function addHelp(node: MetadataNode | undefined, services: CommandServices): Promise<void> {
  const objectPath = node?.xmlPath ?? await pickXmlOrDirectory('Выберите XML объекта или каталог объекта');
  if (!objectPath) {
    return;
  }
  const lang = await vscode.window.showInputBox({
    title: 'Код языка справки',
    value: 'ru',
    validateInput: (value) => /^[A-Za-z][A-Za-z0-9_-]*$/.test(value) ? undefined : 'Только латиница, цифры, дефис и подчёркивание',
  });
  if (!lang) {
    return;
  }

  try {
    const result = services.externalObjectService.addHelp({ objectPath, lang });
    services.suppressConfigurationReloadForFiles([...result.changedFiles]);
    services.markChangedConfigurationByFiles([...result.changedFiles]);
    services.treeProvider.refresh();
    services.refreshActionsView();
    await vscode.window.showInformationMessage(`Справка создана. Изменено файлов: ${result.changedFiles.length}.`);
  } catch (error) {
    await vscode.window.showErrorMessage(`Не удалось создать справку: ${String(error)}`);
  }
}

async function createExternalDataProcessor(services: CommandServices): Promise<void> {
  const input = await promptExternalObjectInput('Новая внешняя обработка');
  if (!input) {
    return;
  }
  try {
    const result = services.externalObjectService.createExternalDataProcessor(input);
    afterStandaloneMutation(result.changedFiles, services);
    await vscode.window.showInformationMessage(`Внешняя обработка создана: ${result.rootPath}`);
  } catch (error) {
    await vscode.window.showErrorMessage(`Не удалось создать внешнюю обработку: ${String(error)}`);
  }
}

async function createExternalReport(services: CommandServices): Promise<void> {
  const input = await promptExternalObjectInput('Новый внешний отчёт');
  if (!input) {
    return;
  }
  const withSkd = await vscode.window.showQuickPick([
    { label: 'Создать с основной СКД', value: true },
    { label: 'Создать без СКД', value: false },
  ], { title: 'Схема компоновки данных' });
  if (!withSkd) {
    return;
  }
  try {
    const result = services.externalObjectService.createExternalReport({ ...input, withSkd: withSkd.value });
    afterStandaloneMutation(result.changedFiles, services);
    await vscode.window.showInformationMessage(`Внешний отчёт создан: ${result.rootPath}`);
  } catch (error) {
    await vscode.window.showErrorMessage(`Не удалось создать внешний отчёт: ${String(error)}`);
  }
}

async function validateExternalObject(node: MetadataNode | undefined, services: CommandServices): Promise<void> {
  const objectPath = node?.xmlPath ?? await pickXmlOrDirectory('Выберите XML или каталог внешней обработки/отчёта');
  if (!objectPath) {
    return;
  }
  const result = services.externalObjectService.validate({ objectPath, detailed: true, maxErrors: 100 });
  await openReport(`Валидация внешнего объекта: ${result.errors} ошибок`, result.lines.join('\n'));
}

async function initBspRegistration(node: MetadataNode | undefined, services: CommandServices): Promise<void> {
  const objectPath = node?.xmlPath ?? await pickXmlOrDirectory('Выберите XML или каталог внешней обработки');
  if (!objectPath) {
    return;
  }
  const kind = await vscode.window.showQuickPick([
    'ДополнительнаяОбработка',
    'ДополнительныйОтчет',
    'ЗаполнениеОбъекта',
    'Отчет',
    'ПечатнаяФорма',
    'СозданиеСвязанныхОбъектов',
  ], { title: 'Вид обработки БСП' });
  if (!kind) {
    return;
  }
  const targetsText = await vscode.window.showInputBox({
    title: 'Назначение',
    prompt: 'Ссылки через запятую, например Документ.СчетНаОплату',
    value: '',
  });
  if (targetsText === undefined) {
    return;
  }
  try {
    const result = services.externalObjectService.initBspRegistration({
      objectPath,
      kind,
      targets: targetsText.split(',').map((item) => item.trim()).filter(Boolean),
    });
    afterStandaloneMutation(result.changedFiles, services);
    await vscode.window.showInformationMessage('Регистрация БСП добавлена в модуль объекта.');
  } catch (error) {
    await vscode.window.showErrorMessage(`Не удалось добавить регистрацию БСП: ${String(error)}`);
  }
}

async function addBspCommand(node: MetadataNode | undefined, services: CommandServices): Promise<void> {
  const objectPath = node?.xmlPath ?? await pickXmlOrDirectory('Выберите XML или каталог внешней обработки');
  if (!objectPath) {
    return;
  }
  const identifier = await vscode.window.showInputBox({
    title: 'Идентификатор команды БСП',
    validateInput: (value) => /^[\p{L}_][\p{L}\p{Nd}_]*$/u.test(value) ? undefined : 'Введите идентификатор 1С',
  });
  if (!identifier) {
    return;
  }
  const commandType = await vscode.window.showQuickPick([
    { label: 'По умолчанию', value: undefined },
    { label: 'ОткрытиеФормы', value: 'ОткрытиеФормы' },
    { label: 'ВызовСерверногоМетода', value: 'ВызовСерверногоМетода' },
    { label: 'ВызовКлиентскогоМетода', value: 'ВызовКлиентскогоМетода' },
    { label: 'ЗаполнениеФормы', value: 'ЗаполнениеФормы' },
    { label: 'СценарийВБезопасномРежиме', value: 'СценарийВБезопасномРежиме' },
  ], { title: 'Тип команды' });
  if (!commandType) {
    return;
  }
  const presentation = await vscode.window.showInputBox({ title: 'Представление команды', value: identifier });
  if (presentation === undefined) {
    return;
  }
  try {
    const result = services.externalObjectService.addBspCommand({
      objectPath,
      identifier,
      commandType: commandType.value,
      presentation,
    });
    afterStandaloneMutation(result.changedFiles, services);
    await vscode.window.showInformationMessage('Команда БСП добавлена.');
  } catch (error) {
    await vscode.window.showErrorMessage(`Не удалось добавить команду БСП: ${String(error)}`);
  }
}

async function promptExternalObjectInput(title: string): Promise<{ name: string; synonym?: string; outputDir: string } | undefined> {
  const name = await vscode.window.showInputBox({
    title,
    prompt: 'Имя объекта',
    validateInput: (value) => /^[\p{L}_][\p{L}\p{Nd}_]*$/u.test(value) ? undefined : 'Имя должно быть идентификатором 1С',
  });
  if (!name) {
    return undefined;
  }
  const synonym = await vscode.window.showInputBox({ title, prompt: 'Синоним', value: name });
  if (synonym === undefined) {
    return undefined;
  }
  const folder = await vscode.window.showOpenDialog({
    title: 'Куда создать XML-исходники',
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
  });
  const outputDir = folder?.[0]?.fsPath;
  return outputDir ? { name, synonym, outputDir } : undefined;
}

async function pickXmlOrDirectory(title: string): Promise<string | undefined> {
  const picked = await vscode.window.showOpenDialog({
    title,
    canSelectFiles: true,
    canSelectFolders: true,
    canSelectMany: false,
    filters: { XML: ['xml'], Все: ['*'] },
  });
  return picked?.[0]?.fsPath;
}

async function openReport(title: string, content: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({
    language: 'plaintext',
    content: `${title}\n${'='.repeat(title.length)}\n\n${content}\n`,
  });
  await vscode.window.showTextDocument(doc);
}

function afterStandaloneMutation(changedFiles: readonly string[], services: CommandServices): void {
  services.suppressConfigurationReloadForFiles([...changedFiles]);
  services.markChangedConfigurationByFiles([...changedFiles]);
  services.treeProvider.refresh();
  services.refreshActionsView();
}
