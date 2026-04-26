import * as vscode from 'vscode';

interface CommitMessageSubmit {
  type: 'submit';
  payload: RepositoryCommitFormData;
}

interface CommitMessageCancel {
  type: 'cancel';
}

type CommitMessage = CommitMessageSubmit | CommitMessageCancel;

export interface RepositoryCommitFormData {
  comment: string;
  recursive: boolean;
  keepLocked: boolean;
  force: boolean;
}

/**
 * Панель помещения изменений в хранилище.
 * Нужна отдельно от quick input, потому что операция требует сразу несколько связанных параметров.
 */
export class RepositoryCommitViewProvider {
  private panel: vscode.WebviewPanel | undefined;
  private resolver: ((value: RepositoryCommitFormData | undefined) => void) | undefined;

  constructor(private readonly extensionUri: vscode.Uri) {}

  async show(targetLabel: string, initiallyLocked: boolean): Promise<RepositoryCommitFormData | undefined> {
    if (this.panel) {
      this.panel.dispose();
    }

    this.panel = vscode.window.createWebviewPanel(
      'v8vsceditRepositoryCommit',
      `Хранилище: помещение (${targetLabel})`,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: false,
        localResourceRoots: [this.extensionUri],
      }
    );

    this.panel.onDidDispose(() => {
      if (this.resolver) {
        this.resolver(undefined);
        this.resolver = undefined;
      }
      this.panel = undefined;
    });

    this.panel.webview.html = this.getHtml(this.panel.webview, targetLabel, initiallyLocked);
    this.panel.webview.onDidReceiveMessage((message: CommitMessage) => {
      if (!this.resolver || !this.panel) {
        return;
      }

      if (message.type === 'cancel') {
        const resolve = this.resolver;
        this.resolver = undefined;
        this.panel.dispose();
        resolve(undefined);
        return;
      }

      const resolve = this.resolver;
      this.resolver = undefined;
      this.panel.dispose();
      resolve(message.payload);
    });

    return new Promise<RepositoryCommitFormData | undefined>((resolve) => {
      this.resolver = resolve;
    });
  }

  private getHtml(
    webview: vscode.Webview,
    targetLabel: string,
    initiallyLocked: boolean
  ): string {
    const nonce = getNonce();

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
      max-width: 780px;
      margin: 0 auto;
      display: grid;
      gap: 16px;
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
    textarea {
      width: 100%;
      min-height: 180px;
      box-sizing: border-box;
      padding: 10px 12px;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 6px;
      font: inherit;
      resize: vertical;
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
      margin-top: 2px;
    }
    .hint {
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      line-height: 1.4;
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
    }
    button {
      min-height: 34px;
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
  </style>
</head>
<body>
  <div class="layout">
    <section class="card">
      <h1>Помещение в хранилище</h1>
      <p class="subtitle">${escapeHtml(targetLabel)}. Комментарий обязателен для осмысленной истории версий, а параметры помещения применяются только к текущей операции.</p>
    </section>
    <section class="card grid">
      <label>
        Комментарий
        <textarea id="comment" placeholder="Что изменено и зачем"></textarea>
      </label>
      <div class="hint">Если оставить флаг «Оставить захваченным», локальное состояние замка не изменится после помещения.</div>
    </section>
    <section class="card options">
      <label class="check">
        <input id="recursive" type="checkbox">
        <span>Выполнить помещение рекурсивно для подчинённых объектов.</span>
      </label>
      <label class="check">
        <input id="keepLocked" type="checkbox" ${initiallyLocked ? 'checked' : ''}>
        <span>Оставить объект захваченным после помещения.</span>
      </label>
      <label class="check">
        <input id="force" type="checkbox">
        <span>
          Игнорировать часть предупреждений платформы.
          <div class="hint">Соответствует параметру -force.</div>
        </span>
      </label>
    </section>
    <section class="actions">
      <button id="cancel" class="secondary" type="button">Отмена</button>
      <button id="submit" class="primary" type="button">Поместить</button>
    </section>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const byId = (id) => document.getElementById(id);
    byId('cancel').addEventListener('click', () => {
      vscode.postMessage({ type: 'cancel' });
    });
    byId('submit').addEventListener('click', () => {
      vscode.postMessage({
        type: 'submit',
        payload: {
          comment: byId('comment').value.trim(),
          recursive: Boolean(byId('recursive').checked),
          keepLocked: Boolean(byId('keepLocked').checked),
          force: Boolean(byId('force').checked),
        }
      });
    });
  </script>
</body>
</html>`;
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
