import * as vscode from 'vscode';
import { findConfigurations, ConfigEntry } from './ConfigFinder';
import { MetadataTreeProvider } from './MetadataTreeProvider';
import { registerCommands } from './CommandRegistry';
import { BslParserService } from './language/BslParserService';
import { registerBslLanguage } from './language/BslLanguageRegistrar';

export function activate(context: vscode.ExtensionContext): void {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return;
  }

  const workspaceFolder = workspaceFolders[0];
  const rootPath = workspaceFolder.uri.fsPath;

  const provider = new MetadataTreeProvider([], context.extensionUri);

  const treeView = vscode.window.createTreeView('1cMetadataTree', {
    treeDataProvider: provider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  // Мутируемый список конфигураций — нужен CompletionProvider
  let currentEntries: ConfigEntry[] = [];

  const reloadEntries = () => {
    findConfigurations(rootPath).then((entries) => {
      currentEntries = entries;
      provider.updateEntries(entries);
    });
  };

  registerCommands(context, provider, workspaceFolder, reloadEntries);

  reloadEntries();

  // BSL language support — парсер инициализируется немедленно при активации,
  // до открытия первого файла, чтобы подсветка появилась сразу без задержки.
  const parserService = new BslParserService(context);
  context.subscriptions.push(parserService);

  parserService.ensureInit()
    .then(() => registerBslLanguage(context, parserService, () => currentEntries))
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`1С BSL: ошибка инициализации парсера: ${msg}`);
    });
}

export function deactivate(): void {
  // Все ресурсы освобождаются через context.subscriptions.
}
