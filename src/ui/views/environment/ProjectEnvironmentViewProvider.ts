import * as vscode from 'vscode';
import {
  ProjectEnvironmentService,
  ProjectEnvironmentSnapshot,
  SaveProjectEnvironmentInput,
} from '../../../infra/environment';

type ProjectEnvironmentMessage =
  | { readonly type: 'refresh' }
  | ({ readonly type: 'save' } & SaveProjectEnvironmentInput);

/**
 * Webview-панель выбора платформы 1С и рабочей информационной базы проекта.
 */
export class ProjectEnvironmentViewProvider implements vscode.Disposable {
  static readonly viewType = 'v8vsceditEnvironmentPanel';

  private panel: vscode.WebviewPanel | undefined;
  private loadingTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly service: ProjectEnvironmentService,
    private readonly outputChannel: vscode.OutputChannel
  ) {}

  show(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active);
      this.loadSnapshot(false);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      ProjectEnvironmentViewProvider.viewType,
      'Настройки проекта',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    this.panel.webview.options = {
      enableScripts: true,
    };
    this.panel.webview.html = this.getHtml(this.panel.webview, this.service.getInitialSnapshot());
    this.panel.webview.onDidReceiveMessage((message: ProjectEnvironmentMessage) => {
      void this.handleMessage(message);
    });
    this.panel.onDidDispose(() => {
      if (this.loadingTimer) {
        clearTimeout(this.loadingTimer);
        this.loadingTimer = undefined;
      }
      this.panel = undefined;
    });
    this.loadSnapshot(false);
  }

  dispose(): void {
    if (this.loadingTimer) {
      clearTimeout(this.loadingTimer);
      this.loadingTimer = undefined;
    }
    this.panel?.dispose();
  }

  refresh(): void {
    this.loadSnapshot(true);
  }

  private async handleMessage(message: ProjectEnvironmentMessage): Promise<void> {
    try {
      if (message.type === 'refresh') {
        this.postStatus('loading', 'Обновляю списки баз и платформ...');
        this.refresh();
        return;
      }

      const snapshot = this.service.save({
        platformPath: message.platformPath,
        baseId: message.baseId,
        dbUser: message.dbUser,
        dbPassword: message.dbPassword,
      });
      this.postState(snapshot);
      this.postStatus('success', 'Настройки сохранены в env.json.');
      await vscode.window.showInformationMessage('Настройки запуска 1С сохранены в env.json.');
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      this.outputChannel.appendLine(`[environment][error] ${text}`);
      this.postStatus('error', text);
      await vscode.window.showErrorMessage(`Не удалось сохранить настройки запуска.\n${text}`);
    }
  }

  private postState(snapshot: ProjectEnvironmentSnapshot): void {
    void this.panel?.webview.postMessage({
      type: 'state',
      state: snapshot,
    });
  }

  private postStatus(kind: 'idle' | 'loading' | 'success' | 'error', message: string): void {
    void this.panel?.webview.postMessage({
      type: 'status',
      kind,
      message,
    });
  }

  private loadSnapshot(forceRefresh: boolean): void {
    if (this.loadingTimer) {
      clearTimeout(this.loadingTimer);
    }

    this.postStatus('loading', forceRefresh
      ? 'Обновляю списки баз и платформ...'
      : 'Загружаю списки баз и платформ...'
    );
    this.loadingTimer = setTimeout(() => {
      this.loadingTimer = undefined;
      try {
        this.postState(this.service.getSnapshot(forceRefresh));
        this.postStatus('idle', '');
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        this.outputChannel.appendLine(`[environment][error] ${text}`);
        this.postStatus('error', text);
      }
    }, 0);
  }

  private getHtml(webview: vscode.Webview, snapshot: ProjectEnvironmentSnapshot): string {
    const nonce = getNonce();
    const stateJson = JSON.stringify(snapshot).replace(/</g, '\\u003C');
    return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      box-sizing: border-box;
      padding: 10px 12px 12px;
      margin: 0;
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }

    .layout {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    section {
      display: flex;
      flex-direction: column;
      gap: 7px;
      padding-bottom: 11px;
      border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border));
    }

    section:last-of-type {
      border-bottom: 0;
      padding-bottom: 0;
    }

    .title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      min-height: 18px;
      font-weight: 600;
      color: var(--vscode-sideBarTitle-foreground, var(--vscode-foreground));
    }

    .count {
      color: var(--vscode-descriptionForeground);
      font-weight: 400;
      white-space: nowrap;
    }

    label {
      display: flex;
      flex-direction: column;
      gap: 4px;
      color: var(--vscode-descriptionForeground);
    }

    select,
    input {
      width: 100%;
      min-height: 28px;
      box-sizing: border-box;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 4px;
      font: inherit;
      outline: none;
    }

    select {
      padding: 3px 6px;
    }

    input {
      padding: 3px 7px;
    }

    select:focus,
    input:focus {
      border-color: var(--vscode-focusBorder);
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: -1px;
    }

    .details,
    .path,
    .empty,
    .warning {
      color: var(--vscode-descriptionForeground);
      line-height: 1.35;
      overflow-wrap: anywhere;
    }

    .details strong {
      color: var(--vscode-foreground);
      font-weight: 600;
    }

    .warning {
      color: var(--vscode-inputValidation-warningForeground, var(--vscode-descriptionForeground));
    }

    .status {
      display: none;
      align-items: center;
      gap: 8px;
      min-height: 24px;
      color: var(--vscode-descriptionForeground);
      line-height: 1.35;
    }

    .status.visible {
      display: flex;
    }

    .status.success {
      color: var(--vscode-testing-iconPassed, var(--vscode-descriptionForeground));
    }

    .status.error {
      color: var(--vscode-inputValidation-errorForeground, var(--vscode-errorForeground));
    }

    .spinner {
      width: 14px;
      height: 14px;
      box-sizing: border-box;
      border: 2px solid var(--vscode-progressBar-background);
      border-right-color: transparent;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      flex: 0 0 auto;
    }

    .spinner.hidden {
      display: none;
    }

    .buttons {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 6px;
    }

    button {
      min-height: 30px;
      padding: 5px 10px;
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 4px;
      font: inherit;
      cursor: pointer;
    }

    .primary {
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
    }

    .primary:hover {
      background: var(--vscode-button-hoverBackground);
    }

    .secondary {
      color: var(--vscode-button-secondaryForeground);
      background: var(--vscode-button-secondaryBackground);
    }

    .secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }

    button:disabled,
    select:disabled,
    input:disabled {
      cursor: default;
      opacity: 0.65;
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
  </style>
</head>
<body>
  <div class="layout">
    <section>
      <div class="title">
        <span>Платформа 1С</span>
        <span id="platformCount" class="count"></span>
      </div>
      <label>
        Версия
        <select id="platform"></select>
      </label>
      <div id="platformPath" class="path"></div>
    </section>

    <section>
      <div class="title">
        <span>Информационная база</span>
        <span id="baseCount" class="count"></span>
      </div>
      <label>
        База
        <select id="base"></select>
      </label>
      <div id="baseDetails" class="details"></div>
    </section>

    <section>
      <label>
        Пользователь
        <input id="dbUser" type="text" autocomplete="off" spellcheck="false">
      </label>
      <label>
        Пароль
        <input id="dbPassword" type="password" autocomplete="off" spellcheck="false">
      </label>
    </section>

    <div id="warnings"></div>
    <div id="status" class="status" aria-live="polite">
      <span id="spinner" class="spinner hidden" aria-hidden="true"></span>
      <span id="statusText"></span>
    </div>
    <div class="buttons">
      <button id="save" class="primary" type="button">Сохранить</button>
      <button id="refresh" class="secondary" type="button">Обновить</button>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let state = ${stateJson};

    const platform = document.getElementById('platform');
    const platformPath = document.getElementById('platformPath');
    const platformCount = document.getElementById('platformCount');
    const base = document.getElementById('base');
    const baseDetails = document.getElementById('baseDetails');
    const baseCount = document.getElementById('baseCount');
    const dbUser = document.getElementById('dbUser');
    const dbPassword = document.getElementById('dbPassword');
    const warnings = document.getElementById('warnings');
    const status = document.getElementById('status');
    const spinner = document.getElementById('spinner');
    const statusText = document.getElementById('statusText');
    const save = document.getElementById('save');
    const refresh = document.getElementById('refresh');
    const controls = [platform, base, dbUser, dbPassword, save, refresh];
    let saving = false;
    let loading = false;

    function render() {
      const selectedPlatform = state.settings.platformPath || '';
      const selectedBase = findSelectedBaseId();

      renderPlatformOptions(selectedPlatform);
      renderBaseOptions(selectedBase);
      dbUser.value = state.settings.dbUser || '';
      dbPassword.value = state.settings.dbPassword || '';
      renderWarnings();
      updateDetails();
      applyControlState();
    }

    function renderPlatformOptions(selectedPlatform) {
      platform.replaceChildren();
      platform.append(new Option('Автоопределение', ''));
      for (const item of state.platforms) {
        platform.append(new Option(item.label, item.executablePath));
      }
      platform.value = selectedPlatform;
      platformCount.textContent = state.platforms.length ? String(state.platforms.length) : '0';
    }

    function renderBaseOptions(selectedBase) {
      base.replaceChildren();
      for (const item of state.bases) {
        base.append(new Option(item.name, item.id));
      }
      base.disabled = state.bases.length === 0;
      base.value = selectedBase;
      baseCount.textContent = state.bases.length ? String(state.bases.length) : '0';
    }

    function findSelectedBaseId() {
      const byConnection = state.bases.find((item) => item.connection === state.settings.ibConnection);
      return byConnection?.id || state.bases[0]?.id || '';
    }

    function updateDetails() {
      const selectedPlatform = state.platforms.find((item) => item.executablePath === platform.value);
      platformPath.textContent = platform.value
        ? selectedPlatform?.executablePath || platform.value
        : 'Путь будет найден автоматически при запуске.';

      const selectedBase = state.bases.find((item) => item.id === base.value);
      if (!selectedBase) {
        baseDetails.textContent = 'Системный список баз 1С пуст.';
        return;
      }

      if (selectedBase.kind === 'file') {
        baseDetails.innerHTML = '<strong>Файловая:</strong> ' + escapeHtml(selectedBase.filePath || '');
      } else if (selectedBase.kind === 'server') {
        baseDetails.innerHTML = '<strong>Серверная:</strong> ' + escapeHtml((selectedBase.server || '') + '/' + (selectedBase.ref || ''));
      } else {
        baseDetails.textContent = selectedBase.connection;
      }
    }

    function renderWarnings() {
      warnings.replaceChildren();
      for (const warning of state.warnings) {
        const item = document.createElement('div');
        item.className = 'warning';
        item.textContent = warning;
        warnings.append(item);
      }
    }

    function setSaving(nextSaving) {
      saving = nextSaving;
      loading = false;
      applyControlState();
      save.textContent = nextSaving ? 'Сохранение...' : 'Сохранить';
      status.className = nextSaving ? 'status visible' : 'status';
      spinner.className = nextSaving ? 'spinner' : 'spinner hidden';
      statusText.textContent = nextSaving ? 'Сохраняю настройки проекта...' : '';
    }

    function showStatus(kind, message) {
      if (kind === 'loading') {
        loading = true;
        saving = false;
        applyControlState();
        save.textContent = 'Сохранить';
        spinner.className = 'spinner';
        status.className = 'status visible';
        statusText.textContent = message;
        return;
      }

      if (kind === 'idle') {
        loading = false;
        saving = false;
        applyControlState();
        save.textContent = 'Сохранить';
        spinner.className = 'spinner hidden';
        status.className = 'status';
        statusText.textContent = '';
        return;
      }

      saving = false;
      loading = false;
      applyControlState();
      save.textContent = 'Сохранить';
      spinner.className = 'spinner hidden';
      status.className = 'status visible ' + kind;
      statusText.textContent = message;
    }

    function applyControlState() {
      for (const control of controls) {
        control.disabled = saving || loading || (control === base && state.bases.length === 0);
      }
    }

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    platform.addEventListener('change', updateDetails);
    base.addEventListener('change', updateDetails);

    save.addEventListener('click', () => {
      if (saving || loading) {
        return;
      }
      setSaving(true);
      vscode.postMessage({
        type: 'save',
        platformPath: platform.value,
        baseId: base.value,
        dbUser: dbUser.value,
        dbPassword: dbPassword.value,
      });
    });

    refresh.addEventListener('click', () => {
      if (saving || loading) {
        return;
      }
      vscode.postMessage({ type: 'refresh' });
    });

    window.addEventListener('message', (event) => {
      if (event.data?.type === 'state') {
        state = event.data.state;
        render();
      } else if (event.data?.type === 'status') {
        showStatus(event.data.kind, event.data.message);
      }
    });

    render();
    showStatus('loading', 'Загружаю списки баз и платформ...');
  </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i += 1) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}
