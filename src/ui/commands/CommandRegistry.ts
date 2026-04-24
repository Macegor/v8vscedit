import * as vscode from 'vscode';
import { MetadataTreeProvider } from '../tree/MetadataTreeProvider';
import { MetadataNode } from '../tree/TreeNode';
import { PropertiesViewProvider } from '../views/PropertiesViewProvider';
import { OnecFileSystemProvider } from '../vfs/OnecFileSystemProvider';
import { buildVirtualUri, buildFormModuleVirtualUri } from '../vfs/OnecUriBuilder';
import { SupportInfoService } from '../../infra/support/SupportInfoService';
import {
  extractExtensionTarget,
  runCompileExtension,
  runDecompileExtension,
  runUpdateExtension,
} from './ext/ExtensionCommandRunner';
import {
  getCommonCommandModulePath,
  getCommonFormModulePath,
  getCommandModulePathForChild,
  ensureCommonModuleCodePath,
  getCommonModuleCodePath,
  getConstantModulePath,
  getFormModulePathForChild,
  getManagerModulePath,
  getObjectModulePath,
  getServiceModulePath,
} from '../../infra/fs/MetaPathResolver';

type NodeArg = MetadataNode | { xmlPath?: string; nodeKind?: string; label?: string };

interface ActionItem extends vscode.QuickPickItem {
  actionId: 'decompileext' | 'compileext' | 'updateext' | 'compileAndUpdateExt';
}

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

  const lspMode = vscode.workspace.getConfiguration('v8vscedit.lsp').get<string>('mode', 'bsl-analyzer');
  const useVfs = lspMode === 'built-in';

  if (useVfs && virtualUri) {
    fsp.register(virtualUri, modulePath);
    if (ownerXmlPath) {
      fsp.registerOwnerXml(virtualUri, ownerXmlPath);
    }
    const doc = await vscode.workspace.openTextDocument(virtualUri);
    await vscode.languages.setTextDocumentLanguage(doc, 'bsl');
    editor = await vscode.window.showTextDocument(doc, { preview });
  } else {
    editor = await vscode.window.showTextDocument(vscode.Uri.file(modulePath), { preview });
  }

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
  outputChannel: vscode.OutputChannel,
  supportService?: SupportInfoService
): void {
  // Открыть XML-файл объекта метаданных
  context.subscriptions.push(
    vscode.commands.registerCommand('v8vscedit.openXmlFile', async (node: { xmlPath?: string }) => {
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
    vscode.commands.registerCommand('v8vscedit.openCommonModuleCode', async (node: NodeArg) => {
      const modulePath = getCommonModuleCodePath(node as any) ?? ensureCommonModuleCodePath(node as any);
      if (!modulePath) { return; }
      const xmlPath = (node as any).xmlPath as string | undefined;
      const vUri = xmlPath ? buildVirtualUri(xmlPath, 'module') : null;
      await openModule(fsp, modulePath, vUri, supportService, xmlPath);
    })
  );

  // Открыть модуль объекта
  context.subscriptions.push(
    vscode.commands.registerCommand('v8vscedit.openObjectModule', async (node: NodeArg) => {
      const modulePath = getObjectModulePath(node as any);
      if (!modulePath) { return; }
      const xmlPath = (node as any).xmlPath as string | undefined;
      const vUri = xmlPath ? buildVirtualUri(xmlPath, 'objectModule') : null;
      await openModule(fsp, modulePath, vUri, supportService, xmlPath);
    })
  );

  // Открыть модуль менеджера
  context.subscriptions.push(
    vscode.commands.registerCommand('v8vscedit.openManagerModule', async (node: NodeArg) => {
      const modulePath = getManagerModulePath(node as any);
      if (!modulePath) { return; }
      const xmlPath = (node as any).xmlPath as string | undefined;
      const vUri = xmlPath ? buildVirtualUri(xmlPath, 'managerModule') : null;
      await openModule(fsp, modulePath, vUri, supportService, xmlPath);
    })
  );

  // Открыть модуль константы
  context.subscriptions.push(
    vscode.commands.registerCommand('v8vscedit.openConstantModule', async (node: NodeArg) => {
      const modulePath = getConstantModulePath(node as any);
      if (!modulePath) { return; }
      const xmlPath = (node as any).xmlPath as string | undefined;
      const vUri = xmlPath ? buildVirtualUri(xmlPath, 'valueManagerModule') : null;
      await openModule(fsp, modulePath, vUri, supportService, xmlPath);
    })
  );

  // Открыть модуль сервиса (Web/HTTP)
  context.subscriptions.push(
    vscode.commands.registerCommand('v8vscedit.openServiceModule', async (node: NodeArg) => {
      const modulePath = getServiceModulePath(node as any);
      if (!modulePath) { return; }
      const xmlPath = (node as any).xmlPath as string | undefined;
      const vUri = xmlPath ? buildVirtualUri(xmlPath, 'module') : null;
      await openModule(fsp, modulePath, vUri, supportService, xmlPath);
    })
  );

  // Открыть модуль формы (общей или объектной)
  context.subscriptions.push(
    vscode.commands.registerCommand('v8vscedit.openFormModule', async (node: NodeArg) => {
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
    vscode.commands.registerCommand('v8vscedit.openCommandModule', async (node: NodeArg) => {
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
    vscode.commands.registerCommand('v8vscedit.refresh', () => {
      reloadEntries();
    })
  );

  // Открыть вкладку свойств для выбранного узла
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'v8vscedit.showProperties',
      (node: MetadataNode | undefined) => {
        if (!node) { return; }
        propertiesViewProvider.show(node);
      }
    )
  );

  // Меню действий над корневой конфигурацией/расширением
  context.subscriptions.push(
    vscode.commands.registerCommand('v8vscedit.showConfigActions', async (node: NodeArg) => {
      const nodeKind = node?.nodeKind;
      const xmlPath = node?.xmlPath;
      if (!nodeKind || !xmlPath) {
        return;
      }

      const isExtension = nodeKind === 'extension';
      const targetLabel = String((node as MetadataNode).label ?? '');

      const actions: ActionItem[] = [];
      if (isExtension) {
        actions.push({
          actionId: 'decompileext',
          label: '$(cloud-download) Импортировать',
        });
        actions.push({
          actionId: 'updateext',
          label: '$(sync) Обновить (быстро: нужен Git)',
        });
        actions.push({
          actionId: 'compileAndUpdateExt',
          label: '$(run-all) Полное обновление',
        });
      }

      if (actions.length === 0) {
        vscode.window.showInformationMessage(`Для "${targetLabel}" пока нет доступных команд.`);
        return;
      }

      const picked = await vscode.window.showQuickPick(actions, {
        title: `Команды: ${targetLabel}`,
        placeHolder: 'Выберите действие',
      });
      if (!picked) {
        return;
      }

      if (picked.actionId === 'decompileext') {
        await vscode.commands.executeCommand(
          'v8vscedit.decompileExtensionSources',
          node
        );
      } else if (picked.actionId === 'updateext') {
        await vscode.commands.executeCommand(
          'v8vscedit.updateExtensionInDb',
          node
        );
      } else if (picked.actionId === 'compileAndUpdateExt') {
        await vscode.commands.executeCommand(
          'v8vscedit.compileAndUpdateExtensionInDb',
          node
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('v8vscedit.decompileExtensionSources', async (node: NodeArg) => {
      const target = extractExtensionTarget(node);
      if (!target) {
        vscode.window.showWarningMessage('Команда доступна только для корневого узла расширения.');
        return;
      }

      await runDecompileExtension(target.extensionName, target.extensionRoot, workspaceFolder, outputChannel);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('v8vscedit.compileExtensionToDb', async (node: NodeArg) => {
      const target = extractExtensionTarget(node);
      if (!target) {
        vscode.window.showWarningMessage('Команда доступна только для корневого узла расширения.');
        return;
      }

      await runCompileExtension(target.extensionName, target.extensionRoot, workspaceFolder, outputChannel);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('v8vscedit.updateExtensionInDb', async (node: NodeArg) => {
      const target = extractExtensionTarget(node);
      if (!target) {
        vscode.window.showWarningMessage('Команда доступна только для корневого узла расширения.');
        return;
      }

      await runUpdateExtension(target.extensionName, target.extensionRoot, workspaceFolder, outputChannel);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('v8vscedit.compileAndUpdateExtensionInDb', async (node: NodeArg) => {
      const target = extractExtensionTarget(node);
      if (!target) {
        vscode.window.showWarningMessage('Команда доступна только для корневого узла расширения.');
        return;
      }

      const compiled = await runCompileExtension(
        target.extensionName,
        target.extensionRoot,
        workspaceFolder,
        outputChannel,
        false
      );
      if (!compiled) {
        return;
      }
      const updated = await runUpdateExtension(
        target.extensionName,
        target.extensionRoot,
        workspaceFolder,
        outputChannel,
        false
      );
      if (!updated) {
        return;
      }

      await vscode.window.showInformationMessage(
        `Загрузка и обновление расширения "${target.extensionName}" в БД успешно завершены.`,
        { modal: true }
      );
    })
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
