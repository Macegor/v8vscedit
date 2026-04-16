import * as vscode from 'vscode';
import { MetadataTreeProvider } from './MetadataTreeProvider';
import { MetadataNode } from './MetadataNode';
import { PropertiesViewProvider } from './views/PropertiesViewProvider';
import { OnecFileSystemProvider } from './OnecFileSystemProvider';
import { buildVirtualUri, buildFormModuleVirtualUri } from './OnecUriBuilder';
import { SupportInfoService } from './services/SupportInfoService';
import {
  getCommonCommandModulePath,
  getCommonFormModulePath,
  getCommandModulePathForChild,
  getCommonModuleCodePath,
  getConstantModulePath,
  getFormModulePathForChild,
  getManagerModulePath,
  getObjectModulePath,
  getServiceModulePath,
} from './ModulePathResolver';

type NodeArg = MetadataNode | { xmlPath?: string; nodeKind?: string; label?: string };

/**
 * Открывает BSL-модуль и блокирует редактирование для объектов на поддержке.
 *
 * @param ownerXmlPath — путь к XML-файлу объекта-владельца (из дерева).
 *   Используется для проверки поддержки ВМЕСТО обратного ресолва из BSL.
 *   Для onec:// readonly ставится через stat() (permissions).
 *   Для file:// — через setEditorReadonlyInSession.
 */
async function openModule(
  fsp: OnecFileSystemProvider,
  modulePath: string,
  virtualUri: vscode.Uri | null,
  supportService: SupportInfoService | undefined,
  ownerXmlPath: string | undefined,
  preview = true
): Promise<void> {
  const locked = ownerXmlPath ? supportService?.isLocked(ownerXmlPath) : false;
  let editor: vscode.TextEditor;

  if (virtualUri) {
    fsp.register(virtualUri, modulePath);
    // Сообщаем FSP о связи модуля с его владельцем для корректного stat()
    if (ownerXmlPath) {
      fsp.registerOwnerXml(virtualUri, ownerXmlPath);
    }
    const doc = await vscode.workspace.openTextDocument(virtualUri);
    await vscode.languages.setTextDocumentLanguage(doc, 'bsl');
    editor = await vscode.window.showTextDocument(doc, { preview });
  } else {
    editor = await vscode.window.showTextDocument(vscode.Uri.file(modulePath), { preview });
  }

  // Для обеих схем: если объект заблокирован, ставим readonly через команду
  if (locked) {
    await setEditorReadonly(editor);
  }
}

/** Помечает активный редактор как readonly в текущей сессии */
async function setEditorReadonly(editor: vscode.TextEditor): Promise<void> {
  await vscode.window.showTextDocument(editor.document, { viewColumn: editor.viewColumn });
  await vscode.commands.executeCommand('workbench.action.files.setActiveEditorReadonlyInSession');
}

/**
 * Регистрирует команды расширения и файловый watcher.
 */
export function registerCommands(
  context: vscode.ExtensionContext,
  provider: MetadataTreeProvider,
  workspaceFolder: vscode.WorkspaceFolder,
  reloadEntries: () => void,
  propertiesViewProvider: PropertiesViewProvider,
  fsp: OnecFileSystemProvider,
  supportService?: SupportInfoService
): void {
  // Открыть XML-файл объекта метаданных
  context.subscriptions.push(
    vscode.commands.registerCommand('1cNavigator.openXmlFile', async (node: { xmlPath?: string }) => {
      if (!node?.xmlPath) { return; }
      const editor = await vscode.window.showTextDocument(
        vscode.Uri.file(node.xmlPath),
        { preview: false }
      );
      if (supportService?.isLocked(node.xmlPath)) {
        await setEditorReadonly(editor);
      }
    })
  );

  // Открыть модуль общего модуля
  context.subscriptions.push(
    vscode.commands.registerCommand('1cNavigator.openCommonModuleCode', async (node: NodeArg) => {
      const modulePath = getCommonModuleCodePath(node as any);
      if (!modulePath) { return; }
      const xmlPath = (node as any).xmlPath as string | undefined;
      const vUri = xmlPath ? buildVirtualUri(xmlPath, 'module') : null;
      await openModule(fsp, modulePath, vUri, supportService, xmlPath);
    })
  );

  // Открыть модуль объекта
  context.subscriptions.push(
    vscode.commands.registerCommand('1cNavigator.openObjectModule', async (node: NodeArg) => {
      const modulePath = getObjectModulePath(node as any);
      if (!modulePath) { return; }
      const xmlPath = (node as any).xmlPath as string | undefined;
      const vUri = xmlPath ? buildVirtualUri(xmlPath, 'objectModule') : null;
      await openModule(fsp, modulePath, vUri, supportService, xmlPath);
    })
  );

  // Открыть модуль менеджера
  context.subscriptions.push(
    vscode.commands.registerCommand('1cNavigator.openManagerModule', async (node: NodeArg) => {
      const modulePath = getManagerModulePath(node as any);
      if (!modulePath) { return; }
      const xmlPath = (node as any).xmlPath as string | undefined;
      const vUri = xmlPath ? buildVirtualUri(xmlPath, 'managerModule') : null;
      await openModule(fsp, modulePath, vUri, supportService, xmlPath);
    })
  );

  // Открыть модуль константы
  context.subscriptions.push(
    vscode.commands.registerCommand('1cNavigator.openConstantModule', async (node: NodeArg) => {
      const modulePath = getConstantModulePath(node as any);
      if (!modulePath) { return; }
      const xmlPath = (node as any).xmlPath as string | undefined;
      const vUri = xmlPath ? buildVirtualUri(xmlPath, 'valueManagerModule') : null;
      await openModule(fsp, modulePath, vUri, supportService, xmlPath);
    })
  );

  // Открыть модуль сервиса (Web/HTTP)
  context.subscriptions.push(
    vscode.commands.registerCommand('1cNavigator.openServiceModule', async (node: NodeArg) => {
      const modulePath = getServiceModulePath(node as any);
      if (!modulePath) { return; }
      const xmlPath = (node as any).xmlPath as string | undefined;
      const vUri = xmlPath ? buildVirtualUri(xmlPath, 'module') : null;
      await openModule(fsp, modulePath, vUri, supportService, xmlPath);
    })
  );

  // Открыть модуль формы (общей или объектной)
  context.subscriptions.push(
    vscode.commands.registerCommand('1cNavigator.openFormModule', async (node: NodeArg) => {
      const nodeAny = node as any;
      const isCommonForm = nodeAny?.nodeKind === 'CommonForm';
      const modulePath = isCommonForm
        ? getCommonFormModulePath(nodeAny)
        : getFormModulePathForChild(nodeAny);
      if (!modulePath) { return; }

      const xmlPath = nodeAny.xmlPath as string | undefined;
      let vUri: vscode.Uri | null = null;
      if (xmlPath) {
        vUri = isCommonForm
          ? buildVirtualUri(xmlPath, 'module')
          : buildFormModuleVirtualUri(xmlPath, String(nodeAny.label ?? ''));
      }
      await openModule(fsp, modulePath, vUri, supportService, xmlPath);
    })
  );

  // Открыть модуль команды (общей или объектной)
  context.subscriptions.push(
    vscode.commands.registerCommand('1cNavigator.openCommandModule', async (node: NodeArg) => {
      const nodeAny = node as any;
      const isCommonCommand = nodeAny?.nodeKind === 'CommonCommand';
      const modulePath = isCommonCommand
        ? getCommonCommandModulePath(nodeAny)
        : getCommandModulePathForChild(nodeAny);
      if (!modulePath) { return; }

      const xmlPath = nodeAny.xmlPath as string | undefined;
      const vUri = xmlPath ? buildVirtualUri(xmlPath, 'commandModule') : null;
      await openModule(fsp, modulePath, vUri, supportService, xmlPath);
    })
  );

  // Обновить дерево конфигураций
  context.subscriptions.push(
    vscode.commands.registerCommand('1cNavigator.refresh', () => {
      reloadEntries();
    })
  );

  // Открыть вкладку свойств для выбранного узла
  context.subscriptions.push(
    vscode.commands.registerCommand(
      '1cNavigator.showProperties',
      (node: MetadataNode | undefined) => {
        if (!node) { return; }
        propertiesViewProvider.show(node);
      }
    )
  );

  // FileSystemWatcher — перестраиваем дерево при изменении Configuration.xml
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(workspaceFolder, '**/Configuration.xml'),
    false,
    false,
    false
  );

  const onConfigChange = () => { reloadEntries(); };
  watcher.onDidCreate(onConfigChange, null, context.subscriptions);
  watcher.onDidDelete(onConfigChange, null, context.subscriptions);
  watcher.onDidChange(onConfigChange, null, context.subscriptions);
  context.subscriptions.push(watcher);
}
