import * as path from 'path';
import * as vscode from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';
import { findConfigurations } from './ConfigFinder';
import { MetadataTreeProvider } from './MetadataTreeProvider';
import { registerCommands } from './CommandRegistry';
import { PropertiesViewProvider } from './views/PropertiesViewProvider';
import { OnecFileSystemProvider, ONEC_SCHEME } from './OnecFileSystemProvider';
import { SupportInfoService } from './services/SupportInfoService';
import { SupportDecorationProvider } from './services/SupportDecorationProvider';

let client: LanguageClient | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return;
  }

  const workspaceFolder = workspaceFolders[0];
  const rootPath = workspaceFolder.uri.fsPath;

  // ── Канал логирования ───────────────────────────────────────────────────
  const outputChannel = vscode.window.createOutputChannel('1С Навигатор');
  context.subscriptions.push(outputChannel);
  outputChannel.appendLine('[init] Расширение активировано');

  // ── Сервис поддержки 1С ─────────────────────────────────────────────────
  const supportService = new SupportInfoService(outputChannel);

  // ── Декорации поддержки в дереве ────────────────────────────────────────
  const decorationProvider = new SupportDecorationProvider();
  context.subscriptions.push(
    vscode.window.registerFileDecorationProvider(decorationProvider),
    decorationProvider
  );

  // Watcher: при изменении ParentConfigurations.bin сбрасываем кэш и обновляем дерево
  const supportWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(workspaceFolder, '**/Ext/ParentConfigurations.bin'),
    false,
    false,
    false
  );
  const onSupportFileChange = (uri: vscode.Uri) => {
    const extDir = path.dirname(uri.fsPath);
    const configRoot = path.dirname(extDir);
    supportService.invalidate(configRoot);
    supportService.loadConfig(configRoot);
    provider.refresh();
    decorationProvider.fireRefresh();
  };
  const onSupportFileDelete = (uri: vscode.Uri) => {
    const extDir = path.dirname(uri.fsPath);
    const configRoot = path.dirname(extDir);
    supportService.invalidate(configRoot);
    provider.refresh();
    decorationProvider.fireRefresh();
  };
  supportWatcher.onDidCreate(onSupportFileChange, null, context.subscriptions);
  supportWatcher.onDidChange(onSupportFileChange, null, context.subscriptions);
  supportWatcher.onDidDelete(onSupportFileDelete, null, context.subscriptions);
  context.subscriptions.push(supportWatcher);

  // ── Виртуальная файловая система onec:// ────────────────────────────────
  const fsp = new OnecFileSystemProvider();
  fsp.setSupportService(supportService);
  fsp.setOutputChannel(outputChannel);
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider(ONEC_SCHEME, fsp, {
      isCaseSensitive: false,
      isReadonly: false,
    })
  );

  // ── Навигатор метаданных ────────────────────────────────────────────────
  const provider = new MetadataTreeProvider([], context.extensionUri, supportService);
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
      outputChannel.appendLine(`[init] Найдено конфигураций: ${entries.length}`);
    });
  };

  registerCommands(context, provider, workspaceFolder, reloadEntries, propertiesViewProvider, fsp, supportService);

  // ── Readonly для BSL-файлов, открытых напрямую из ФС (схема file://) ───
  // Для onec:// readonly обеспечивается через stat() → permissions.
  // Для file:// нужно явно переключать editor в readonly-режим.
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(async (doc) => {
      if (doc.uri.scheme !== 'file') { return; }
      if (!doc.fileName.toLowerCase().endsWith('.bsl')) { return; }
      if (!supportService.isLocked(doc.fileName)) { return; }

      outputChannel.appendLine(`[readonly] Блокировка file:// BSL: ${path.basename(doc.fileName)}`);

      // Ждём, когда VS Code покажет редактор для этого документа
      const disposable = vscode.window.onDidChangeVisibleTextEditors(async (editors) => {
        const editor = editors.find(
          (e) => e.document.uri.toString() === doc.uri.toString()
        );
        if (!editor) { return; }
        disposable.dispose();
        await vscode.window.showTextDocument(editor.document, { viewColumn: editor.viewColumn, preserveFocus: false });
        await vscode.commands.executeCommand('workbench.action.files.setActiveEditorReadonlyInSession');
      });
      // Очистка через 5с если редактор так и не появился
      setTimeout(() => disposable.dispose(), 5000);
    })
  );

  // Команды-индикаторы поддержки (inline-кнопки в дереве)
  context.subscriptions.push(
    vscode.commands.registerCommand('1cNavigator.support.none', () => {
      vscode.window.showInformationMessage('Объект не на поддержке.');
    }),
    vscode.commands.registerCommand('1cNavigator.support.editable', () => {
      vscode.window.showInformationMessage('Объект на поддержке. Редактирование разрешено.');
    }),
    vscode.commands.registerCommand('1cNavigator.support.locked', () => {
      vscode.window.showWarningMessage('Объект на поддержке. Редактирование запрещено.');
    }),
  );

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
