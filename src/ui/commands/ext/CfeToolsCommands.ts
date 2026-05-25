import * as path from 'path';
import * as vscode from 'vscode';
import { META_TYPES } from '../../../domain/MetaTypes';
import type { ModuleSlot } from '../../../domain/ModuleSlot';
import { getObjectLocationFromXml } from '../../../infra/fs/MetaPathResolver';
import { parseConfigXml } from '../../../infra/xml';
import type { ConfigEntry } from '../../../domain/Configuration';
import type { MetadataNode } from '../../tree/TreeNode';
import type { CommandServices } from '../_shared';

type InterceptorPick = 'Before' | 'After' | 'ModificationAndControl';

const SLOT_TO_MODULE_PATH: Record<ModuleSlot, string> = {
  CommonModule: '',
  Object: 'ObjectModule',
  Manager: 'ManagerModule',
  ValueManager: 'ValueManagerModule',
  Service: 'Module',
  CommonCommand: 'CommandModule',
  CommonForm: 'Form',
  ChildForm: 'Form',
  ChildCommand: 'CommandModule',
  RecordSet: 'RecordSetModule',
};

export function registerCfeToolsCommands(context: vscode.ExtensionContext, services: CommandServices): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('v8vscedit.cfe.addMethodInterceptor', async (node: MetadataNode | undefined) => {
      await addMethodInterceptor(node, services);
    }),
    vscode.commands.registerCommand('v8vscedit.cfe.analyzeExtension', async (node: MetadataNode | undefined) => {
      await analyzeExtension(node, services);
    })
  );
}

async function addMethodInterceptor(node: MetadataNode | undefined, services: CommandServices): Promise<void> {
  const extensionEntry = await pickExtensionEntry(services, node);
  if (!extensionEntry) {
    return;
  }

  const modulePath = await resolveModulePath(node) ?? await vscode.window.showInputBox({
    title: 'ModulePath для перехватчика',
    prompt: 'Например: Catalog.Товары.ObjectModule или Document.Заказ.Form.ФормаДокумента',
  });
  if (!modulePath) {
    return;
  }

  const methodName = await vscode.window.showInputBox({
    title: 'Имя оригинального метода',
    prompt: 'Например: ПередЗаписью',
    validateInput: (value) => /^[\p{L}_][\p{L}\p{Nd}_]*$/u.test(value.trim())
      ? undefined
      : 'Имя метода должно начинаться с буквы и содержать только буквы, цифры и подчёркивание.',
  });
  if (!methodName) {
    return;
  }

  const interceptorType = await vscode.window.showQuickPick(
    [
      { label: 'Before', description: '&Перед' },
      { label: 'After', description: '&После' },
      { label: 'ModificationAndControl', description: '&ИзменениеИКонтроль' },
    ],
    { title: 'Тип перехватчика' }
  );
  if (!interceptorType) {
    return;
  }

  const contextPick = await vscode.window.showQuickPick(
    ['НаСервере', 'НаКлиенте', 'НаСервереБезКонтекста'],
    { title: 'Контекст выполнения' }
  );
  if (!contextPick) {
    return;
  }

  const kindPick = await vscode.window.showQuickPick(
    ['Процедура', 'Функция'],
    { title: 'Тип метода' }
  );
  if (!kindPick) {
    return;
  }

  try {
    const result = services.cfePatchMethodService.addMethodInterceptor({
      extensionPath: extensionEntry.rootPath,
      modulePath,
      methodName,
      interceptorType: interceptorType.label as InterceptorPick,
      context: contextPick,
      isFunction: kindPick === 'Функция',
    });
    for (const warning of result.warnings) {
      services.outputChannel.appendLine(`[cfe-patch][warn] ${warning}`);
    }
    services.markChangedConfigurationByFiles([...result.changedFiles]);
    services.refreshActionsView();
    const doc = await vscode.workspace.openTextDocument(result.moduleFilePath);
    await vscode.window.showTextDocument(doc);
    void vscode.window.showInformationMessage(`Перехватчик ${result.procedureName} добавлен.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await vscode.window.showErrorMessage(`Не удалось добавить перехватчик: ${message}`);
  }
}

async function analyzeExtension(node: MetadataNode | undefined, services: CommandServices): Promise<void> {
  const extensionEntry = await pickExtensionEntry(services, node);
  if (!extensionEntry) {
    return;
  }
  const mode = await vscode.window.showQuickPick(
    [
      { label: 'overview', description: 'Состав расширения и перехватчики' },
      { label: 'transfer', description: 'Проверка переноса блоков #Вставка' },
    ],
    { title: 'Режим анализа расширения' }
  );
  if (!mode) {
    return;
  }

  const cfEntry = mode.label === 'transfer'
    ? services.treeProvider.getEntries().find((entry) => entry.kind === 'cf')
    : undefined;
  const result = services.cfeDiffService.analyze({
    extensionPath: extensionEntry.rootPath,
    configPath: cfEntry?.rootPath,
    mode: mode.label === 'transfer' ? 'transfer' : 'overview',
  });
  const doc = await vscode.workspace.openTextDocument({
    language: 'json',
    content: JSON.stringify(result, null, 2),
  });
  await vscode.window.showTextDocument(doc);
}

async function pickExtensionEntry(
  services: CommandServices,
  node: MetadataNode | undefined
): Promise<ConfigEntry | undefined> {
  const entries = services.treeProvider.getEntries().filter((entry) => entry.kind === 'cfe');
  if (entries.length === 0) {
    await vscode.window.showWarningMessage('В проекте нет расширений CFE.');
    return undefined;
  }

  const nodePath = node?.metaContext?.ownerObjectXmlPath ?? node?.xmlPath;
  const nodeEntry = nodePath
    ? entries.find((entry) => isInside(nodePath, entry.rootPath))
    : undefined;
  if (nodeEntry) {
    return nodeEntry;
  }
  if (entries.length === 1) {
    return entries[0];
  }

  const picked = await vscode.window.showQuickPick(
    entries.map((entry) => ({
      label: readConfigName(entry),
      description: entry.rootPath,
      entry,
    })),
    { title: 'Выберите расширение' }
  );
  return picked?.entry;
}

async function resolveModulePath(node: MetadataNode | undefined): Promise<string | undefined> {
  if (!node?.xmlPath) {
    return undefined;
  }

  if (node.nodeKind === 'Form' && node.metaContext?.ownerObjectXmlPath) {
    const owner = getObjectLocationFromXml(node.metaContext.ownerObjectXmlPath);
    return `${node.metaContext.rootMetaKind}.${owner.objectName}.Form.${node.textLabel}`;
  }

  const def = META_TYPES[node.nodeKind];
  const modules = def.modules ?? [];
  if (modules.length === 0) {
    return undefined;
  }
  const location = getObjectLocationFromXml(node.xmlPath);
  const slot = modules.length === 1
    ? modules[0]
    : await pickModuleSlot(modules);
  if (!slot) {
    return undefined;
  }
  if (slot === 'CommonModule') {
    return `CommonModule.${node.textLabel}`;
  }
  const suffix = SLOT_TO_MODULE_PATH[slot];
  return suffix ? `${node.nodeKind}.${location.objectName}.${suffix}` : `${node.nodeKind}.${location.objectName}`;
}

async function pickModuleSlot(slots: readonly ModuleSlot[]): Promise<ModuleSlot | undefined> {
  const picked = await vscode.window.showQuickPick(
    slots.map((slot) => ({ label: slot, slot })),
    { title: 'Выберите модуль' }
  );
  return picked?.slot;
}

function readConfigName(entry: ConfigEntry): string {
  try {
    return parseConfigXml(path.join(entry.rootPath, 'Configuration.xml')).name || path.basename(entry.rootPath);
  } catch {
    return path.basename(entry.rootPath);
  }
}

function isInside(filePath: string, rootPath: string): boolean {
  const rel = path.relative(path.resolve(rootPath), path.resolve(filePath));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
