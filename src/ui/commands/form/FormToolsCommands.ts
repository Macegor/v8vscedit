import * as vscode from 'vscode';
import * as path from 'path';
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

async function showFormInfo(node: MetadataNode | undefined, services: CommandServices): Promise<void> {
  const formPath = node?.xmlPath ?? await pickPath('Выберите Form.xml, XML формы или каталог формы');
  if (!formPath) {
    return;
  }
  const result = services.formToolsService.info({ formPath, limit: 1000 });
  await openReport(`Форма: ${result.title}`, result.lines.join('\n'));
}

async function validateForm(node: MetadataNode | undefined, services: CommandServices): Promise<void> {
  const formPath = node?.xmlPath ?? await pickPath('Выберите Form.xml, XML формы или каталог формы');
  if (!formPath) {
    return;
  }
  const result = services.formToolsService.validate({ formPath, detailed: true, maxErrors: 100 });
  await openReport(`Валидация формы: ${result.errors} ошибок`, result.lines.join('\n'));
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
    await vscode.window.showErrorMessage(`Не удалось добавить форму: ${String(error)}`);
  }
}

async function removeForm(node: MetadataNode | undefined, services: CommandServices): Promise<void> {
  const objectPath = node?.nodeKind === 'Form' && node.xmlPath ? resolveOwnerObjectXml(node.xmlPath) : await pickPath('Выберите XML объекта или каталог объекта');
  if (!objectPath) {
    return;
  }
  const formName = node?.nodeKind === 'Form' ? String(node.label) : await vscode.window.showInputBox({ title: 'Имя формы для удаления' });
  if (!formName) {
    return;
  }
  try {
    const result = services.formToolsService.removeForm({ objectPath, formName });
    afterMutation(result.changedFiles, services);
    await vscode.window.showInformationMessage(`Форма ${formName} удалена.`);
  } catch (error) {
    await vscode.window.showErrorMessage(`Не удалось удалить форму: ${String(error)}`);
  }
}

function resolveOwnerObjectXml(formDescriptorPath: string): string {
  const formsDir = path.dirname(formDescriptorPath);
  const objectDir = path.dirname(formsDir);
  return `${objectDir}.xml`;
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
  services.treeProvider.refresh();
  services.refreshActionsView();
}
