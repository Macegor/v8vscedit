import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { findConfigurations } from './ConfigFinder';
import { MetadataTreeProvider } from './MetadataTreeProvider';
import { MetadataNode } from './MetadataNode';

let provider: MetadataTreeProvider | undefined;
let watcher: vscode.FileSystemWatcher | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return;
  }

  const rootPath = workspaceFolders[0].uri.fsPath;

  // Ищем все Configuration.xml в workspace
  const entries = await findConfigurations(rootPath);

  provider = new MetadataTreeProvider(entries, context.extensionUri);

  // Регистрируем TreeView
  const treeView = vscode.window.createTreeView('1cMetadataTree', {
    treeDataProvider: provider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  // Команда: открыть XML-файл объекта метаданных (из контекстного меню)
  context.subscriptions.push(
    vscode.commands.registerCommand('1cNavigator.openXmlFile', (node: { xmlPath?: string }) => {
      if (!node?.xmlPath) {
        return;
      }
      const uri = vscode.Uri.file(node.xmlPath);
      vscode.window.showTextDocument(uri, { preview: false });
    })
  );

  // Команда: открыть модуль общего модуля по клику
  context.subscriptions.push(
    vscode.commands.registerCommand(
      '1cNavigator.openCommonModuleCode',
      async (node: MetadataNode | { xmlPath?: string }) => {
        if (!node || !node.xmlPath) {
          return;
        }

        const xmlDir = path.dirname(node.xmlPath);
        const name = 'label' in node ? String((node as MetadataNode).label) : '';

        const candidates: string[] = [];

        // Вариант 1: глубокая структура
        // CommonModules/Имя/Имя.xml  -> CommonModules/Имя/Ext/Module.bsl
        candidates.push(path.join(xmlDir, 'Ext', 'Module.bsl'));

        // Вариант 2: плоская структура XML
        // CommonModules/Имя.xml -> CommonModules/Имя/Ext/Module.bsl
        if (name) {
          const commonModulesDir = xmlDir;
          candidates.push(path.join(commonModulesDir, name, 'Ext', 'Module.bsl'));
        }

        const modulePath = candidates.find((p) => fs.existsSync(p));
        if (!modulePath) {
          return;
        }

        const uri = vscode.Uri.file(modulePath);
        await vscode.window.showTextDocument(uri, { preview: true });
      }
    )
  );

  // Команда: обновить дерево
  context.subscriptions.push(
    vscode.commands.registerCommand('1cNavigator.refresh', async () => {
      if (!provider) {
        return;
      }
      const newEntries = await findConfigurations(rootPath);
      provider.updateEntries(newEntries);
    })
  );

  // FileSystemWatcher — перестраиваем дерево при изменении Configuration.xml
  watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(workspaceFolders[0], '**/Configuration.xml'),
    false,
    false,
    false
  );

  const onConfigChange = async () => {
    if (!provider) {
      return;
    }
    const newEntries = await findConfigurations(rootPath);
    provider.updateEntries(newEntries);
  };

  watcher.onDidCreate(onConfigChange, null, context.subscriptions);
  watcher.onDidDelete(onConfigChange, null, context.subscriptions);
  watcher.onDidChange(onConfigChange, null, context.subscriptions);
  context.subscriptions.push(watcher);
}

export function deactivate(): void {
  watcher?.dispose();
}
