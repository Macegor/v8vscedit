import * as vscode from 'vscode';
import { SupportMode } from '../../../infra/support/SupportInfoService';
import { resolveFormBodyFromNode, resolveObjectFormNodeParts } from '../../tree/formNodePaths';
import type { MetadataNode } from '../../tree/TreeNode';
import type { CommandServices } from '../_shared';

export function registerFormToolsCommands(
  context: vscode.ExtensionContext,
  services: CommandServices
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('v8vscedit.form.info', async (node: MetadataNode | undefined) => {
      await showFormInfo(node, services);
    }),
    vscode.commands.registerCommand('v8vscedit.form.validate', async (node: MetadataNode | undefined) => {
      await validateForm(node, services);
    }),
    vscode.commands.registerCommand('v8vscedit.form.add', async (node: MetadataNode | undefined) => {
      await addForm(node, services);
    }),
    vscode.commands.registerCommand('v8vscedit.form.remove', async (node: MetadataNode | undefined) => {
      await removeForm(node, services);
    })
  );
}

/**
 * Отказ команды — в уведомление И в журнал «1С Редактор». Только тост теряется:
 * пользователь закрывает его, и разбираться потом не по чему, а сообщения
 * сервисов форм несут путь файла и причину.
 */
async function failCommand(services: CommandServices, what: string, error: unknown): Promise<void> {
  const text = `${what}: ${String(error)}`;
  services.outputChannel.appendLine(`[form][error] ${text}`);
  await vscode.window.showErrorMessage(text);
}

async function showFormInfo(node: MetadataNode | undefined, services: CommandServices): Promise<void> {
  await runFormReport(node, services, (formPath) => {
    const result = services.formToolsService.info({ formPath, limit: 1000 });
    return { title: `Форма: ${result.title}`, lines: result.lines };
  });
}

async function validateForm(node: MetadataNode | undefined, services: CommandServices): Promise<void> {
  await runFormReport(node, services, (formPath) => {
    const result = services.formToolsService.validate({ formPath, detailed: true, maxErrors: 100 });
    // Предупреждения в заголовке обязательны: после смягчения части правил
    // содержательный вывод бывает целиком в них, и «0 ошибок» их прятало.
    return {
      title: `Валидация формы: ${String(result.errors)} ошибок, ${String(result.warnings)} предупреждений`,
      lines: result.lines,
    };
  });
}

/** Общий сценарий читающих формо-команд: путь тела формы → отчёт, отказ сервиса → уведомление. */
async function runFormReport(
  node: MetadataNode | undefined,
  services: CommandServices,
  build: (formPath: string) => { readonly title: string; readonly lines: readonly string[] },
): Promise<void> {
  const formPath = await resolveFormBodyForCommand(node, services);
  if (!formPath) {
    return;
  }
  // `openReport` намеренно ВНЕ try: он открывает документ и к чтению формы
  // отношения не имеет, а внутри try его сбой был бы показан как «не удалось
  // прочитать форму» — текст соврал бы про стадию.
  let report: { readonly title: string; readonly lines: readonly string[] };
  try {
    report = build(formPath);
  } catch (error) {
    await failCommand(services, 'Не удалось прочитать форму', error);
    return;
  }
  await openReport(report.title, report.lines.join('\n'));
}

/**
 * Путь к ТЕЛУ формы по узлу навигатора. `node.xmlPath` здесь брать нельзя: у формы
 * объекта это XML объекта-владельца, и команда разбирала XML справочника как форму
 * (лавина ложных ошибок валидации). Деривация — общая с MCP-инструментами.
 */
async function resolveFormBodyForCommand(
  node: MetadataNode | undefined,
  services: CommandServices,
): Promise<string | undefined> {
  if (!node) {
    return await pickPath('Выберите Form.xml, XML формы или каталог формы');
  }
  try {
    return resolveFormBodyFromNode(node, node.textLabel);
  } catch (error) {
    await failCommand(services, 'Не удалось определить файл формы', error);
    return undefined;
  }
}

async function addForm(node: MetadataNode | undefined, services: CommandServices): Promise<void> {
  const objectPath = node?.xmlPath ?? await pickPath('Выберите XML объекта или каталог объекта');
  if (!objectPath) {
    return;
  }
  const formName = await vscode.window.showInputBox({
    title: 'Имя формы',
    validateInput: (value) => /^[\p{L}_][\p{L}\p{Nd}_]*$/u.test(value) ? undefined : 'Введите идентификатор 1С',
  });
  if (!formName) {
    return;
  }
  const purpose = await vscode.window.showQuickPick(['Object', 'List', 'Choice', 'Record'], { title: 'Назначение формы' });
  if (!purpose) {
    return;
  }
  const synonym = await vscode.window.showInputBox({ title: 'Синоним формы', value: formName });
  if (synonym === undefined) {
    return;
  }
  try {
    const result = services.formToolsService.addForm({ objectPath, formName, purpose, synonym, setDefault: true });
    afterMutation(result.changedFiles, services);
    await vscode.window.showInformationMessage(`Форма ${formName} добавлена.`);
  } catch (error) {
    await failCommand(services, 'Не удалось добавить форму', error);
  }
}

async function removeForm(node: MetadataNode | undefined, services: CommandServices): Promise<void> {
  const target = await resolveRemoveTarget(node, services);
  if (!target) {
    return;
  }
  const { objectPath, formName } = target;

  // objectPath — это XML объекта-владельца формы, по нему проверяем поддержку и захват в хранилище
  // (тот же путь, что supportXmlPath в RemoveMetadataCommand).
  if (services.supportService?.getSupportMode(objectPath) === SupportMode.Locked) {
    await vscode.window.showErrorMessage('Удаление запрещено: объект находится на поддержке с запретом редактирования.');
    return;
  }
  const repositoryTarget = services.repositoryService.resolveTargetByXmlPath(objectPath);
  if (repositoryTarget && services.repositoryService.isMetadataEditRestricted(repositoryTarget, objectPath)) {
    await vscode.window.showErrorMessage('Удаление запрещено: объект не захвачен в хранилище.');
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    `Удалить форму "${formName}"? Изменение затронет XML-выгрузку и связанные файлы формы.`,
    { modal: true },
    'Удалить'
  );
  if (confirm !== 'Удалить') {
    return;
  }

  try {
    const result = services.formToolsService.removeForm({ objectPath, formName });
    afterMutation(result.changedFiles, services);
    await vscode.window.showInformationMessage(`Форма ${formName} удалена.`);
  } catch (error) {
    await failCommand(services, 'Не удалось удалить форму', error);
  }
}

/**
 * Объект-владелец и имя удаляемой формы. У узла формы объекта оба берутся из
 * `metaContext` (общая с MCP деривация), а не арифметикой над `node.xmlPath`:
 * там лежит XML владельца, и двойной `dirname` уводил путь на уровень выше
 * конфигурации. Общая форма владельца не имеет и попадает в ручную ветку —
 * удалять её этой командой нечем (как и `v8vscedit_remove_form`).
 */
async function resolveRemoveTarget(
  node: MetadataNode | undefined,
  services: CommandServices,
): Promise<{ objectPath: string; formName: string } | undefined> {
  if (node?.nodeKind === 'Form') {
    try {
      const { ownerObjectXmlPath, formName } = resolveObjectFormNodeParts(node, node.textLabel);
      return { objectPath: ownerObjectXmlPath, formName };
    } catch (error) {
      await failCommand(services, 'Не удалось определить объект-владелец формы', error);
      return undefined;
    }
  }
  const objectPath = await pickPath('Выберите XML объекта или каталог объекта');
  if (!objectPath) {
    return undefined;
  }
  const formName = await vscode.window.showInputBox({ title: 'Имя формы для удаления' });
  if (!formName) {
    return undefined;
  }
  return { objectPath, formName };
}

async function pickPath(title: string): Promise<string | undefined> {
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

function afterMutation(changedFiles: readonly string[], services: CommandServices): void {
  services.suppressConfigurationReloadForFiles([...changedFiles]);
  services.markChangedConfigurationByFiles([...changedFiles]);
  // refreshCacheForFiles сам эмитит onDidChangeTreeData; вызывать refresh()
  // дополнительно нужно только если кэш не был обновлён (файлы вне дерева).
  const refreshed = services.treeProvider.refreshCacheForFiles([...changedFiles]);
  if (!refreshed) {
    services.treeProvider.refresh();
  }
  services.refreshActionsView();
}
