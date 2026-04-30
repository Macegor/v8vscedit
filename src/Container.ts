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
import { SubsystemEditorViewProvider } from './ui/views/subsystem/SubsystemEditorViewProvider';
import { TreeSearchViewProvider } from './ui/views/search/TreeSearchViewProvider';
import { OnecFileSystemProvider, ONEC_SCHEME } from './ui/vfs/OnecFileSystemProvider';
import { SupportInfoService } from './infra/support/SupportInfoService';
import { MetadataXmlCreator, MetadataXmlRemover } from './infra/xml';
import { SubsystemXmlService } from './infra/xml/SubsystemXmlService';
import { RepositoryService } from './infra/repository/RepositoryService';
import { GitMetadataStatusService } from './infra/git/GitMetadataStatusService';
import { AiSkillsInstaller } from './infra/skills/AiSkillsInstaller';
import { SupportDecorationProvider } from './ui/tree/decorations/SupportDecorationProvider';
import { GitMetadataDecorationProvider } from './ui/tree/decorations/GitMetadataDecorationProvider';
import { LspManager } from './lsp/LspManager';
import { BslReadonlyGuard } from './ui/readonly/BslReadonlyGuard';
import { registerSupportIndicatorCommands } from './ui/support/SupportIndicatorCommands';
import { registerSupportWatcher } from './ui/support/SupportWatcher';
import { RepositoryCommitViewProvider } from './ui/views/RepositoryCommitViewProvider';
import { RepositoryConnectionViewProvider } from './ui/views/RepositoryConnectionViewProvider';
import { updateMetadataCacheAfterRename } from './infra/cache/MetadataCache';
import { BslAnalyzerConfigService, ProjectEnvironmentService } from './infra/environment';
import { ProjectEnvironmentViewProvider } from './ui/views/environment/ProjectEnvironmentViewProvider';

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
  readonly subsystemEditorViewProvider: SubsystemEditorViewProvider;
  readonly repositoryService: RepositoryService;
  readonly gitMetadataStatusService: GitMetadataStatusService;
  readonly gitMetadataDecorationProvider: GitMetadataDecorationProvider;
  readonly repositoryConnectionViewProvider: RepositoryConnectionViewProvider;
  readonly repositoryCommitViewProvider: RepositoryCommitViewProvider;
  readonly bslAnalyzerConfigService: BslAnalyzerConfigService;
  readonly projectEnvironmentService: ProjectEnvironmentService;
  readonly projectEnvironmentViewProvider: ProjectEnvironmentViewProvider;
  readonly aiSkillsInstaller: AiSkillsInstaller;
  readonly metadataXmlCreator: MetadataXmlCreator;
  readonly metadataXmlRemover: MetadataXmlRemover;
  readonly subsystemXmlService: SubsystemXmlService;
  readonly treeSearchViewProvider: TreeSearchViewProvider;
  readonly lspManager: LspManager;
  readonly changeDetector: ConfigurationChangeDetector;

  private treeView: vscode.TreeView<MetadataNode> | undefined;
  private changeStateTimer: NodeJS.Timeout | undefined;
  private treeCacheTimer: NodeJS.Timeout | undefined;
  private decorationRefreshTimer: NodeJS.Timeout | undefined;
  private readonly pendingTreeCacheFiles = new Set<string>();
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
    this.repositoryService = new RepositoryService(workspaceFolder.uri.fsPath);
    this.bslAnalyzerConfigService = new BslAnalyzerConfigService(workspaceFolder.uri.fsPath);
    this.projectEnvironmentService = new ProjectEnvironmentService(workspaceFolder.uri.fsPath);
    this.gitMetadataStatusService = new GitMetadataStatusService(workspaceFolder.uri.fsPath);
    this.gitMetadataDecorationProvider = new GitMetadataDecorationProvider(this.gitMetadataStatusService);

    this.decorationProvider = new SupportDecorationProvider();
    context.subscriptions.push(
      vscode.window.registerFileDecorationProvider(this.decorationProvider),
      this.decorationProvider,
      vscode.window.registerFileDecorationProvider(this.gitMetadataDecorationProvider),
      this.gitMetadataDecorationProvider
    );

    this.vfs = new OnecFileSystemProvider();
    this.vfs.setSupportService(this.supportService);
    this.vfs.setRepositoryService(this.repositoryService);
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
      this.supportService,
      this.repositoryService
    );
    this.propertiesProvider = new PropertiesViewProvider(
      this.supportService,
      this.repositoryService,
      (configRoot, oldXmlPath, newXmlPath) => this.handleAfterRename(configRoot, oldXmlPath, newXmlPath)
    );
    this.subsystemXmlService = new SubsystemXmlService();
    this.subsystemEditorViewProvider = new SubsystemEditorViewProvider(
      context.extensionUri,
      this.subsystemXmlService,
      this.supportService,
      this.repositoryService,
      () => this.treeProvider.refresh()
    );
    this.repositoryConnectionViewProvider = new RepositoryConnectionViewProvider(context.extensionUri);
    this.repositoryCommitViewProvider = new RepositoryCommitViewProvider(context.extensionUri);
    this.projectEnvironmentViewProvider = new ProjectEnvironmentViewProvider(
      this.projectEnvironmentService,
      this.outputChannel
    );
    this.aiSkillsInstaller = new AiSkillsInstaller(this.outputChannel);
    this.metadataXmlCreator = new MetadataXmlCreator();
    this.metadataXmlRemover = new MetadataXmlRemover();
    context.subscriptions.push(
      this.propertiesProvider,
      this.subsystemEditorViewProvider,
      this.projectEnvironmentViewProvider
    );
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
    c.wireGitDecorationWatcher();
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
    if (this.isProjectInitialized()) {
      this.bslAnalyzerConfigService.ensureExists(getExtensionRootPaths(entries));
    }
    this.refreshChangedConfigurationState();
    const hasCfe = entries.some((e) => e.kind === 'cfe');
    void vscode.commands.executeCommand('setContext', 'v8vscedit.hasCfeEntries', hasCfe);
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
      metadataXmlRemover: this.metadataXmlRemover,
      reloadEntries: () => this.reloadEntries(),
      propertiesViewProvider: this.propertiesProvider,
      subsystemEditorViewProvider: this.subsystemEditorViewProvider,
      vfs: this.vfs,
      outputChannel: this.outputChannel,
      supportService: this.supportService,
      repositoryService: this.repositoryService,
      repositoryConnectionViewProvider: this.repositoryConnectionViewProvider,
      repositoryCommitViewProvider: this.repositoryCommitViewProvider,
      bslAnalyzerConfigService: this.bslAnalyzerConfigService,
      projectEnvironmentViewProvider: this.projectEnvironmentViewProvider,
      aiSkillsInstaller: this.aiSkillsInstaller,
      refreshChangedConfigurationState: () => this.refreshChangedConfigurationState(),
      markChangedConfigurationByFiles: (filePaths) => this.markChangedConfigurationByFiles(filePaths),
      getChangedConfigurations: () => this.getChangedConfigurations(),
      markConfigurationsClean: (rootPaths) => this.markConfigurationsClean(rootPaths),
      suppressConfigurationReloadForFiles: (filePaths) => this.suppressConfigurationReloadForFiles(filePaths),
      revealTreeNode: (predicate, rootPath) => this.revealTreeNode(predicate, rootPath),
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
      this.refreshTreeCacheForFiles([uri.fsPath]);
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

    const onSourceChange = (uri: vscode.Uri) => {
      this.scheduleChangedConfigurationStateRefresh(uri);
      if (path.extname(uri.fsPath).toLowerCase() === '.xml') {
        this.scheduleTreeCacheRefresh(uri.fsPath);
      } else {
        this.scheduleDecorationRefresh();
      }
    };
    for (const watcher of [xmlWatcher, bslWatcher]) {
      watcher.onDidCreate((uri) => onSourceChange(uri), null, this.context.subscriptions);
      watcher.onDidDelete((uri) => onSourceChange(uri), null, this.context.subscriptions);
      watcher.onDidChange((uri) => onSourceChange(uri), null, this.context.subscriptions);
      this.context.subscriptions.push(watcher);
    }
  }

  private wireGitDecorationWatcher(): void {
    const watchers = [
      new vscode.RelativePattern(this.workspaceFolder, '.git/HEAD'),
      new vscode.RelativePattern(this.workspaceFolder, '.git/index'),
      new vscode.RelativePattern(this.workspaceFolder, '.git/packed-refs'),
      new vscode.RelativePattern(this.workspaceFolder, '.git/refs/**'),
    ].map((pattern) => vscode.workspace.createFileSystemWatcher(pattern, false, false, false));

    for (const watcher of watchers) {
      watcher.onDidCreate(() => this.scheduleDecorationRefresh(), null, this.context.subscriptions);
      watcher.onDidDelete(() => this.scheduleDecorationRefresh(), null, this.context.subscriptions);
      watcher.onDidChange(() => this.scheduleDecorationRefresh(), null, this.context.subscriptions);
      this.context.subscriptions.push(watcher);
    }
  }

  private ensureHashCaches(entries: ConfigEntry[]): void {
    if (entries.length > 0 && this.treeView) {
      this.treeView.message = 'Проверка кэша метаданных...';
    }
    try {
      const created = this.changeDetector.ensureCaches(entries, (message) => {
        if (this.treeView) {
          this.treeView.message = message;
        }
        this.outputChannel.appendLine(`[init] ${message}`);
      });
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

  private scheduleTreeCacheRefresh(filePath: string): void {
    if (!this.treeProvider.getEntries().some((entry) => isPathInside(filePath, entry.rootPath))) {
      return;
    }

    if (this.consumeSuppressedConfigurationReload(filePath)) {
      return;
    }

    this.pendingTreeCacheFiles.add(filePath);
    if (this.treeCacheTimer) {
      return;
    }

    this.treeCacheTimer = setTimeout(() => {
      this.treeCacheTimer = undefined;
      const filePaths = [...this.pendingTreeCacheFiles];
      this.pendingTreeCacheFiles.clear();
      const refreshed = this.refreshTreeCacheForFiles(filePaths);
      if (!refreshed) {
        this.scheduleDecorationRefresh();
      }
    }, 500);
  }

  private refreshTreeCacheForFiles(filePaths: string[]): boolean {
    try {
      const refreshed = this.treeProvider.refreshCacheForFiles(filePaths);
      this.gitMetadataDecorationProvider.refresh();
      return refreshed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.outputChannel.appendLine(`[meta-cache] Не удалось обновить кэш дерева: ${message}`);
      return false;
    }
  }

  private scheduleDecorationRefresh(): void {
    if (this.decorationRefreshTimer) {
      return;
    }

    this.decorationRefreshTimer = setTimeout(() => {
      this.decorationRefreshTimer = undefined;
      this.gitMetadataDecorationProvider.refresh();
      this.treeProvider.refreshDecorations();
    }, 500);
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

  private async revealTreeNode(predicate: (node: MetadataNode) => boolean, rootPath?: string): Promise<boolean> {
    if (!this.treeView) {
      return false;
    }

    this.treeProvider.clearSearchQuery();
    const node = this.treeProvider.findNode(predicate, rootPath);
    if (!node) {
      return false;
    }

    try {
      await this.treeView.reveal(node, {
        select: true,
        focus: true,
        expand: 3,
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.outputChannel.appendLine(`[tree] Не удалось выделить узел после операции: ${message}`);
      return false;
    }
  }

  /**
   * Точечно обновляет кэш метаданных после переименования объекта и сразу обновляет дерево.
   * Подавляет полную перестройку кэша, которую иначе вызвал бы watcher на Configuration.xml.
   */
  private handleAfterRename(configRoot: string, oldXmlPath: string, newXmlPath: string): void {
    const configXmlPath = path.join(configRoot, 'Configuration.xml');
    this.suppressConfigurationReloadForFiles([configXmlPath]);

    const entry = this.treeProvider.getEntries().find(
      (e) => path.resolve(e.rootPath).toLowerCase() === path.resolve(configRoot).toLowerCase()
    );

    if (entry) {
      try {
        updateMetadataCacheAfterRename(this.workspaceFolder.uri.fsPath, entry, oldXmlPath, newXmlPath);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.outputChannel.appendLine(`[meta-cache] Точечное обновление кэша при переименовании не удалось: ${message}`);
      }
    }

    this.treeProvider.refresh();
  }

  private wireReadonlyGuard(): void {
    const guard = new BslReadonlyGuard(this.supportService, this.repositoryService, this.outputChannel);
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

function getExtensionRootPaths(entries: ConfigEntry[]): string[] {
  return entries
    .filter((entry) => entry.kind === 'cfe')
    .map((entry) => entry.rootPath);
}

function isDirectory(directoryPath: string): boolean {
  try {
    return fs.statSync(directoryPath).isDirectory();
  } catch {
    return false;
  }
}
