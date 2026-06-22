import * as vscode from 'vscode';
import {
  BSL_ANALYZER_MCP_TOOLS,
  EXTENSION_MCP_TOOLS,
  type AiMcpRedactedSettings,
  type AiMcpSaveSettings,
  type AiMcpSettings,
  maskAiMcpSecrets,
  mergeAiMcpSaveSettings,
  normalizeAiMcpSettings,
  redactAiMcpSettings,
} from '../../../infra/ai/AiMcpConfiguration';
import type { AiSecretId, AiSecretStorage } from '../../../infra/ai/AiSecretStorage';
import type { BslAnalyzerMcpService, BslAnalyzerMcpStatus } from '../../mcp/BslAnalyzerMcpService';
import type { V8McpServer, V8McpServerStatus } from '../../mcp/V8McpServer';
import { WebviewHtmlFactory } from '../webview/WebviewHtmlFactory';

// Сопоставление логического секрета с устаревшим ключом настройки, откуда он
// мигрирует в SecretStorage. Используется для совместимости (fallback-чтение)
// и одноразового переноса с очисткой settings.json.
const SECRET_CONFIG_KEYS: Record<AiSecretId, string> = {
  embeddingApiKey: 'aiMcp.bslAnalyzer.embedding.apiKey',
  naparnikToken: 'aiMcp.bslAnalyzer.naparnikToken',
  onecPassword: 'aiMcp.bslAnalyzer.onec.password',
};

// Маска для секретов в местах, попадающих в webview (например commandLine
// статуса bsl-analyzer): реальное значение наружу не уходит.
const SECRET_MASK = '••••';

export interface AiMcpSnapshot {
  readonly settings: AiMcpRedactedSettings;
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
  | { readonly type: 'save'; readonly settings: AiMcpSaveSettings }
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
    private readonly secretStorage: AiSecretStorage,
    private readonly startExtensionMcp: () => void,
    private readonly stopExtensionMcp: () => Promise<void>
  ) {}

  async show(): Promise<void> {
    // Переносим устаревшие секреты из settings.json в SecretStorage до показа,
    // чтобы webview уже видел корректные признаки «задано».
    await this.migrateLegacySecrets();
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
      // Стартовый снимок секретов async; webview сам запросит свежее состояние
      // через refresh, поэтому здесь отдаём снимок без секретов-флагов.
      initialState: this.getSnapshotWithoutSecrets(),
      csp: { allowStyles: true },
    });
    this.panel.webview.onDidReceiveMessage((message: AiMcpViewMessage) => {
      void this.handleMessage(message);
    });
    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });
    // Сразу досылаем состояние с актуальными флагами секретов из SecretStorage.
    this.postState();
  }

  refresh(): void {
    this.postState();
  }

  /**
   * Несекретные настройки из конфигурации. Секреты здесь всегда пустые —
   * реальные значения берутся из SecretStorage в {@link getResolvedSettings}.
   */
  private getConfigSettings(): AiMcpSettings {
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
      // Устаревшие config-секреты читаем как fallback для непромигрированных.
      bslAnalyzerEmbeddingApiKey: config.get<string>(SECRET_CONFIG_KEYS.embeddingApiKey),
      bslAnalyzerEmbeddingModel: config.get<string>('aiMcp.bslAnalyzer.embedding.model'),
      bslAnalyzerNaparnikToken: config.get<string>(SECRET_CONFIG_KEYS.naparnikToken),
      bslAnalyzerOnecUrl: config.get<string>('aiMcp.bslAnalyzer.onec.url'),
      bslAnalyzerOnecUser: config.get<string>('aiMcp.bslAnalyzer.onec.user'),
      bslAnalyzerOnecPassword: config.get<string>(SECRET_CONFIG_KEYS.onecPassword),
    }, this.workspaceFolder.uri.fsPath);
  }

  /**
   * Полные настройки с реальными секретами из SecretStorage (fallback —
   * устаревшая настройка для непромигрированных секретов). Используется для
   * запуска MCP, где нужны фактические значения ключей/токена/пароля.
   */
  async getResolvedSettings(): Promise<AiMcpSettings> {
    const base = this.getConfigSettings();
    return {
      ...base,
      bslAnalyzerEmbeddingApiKey: await this.resolveSecret('embeddingApiKey', base.bslAnalyzerEmbeddingApiKey),
      bslAnalyzerNaparnikToken: await this.resolveSecret('naparnikToken', base.bslAnalyzerNaparnikToken),
      bslAnalyzerOnecPassword: await this.resolveSecret('onecPassword', base.bslAnalyzerOnecPassword),
    };
  }

  /** Снимок для webview с актуальными флагами «секрет задан» из SecretStorage. */
  async getSnapshot(): Promise<AiMcpSnapshot> {
    const settings = await this.getResolvedSettings();
    return this.buildSnapshot(settings);
  }

  /** Снимок без обращения к SecretStorage — секреты считаются незаданными. */
  private getSnapshotWithoutSecrets(): AiMcpSnapshot {
    const base = this.getConfigSettings();
    return this.buildSnapshot({
      ...base,
      bslAnalyzerEmbeddingApiKey: '',
      bslAnalyzerNaparnikToken: '',
      bslAnalyzerOnecPassword: '',
    });
  }

  private buildSnapshot(settings: AiMcpSettings): AiMcpSnapshot {
    // Статус считаем по настройкам с замаскированными секретами: иначе пароль
    // 1С утёк бы наружу через commandLine профиля (он содержит --onec-password).
    const maskedSettings = maskAiMcpSecrets(settings, SECRET_MASK);
    return {
      settings: redactAiMcpSettings(settings),
      extensionStatus: this.mcpServer.getStatus(),
      bslAnalyzerStatus: this.bslAnalyzerMcpService.getStatus(maskedSettings),
      extensionTools: EXTENSION_MCP_TOOLS,
      bslAnalyzerTools: BSL_ANALYZER_MCP_TOOLS,
      docs: {
        readmeUrl: 'https://github.com/itrous/bsl-analyzer/blob/develop/docs/mcp/README.md',
        toolsUrl: 'https://github.com/itrous/bsl-analyzer/blob/develop/docs/mcp/TOOLS_AND_EXTENSION.md',
      },
    };
  }

  private async resolveSecret(id: AiSecretId, configFallback: string): Promise<string> {
    const stored = await this.secretStorage.get(id);
    if (typeof stored === 'string' && stored.trim()) {
      return stored;
    }
    return configFallback;
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
        await this.bslAnalyzerMcpService.applyAutoStart(await this.getResolvedSettings());
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
        await this.bslAnalyzerMcpService.startEnabled(await this.getResolvedSettings());
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

  private async saveSettings(settings: AiMcpSaveSettings): Promise<void> {
    // Несекретные поля нормализуем поверх текущих; секреты в config не пишем —
    // их источник правды SecretStorage. Пустой config-секрет в merged
    // безопасен: ниже мы вообще не обновляем config-ключи секретов.
    const merged = mergeAiMcpSaveSettings(this.getConfigSettings(), settings);
    const normalized = normalizeAiMcpSettings(merged, this.workspaceFolder.uri.fsPath);
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
    await config.update('aiMcp.bslAnalyzer.embedding.model', normalized.bslAnalyzerEmbeddingModel, target);
    await config.update('aiMcp.bslAnalyzer.onec.url', normalized.bslAnalyzerOnecUrl, target);
    await config.update('aiMcp.bslAnalyzer.onec.user', normalized.bslAnalyzerOnecUser, target);

    // Секреты: записываем в SecretStorage только при реальном вводе из webview
    // (пустое/отсутствующее значение означает «не менять»). На всякий случай
    // очищаем устаревшие config-ключи, если они ещё остались.
    await this.persistSecretIfProvided('embeddingApiKey', settings.bslAnalyzerEmbeddingApiKey);
    await this.persistSecretIfProvided('naparnikToken', settings.bslAnalyzerNaparnikToken);
    await this.persistSecretIfProvided('onecPassword', settings.bslAnalyzerOnecPassword);
  }

  private async persistSecretIfProvided(id: AiSecretId, value: string | undefined): Promise<void> {
    const trimmed = value?.trim();
    if (!trimmed) {
      return;
    }
    await this.secretStorage.set(id, trimmed);
    await this.clearLegacySecretConfig(id);
  }

  /**
   * Переносит устаревшие секреты из settings.json в SecretStorage и очищает
   * config (в обоих таргетах), чтобы они не оставались в репозитории. Перенос
   * выполняется только для секрета, которого ещё нет в SecretStorage.
   */
  async migrateLegacySecrets(): Promise<void> {
    for (const id of ['embeddingApiKey', 'naparnikToken', 'onecPassword'] as const) {
      const existing = await this.secretStorage.get(id);
      if (typeof existing === 'string' && existing.trim()) {
        // Уже в SecretStorage — гарантируем лишь отсутствие legacy-значения.
        await this.clearLegacySecretConfig(id);
        continue;
      }
      const config = vscode.workspace.getConfiguration('v8vscedit');
      const legacy = config.get<string>(SECRET_CONFIG_KEYS[id])?.trim();
      if (legacy) {
        await this.secretStorage.set(id, legacy);
        await this.clearLegacySecretConfig(id);
      }
    }
  }

  /** Удаляет устаревшее значение секрета из настроек во всех таргетах. */
  private async clearLegacySecretConfig(id: AiSecretId): Promise<void> {
    const config = vscode.workspace.getConfiguration('v8vscedit');
    const key = SECRET_CONFIG_KEYS[id];
    for (const target of [
      vscode.ConfigurationTarget.Workspace,
      vscode.ConfigurationTarget.WorkspaceFolder,
      vscode.ConfigurationTarget.Global,
    ]) {
      try {
        await config.update(key, undefined, target);
      } catch {
        // Таргет может быть недоступен (например, нет workspace-файла) —
        // это не ошибка миграции.
      }
    }
  }

  private postState(): void {
    void this.getSnapshot().then((state) => {
      void this.panel?.webview.postMessage({ type: 'state', state });
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
