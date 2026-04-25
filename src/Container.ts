import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ConfigEntry } from './domain/Configuration';
import { findConfigurations } from './infra/fs/ConfigLocator';
import { ChangedConfiguration, ConfigurationChangeDetector } from './infra/fs/ConfigurationChangeDetector';
import { MetadataTreeProvider } from './ui/tree/MetadataTreeProvider';
import { MetadataNode } from './ui/tree/TreeNode';
import { registerCommands } from './ui/commands/CommandRegistry';
import { PropertiesViewProvider } from './ui/views/PropertiesViewProvider';
import { TreeSearchViewProvider } from './ui/views/search/TreeSearchViewProvider';
import { OnecFileSystemProvider, ONEC_SCHEME } from './ui/vfs/OnecFileSystemProvider';
import { SupportInfoService } from './infra/support/SupportInfoService';
import { MetadataXmlCreator } from './infra/xml';
import { SupportDecorationProvider } from './ui/tree/decorations/SupportDecorationProvider';
import { LspManager } from './lsp/LspManager';
import { BslReadonlyGuard } from './ui/readonly/BslReadonlyGuard';
import { registerSupportIndicatorCommands } from './ui/support/SupportIndicatorCommands';
import { registerSupportWatcher } from './ui/support/SupportWatcher';

/**
 * Композиционный корень расширения. Собирает зависимости в одном месте,
 * чтобы `extension.ts` оставался тонким (без бизнес-логики).
 *
 * Порядок сборки соответствует целевой архитектуре (см. `AGENTS.md`):
 *   1. Инфраструктурные сервисы (логирование, поддержка).
 *   2. UI-провайдеры (декорации, дерево, свойства, VFS).
 *   3. Композитные подсистемы (LSP-менеджер, watchers).
 *   4. Регистрация команд.
 */
export class Container {
  readonly outputChannel: vscode.OutputChannel;
  readonly supportService: SupportInfoService;
  readonly decorationProvider: SupportDecorationProvider;
  readonly vfs: OnecFileSystemProvider;
  readonly treeProvider: MetadataTreeProvider;
  readonly propertiesProvider: PropertiesViewProvider;
  readonly metadataXmlCreator: MetadataXmlCreator;
  readonly treeSearchViewProvider: TreeSearchViewProvider;
  readonly lspManager: LspManager;
  readonly changeDetector: ConfigurationChangeDetector;

  private treeView: vscode.TreeView<MetadataNode> | undefined;
  private changeStateTimer: NodeJS.Timeout | undefined;
  private changedConfigurations: ChangedConfiguration[] = [];
  private readonly suppressedConfigurationReloads = new Map<string, number>();

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly workspaceFolder: vscode.WorkspaceFolder
  ) {
    this.outputChannel = vscode.window.createOutputChannel('1С Редактор');
    context.subscriptions.push(this.outputChannel);
    this.outputChannel.appendLine('[init] Расширение активировано');

    this.supportService = new SupportInfoService(this.outputChannel);

    this.decorationProvider = new SupportDecorationProvider();
    context.subscriptions.push(
      vscode.window.registerFileDecorationProvider(this.decorationProvider),
      this.decorationProvider
    );

    this.vfs = new OnecFileSystemProvider();
    this.vfs.setSupportService(this.supportService);
    this.vfs.setOutputChannel(this.outputChannel);
    this.vfs.setOnDidWriteRealFile((filePath) => this.scheduleChangedConfigurationStateRefresh(
      vscode.Uri.file(filePath)
    ));
    context.subscriptions.push(
      vscode.workspace.registerFileSystemProvider(ONEC_SCHEME, this.vfs, {
        isCaseSensitive: false,
        isReadonly: false,
      })
    );

    this.treeProvider = new MetadataTreeProvider(
      [],
      context.extensionUri,
      workspaceFolder.uri.fsPath,
      (message) => {
        if (this.treeView) {
          this.treeView.message = message;
        }
      },
      this.supportService
    );
    this.propertiesProvider = new PropertiesViewProvider(this.supportService);
    this.metadataXmlCreator = new MetadataXmlCreator();
    context.subscriptions.push(this.propertiesProvider);
    this.treeSearchViewProvider = new TreeSearchViewProvider(context.extensionUri, {
      treeProvider: this.treeProvider,
      setTreeMessage: (message) => {
        if (this.treeView) {
          this.treeView.message = message;
        }
      },
      isProjectInitialized: () => this.isProjectInitialized(),
    });
    this.changeDetector = new ConfigurationChangeDetector(workspaceFolder.uri.fsPath);

    this.lspManager = new LspManager(context, this.outputChannel, ONEC_SCHEME);
  }

  /** Создаёт контейнер и выполняет регистрацию всех подсистем */
  static async bootstrap(context: vscode.ExtensionContext, folder: vscode.WorkspaceFolder): Promise<Container> {
    const c = new Container(context, folder);
    c.wireTreeView();
    c.wireTreeSearchView();
    c.wireSupportWatcher();
    c.wireConfigurationWatcher();
    c.wireConfigurationSourceWatcher();
    c.wireCommands();
    c.wireReadonlyGuard();
    await c.reloadEntries();
    c.wireLsp();
    return c;
  }

  /** Перечитывает список конфигураций в рабочей области */
  async reloadEntries(): Promise<void> {
    const rootPath = this.workspaceFolder.uri.fsPath;
    const entries = await findConfigurations(rootPath);
    this.ensureHashCaches(entries);
    this.treeProvider.updateEntries(entries);
    this.refreshChangedConfigurationState();
    this.outputChannel.appendLine(`[init] Найдено конфигураций: ${entries.length}`);
  }

  private wireTreeView(): void {
    const view = vscode.window.createTreeView('v8vsceditTree', {
      treeDataProvider: this.treeProvider,
      showCollapseAll: true,
    });
    this.treeView = view;
    this.context.subscriptions.push(view);
  }

  private wireTreeSearchView(): void {
    this.context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(
        TreeSearchViewProvider.viewType,
        this.treeSearchViewProvider,
        { webviewOptions: { retainContextWhenHidden: true } }
      )
    );
  }

  private wireSupportWatcher(): void {
    registerSupportWatcher(
      this.workspaceFolder,
      this.context,
      this.supportService,
      this.decorationProvider,
      () => this.treeProvider.refresh()
    );
  }

  private wireCommands(): void {
    registerCommands(this.context, {
      treeProvider: this.treeProvider,
      workspaceFolder: this.workspaceFolder,
      metadataXmlCreator: this.metadataXmlCreator,
      reloadEntries: () => this.reloadEntries(),
      propertiesViewProvider: this.propertiesProvider,
      vfs: this.vfs,
      outputChannel: this.outputChannel,
      supportService: this.supportService,
      refreshChangedConfigurationState: () => this.refreshChangedConfigurationState(),
      markChangedConfigurationByFiles: (filePaths) => this.markChangedConfigurationByFiles(filePaths),
      getChangedConfigurations: () => this.getChangedConfigurations(),
      markConfigurationsClean: (rootPaths) => this.markConfigurationsClean(rootPaths),
      suppressConfigurationReloadForFiles: (filePaths) => this.suppressConfigurationReloadForFiles(filePaths),
      setTreeMessage: (message) => {
        if (this.treeView) {
          this.treeView.message = message;
        }
      },
      refreshActionsView: () => this.treeSearchViewProvider.refresh(),
    });
    registerSupportIndicatorCommands(this.context);
  }

  private wireConfigurationWatcher(): void {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(this.workspaceFolder, '**/Configuration.xml'),
      false,
      false,
      false
    );

    const onConfigChange = (uri: vscode.Uri) => {
      if (this.consumeSuppressedConfigurationReload(uri.fsPath)) {
        return;
      }
      this.reloadEntries();
    };

    watcher.onDidCreate(onConfigChange, null, this.context.subscriptions);
    watcher.onDidDelete(onConfigChange, null, this.context.subscriptions);
    watcher.onDidChange(onConfigChange, null, this.context.subscriptions);
    this.context.subscriptions.push(watcher);
  }

  private wireConfigurationSourceWatcher(): void {
    const xmlWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(this.workspaceFolder, '**/*.xml'),
      false,
      false,
      false
    );
    const bslWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(this.workspaceFolder, '**/*.bsl'),
      false,
      false,
      false
    );

    const onSourceChange = (uri: vscode.Uri) => this.scheduleChangedConfigurationStateRefresh(uri);
    for (const watcher of [xmlWatcher, bslWatcher]) {
      watcher.onDidCreate((uri) => onSourceChange(uri), null, this.context.subscriptions);
      watcher.onDidDelete((uri) => onSourceChange(uri), null, this.context.subscriptions);
      watcher.onDidChange((uri) => onSourceChange(uri), null, this.context.subscriptions);
      this.context.subscriptions.push(watcher);
    }
  }

  private ensureHashCaches(entries: ConfigEntry[]): void {
    if (entries.length > 0 && this.treeView) {
      this.treeView.message = 'Проверка кэша метаданных...';
    }
    try {
      const created = this.changeDetector.ensureCaches(entries);
      if (created > 0) {
        this.outputChannel.appendLine(`[hash-cache] Создано первичных кэшей: ${created}`);
      }
    } finally {
      if (this.treeView) {
        this.treeView.message = undefined;
      }
    }
  }

  private scheduleChangedConfigurationStateRefresh(uri?: vscode.Uri): void {
    if (uri && this.markChangedConfigurationByFile(uri.fsPath)) {
      return;
    }
    if (this.changeStateTimer) {
      return;
    }
    this.changeStateTimer = setTimeout(() => {
      this.changeStateTimer = undefined;
      this.refreshChangedConfigurationState();
    }, 1_000);
  }

  private refreshChangedConfigurationState(): void {
    const changed = this.changeDetector.detect(this.treeProvider.getEntries());
    this.changedConfigurations = changed;
    void vscode.commands.executeCommand(
      'setContext',
      'v8vscedit.hasChangedConfigurations',
      changed.length > 0
    );
  }

  private markChangedConfigurationByFiles(filePaths: string[]): void {
    const countsByRoot = new Map<string, { entry: ConfigEntry; count: number }>();
    for (const filePath of filePaths) {
      const entry = this.treeProvider
        .getEntries()
        .find((item) => isPathInside(filePath, item.rootPath));
      if (!entry) {
        continue;
      }

      const key = path.resolve(entry.rootPath).toLowerCase();
      const current = countsByRoot.get(key);
      countsByRoot.set(key, {
        entry,
        count: (current?.count ?? 0) + 1,
      });
    }

    for (const { entry, count } of countsByRoot.values()) {
      this.markChangedConfiguration(entry, count);
    }
  }

  private getChangedConfigurations(): ChangedConfiguration[] {
    return [...this.changedConfigurations];
  }

  private markConfigurationsClean(rootPaths: string[]): void {
    if (rootPaths.length === 0) {
      return;
    }
    const clean = new Set(rootPaths.map((item) => path.resolve(item).toLowerCase()));
    this.changedConfigurations = this.changedConfigurations.filter(
      (item) => !clean.has(path.resolve(item.rootPath).toLowerCase())
    );
    void vscode.commands.executeCommand(
      'setContext',
      'v8vscedit.hasChangedConfigurations',
      this.changedConfigurations.length > 0
    );
  }

  private markChangedConfigurationByFile(filePath: string): boolean {
    const entry = this.treeProvider
      .getEntries()
      .find((item) => isPathInside(filePath, item.rootPath));
    if (!entry) {
      return false;
    }

    this.markChangedConfiguration(entry, 1);
    return true;
  }

  private markChangedConfiguration(entry: ConfigEntry, changedFilesCount: number): void {
    const existing = this.changedConfigurations.find((item) => item.rootPath === entry.rootPath);
    if (existing) {
      existing.changedFilesCount = Math.max(existing.changedFilesCount, changedFilesCount);
    } else {
      this.changedConfigurations = [
        ...this.changedConfigurations,
        this.changeDetector.describe(entry, changedFilesCount),
      ].sort((left, right) => {
        if (left.kind !== right.kind) {
          return left.kind === 'cf' ? -1 : 1;
        }
        return left.name.localeCompare(right.name);
      });
    }

    void vscode.commands.executeCommand('setContext', 'v8vscedit.hasChangedConfigurations', true);
  }

  private suppressConfigurationReloadForFiles(filePaths: string[]): void {
    const expiresAt = Date.now() + 5_000;
    for (const filePath of filePaths) {
      if (path.basename(filePath).toLowerCase() !== 'configuration.xml') {
        continue;
      }
      this.suppressedConfigurationReloads.set(path.resolve(filePath).toLowerCase(), expiresAt);
    }
  }

  private consumeSuppressedConfigurationReload(filePath: string): boolean {
    const key = path.resolve(filePath).toLowerCase();
    const expiresAt = this.suppressedConfigurationReloads.get(key);
    if (!expiresAt) {
      return false;
    }

    if (expiresAt < Date.now()) {
      this.suppressedConfigurationReloads.delete(key);
      return false;
    }

    return true;
  }

  private wireReadonlyGuard(): void {
    const guard = new BslReadonlyGuard(this.supportService, this.outputChannel);
    this.context.subscriptions.push(guard.register());
  }

  private wireLsp(): void {
    this.lspManager.registerCommands();
    this.lspManager.startWithAutoUpdate();
  }

  private isProjectInitialized(): boolean {
    const rootPath = this.workspaceFolder.uri.fsPath;
    return (
      fs.existsSync(path.join(rootPath, 'env.json')) &&
      isDirectory(path.join(rootPath, 'src', 'cf')) &&
      isDirectory(path.join(rootPath, 'src', 'cfe'))
    );
  }
}

function isPathInside(filePath: string, rootPath: string): boolean {
  const normalizedFilePath = path.resolve(filePath).toLowerCase();
  const normalizedRootPath = path.resolve(rootPath).toLowerCase();
  const relative = path.relative(normalizedRootPath, normalizedFilePath);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function isDirectory(directoryPath: string): boolean {
  try {
    return fs.statSync(directoryPath).isDirectory();
  } catch {
    return false;
  }
}
