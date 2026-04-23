import * as vscode from 'vscode';
import { findConfigurations } from './infra/fs/ConfigLocator';
import { MetadataTreeProvider } from './ui/tree/MetadataTreeProvider';
import { registerCommands } from './ui/commands/CommandRegistry';
import { PropertiesViewProvider } from './ui/views/PropertiesViewProvider';
import { OnecFileSystemProvider, ONEC_SCHEME } from './ui/vfs/OnecFileSystemProvider';
import { SupportInfoService } from './infra/support/SupportInfoService';
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
  readonly lspManager: LspManager;

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
    context.subscriptions.push(
      vscode.workspace.registerFileSystemProvider(ONEC_SCHEME, this.vfs, {
        isCaseSensitive: false,
        isReadonly: false,
      })
    );

    this.treeProvider = new MetadataTreeProvider([], context.extensionUri, this.supportService);
    this.propertiesProvider = new PropertiesViewProvider();
    context.subscriptions.push(this.propertiesProvider);

    this.lspManager = new LspManager(context, this.outputChannel, ONEC_SCHEME);
  }

  /** Создаёт контейнер и выполняет регистрацию всех подсистем */
  static bootstrap(context: vscode.ExtensionContext, folder: vscode.WorkspaceFolder): Container {
    const c = new Container(context, folder);
    c.wireTreeView();
    c.wireSupportWatcher();
    c.wireCommands();
    c.wireReadonlyGuard();
    c.wireLsp();
    c.reloadEntries();
    return c;
  }

  /** Перечитывает список конфигураций в рабочей области */
  reloadEntries(): void {
    const rootPath = this.workspaceFolder.uri.fsPath;
    findConfigurations(rootPath).then((entries) => {
      this.treeProvider.updateEntries(entries);
      this.outputChannel.appendLine(`[init] Найдено конфигураций: ${entries.length}`);
    });
  }

  private wireTreeView(): void {
    const view = vscode.window.createTreeView('v8vsceditTree', {
      treeDataProvider: this.treeProvider,
      showCollapseAll: true,
    });
    this.context.subscriptions.push(view);
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
    registerCommands(
      this.context,
      this.treeProvider,
      this.workspaceFolder,
      () => this.reloadEntries(),
      this.propertiesProvider,
      this.vfs,
      this.outputChannel,
      this.supportService
    );
    registerSupportIndicatorCommands(this.context);
  }

  private wireReadonlyGuard(): void {
    const guard = new BslReadonlyGuard(this.supportService, this.outputChannel);
    this.context.subscriptions.push(guard.register());
  }

  private wireLsp(): void {
    this.lspManager.registerCommands();
    this.lspManager.startWithAutoUpdate();
  }
}
