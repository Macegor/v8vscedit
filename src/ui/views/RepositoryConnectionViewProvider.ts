import * as path from 'path';
import * as vscode from 'vscode';
import { RepositoryBinding, RepositoryTarget } from '../../infra/repository/RepositoryService';

type ConnectionMode = 'bind' | 'create';

interface ConnectionMessageSubmit {
  type: 'submit';
  payload: RepositoryConnectionFormData;
}

interface ConnectionMessageCancel {
  type: 'cancel';
}

interface ConnectionMessageBrowseRepoPath {
  type: 'browseRepoPath';
  payload: {
    currentValue: string;
  };
}

type ConnectionMessage =
  | ConnectionMessageSubmit
  | ConnectionMessageCancel
  | ConnectionMessageBrowseRepoPath;

type ConnectionHostMessage =
  | {
    type: 'setRepoPath';
    payload: string;
  }
  | {
    type: 'setBusy';
    payload: {
      busy: boolean;
      message: string;
    };
  }
  | {
    type: 'setError';
    payload: string;
  };

export interface RepositoryConnectionFormData {
  repoPath: string;
  repoUser: string;
  repoPassword: string;
  forceBindAlreadyBindedUser: boolean;
  forceReplaceCfg: boolean;
  allowConfigurationChanges: boolean;
  changesAllowedRule: string;
  changesNotRecommendedRule: string;
  noBind: boolean;
}

export interface RepositoryConnectionSubmitResult {
  success: boolean;
  errorMessage?: string;
}

/**
 * Панель ввода параметров подключения или создания хранилища.
 * Окно остаётся открытым до завершения операции, чтобы можно было показать состояние выполнения.
 */
export class RepositoryConnectionViewProvider {
  private panel: vscode.WebviewPanel | undefined;
  private completionResolver: (() => void) | undefined;
  private isBusy = false;

  constructor(private readonly extensionUri: vscode.Uri) {}

  async show(
    mode: ConnectionMode,
    target: RepositoryTarget,
    initialBinding: RepositoryBinding | null,
    onSubmit: (formData: RepositoryConnectionFormData) => Promise<RepositoryConnectionSubmitResult>
  ): Promise<void> {
    if (this.panel) {
      this.panel.dispose();
    }

    this.panel = vscode.window.createWebviewPanel(
      'v8vsceditRepositoryConnection',
      mode === 'bind'
        ? `Хранилище: подключение (${target.displayName})`
        : `Хранилище: создание (${target.displayName})`,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: false,
        localResourceRoots: [this.extensionUri],
      }
    );
    this.isBusy = false;

    this.panel.onDidDispose(() => {
      this.isBusy = false;
      const resolve = this.completionResolver;
      this.completionResolver = undefined;
      this.panel = undefined;
      resolve?.();
    });

    this.panel.webview.html = this.getHtml(this.panel.webview, mode, target, initialBinding);
    this.panel.webview.onDidReceiveMessage(async (message: ConnectionMessage) => {
      if (!this.panel || this.isBusy && message.type !== 'cancel') {
        return;
      }

      if (message.type === 'cancel') {
        this.panel.dispose();
        return;
      }

      if (message.type === 'browseRepoPath') {
        await this.handleBrowseRepoPath(message.payload.currentValue);
        return;
      }

      this.isBusy = true;
      await this.postMessage({
        type: 'setError',
        payload: '',
      });
      await this.postMessage({
        type: 'setBusy',
        payload: {
          busy: true,
          message: mode === 'bind'
            ? 'Подключаю конфигурацию к хранилищу...'
            : 'Создаю хранилище конфигурации...',
        },
      });

      try {
        const result = await onSubmit(message.payload);
        if (result.success) {
          this.panel?.dispose();
          return;
        }

        await this.postMessage({
          type: 'setBusy',
          payload: {
            busy: false,
            message: '',
          },
        });
        await this.postMessage({
          type: 'setError',
          payload: result.errorMessage ?? 'Операция не завершена.',
        });
      } catch (error) {
        await this.postMessage({
          type: 'setBusy',
          payload: {
            busy: false,
            message: '',
          },
        });
        await this.postMessage({
          type: 'setError',
          payload: error instanceof Error ? error.message : String(error),
        });
      } finally {
        this.isBusy = false;
      }
    });

    return new Promise<void>((resolve) => {
      this.completionResolver = resolve;
    });
  }

  private async handleBrowseRepoPath(currentValue: string): Promise<void> {
    const dialogUri = resolveExistingDialogUri(currentValue);
    const selected = await vscode.window.showOpenDialog({
      title: 'Выбор каталога или файла хранилища',
      openLabel: 'Выбрать',
      canSelectMany: false,
      canSelectFiles: true,
      canSelectFolders: true,
      defaultUri: dialogUri,
    });
    const repoPath = selected?.[0]?.fsPath;
    if (!repoPath) {
      return;
    }

    await this.postMessage({
      type: 'setRepoPath',
      payload: repoPath,
    });
  }

  private async postMessage(message: ConnectionHostMessage): Promise<void> {
    if (!this.panel) {
      return;
    }
    await this.panel.webview.postMessage(message);
  }

  private getHtml(
    webview: vscode.Webview,
    mode: ConnectionMode,
    target: RepositoryTarget,
    initialBinding: RepositoryBinding | null
  ): string {
    const nonce = getNonce();
    const repoPath = escapeHtml(initialBinding?.repoPath ?? '');
    const repoUser = escapeHtml(initialBinding?.repoUser ?? '');
    const repoPassword = escapeHtml(initialBinding?.repoPassword ?? '');
    const title = mode === 'bind' ? 'Подключение к хранилищу' : 'Создание хранилища';
    const submitCaption = mode === 'bind' ? 'Подключить' : 'Создать';

    return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      padding: 16px;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    .layout {
      max-width: 840px;
      margin: 0 auto;
      display: grid;
      gap: 16px;
      position: relative;
    }
    .card {
      padding: 16px;
      border: 1px solid var(--vscode-panel-border, var(--vscode-input-border, transparent));
      border-radius: 10px;
      background: linear-gradient(180deg, var(--vscode-sideBar-background), var(--vscode-editor-background));
    }
    h1 {
      margin: 0 0 8px;
      font-size: 18px;
    }
    .subtitle {
      margin: 0;
      color: var(--vscode-descriptionForeground);
      line-height: 1.45;
    }
    .grid {
      display: grid;
      gap: 12px;
    }
    label {
      display: grid;
      gap: 6px;
      font-weight: 600;
    }
    .caption {
      display: flex;
      align-items: baseline;
      gap: 8px;
      flex-wrap: wrap;
    }
    .caption-original {
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      font-weight: 400;
    }
    input, select {
      width: 100%;
      box-sizing: border-box;
      min-height: 36px;
      padding: 7px 10px;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 6px;
      font: inherit;
    }
    .path-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
    }
    .browse-button {
      min-width: 118px;
    }
    .options {
      display: grid;
      gap: 10px;
    }
    .check {
      display: flex;
      gap: 10px;
      align-items: flex-start;
      font-weight: 400;
    }
    .check input {
      width: auto;
      min-height: auto;
      margin-top: 2px;
    }
    .check-text {
      display: grid;
      gap: 4px;
    }
    .hint {
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      line-height: 1.4;
    }
    .error {
      min-height: 20px;
      color: var(--vscode-errorForeground);
      font-size: 12px;
      line-height: 1.4;
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
    }
    button {
      min-height: 36px;
      padding: 0 14px;
      border-radius: 6px;
      border: 1px solid var(--vscode-button-border, transparent);
      font: inherit;
      cursor: pointer;
    }
    .secondary {
      color: var(--vscode-button-secondaryForeground);
      background: var(--vscode-button-secondaryBackground);
    }
    .primary {
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
    }
    .busy-overlay {
      position: absolute;
      inset: 0;
      display: none;
      align-items: center;
      justify-content: center;
      border-radius: 12px;
      background: color-mix(in srgb, var(--vscode-editor-background) 78%, transparent);
      backdrop-filter: blur(2px);
      z-index: 10;
    }
    .busy-overlay.visible {
      display: flex;
    }
    .busy-card {
      display: grid;
      justify-items: center;
      gap: 12px;
      padding: 18px 22px;
      border-radius: 12px;
      border: 1px solid var(--vscode-panel-border, var(--vscode-input-border, transparent));
      background: var(--vscode-sideBar-background);
    }
    .spinner {
      width: 34px;
      height: 34px;
      border-radius: 50%;
      border: 3px solid color-mix(in srgb, var(--vscode-progressBar-background) 28%, transparent);
      border-top-color: var(--vscode-progressBar-background);
      animation: spin 0.9s linear infinite;
    }
    .busy-text {
      color: var(--vscode-descriptionForeground);
    }
    .disabled {
      opacity: 0.65;
      pointer-events: none;
    }
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <div class="layout" id="layout">
    <div class="busy-overlay" id="busyOverlay" aria-hidden="true">
      <div class="busy-card">
        <div class="spinner"></div>
        <div class="busy-text" id="busyText">Подготовка...</div>
      </div>
    </div>
    <section class="card">
      <h1>${title}</h1>
      <p class="subtitle">${escapeHtml(target.displayName)}. Параметры сохраняются в env.json и затем используются всеми командами хранилища.</p>
    </section>
    <section class="card grid">
      <label>
        <span class="caption">
          <span>Путь к хранилищу или адрес сервера</span>
          <span class="caption-original">(repo-path)</span>
        </span>
        <div class="path-row">
          <input id="repoPath" value="${repoPath}" autocomplete="off" spellcheck="false">
          <button id="browseRepoPath" class="secondary browse-button" type="button">Выбрать…</button>
        </div>
      </label>
      <label>
        <span class="caption">
          <span>Пользователь хранилища</span>
          <span class="caption-original">(repo-user)</span>
        </span>
        <input id="repoUser" value="${repoUser}" autocomplete="off" spellcheck="false">
      </label>
      <label>
        <span class="caption">
          <span>Пароль хранилища</span>
          <span class="caption-original">(repo-pwd)</span>
        </span>
        <input id="repoPassword" type="password" value="${repoPassword}" autocomplete="off" spellcheck="false">
      </label>
    </section>
    <section class="card options">
      ${mode === 'bind' ? `
      <label class="check">
        <input id="forceBindAlreadyBindedUser" type="checkbox">
        <span class="check-text">
          <span class="caption">
            <span>Разрешить подключение, даже если пользователь уже привязан</span>
            <span class="caption-original">(forceBindAlreadyBindedUser)</span>
          </span>
          <span class="hint">Используйте, если платформа считает пользователя уже связанным с другим экземпляром конфигурации.</span>
        </span>
      </label>
      <label class="check">
        <input id="forceReplaceCfg" type="checkbox">
        <span class="check-text">
          <span class="caption">
            <span>Заменить текущую конфигурацию состоянием из хранилища</span>
            <span class="caption-original">(forceReplaceCfg)</span>
          </span>
          <span class="hint">Нужно, когда требуется без вопросов принять содержимое хранилища как источник истины.</span>
        </span>
      </label>` : `
      <label class="check">
        <input id="allowConfigurationChanges" type="checkbox">
        <span class="check-text">
          <span class="caption">
            <span>Разрешить изменение конфигурации на поддержке без возможности изменения</span>
            <span class="caption-original">(AllowConfigurationChanges)</span>
          </span>
        </span>
      </label>
      <label>
        <span class="caption">
          <span>Правило для разрешённых изменений</span>
          <span class="caption-original">(ChangesAllowedRule)</span>
        </span>
        <select id="changesAllowedRule">
          <option value="">Не менять</option>
          <option value="ObjectNotEditable">Объект не редактируется (ObjectNotEditable)</option>
          <option value="ObjectIsEditableSupportEnabled">Редактирование включено поддержкой (ObjectIsEditableSupportEnabled)</option>
          <option value="ObjectNotSupported">Объект не находится на поддержке (ObjectNotSupported)</option>
        </select>
      </label>
      <label>
        <span class="caption">
          <span>Правило для нерекомендуемых изменений</span>
          <span class="caption-original">(ChangesNotRecommendedRule)</span>
        </span>
        <select id="changesNotRecommendedRule">
          <option value="">Не менять</option>
          <option value="ObjectNotEditable">Объект не редактируется (ObjectNotEditable)</option>
          <option value="ObjectIsEditableSupportEnabled">Редактирование включено поддержкой (ObjectIsEditableSupportEnabled)</option>
          <option value="ObjectNotSupported">Объект не находится на поддержке (ObjectNotSupported)</option>
        </select>
      </label>
      <label class="check">
        <input id="noBind" type="checkbox">
        <span class="check-text">
          <span class="caption">
            <span>Создать хранилище без привязки текущей конфигурации</span>
            <span class="caption-original">(NoBind)</span>
          </span>
        </span>
      </label>`}
    </section>
    <div class="error" id="errorText"></div>
    <section class="actions">
      <button id="cancel" class="secondary" type="button">Отмена</button>
      <button id="submit" class="primary" type="button">${submitCaption}</button>
    </section>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const byId = (id) => document.getElementById(id);
    const layout = byId('layout');
    const busyOverlay = byId('busyOverlay');
    const busyText = byId('busyText');
    const errorText = byId('errorText');

    const setBusy = (busy, message) => {
      layout.classList.toggle('disabled', busy);
      busyOverlay.classList.toggle('visible', busy);
      busyOverlay.setAttribute('aria-hidden', String(!busy));
      busyText.textContent = message || 'Выполняется...';
    };

    const collectPayload = () => ({
      repoPath: byId('repoPath').value.trim(),
      repoUser: byId('repoUser').value.trim(),
      repoPassword: byId('repoPassword').value,
      forceBindAlreadyBindedUser: Boolean(byId('forceBindAlreadyBindedUser')?.checked),
      forceReplaceCfg: Boolean(byId('forceReplaceCfg')?.checked),
      allowConfigurationChanges: Boolean(byId('allowConfigurationChanges')?.checked),
      changesAllowedRule: byId('changesAllowedRule')?.value ?? '',
      changesNotRecommendedRule: byId('changesNotRecommendedRule')?.value ?? '',
      noBind: Boolean(byId('noBind')?.checked),
    });

    byId('cancel').addEventListener('click', () => {
      vscode.postMessage({ type: 'cancel' });
    });

    byId('browseRepoPath').addEventListener('click', () => {
      vscode.postMessage({
        type: 'browseRepoPath',
        payload: {
          currentValue: byId('repoPath').value.trim(),
        }
      });
    });

    byId('submit').addEventListener('click', () => {
      vscode.postMessage({
        type: 'submit',
        payload: collectPayload(),
      });
    });

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (!message || typeof message !== 'object') {
        return;
      }

      if (message.type === 'setRepoPath') {
        byId('repoPath').value = message.payload || '';
        return;
      }

      if (message.type === 'setBusy') {
        setBusy(Boolean(message.payload?.busy), message.payload?.message || '');
        return;
      }

      if (message.type === 'setError') {
        errorText.textContent = message.payload || '';
      }
    });
  </script>
</body>
</html>`;
  }
}

function resolveExistingDialogUri(currentValue: string): vscode.Uri | undefined {
  if (!currentValue.trim()) {
    return undefined;
  }

  const normalized = currentValue.trim().replace(/\//g, path.sep);
  if (!path.isAbsolute(normalized)) {
    return undefined;
  }

  try {
    return vscode.Uri.file(normalized);
  } catch {
    return undefined;
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let index = 0; index < 32; index += 1) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
