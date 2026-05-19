import * as vscode from 'vscode';
import {
  BSL_ANALYZER_MCP_TOOLS,
  EXTENSION_MCP_TOOLS,
  type AiMcpSettings,
  normalizeAiMcpSettings,
} from '../../../infra/ai/AiMcpConfiguration';
import type { BslAnalyzerMcpService, BslAnalyzerMcpStatus } from '../../mcp/BslAnalyzerMcpService';
import type { V8McpServer, V8McpServerStatus } from '../../mcp/V8McpServer';
import { WebviewHtmlFactory } from '../webview/WebviewHtmlFactory';

export interface AiMcpSnapshot {
  readonly settings: AiMcpSettings;
  readonly extensionStatus: V8McpServerStatus;
  readonly bslAnalyzerStatus: BslAnalyzerMcpStatus;
  readonly extensionTools: typeof EXTENSION_MCP_TOOLS;
  readonly bslAnalyzerTools: typeof BSL_ANALYZER_MCP_TOOLS;
  readonly docs: {
    readonly readmeUrl: string;
    readonly toolsUrl: string;
  };
}

type AiMcpViewMessage =
  | { readonly type: 'refresh' }
  | { readonly type: 'save'; readonly settings: AiMcpSettings }
  | { readonly type: 'startExtensionMcp' }
  | { readonly type: 'stopExtensionMcp' }
  | { readonly type: 'startBslAnalyzerMcp' }
  | { readonly type: 'stopBslAnalyzerMcp' }
  | { readonly type: 'installAiSkills' };

export class AiMcpViewProvider implements vscode.Disposable {
  static readonly viewType = 'v8vsceditAiMcpPanel';

  private panel: vscode.WebviewPanel | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly workspaceFolder: vscode.WorkspaceFolder,
    private readonly outputChannel: vscode.OutputChannel,
    private readonly mcpServer: V8McpServer,
    private readonly bslAnalyzerMcpService: BslAnalyzerMcpService,
    private readonly startExtensionMcp: () => void,
    private readonly stopExtensionMcp: () => Promise<void>
  ) {}

  show(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active);
      this.postState();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      AiMcpViewProvider.viewType,
      'ИИ и MCP',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );
    this.panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist', 'ui')],
    };
    this.panel.webview.html = new WebviewHtmlFactory(this.extensionUri).renderVueWebviewHtml({
      webview: this.panel.webview,
      title: 'ИИ и MCP',
      entry: 'ai',
      viewKind: 'ai',
      initialState: this.getSnapshot(),
      csp: { allowStyles: true },
    });
    this.panel.webview.onDidReceiveMessage((message: AiMcpViewMessage) => {
      void this.handleMessage(message);
    });
    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });
  }

  refresh(): void {
    this.postState();
  }

  getSettings(): AiMcpSettings {
    const config = vscode.workspace.getConfiguration('v8vscedit');
    return normalizeAiMcpSettings({
      extensionAutoStart: config.get<boolean>('mcp.enabled'),
      extensionHost: config.get<string>('mcp.host'),
      extensionPort: config.get<number>('mcp.port'),
      bslAnalyzerAutoStart: config.get<boolean>('aiMcp.bslAnalyzer.autoStart'),
      bslAnalyzerReferenceEnabled: config.get<boolean>('aiMcp.bslAnalyzer.reference.enabled'),
      bslAnalyzerWorkspaceEnabled: config.get<boolean>('aiMcp.bslAnalyzer.workspace.enabled'),
      bslAnalyzerWorkspaceSourceDir: config.get<string>('aiMcp.bslAnalyzer.workspace.sourceDir'),
      bslAnalyzerEmbeddingUrl: config.get<string>('aiMcp.bslAnalyzer.embedding.url'),
      bslAnalyzerEmbeddingApiKey: config.get<string>('aiMcp.bslAnalyzer.embedding.apiKey'),
      bslAnalyzerEmbeddingModel: config.get<string>('aiMcp.bslAnalyzer.embedding.model'),
      bslAnalyzerNaparnikToken: config.get<string>('aiMcp.bslAnalyzer.naparnikToken'),
      bslAnalyzerOnecUrl: config.get<string>('aiMcp.bslAnalyzer.onec.url'),
      bslAnalyzerOnecUser: config.get<string>('aiMcp.bslAnalyzer.onec.user'),
      bslAnalyzerOnecPassword: config.get<string>('aiMcp.bslAnalyzer.onec.password'),
    }, this.workspaceFolder.uri.fsPath);
  }

  getSnapshot(): AiMcpSnapshot {
    const settings = this.getSettings();
    return {
      settings,
      extensionStatus: this.mcpServer.getStatus(),
      bslAnalyzerStatus: this.bslAnalyzerMcpService.getStatus(settings),
      extensionTools: EXTENSION_MCP_TOOLS,
      bslAnalyzerTools: BSL_ANALYZER_MCP_TOOLS,
      docs: {
        readmeUrl: 'https://github.com/itrous/bsl-analyzer/blob/develop/docs/mcp/README.md',
        toolsUrl: 'https://github.com/itrous/bsl-analyzer/blob/develop/docs/mcp/TOOLS_AND_EXTENSION.md',
      },
    };
  }

  dispose(): void {
    this.panel?.dispose();
  }

  private async handleMessage(message: AiMcpViewMessage): Promise<void> {
    try {
      if (message.type === 'refresh') {
        this.postState();
        return;
      }
      if (message.type === 'save') {
        await this.saveSettings(message.settings);
        await this.bslAnalyzerMcpService.applyAutoStart(this.getSettings());
        this.postStatus('success', 'Настройки ИИ и MCP сохранены.');
        this.postState();
        return;
      }
      if (message.type === 'startExtensionMcp') {
        this.startExtensionMcp();
        this.postStatus('success', 'MCP-сервер расширения запускается.');
        this.postState();
        return;
      }
      if (message.type === 'stopExtensionMcp') {
        await this.stopExtensionMcp();
        this.postStatus('success', 'MCP-сервер расширения остановлен.');
        this.postState();
        return;
      }
      if (message.type === 'startBslAnalyzerMcp') {
        await this.bslAnalyzerMcpService.startEnabled(this.getSettings());
        this.postStatus('success', 'MCP-профили bsl-analyzer запущены.');
        this.postState();
        return;
      }
      if (message.type === 'stopBslAnalyzerMcp') {
        await this.bslAnalyzerMcpService.stopAll();
        this.postStatus('success', 'MCP-профили bsl-analyzer остановлены.');
        this.postState();
        return;
      }
      await vscode.commands.executeCommand('v8vscedit.installAiSkills');
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      this.outputChannel.appendLine(`[ai-mcp][error] ${text}`);
      this.postStatus('error', text);
    }
  }

  private async saveSettings(settings: AiMcpSettings): Promise<void> {
    const normalized = normalizeAiMcpSettings(settings, this.workspaceFolder.uri.fsPath);
    const config = vscode.workspace.getConfiguration('v8vscedit');
    const target = vscode.ConfigurationTarget.Workspace;
    await config.update('mcp.enabled', normalized.extensionAutoStart, target);
    await config.update('mcp.host', normalized.extensionHost, target);
    await config.update('mcp.port', normalized.extensionPort, target);
    await config.update('aiMcp.bslAnalyzer.autoStart', normalized.bslAnalyzerAutoStart, target);
    await config.update('aiMcp.bslAnalyzer.reference.enabled', normalized.bslAnalyzerReferenceEnabled, target);
    await config.update('aiMcp.bslAnalyzer.workspace.enabled', normalized.bslAnalyzerWorkspaceEnabled, target);
    await config.update('aiMcp.bslAnalyzer.workspace.sourceDir', normalized.bslAnalyzerWorkspaceSourceDir, target);
    await config.update('aiMcp.bslAnalyzer.embedding.url', normalized.bslAnalyzerEmbeddingUrl, target);
    await config.update('aiMcp.bslAnalyzer.embedding.apiKey', normalized.bslAnalyzerEmbeddingApiKey, target);
    await config.update('aiMcp.bslAnalyzer.embedding.model', normalized.bslAnalyzerEmbeddingModel, target);
    await config.update('aiMcp.bslAnalyzer.naparnikToken', normalized.bslAnalyzerNaparnikToken, target);
    await config.update('aiMcp.bslAnalyzer.onec.url', normalized.bslAnalyzerOnecUrl, target);
    await config.update('aiMcp.bslAnalyzer.onec.user', normalized.bslAnalyzerOnecUser, target);
    await config.update('aiMcp.bslAnalyzer.onec.password', normalized.bslAnalyzerOnecPassword, target);
  }

  private postState(): void {
    void this.panel?.webview.postMessage({
      type: 'state',
      state: this.getSnapshot(),
    });
  }

  private postStatus(kind: 'idle' | 'success' | 'error', message: string): void {
    void this.panel?.webview.postMessage({
      type: 'status',
      kind,
      message,
    });
  }
}
