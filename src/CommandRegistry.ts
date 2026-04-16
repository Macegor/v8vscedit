import * as vscode from 'vscode';
import { MetadataTreeProvider } from './MetadataTreeProvider';
import { MetadataNode } from './MetadataNode';
import { PropertiesViewProvider } from './views/PropertiesViewProvider';
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

/**
 * Регистрирует команды расширения и файловый watcher.
 * Поиск конфигураций и обновление дерева делаются через внешний колбэк reloadEntries.
 */
export function registerCommands(
  context: vscode.ExtensionContext,
  provider: MetadataTreeProvider,
  workspaceFolder: vscode.WorkspaceFolder,
  reloadEntries: () => void,
  propertiesViewProvider: PropertiesViewProvider
): void {
  // Открыть XML-файл объекта метаданных
  context.subscriptions.push(
    vscode.commands.registerCommand('1cNavigator.openXmlFile', (node: { xmlPath?: string }) => {
      if (!node?.xmlPath) {
        return;
      }
      const uri = vscode.Uri.file(node.xmlPath);
      vscode.window.showTextDocument(uri, { preview: false });
    })
  );

  // Открыть модуль общего модуля
  context.subscriptions.push(
    vscode.commands.registerCommand(
      '1cNavigator.openCommonModuleCode',
      async (node: MetadataNode | { xmlPath?: string; nodeKind?: string; label?: string }) => {
        const modulePath = getCommonModuleCodePath(node as any);
        if (!modulePath) {
          return;
        }
        const uri = vscode.Uri.file(modulePath);
        await vscode.window.showTextDocument(uri, { preview: true });
      }
    )
  );

  // Открыть модуль объекта
  context.subscriptions.push(
    vscode.commands.registerCommand(
      '1cNavigator.openObjectModule',
      async (node: MetadataNode | { xmlPath?: string; nodeKind?: string; label?: string }) => {
        const modulePath = getObjectModulePath(node as any);
        if (!modulePath) {
          return;
        }
        const uri = vscode.Uri.file(modulePath);
        await vscode.window.showTextDocument(uri, { preview: true });
      }
    )
  );

  // Открыть модуль менеджера
  context.subscriptions.push(
    vscode.commands.registerCommand(
      '1cNavigator.openManagerModule',
      async (node: MetadataNode | { xmlPath?: string; nodeKind?: string; label?: string }) => {
        const modulePath = getManagerModulePath(node as any);
        if (!modulePath) {
          return;
        }
        const uri = vscode.Uri.file(modulePath);
        await vscode.window.showTextDocument(uri, { preview: true });
      }
    )
  );

  // Открыть модуль константы
  context.subscriptions.push(
    vscode.commands.registerCommand(
      '1cNavigator.openConstantModule',
      async (node: MetadataNode | { xmlPath?: string; nodeKind?: string; label?: string }) => {
        const modulePath = getConstantModulePath(node as any);
        if (!modulePath) {
          return;
        }
        const uri = vscode.Uri.file(modulePath);
        await vscode.window.showTextDocument(uri, { preview: true });
      }
    )
  );

  // Открыть модуль сервиса (Web/HTTP)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      '1cNavigator.openServiceModule',
      async (node: MetadataNode | { xmlPath?: string; nodeKind?: string; label?: string }) => {
        const modulePath = getServiceModulePath(node as any);
        if (!modulePath) {
          return;
        }
        const uri = vscode.Uri.file(modulePath);
        await vscode.window.showTextDocument(uri, { preview: true });
      }
    )
  );

  // Открыть модуль формы (общей или объектной)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      '1cNavigator.openFormModule',
      async (node: MetadataNode | { xmlPath?: string; nodeKind?: string; label?: string }) => {
        const modulePath =
          (node as any)?.nodeKind === 'CommonForm'
            ? getCommonFormModulePath(node as any)
            : getFormModulePathForChild(node as any);
        if (!modulePath) {
          return;
        }
        const uri = vscode.Uri.file(modulePath);
        await vscode.window.showTextDocument(uri, { preview: true });
      }
    )
  );

  // Открыть модуль команды (общей или объектной)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      '1cNavigator.openCommandModule',
      async (node: MetadataNode | { xmlPath?: string; nodeKind?: string; label?: string }) => {
        const modulePath =
          (node as any)?.nodeKind === 'CommonCommand'
            ? getCommonCommandModulePath(node as any)
            : getCommandModulePathForChild(node as any);
        if (!modulePath) {
          return;
        }
        const uri = vscode.Uri.file(modulePath);
        await vscode.window.showTextDocument(uri, { preview: true });
      }
    )
  );

  // Обновить дерево конфигураций
  context.subscriptions.push(
    vscode.commands.registerCommand('1cNavigator.refresh', async () => {
      reloadEntries();
    })
  );

  // Открыть вкладку свойств для выбранного узла
  context.subscriptions.push(
    vscode.commands.registerCommand(
      '1cNavigator.showProperties',
      (node: MetadataNode | undefined) => {
        if (!node) {
          return;
        }
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

  const onConfigChange = () => {
    reloadEntries();
  };

  watcher.onDidCreate(onConfigChange, null, context.subscriptions);
  watcher.onDidDelete(onConfigChange, null, context.subscriptions);
  watcher.onDidChange(onConfigChange, null, context.subscriptions);
  context.subscriptions.push(watcher);
}

