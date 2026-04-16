import * as path from 'path';
import * as vscode from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';
import { findConfigurations } from './ConfigFinder';
import { MetadataTreeProvider } from './MetadataTreeProvider';
import { registerCommands } from './CommandRegistry';
import { PropertiesViewProvider } from './views/PropertiesViewProvider';
import { OnecFileSystemProvider, ONEC_SCHEME } from './OnecFileSystemProvider';

let client: LanguageClient | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return;
  }

  const workspaceFolder = workspaceFolders[0];
  const rootPath = workspaceFolder.uri.fsPath;

  // ── Навигатор метаданных ────────────────────────────────────────────────
  const fsp = new OnecFileSystemProvider();
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider(ONEC_SCHEME, fsp, {
      isCaseSensitive: false,
      isReadonly: false,
    })
  );

  const provider = new MetadataTreeProvider([], context.extensionUri);
  const propertiesViewProvider = new PropertiesViewProvider();
  context.subscriptions.push(propertiesViewProvider);

  const treeView = vscode.window.createTreeView('1cMetadataTree', {
    treeDataProvider: provider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  const reloadEntries = () => {
    findConfigurations(rootPath).then((entries) => {
      provider.updateEntries(entries);
    });
  };

  registerCommands(context, provider, workspaceFolder, reloadEntries, propertiesViewProvider, fsp);
  reloadEntries();

  // ── LSP-сервер языковой поддержки BSL ──────────────────────────────────
  const serverModule = context.asAbsolutePath(path.join('dist', 'server.js'));

  const serverOptions: ServerOptions = {
    run: {
      module: serverModule,
      transport: TransportKind.ipc,
    },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      // Порт 6009 для подключения отладчика к серверному процессу
      options: { execArgv: ['--nolazy', '--inspect=6009'] },
    },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: 'file', language: 'bsl' },
      { scheme: ONEC_SCHEME, language: 'bsl' },
    ],
    synchronize: {
      fileEvents: vscode.workspace.createFileSystemWatcher('**/*.bsl'),
    },
  };

  client = new LanguageClient(
    'bsl-language-server',
    '1C BSL Language Server',
    serverOptions,
    clientOptions,
  );

  client.start().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`1С BSL: ошибка запуска языкового сервера: ${msg}`);
  });

  context.subscriptions.push({ dispose: () => { client?.stop(); } });
}

export function deactivate(): Promise<void> | undefined {
  return client?.stop();
}
