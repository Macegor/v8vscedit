/**
 * Writable CustomEditorProvider для визуального редактирования форм 1С.
 * Поддерживает drag-and-drop, редактирование свойств, удаление элементов.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import { parseFormXml } from './FormXmlParser';
import { FormXmlDocument } from './FormXmlSerializer';

// ── CustomDocument ──────────────────────────────────────────────────────────

class FormDocument implements vscode.CustomDocument {
  private readonly _onDidDispose = new vscode.EventEmitter<void>();
  readonly onDidDispose = this._onDidDispose.event;

  private _xmlDoc: FormXmlDocument;
  private _isDirty = false;

  /** Стек undo: XML-снапшоты до каждого изменения */
  private undoStack: string[] = [];
  /** Стек redo: XML-снапшоты отменённых изменений */
  private redoStack: string[] = [];
  private static readonly MAX_UNDO = 50;

  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  constructor(readonly uri: vscode.Uri, content: string) {
    this._xmlDoc = new FormXmlDocument(content);
  }

  get xmlDoc(): FormXmlDocument {
    return this._xmlDoc;
  }

  get isDirty(): boolean {
    return this._isDirty;
  }

  /** Сохранить снапшот перед изменением */
  pushUndo(): void {
    this.undoStack.push(this._xmlDoc.serialize());
    if (this.undoStack.length > FormDocument.MAX_UNDO) {
      this.undoStack.shift();
    }
    this.redoStack.length = 0;
  }

  /** Отменить последнее изменение */
  undo(): boolean {
    const snapshot = this.undoStack.pop();
    if (!snapshot) return false;
    this.redoStack.push(this._xmlDoc.serialize());
    this._xmlDoc = new FormXmlDocument(snapshot);
    this._isDirty = this.undoStack.length > 0;
    this._onDidChange.fire();
    return true;
  }

  /** Повторить отменённое изменение */
  redo(): boolean {
    const snapshot = this.redoStack.pop();
    if (!snapshot) return false;
    this.undoStack.push(this._xmlDoc.serialize());
    this._xmlDoc = new FormXmlDocument(snapshot);
    this._isDirty = true;
    this._onDidChange.fire();
    return true;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  markDirty(): void {
    this._isDirty = true;
    this._onDidChange.fire();
  }

  markClean(): void {
    this._isDirty = false;
  }

  reload(content: string): void {
    this._xmlDoc = new FormXmlDocument(content);
    this._isDirty = false;
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }

  dispose(): void {
    this._onDidDispose.fire();
    this._onDidDispose.dispose();
    this._onDidChange.dispose();
  }
}

// ── Provider ────────────────────────────────────────────────────────────────

export class FormEditorProvider implements vscode.CustomEditorProvider<FormDocument> {
  static readonly viewType = 'v8vscedit.formEditor';

  private readonly _onDidChangeCustomDocument =
    new vscode.EventEmitter<vscode.CustomDocumentContentChangeEvent<FormDocument>>();
  readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;
  private readonly webviews = new Map<string, vscode.Webview>();

  constructor(private readonly extensionUri: vscode.Uri) {}

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new FormEditorProvider(context.extensionUri);
    return vscode.window.registerCustomEditorProvider(
      FormEditorProvider.viewType,
      provider,
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      }
    );
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  async openCustomDocument(uri: vscode.Uri): Promise<FormDocument> {
    const content = fs.readFileSync(uri.fsPath, 'utf-8');
    return new FormDocument(uri, content);
  }

  resolveCustomEditor(
    document: FormDocument,
    webviewPanel: vscode.WebviewPanel
  ): void {
    this.webviews.set(document.uri.toString(), webviewPanel.webview);

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'dist'),
      ],
    };

    webviewPanel.webview.html = this.getHtml(webviewPanel.webview);

    // Отправить начальную модель
    this.sendModel(document, webviewPanel.webview);

    // Обработка сообщений от webview
    webviewPanel.webview.onDidReceiveMessage(
      (msg) => this.handleMessage(msg, document, webviewPanel.webview)
    );

    // File watcher для внешних изменений
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(
        vscode.Uri.file(document.uri.fsPath.replace(/[/\\][^/\\]+$/, '')),
        '*.xml'
      )
    );
    watcher.onDidChange(() => {
      if (!document.isDirty) {
        const content = fs.readFileSync(document.uri.fsPath, 'utf-8');
        document.reload(content);
        this.sendModel(document, webviewPanel.webview);
      }
    });
    webviewPanel.onDidDispose(() => {
      watcher.dispose();
      this.webviews.delete(document.uri.toString());
    });
  }

  // ── Save ────────────────────────────────────────────────────────────────

  async saveCustomDocument(document: FormDocument): Promise<void> {
    const xml = document.xmlDoc.serialize();
    fs.writeFileSync(document.uri.fsPath, xml, 'utf-8');
    document.markClean();
  }

  async saveCustomDocumentAs(
    document: FormDocument,
    destination: vscode.Uri
  ): Promise<void> {
    const xml = document.xmlDoc.serialize();
    fs.writeFileSync(destination.fsPath, xml, 'utf-8');
  }

  async revertCustomDocument(document: FormDocument): Promise<void> {
    const content = fs.readFileSync(document.uri.fsPath, 'utf-8');
    document.reload(content);
    const webview = this.webviews.get(document.uri.toString());
    if (webview) {
      this.sendModel(document, webview);
    }
  }

  async backupCustomDocument(
    document: FormDocument,
    context: vscode.CustomDocumentBackupContext
  ): Promise<vscode.CustomDocumentBackup> {
    const xml = document.xmlDoc.serialize();
    fs.writeFileSync(context.destination.fsPath, xml, 'utf-8');
    return {
      id: context.destination.toString(),
      delete: () => {
        try { fs.unlinkSync(context.destination.fsPath); } catch {}
      },
    };
  }

  // ── Message handling ──────────────────────────────────────────────────────

  private handleMessage(
    msg: {
      type: string;
      elementId?: number;
      targetParentId?: number;
      insertBeforeId?: number | null;
      propertyName?: string;
      value?: string;
      parentId?: number;
      elementType?: string;
      elementName?: string;
      dataPath?: string;
      handlerName?: string;
    },
    document: FormDocument,
    webview: vscode.Webview
  ): void {
    switch (msg.type) {
      case 'moveElement': {
        document.pushUndo();
        const ok = document.xmlDoc.moveElement(
          msg.elementId!,
          msg.targetParentId!,
          msg.insertBeforeId ?? null
        );
        if (ok) {
          this.markChanged(document);
          this.sendModel(document, webview);
        }
        break;
      }

      case 'updateProperty': {
        document.pushUndo();
        const ok = document.xmlDoc.updateElementProperty(
          msg.elementId!,
          msg.propertyName!,
          msg.value!
        );
        if (ok) {
          this.markChanged(document);
          this.sendModel(document, webview);
        }
        break;
      }

      case 'deleteElement': {
        document.pushUndo();
        const ok = document.xmlDoc.deleteElement(msg.elementId!);
        if (ok) {
          this.markChanged(document);
          this.sendModel(document, webview);
        }
        break;
      }

      case 'createElement': {
        document.pushUndo();
        const result = document.xmlDoc.createElement(
          msg.parentId!,
          msg.elementType!,
          msg.elementName!,
          msg.insertBeforeId ?? null
        );
        if (result.success) {
          this.markChanged(document);
          this.sendModel(document, webview);
        }
        break;
      }

      case 'createElementWithDataPath': {
        document.pushUndo();
        const result = document.xmlDoc.createElement(
          msg.parentId!,
          msg.elementType!,
          msg.elementName!,
          null
        );
        if (result.success) {
          // Установить DataPath на новый элемент
          if (msg.dataPath) {
            document.xmlDoc.updateElementProperty(result.newId, 'DataPath', msg.dataPath);
          }
          this.markChanged(document);
          this.sendModel(document, webview);
        }
        break;
      }

      case 'openModule': {
        const formDir = document.uri.fsPath.replace(/[/\\][^/\\]+$/, '');
        const moduleFile = formDir.replace(/[/\\]Ext$/, '') + '/Ext/Form/Module.bsl';
        const moduleUri = vscode.Uri.file(moduleFile);
        vscode.commands.executeCommand('vscode.open', moduleUri);
        break;
      }

      case 'goToHandler': {
        const formDir2 = document.uri.fsPath.replace(/[/\\][^/\\]+$/, '');
        const moduleFile2 = formDir2.replace(/[/\\]Ext$/, '') + '/Ext/Form/Module.bsl';
        const handlerName = msg.handlerName ?? '';
        try {
          const fs2 = require('fs');
          if (fs2.existsSync(moduleFile2)) {
            const content: string = fs2.readFileSync(moduleFile2, 'utf-8');
            // Ищем процедуру/функцию по имени
            const regex = new RegExp(`^\\s*(Процедура|Функция|Procedure|Function)\\s+${handlerName}\\b`, 'mi');
            const match = regex.exec(content);
            const line = match ? content.substring(0, match.index).split('\n').length : 1;
            const moduleUri = vscode.Uri.file(moduleFile2);
            vscode.window.showTextDocument(moduleUri, {
              selection: new vscode.Range(line - 1, 0, line - 1, 0),
            });
          } else {
            vscode.window.showWarningMessage(`Module.bsl не найден: ${moduleFile2}`);
          }
        } catch {
          vscode.commands.executeCommand('vscode.open', vscode.Uri.file(moduleFile2));
        }
        break;
      }

      case 'selectElement':
        // Только визуальная синхронизация, обрабатывается в webview
        break;

      case 'undo': {
        if (document.undo()) {
          this._onDidChangeCustomDocument.fire({ document });
          this.sendModel(document, webview);
        }
        break;
      }

      case 'redo': {
        if (document.redo()) {
          this._onDidChangeCustomDocument.fire({ document });
          this.sendModel(document, webview);
        }
        break;
      }
    }
  }

  private markChanged(document: FormDocument): void {
    document.markDirty();
    this._onDidChangeCustomDocument.fire({ document });
  }

  private sendModel(document: FormDocument, webview: vscode.Webview): void {
    try {
      // Пере-парсим из текущего XML чтобы получить актуальную FormModel
      const xml = document.xmlDoc.serialize();
      const model = parseFormXml(xml);
      webview.postMessage({ type: 'formLoaded', model });
    } catch (err) {
      webview.postMessage({
        type: 'error',
        message: `Ошибка при парсинге формы: ${err}`,
      });
    }
  }

  // ── HTML ───────────────────────────────────────────────────────────────────

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'formEditor.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'formEditor.css')
    );

    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>Визуальный редактор формы</title>
</head>
<body>
  <div class="form-editor" id="form-editor">
    <!-- Top row -->
    <div class="panel element-tree-panel" id="panel-tree">
      <div class="panel-body" id="tree-body"></div>
      <div class="tab-bar tab-bar-bottom">
        <div class="tab active" data-tab="elements" data-panel="tree">Элементы</div>
        <div class="tab" data-tab="command-interface" data-panel="tree">Командный интерфейс</div>
      </div>
    </div>
    <div class="splitter splitter-v" id="splitter-v-top" title="Перетащите для изменения ширины"></div>
    <div class="panel data-panel" id="panel-data">
      <div class="tab-bar tab-bar-top">
        <div class="tab active" data-tab="attributes" data-panel="data">Реквизиты</div>
        <div class="tab" data-tab="commands" data-panel="data">Команды</div>
        <div class="tab" data-tab="parameters" data-panel="data">Параметры</div>
      </div>
      <div class="panel-body" id="data-body"></div>
    </div>
    <!-- Horizontal splitter -->
    <div class="splitter splitter-h" id="splitter-h" title="Перетащите для изменения высоты"></div>
    <!-- Bottom row -->
    <div class="panel form-preview-panel" id="panel-preview">
      <div class="panel-body" id="preview-body"></div>
      <div class="tab-bar tab-bar-bottom">
        <div class="tab active" data-tab="form-preview" data-panel="preview">Форма</div>
        <div class="tab" data-tab="module" data-panel="preview">Модуль</div>
      </div>
    </div>
    <div class="splitter splitter-v" id="splitter-v-bottom" title="Перетащите для изменения ширины"></div>
    <div class="panel property-panel" id="panel-props">
      <div class="panel-header">Свойства</div>
      <div class="panel-body" id="property-body"></div>
    </div>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
