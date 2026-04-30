import * as vscode from 'vscode';
import * as fs from 'fs';
import { getMetaIcon } from '../../../domain/MetaTypes';
import {
  MetadataRefTreeNode,
  SubsystemEditorSnapshot,
  SubsystemPropertyKey,
  SubsystemXmlService,
} from '../../../infra/xml/SubsystemXmlService';
import { RepositoryService } from '../../../infra/repository/RepositoryService';
import { SupportInfoService, SupportMode } from '../../../infra/support/SupportInfoService';
import { MetadataNode } from '../../tree/TreeNode';

type SubsystemEditorMessage =
  | { type: 'propertyChanged'; key: SubsystemPropertyKey; value: string | boolean }
  | { type: 'addContent'; refs: string[] }
  | { type: 'removeContent'; refs: string[] }
  | { type: 'addChild'; name: string }
  | { type: 'removeChild'; name: string }
  | { type: 'openCommandInterface' };

/**
 * Специальная панель подсистем: свойства, состав и служебные секции.
 * Состав подсистемы редактируется через отдельный XML-сервис, а не через
 * общий список свойств.
 */
export class SubsystemEditorViewProvider implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private activeNode: MetadataNode | undefined;
  private updateQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly xmlService: SubsystemXmlService,
    private readonly supportService?: SupportInfoService,
    private readonly repositoryService?: RepositoryService,
    private readonly onAfterChange?: (xmlPath: string) => void
  ) {}

  show(node: MetadataNode): void {
    this.activeNode = node;
    if (this.panel) {
      this.panel.title = this.buildTitle(node);
      this.panel.webview.html = this.renderHtml(node, this.panel.webview);
      this.panel.reveal(this.panel.viewColumn ?? vscode.ViewColumn.Active, false);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'v8vsceditSubsystemEditor',
      this.buildTitle(node),
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.extensionUri],
      }
    );
    this.panel.webview.html = this.renderHtml(node, this.panel.webview);
    this.panel.webview.onDidReceiveMessage((message) => this.handleMessage(message));
    this.panel.onDidDispose(() => {
      this.panel = undefined;
      this.activeNode = undefined;
    });
  }

  dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
  }

  private buildTitle(node: MetadataNode): string {
    return `${node.textLabel} — Подсистема`;
  }

  private renderHtml(node: MetadataNode, webview: vscode.Webview): string {
    if (!node.xmlPath || !fs.existsSync(node.xmlPath)) {
      return this.renderState(webview, node.textLabel, 'XML-файл подсистемы не найден.');
    }

    const nonce = getNonce();
    const snapshot = this.xmlService.readSnapshot(node.xmlPath);
    const isLocked = this.isEditLocked(node);
    const contentRefs = new Set(snapshot.subsystem.contentRefs);
    const availableCount = countTreeLeaves(snapshot.contentTree);
    const selectedTree = buildSelectedContentTree(snapshot.contentTree, snapshot.subsystem.contentRefs);
    const contentHtml = this.renderContentEditor(snapshot, contentRefs, availableCount, selectedTree, webview, isLocked);

    return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
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
      max-width: 1040px;
      margin: 0 auto;
      display: grid;
      grid-template-columns: 160px minmax(0, 1fr);
      gap: 16px;
    }
    .tabs {
      display: grid;
      align-content: start;
      gap: 6px;
    }
    .tab {
      min-height: 34px;
      padding: 0 10px;
      text-align: left;
      color: var(--vscode-button-secondaryForeground);
      background: var(--vscode-button-secondaryBackground);
      border: 1px solid var(--vscode-button-border, var(--vscode-panel-border, transparent));
      border-radius: 6px;
      cursor: pointer;
      font: inherit;
    }
    .tab.active {
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
    }
    .panel {
      display: none;
      gap: 16px;
    }
    .panel.active {
      display: grid;
    }
    .card {
      padding: 16px;
      border: 1px solid var(--vscode-panel-border, var(--vscode-input-border, transparent));
      border-radius: 10px;
      background: linear-gradient(180deg, var(--vscode-sideBar-background), var(--vscode-editor-background));
    }
    .header {
      display: grid;
      gap: 6px;
    }
    h1 {
      margin: 0;
      font-size: 18px;
    }
    .subtitle,
    .hint,
    .counter {
      color: var(--vscode-descriptionForeground);
      line-height: 1.45;
    }
    .subtitle {
      margin: 0;
    }
    .grid {
      display: grid;
      gap: 12px;
    }
    .form-row {
      display: grid;
      grid-template-columns: minmax(150px, 28%) minmax(0, 1fr);
      gap: 12px;
      align-items: start;
    }
    label,
    .label {
      font-weight: 600;
    }
    input,
    textarea,
    select {
      width: 100%;
      box-sizing: border-box;
      min-height: 34px;
      padding: 7px 10px;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 6px;
      font: inherit;
    }
    textarea {
      min-height: 120px;
      resize: vertical;
    }
    input[type="checkbox"] {
      width: auto;
      min-height: 0;
      margin: 3px 0 0;
      accent-color: var(--vscode-checkbox-selectBackground);
    }
    .check {
      display: flex;
      gap: 10px;
      align-items: flex-start;
      font-weight: 400;
    }
    .content-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
      gap: 12px;
      align-items: stretch;
    }
    .tree-box {
      height: 430px;
      overflow: auto;
      padding: 4px;
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border, transparent));
      border-radius: 6px;
      background: var(--vscode-input-background);
    }
    .tree-box.drag-over {
      outline: 2px solid var(--vscode-focusBorder);
      outline-offset: -2px;
      background: var(--vscode-list-hoverBackground);
    }
    .tree-title {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: baseline;
      font-weight: 600;
    }
    .tree-node {
      margin-left: 8px;
    }
    .tree-node.root {
      margin-left: 8px;
    }
    .tree-group {
      margin: 1px 0;
    }
    .tree-summary {
      min-height: 24px;
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 0 4px 0 0;
      border-radius: 6px;
      cursor: pointer;
      user-select: none;
    }
    .tree-summary::-webkit-details-marker {
      display: none;
    }
    .tree-summary::marker {
      content: "";
    }
    .tree-summary:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .tree-toggle,
    .tree-spacer {
      width: 16px;
      height: 16px;
      flex: 0 0 16px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .tree-toggle::before {
      content: "";
      width: 5px;
      height: 5px;
      border: solid var(--vscode-descriptionForeground);
      border-width: 0 1.5px 1.5px 0;
      transform: rotate(-45deg);
      transition: transform 80ms ease;
    }
    details[open] > .tree-summary .tree-toggle::before {
      transform: rotate(45deg);
    }
    .tree-leaf {
      min-height: 24px;
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 0 4px;
      border-radius: 6px;
      cursor: pointer;
      user-select: none;
    }
    .tree-leaf[draggable="true"] {
      cursor: grab;
    }
    .tree-leaf.dragging {
      opacity: 0.55;
    }
    .tree-leaf:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .tree-leaf.selected {
      color: var(--vscode-list-activeSelectionForeground);
      background: var(--vscode-list-activeSelectionBackground);
    }
    .tree-leaf.included:not(.selected) {
      color: var(--vscode-descriptionForeground);
    }
    .tree-icon {
      width: 16px;
      height: 16px;
      flex: 0 0 16px;
    }
    .tree-kind {
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      margin-left: auto;
    }
    .transfer-actions {
      display: grid;
      align-content: center;
      gap: 8px;
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
    button:disabled,
    input:disabled,
    textarea:disabled,
    select:disabled {
      opacity: 0.55;
      cursor: default;
    }
    .primary {
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
    }
    .secondary {
      color: var(--vscode-button-secondaryForeground);
      background: var(--vscode-button-secondaryBackground);
    }
    .danger {
      color: var(--vscode-errorForeground);
      background: var(--vscode-input-background);
    }
    .child-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px;
      align-items: center;
    }
    .child-list {
      display: grid;
      gap: 8px;
    }
    .empty {
      padding: 12px;
      color: var(--vscode-descriptionForeground);
      border: 1px dashed var(--vscode-panel-border, var(--vscode-input-border, transparent));
      border-radius: 6px;
    }
    @media (max-width: 760px) {
      .layout {
        grid-template-columns: 1fr;
      }
      .tabs {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
      .form-row {
        grid-template-columns: 1fr;
      }
      .content-grid {
        grid-template-columns: 1fr;
      }
      .transfer-actions {
        grid-template-columns: repeat(2, max-content);
        justify-content: end;
      }
    }
  </style>
</head>
<body>
  <div class="layout">
    <nav class="tabs" aria-label="Разделы подсистемы">
      <button class="tab active" type="button" data-tab="main">Основные</button>
      <button class="tab" type="button" data-tab="content">Состав</button>
      <button class="tab" type="button" data-tab="other">Прочее</button>
    </nav>
    <main>
      <section class="panel active" data-panel="main">
        <section class="card header">
          <h1>${escapeHtml(snapshot.subsystem.name)}</h1>
          <p class="subtitle">${escapeHtml(snapshot.subsystem.synonym || 'Подсистема')}</p>
          ${isLocked ? '<p class="subtitle">Редактирование запрещено текущим состоянием поддержки или хранилища.</p>' : ''}
        </section>
        <section class="card grid">
          ${this.renderTextInput('Name', 'Имя', snapshot.subsystem.name, true)}
          ${this.renderTextInput('Synonym', 'Синоним', snapshot.subsystem.synonym, isLocked)}
          ${this.renderTextInput('Comment', 'Комментарий', snapshot.subsystem.comment, isLocked)}
          ${this.renderCheck('IncludeInCommandInterface', 'Включать в командный интерфейс', snapshot.subsystem.includeInCommandInterface, isLocked)}
          ${this.renderCheck('UseOneCommand', 'Подсистема с одной командой', snapshot.subsystem.useOneCommand, isLocked)}
          <div class="form-row">
            <span></span>
            <button class="secondary" id="openCommandInterface" type="button">Командный интерфейс</button>
          </div>
          ${this.renderTextarea('Explanation', 'Пояснение', snapshot.subsystem.explanation, isLocked)}
          ${this.renderTextInput('PictureRef', 'Картинка', snapshot.subsystem.pictureRef, isLocked)}
        </section>
      </section>

      <section class="panel" data-panel="content">
        <section class="card header">
          <h1>Состав</h1>
          <p class="subtitle" id="contentSummary">${snapshot.subsystem.contentRefs.length} из ${availableCount}</p>
        </section>
        <section class="card grid">
          <input id="contentFilter" type="search" placeholder="Фильтр" autocomplete="off">
          ${contentHtml}
        </section>
      </section>

      <section class="panel" data-panel="other">
        <section class="card grid">
          ${this.renderCheck('IncludeHelpInContents', 'Включать справку в содержание', snapshot.subsystem.includeHelpInContents, isLocked)}
          ${this.renderCheck('PictureLoadTransparent', 'Загружать прозрачный фон картинки', snapshot.subsystem.pictureLoadTransparent, isLocked)}
        </section>
        <section class="card grid">
          <div class="label">Подчинённые подсистемы</div>
          <div class="child-row">
            <input id="childName" type="text" ${isLocked ? 'disabled' : ''}>
            <button class="primary" id="addChild" type="button" ${isLocked ? 'disabled' : ''}>Добавить</button>
          </div>
          <div class="child-list">
            ${snapshot.subsystem.childSubsystems.length === 0
              ? '<div class="empty">Нет подчинённых подсистем</div>'
              : snapshot.subsystem.childSubsystems.map((name) => `
                <div class="child-row">
                  <span>${escapeHtml(name)}</span>
                  <button class="danger" type="button" data-remove-child="${escapeHtml(name)}" ${isLocked ? 'disabled' : ''}>Удалить</button>
                </div>
              `).join('')}
          </div>
        </section>
      </section>
    </main>
  </div>
  <script nonce="${nonce}">
    ${this.renderScript(snapshot, isLocked)}
  </script>
</body>
</html>`;
  }

  private renderState(webview: vscode.Webview, title: string, message: string): string {
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { padding: 16px; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); }
    .card { max-width: 760px; margin: 0 auto; padding: 16px; border: 1px solid var(--vscode-panel-border, transparent); border-radius: 10px; background: var(--vscode-sideBar-background); }
    h1 { margin: 0 0 8px; font-size: 18px; }
    p { margin: 0; color: var(--vscode-descriptionForeground); }
  </style>
</head>
<body><section class="card"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></section></body>
</html>`;
  }

  private renderTextInput(key: SubsystemPropertyKey, label: string, value: string, disabled: boolean): string {
    return `
      <label class="form-row">
        <span>${escapeHtml(label)}</span>
        <input data-prop="${key}" type="text" value="${escapeHtml(value)}" ${disabled ? 'disabled' : ''}>
      </label>
    `;
  }

  private renderTextarea(key: SubsystemPropertyKey, label: string, value: string, disabled: boolean): string {
    return `
      <label class="form-row">
        <span>${escapeHtml(label)}</span>
        <textarea data-prop="${key}" ${disabled ? 'disabled' : ''}>${escapeHtml(value)}</textarea>
      </label>
    `;
  }

  private renderCheck(key: SubsystemPropertyKey, label: string, value: boolean, disabled: boolean): string {
    return `
      <label class="form-row">
        <span>${escapeHtml(label)}</span>
        <span class="check"><input data-prop="${key}" type="checkbox" ${value ? 'checked' : ''} ${disabled ? 'disabled' : ''}></span>
      </label>
    `;
  }

  private renderContentEditor(
    snapshot: SubsystemEditorSnapshot,
    contentRefs: Set<string>,
    availableCount: number,
    selectedTree: MetadataRefTreeNode[],
    webview: vscode.Webview,
    isLocked: boolean
  ): string {
    return `
      <div class="content-grid">
        <div>
          <div class="tree-title">
            <span>Все объекты</span>
            <span class="counter" id="availableCounter">${availableCount}</span>
          </div>
          <div class="tree-box" id="availableContent" data-drop-tree="available">
            ${this.renderContentTree(snapshot.contentTree, contentRefs, 'available', webview, isLocked)}
          </div>
        </div>
        <div class="transfer-actions">
          <button class="primary" id="addContent" type="button" ${isLocked ? 'disabled' : ''}>Включить</button>
          <button class="secondary" id="removeContent" type="button" ${isLocked ? 'disabled' : ''}>Исключить</button>
        </div>
        <div>
          <div class="tree-title">
            <span>Входящие в подсистему объекты</span>
            <span class="counter" id="selectedCounter">${snapshot.subsystem.contentRefs.length}</span>
          </div>
          <div class="tree-box" id="selectedContent" data-drop-tree="selected">
            ${selectedTree.length > 0
              ? this.renderContentTree(selectedTree, contentRefs, 'selected', webview, isLocked)
              : '<div class="empty">Состав пуст</div>'}
          </div>
        </div>
      </div>
    `;
  }

  private renderContentTree(
    nodes: MetadataRefTreeNode[],
    contentRefs: Set<string>,
    treeName: 'available' | 'selected',
    webview: vscode.Webview,
    isLocked: boolean,
    depth = 0
  ): string {
    return nodes.map((node) => {
      if (node.ref) {
        const includedClass = contentRefs.has(node.ref) ? ' included' : '';
        return `
          <div class="tree-node ${depth === 0 ? 'root' : ''}">
            <div class="tree-leaf${includedClass}" data-tree="${treeName}" data-ref="${escapeHtml(node.ref)}" data-search="${escapeHtml(`${node.label} ${node.ref}`)}" draggable="${isLocked ? 'false' : 'true'}">
              <span class="tree-spacer" aria-hidden="true"></span>
              ${this.renderTreeIcon(webview, node)}
              <span>${escapeHtml(node.label)}</span>
              <span class="tree-kind">${escapeHtml(node.kind ?? '')}</span>
            </div>
          </div>
        `;
      }

      return `
        <details class="tree-node tree-group ${depth === 0 ? 'root' : ''}" data-node-id="${escapeHtml(node.id)}" ${depth === 0 ? 'open' : ''}>
          <summary class="tree-summary" data-search="${escapeHtml(node.label)}"><span class="tree-toggle" aria-hidden="true"></span>${this.renderTreeIcon(webview, node)}<span>${escapeHtml(node.label)}</span></summary>
          ${this.renderContentTree(node.children, contentRefs, treeName, webview, isLocked, depth + 1)}
        </details>
      `;
    }).join('');
  }

  private renderTreeIcon(webview: vscode.Webview, node: MetadataRefTreeNode): string {
    const icon = node.kind ? getMetaIcon(node.kind) : 'folder';
    const lightUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'src', 'icons', 'light', `${icon}.svg`));
    const darkUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'src', 'icons', 'dark', `${icon}.svg`));
    return `<picture><source srcset="${lightUri}" media="(prefers-color-scheme: light)"><img class="tree-icon" src="${darkUri}" alt=""></picture>`;
  }

  private renderScript(snapshot: SubsystemEditorSnapshot, isLocked: boolean): string {
    return `
      const vscode = acquireVsCodeApi();
      const isLocked = ${isLocked ? 'true' : 'false'};
      const byId = (id) => document.getElementById(id);
      const selection = { available: new Set(), selected: new Set() };
      let draggedRefs = [];
      let draggedFromTree = '';
      const getSelectedRefs = (tree) => Array.from(selection[tree] ?? []);
      const clearTreeSelection = (tree) => {
        selection[tree]?.clear();
        document.querySelectorAll('[data-tree="' + tree + '"].selected').forEach((item) => item.classList.remove('selected'));
      };
      const getLeafDragRefs = (leaf) => {
        const tree = leaf.dataset.tree;
        const ref = leaf.dataset.ref;
        if (!tree || !ref) return [];
        return selection[tree]?.has(ref) ? getSelectedRefs(tree) : [ref];
      };
      const sendContentTransfer = (targetTree, refs) => {
        if (isLocked || refs.length === 0) return;
        vscode.postMessage({
          type: targetTree === 'selected' ? 'addContent' : 'removeContent',
          refs,
        });
      };
      const collectOpenGroupIds = (containerId) => {
        return Array.from(byId(containerId)?.querySelectorAll('details.tree-group[open][data-node-id]') ?? [])
          .map((details) => details.dataset.nodeId)
          .filter(Boolean);
      };
      const restoreOpenGroupIds = (containerId, ids) => {
        const opened = new Set(ids);
        byId(containerId)?.querySelectorAll('details.tree-group[data-node-id]').forEach((details) => {
          details.open = opened.has(details.dataset.nodeId) || details.classList.contains('root');
        });
      };
      const applyContentFilter = () => {
        const query = String(byId('contentFilter')?.value ?? '').trim().toLowerCase();
        document.querySelectorAll('.tree-leaf[data-ref]').forEach((leaf) => {
          const source = String(leaf.dataset.search || leaf.textContent || '').toLowerCase();
          leaf.parentElement.hidden = query.length > 0 && !source.includes(query);
        });
        document.querySelectorAll('details.tree-group').forEach((details) => {
          details.open = query.length > 0 || details.open || details.classList.contains('root');
        });
      };
      const toggleLeaf = (leaf, event) => {
        const tree = leaf.dataset.tree;
        const ref = leaf.dataset.ref;
        if (!tree || !ref) return;
        if (!event.metaKey && !event.ctrlKey && !event.shiftKey) {
          clearTreeSelection(tree);
        }
        if (selection[tree].has(ref)) {
          selection[tree].delete(ref);
          leaf.classList.remove('selected');
        } else {
          selection[tree].add(ref);
          leaf.classList.add('selected');
        }
      };
      const bindTreeLeaves = () => {
        document.querySelectorAll('.tree-leaf[data-ref]').forEach((leaf) => {
          if (leaf.dataset.bound === 'true') return;
          leaf.dataset.bound = 'true';
          leaf.addEventListener('click', (event) => toggleLeaf(leaf, event));
          leaf.addEventListener('dragstart', (event) => {
            if (isLocked) {
              event.preventDefault();
              return;
            }
            draggedFromTree = leaf.dataset.tree || '';
            draggedRefs = getLeafDragRefs(leaf);
            if (draggedRefs.length === 0) {
              event.preventDefault();
              return;
            }
            leaf.classList.add('dragging');
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('application/vnd.v8vscedit.refs', JSON.stringify({
              tree: draggedFromTree,
              refs: draggedRefs,
            }));
            event.dataTransfer.setData('text/plain', draggedRefs.join('\\n'));
          });
          leaf.addEventListener('dragend', () => {
            leaf.classList.remove('dragging');
            draggedRefs = [];
            draggedFromTree = '';
            document.querySelectorAll('.tree-box.drag-over').forEach((box) => box.classList.remove('drag-over'));
          });
          leaf.addEventListener('dblclick', () => {
            if (isLocked) return;
            const ref = leaf.dataset.ref;
            if (!ref) return;
            vscode.postMessage({
              type: leaf.dataset.tree === 'selected' ? 'removeContent' : 'addContent',
              refs: [ref],
            });
          });
        });
      };
      const bindDropTargets = () => {
        document.querySelectorAll('.tree-box[data-drop-tree]').forEach((box) => {
          if (box.dataset.dropBound === 'true') return;
          box.dataset.dropBound = 'true';
          const targetTree = box.dataset.dropTree;
          box.addEventListener('dragover', (event) => {
            if (isLocked || !targetTree || targetTree === draggedFromTree || draggedRefs.length === 0) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            box.classList.add('drag-over');
          });
          box.addEventListener('dragleave', (event) => {
            if (!box.contains(event.relatedTarget)) {
              box.classList.remove('drag-over');
            }
          });
          box.addEventListener('drop', (event) => {
            box.classList.remove('drag-over');
            if (isLocked || !targetTree) return;
            event.preventDefault();
            let refs = draggedRefs;
            try {
              const raw = event.dataTransfer.getData('application/vnd.v8vscedit.refs');
              const parsed = raw ? JSON.parse(raw) : undefined;
              if (Array.isArray(parsed?.refs)) {
                refs = parsed.refs.map((ref) => String(ref)).filter(Boolean);
              }
            } catch {
              refs = draggedRefs;
            }
            if (targetTree !== draggedFromTree) {
              sendContentTransfer(targetTree, refs);
            }
          });
        });
      };
      document.querySelectorAll('.tab').forEach((button) => {
        button.addEventListener('click', () => {
          const tab = button.dataset.tab;
          document.querySelectorAll('.tab').forEach((item) => item.classList.toggle('active', item === button));
          document.querySelectorAll('.panel').forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === tab));
        });
      });
      document.querySelectorAll('[data-prop]').forEach((field) => {
        if (isLocked || field.disabled) return;
        const key = field.dataset.prop;
        const send = () => {
          const value = field.type === 'checkbox' ? Boolean(field.checked) : String(field.value ?? '');
          vscode.postMessage({ type: 'propertyChanged', key, value });
        };
        if (field.type === 'checkbox') {
          field.addEventListener('change', send);
        } else {
          field.addEventListener('blur', send);
          field.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' || event.shiftKey || field.tagName === 'TEXTAREA') return;
            event.preventDefault();
            send();
            field.blur();
          });
        }
      });
      byId('openCommandInterface')?.addEventListener('click', () => {
        vscode.postMessage({ type: 'openCommandInterface' });
      });
      byId('addContent')?.addEventListener('click', () => {
        if (isLocked) return;
        const refs = getSelectedRefs('available');
        if (refs.length > 0) {
          vscode.postMessage({ type: 'addContent', refs });
        }
      });
      byId('removeContent')?.addEventListener('click', () => {
        if (isLocked) return;
        const refs = getSelectedRefs('selected');
        if (refs.length > 0) {
          vscode.postMessage({ type: 'removeContent', refs });
        }
      });
      bindTreeLeaves();
      bindDropTargets();
      byId('addChild')?.addEventListener('click', () => {
        if (isLocked) return;
        const name = String(byId('childName')?.value ?? '').trim();
        if (name) {
          vscode.postMessage({ type: 'addChild', name });
        }
      });
      document.querySelectorAll('[data-remove-child]').forEach((button) => {
        button.addEventListener('click', () => {
          if (isLocked) return;
          vscode.postMessage({ type: 'removeChild', name: button.dataset.removeChild });
        });
      });
      byId('contentFilter')?.addEventListener('input', () => {
        applyContentFilter();
      });
      window.addEventListener('message', (event) => {
        const message = event.data;
        if (message?.type !== 'contentChanged') return;
        const availableOpen = collectOpenGroupIds('availableContent');
        const selectedOpen = collectOpenGroupIds('selectedContent');
        const availableScroll = byId('availableContent')?.scrollTop ?? 0;
        const selectedScroll = byId('selectedContent')?.scrollTop ?? 0;
        clearTreeSelection('available');
        clearTreeSelection('selected');
        const availableContent = byId('availableContent');
        const selectedContent = byId('selectedContent');
        if (availableContent) {
          availableContent.innerHTML = String(message.availableHtml ?? '');
          availableContent.scrollTop = availableScroll;
        }
        if (selectedContent) {
          selectedContent.innerHTML = String(message.selectedHtml ?? '');
          selectedContent.scrollTop = selectedScroll;
        }
        const contentSummary = byId('contentSummary');
        const availableCounter = byId('availableCounter');
        const selectedCounter = byId('selectedCounter');
        if (contentSummary) contentSummary.textContent = String(message.summary ?? '');
        if (availableCounter) availableCounter.textContent = String(message.availableCount ?? '');
        if (selectedCounter) selectedCounter.textContent = String(message.selectedCount ?? '');
        restoreOpenGroupIds('availableContent', availableOpen);
        restoreOpenGroupIds('selectedContent', selectedOpen);
        bindTreeLeaves();
        bindDropTargets();
        applyContentFilter();
      });
    `;
  }

  private async handleMessage(message: unknown): Promise<void> {
    const msg = message as SubsystemEditorMessage;
    if (!this.activeNode?.xmlPath || !this.panel) {
      return;
    }
    if (this.isEditLocked(this.activeNode) && msg.type !== 'openCommandInterface') {
      void vscode.window.showWarningMessage('Редактирование подсистемы запрещено текущим состоянием поддержки или хранилища.');
      return;
    }

    if (msg.type === 'openCommandInterface') {
      await this.openCommandInterface(this.activeNode.xmlPath);
      return;
    }

    await this.enqueueUpdate(async () => {
      const xmlPath = this.activeNode?.xmlPath;
      if (!xmlPath) {
        return;
      }
      let changed = false;
      let contentChanged = false;
      if (msg.type === 'propertyChanged') {
        changed = this.xmlService.updateProperty(xmlPath, msg.key, msg.value);
      } else if (msg.type === 'addContent') {
        changed = this.xmlService.addContentRefs(xmlPath, msg.refs);
        contentChanged = changed;
      } else if (msg.type === 'removeContent') {
        changed = this.xmlService.removeContentRefs(xmlPath, msg.refs);
        contentChanged = changed;
      } else if (msg.type === 'addChild') {
        changed = this.xmlService.addChildSubsystem(xmlPath, msg.name);
      } else if (msg.type === 'removeChild') {
        changed = this.xmlService.removeChildSubsystem(xmlPath, msg.name);
      }

      if (changed) {
        this.onAfterChange?.(xmlPath);
        if (this.panel && this.activeNode) {
          if (contentChanged) {
            await this.panel.webview.postMessage(this.buildContentChangedMessage(xmlPath, this.panel.webview));
          } else {
            this.panel.webview.html = this.renderHtml(this.activeNode, this.panel.webview);
          }
        }
      }
    });
  }

  private buildContentChangedMessage(xmlPath: string, webview: vscode.Webview): {
    type: 'contentChanged';
    availableHtml: string;
    selectedHtml: string;
    availableCount: number;
    selectedCount: number;
    summary: string;
  } {
    const snapshot = this.xmlService.readSnapshot(xmlPath);
    const contentRefs = new Set(snapshot.subsystem.contentRefs);
    const availableCount = countTreeLeaves(snapshot.contentTree);
    const selectedTree = buildSelectedContentTree(snapshot.contentTree, snapshot.subsystem.contentRefs);
    const isLocked = this.activeNode ? this.isEditLocked(this.activeNode) : true;
    const selectedHtml = selectedTree.length > 0
      ? this.renderContentTree(selectedTree, contentRefs, 'selected', webview, isLocked)
      : '<div class="empty">Состав пуст</div>';

    return {
      type: 'contentChanged',
      availableHtml: this.renderContentTree(snapshot.contentTree, contentRefs, 'available', webview, isLocked),
      selectedHtml,
      availableCount,
      selectedCount: snapshot.subsystem.contentRefs.length,
      summary: `${snapshot.subsystem.contentRefs.length} из ${availableCount}`,
    };
  }

  private async enqueueUpdate(operation: () => Promise<void>): Promise<void> {
    const run = this.updateQueue.then(operation);
    this.updateQueue = run.catch(() => undefined);
    await run;
  }

  private async openCommandInterface(xmlPath: string): Promise<void> {
    const info = this.xmlService.readSubsystem(xmlPath);
    if (!info.commandInterfacePath) {
      void vscode.window.showInformationMessage('Для этой подсистемы CommandInterface.xml не найден.');
      return;
    }
    await vscode.window.showTextDocument(vscode.Uri.file(info.commandInterfacePath), { preview: false });
  }

  private isEditLocked(node: MetadataNode): boolean {
    if (!node.xmlPath || !fs.existsSync(node.xmlPath)) {
      return true;
    }
    if (this.supportService?.getSupportMode(node.xmlPath) === SupportMode.Locked) {
      return true;
    }
    return this.repositoryService?.isEditRestricted(node.xmlPath) === true;
  }
}

function buildSelectedContentTree(nodes: MetadataRefTreeNode[], refs: string[]): MetadataRefTreeNode[] {
  const refSet = new Set(refs);
  const result = filterContentTree(nodes, refSet);
  const knownRefs = collectTreeRefs(result);
  const missing = refs.filter((ref) => !knownRefs.has(ref));
  if (missing.length > 0) {
    result.push({
      id: 'missing-content',
      label: 'Не найденные в дереве',
      children: missing.map((ref) => ({
        id: `missing-${ref}`,
        ref,
        label: ref,
        children: [],
      })),
    });
  }
  return result;
}

function filterContentTree(nodes: MetadataRefTreeNode[], refs: Set<string>): MetadataRefTreeNode[] {
  const result: MetadataRefTreeNode[] = [];
  for (const node of nodes) {
    if (node.ref) {
      if (refs.has(node.ref)) {
        result.push(node);
      }
      continue;
    }
    const children = filterContentTree(node.children, refs);
    if (children.length > 0) {
      result.push({ ...node, children });
    }
  }
  return result;
}

function collectTreeRefs(nodes: MetadataRefTreeNode[]): Set<string> {
  const result = new Set<string>();
  for (const node of nodes) {
    if (node.ref) {
      result.add(node.ref);
      continue;
    }
    for (const ref of collectTreeRefs(node.children)) {
      result.add(ref);
    }
  }
  return result;
}

function countTreeLeaves(nodes: MetadataRefTreeNode[]): number {
  let count = 0;
  for (const node of nodes) {
    count += node.ref ? 1 : countTreeLeaves(node.children);
  }
  return count;
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
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&#39;');
}
