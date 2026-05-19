import * as vscode from 'vscode';
import type { TemplateType } from '../../../infra/xml';
import type { AddMetadataTarget, MetadataNode } from '../../tree/TreeNode';
import type { CommandServices } from '../_shared';
import {
  getAddMetadataLabel,
  MetadataMutationService,
  validateMetadataName,
} from './MetadataMutationService';

export function registerAddMetadataCommand(
  context: vscode.ExtensionContext,
  services: CommandServices
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('v8vscedit.addMetadata', async (node: MetadataNode | undefined) => {
      await addMetadata(node, services);
    })
  );
}

async function addMetadata(node: MetadataNode | undefined, services: CommandServices): Promise<void> {
  const target = node?.addMetadataTarget;
  if (!target) {
    await vscode.window.showErrorMessage('Для выбранного узла нельзя добавить метаданные.');
    return;
  }

  const name = await promptName(target);
  if (!name) {
    return;
  }
  const templateType = await promptTemplateType(target);
  if (templateType === undefined && isTemplateTarget(target)) {
    return;
  }

  const result = await new MetadataMutationService(services).addMetadata({
    target,
    name,
    templateType,
    sourceNode: node,
  });
  if (!result.success) {
    await vscode.window.showErrorMessage(result.message);
    return;
  }

  void vscode.window.showInformationMessage(result.message);
}

interface TemplateTypePick extends vscode.QuickPickItem {
  readonly value: TemplateType;
}

const TEMPLATE_TYPE_PICKS: readonly TemplateTypePick[] = [
  { value: 'SpreadsheetDocument', label: 'Табличный документ', description: 'Template.xml' },
  { value: 'DataCompositionSchema', label: 'Схема компоновки данных', description: 'Template.xml' },
  { value: 'TextDocument', label: 'Текстовый документ', description: 'Template.txt' },
  { value: 'HTMLDocument', label: 'HTML-документ', description: 'Template.xml + ru.html' },
  { value: 'BinaryData', label: 'Двоичные данные', description: 'Template.bin' },
  { value: 'DataCompositionAppearanceTemplate', label: 'Шаблон оформления компоновки данных', description: 'Template.xml' },
  { value: 'GraphicalSchema', label: 'Графическая схема', description: 'Template.xml' },
  { value: 'AddIn', label: 'Внешняя компонента', description: 'Template.bin' },
];

async function promptTemplateType(target: AddMetadataTarget): Promise<TemplateType | undefined> {
  if (!isTemplateTarget(target)) {
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(TEMPLATE_TYPE_PICKS, {
    title: 'Тип макета',
    placeHolder: 'Выберите тип создаваемого макета',
  });
  return picked?.value;
}

function isTemplateTarget(target: AddMetadataTarget): boolean {
  return (target.kind === 'child' && target.childTag === 'Template')
    || (target.kind === 'root' && target.targetKind === 'CommonTemplate');
}

async function promptName(target: AddMetadataTarget): Promise<string | undefined> {
  const defaultValue = target.kind === 'root' && target.configKind === 'cfe'
    ? target.namePrefix ?? ''
    : '';
  const label = getAddMetadataLabel(target);
  const raw = await vscode.window.showInputBox({
    title: `Добавить: ${label}`,
    prompt: 'Введите имя нового элемента метаданных',
    value: defaultValue,
    validateInput: (value) => validateMetadataName(value),
  });
  if (raw === undefined) {
    return undefined;
  }
  let name = raw.trim();
  if (target.kind === 'root' && target.configKind === 'cfe' && target.namePrefix && !name.startsWith(target.namePrefix)) {
    name = `${target.namePrefix}${name}`;
  }
  return name;
}
