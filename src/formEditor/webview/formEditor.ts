/**
 * Точка входа webview визуального редактора форм.
 * Получает FormModel от extension host и рендерит три панели.
 * Поддерживает drag-and-drop, редактирование свойств, удаление элементов.
 */

import type { FormModel, FormElement } from '../FormModel';
import {
  renderElementTree,
  setOnSelectElement as setTreeOnSelect,
  expandToDepth,
  setSelectedElementId as setTreeSelectedId,
  setOnCreateElement,
  setOnDeleteFromTree,
} from './formElementTree';
import {
  renderFormPreview,
  setOnSelectElement as setPreviewOnSelect,
  setSelectedElementId as setPreviewSelectedId,
} from './formPreview';
import {
  renderPropertyPanel,
  setOnPropertyChange,
  setOnDeleteElement,
} from './formPropertyPanel';
import {
  initTreeDragDrop,
  initPreviewDragDrop,
  setOnMoveElement,
} from './dragDrop';
import {
  renderDataPanel,
  setActiveDataTab,
  setOnCreateFromAttribute,
  setOnGoToHandler,
} from './formDataPanel';

// Получить API VS Code webview
declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

let currentModel: FormModel | null = null;
let elementIndex: Map<number, FormElement> = new Map();
let selectedElementId: number | null = null;

// ── DOM-элементы ─────────────────────────────────────────────────────────────

const treeBody = document.getElementById('tree-body')!;
const previewBody = document.getElementById('preview-body')!;
const propertyBody = document.getElementById('property-body')!;
const dataBody = document.getElementById('data-body')!;

// ── Drag-and-drop ────────────────────────────────────────────────────────────

initTreeDragDrop(treeBody);
initPreviewDragDrop(previewBody);

setOnMoveElement((elementId, targetParentId, insertBeforeId) => {
  vscode.postMessage({
    type: 'moveElement',
    elementId,
    targetParentId,
    insertBeforeId,
  });
});

// ── Редактирование свойств ───────────────────────────────────────────────────

setOnPropertyChange((elementId, propertyName, value) => {
  vscode.postMessage({
    type: 'updateProperty',
    elementId,
    propertyName,
    value,
  });
});

// ── Удаление элементов ──────────────────────────────────────────────────────

setOnDeleteElement((elementId) => {
  vscode.postMessage({
    type: 'deleteElement',
    elementId,
  });
});

setOnDeleteFromTree((elementId) => {
  vscode.postMessage({
    type: 'deleteElement',
    elementId,
  });
});

// ── Создание элементов ──────────────────────────────────────────────────────

setOnCreateElement((parentId, elementType, elementName, insertBeforeId) => {
  vscode.postMessage({
    type: 'createElement',
    parentId,
    elementType,
    elementName,
    insertBeforeId,
  });
});

// ── Создание элемента из реквизита (drag/dblclick) ──────────────────────────

setOnCreateFromAttribute((parentId, elementType, name, dataPath) => {
  vscode.postMessage({
    type: 'createElementWithDataPath',
    parentId,
    elementType,
    elementName: name,
    dataPath,
  });
});

// ── Переход к обработчику события ───────────────────────────────────────────

setOnGoToHandler((handlerName) => {
  vscode.postMessage({
    type: 'goToHandler',
    handlerName,
  });
});

// ── Drop реквизита из панели данных на превью/дерево ─────────────────────────

previewBody.addEventListener('drop', (e: DragEvent) => {
  try {
    const data = JSON.parse(e.dataTransfer?.getData('text/plain') ?? '{}');
    if (data.source === 'attribute') {
      e.preventDefault();
      e.stopPropagation();
      // Определить target parent из drop position
      const targetEl = (e.target as HTMLElement).closest('[data-element-id]') as HTMLElement | null;
      const parentId = targetEl ? parseInt(targetEl.dataset.elementId ?? '0', 10) : 0;
      vscode.postMessage({
        type: 'createElementWithDataPath',
        parentId,
        elementType: 'InputField',
        elementName: data.name,
        dataPath: data.dataPath,
      });
    }
  } catch {}
});

previewBody.addEventListener('dragover', (e: DragEvent) => {
  e.preventDefault();
});

// ── Обработка выбора элемента ────────────────────────────────────────────────

function onSelectElement(element: FormElement): void {
  selectedElementId = element.id;
  setTreeSelectedId(element.id);
  setPreviewSelectedId(element.id);

  // Обновить выделение в превью
  document.querySelectorAll('.preview-element.selected').forEach((el: Element) => {
    (el as HTMLElement).classList.remove('selected');
  });
  const previewEl = previewBody.querySelector(
    `[data-element-id="${element.id}"]`
  );
  if (previewEl) (previewEl as HTMLElement).classList.add('selected');

  // Обновить выделение в дереве
  document.querySelectorAll('.tree-node.selected').forEach((el: Element) => {
    (el as HTMLElement).classList.remove('selected');
  });
  const treeEl = treeBody.querySelector(
    `.tree-node[data-element-id="${element.id}"]`
  );
  if (treeEl) (treeEl as HTMLElement).classList.add('selected');

  // Обновить свойства
  renderPropertyPanel(propertyBody, element);

  // Сообщить extension host
  vscode.postMessage({ type: 'selectElement', elementId: element.id });
}

setTreeOnSelect(onSelectElement);
setPreviewOnSelect(onSelectElement);

// ── Индексация элементов ─────────────────────────────────────────────────────

function buildIndex(element: FormElement): void {
  elementIndex.set(element.id, element);
  for (const child of element.children) {
    buildIndex(child);
  }
}

// ── Обработка сообщений от extension host ────────────────────────────────────

window.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data;

  switch (msg.type) {
    case 'formLoaded': {
      currentModel = msg.model as FormModel;
      elementIndex = new Map();
      buildIndex(currentModel.root);

      // Раскрыть дерево до 2 уровня
      expandToDepth(currentModel.root, 2);

      // Рендер
      renderElementTree(treeBody, currentModel.root);
      renderFormPreview(previewBody, currentModel.root);
      renderDataPanel(dataBody, currentModel);

      // Восстановить выбранный элемент если он ещё существует
      if (selectedElementId !== null && elementIndex.has(selectedElementId)) {
        const el = elementIndex.get(selectedElementId)!;
        onSelectElement(el);
      } else {
        selectedElementId = null;
        renderPropertyPanel(propertyBody, null);
      }
      break;
    }

    case 'error': {
      propertyBody.innerHTML = `<div class="no-selection" style="color: var(--vscode-errorForeground);">${msg.message}</div>`;
      break;
    }
  }
});

// ── Горячие клавиши ─────────────────────────────────────────────────────────

document.addEventListener('keydown', (e: KeyboardEvent) => {
  // Undo: Ctrl+Z
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
    e.preventDefault();
    vscode.postMessage({ type: 'undo' });
    return;
  }

  // Redo: Ctrl+Y or Ctrl+Shift+Z
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
    e.preventDefault();
    vscode.postMessage({ type: 'redo' });
    return;
  }

  // Delete
  if (e.key === 'Delete' && selectedElementId !== null && selectedElementId !== 0) {
    e.preventDefault();
    vscode.postMessage({ type: 'deleteElement', elementId: selectedElementId });
  }
});

// ── Переключение вкладок ────────────────────────────────────────────────────

document.addEventListener('click', (e: MouseEvent) => {
  const tab = (e.target as HTMLElement).closest('.tab') as HTMLElement | null;
  if (!tab) return;

  const panel = tab.dataset.panel;
  const tabName = tab.dataset.tab;
  if (!panel || !tabName) return;

  // Найти tab-bar и переключить active
  const tabBar = tab.parentElement;
  if (!tabBar) return;
  tabBar.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
  tab.classList.add('active');

  // Обработка переключения вкладок по панелям
  if (panel === 'data') {
    const dataTab = tabName as 'attributes' | 'commands' | 'parameters';
    setActiveDataTab(dataTab);
  }

  if (panel === 'preview' && tabName === 'module') {
    vscode.postMessage({ type: 'openModule' });
    // Вернуть активную вкладку на "Форма"
    tabBar.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    const formTab = tabBar.querySelector('[data-tab="form-preview"]');
    if (formTab) formTab.classList.add('active');
  }
});

// ── Ресайз сплиттеров ───────────────────────────────────────────────────────

function initSplitters(): void {
  const editor = document.getElementById('form-editor')!;
  const splitterH = document.getElementById('splitter-h')!;
  const splitterVTop = document.getElementById('splitter-v-top')!;
  const splitterVBottom = document.getElementById('splitter-v-bottom')!;

  let activeSplitter: HTMLElement | null = null;
  let startPos = 0;
  let startSize = 0;

  function onMouseDown(e: MouseEvent, splitter: HTMLElement): void {
    e.preventDefault();
    activeSplitter = splitter;
    splitter.classList.add('active');

    if (splitter.classList.contains('splitter-h')) {
      startPos = e.clientY;
      startSize = editor.getBoundingClientRect().height;
    } else {
      startPos = e.clientX;
      startSize = editor.getBoundingClientRect().width;
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = splitter.classList.contains('splitter-h') ? 'row-resize' : 'col-resize';
    document.body.style.userSelect = 'none';
  }

  function onMouseMove(e: MouseEvent): void {
    if (!activeSplitter) return;

    if (activeSplitter.classList.contains('splitter-h')) {
      // Horizontal: adjust top row height
      const editorRect = editor.getBoundingClientRect();
      const topHeight = Math.max(100, Math.min(e.clientY - editorRect.top, editorRect.height - 100));
      editor.style.setProperty('--top-height', `${topHeight}px`);
    } else {
      // Vertical: adjust left column width
      const editorRect = editor.getBoundingClientRect();
      const leftWidth = Math.max(150, Math.min(e.clientX - editorRect.left, editorRect.width - 200));
      editor.style.setProperty('--left-width', `${leftWidth}px`);
    }
  }

  function onMouseUp(): void {
    if (activeSplitter) {
      activeSplitter.classList.remove('active');
      activeSplitter = null;
    }
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }

  splitterH.addEventListener('mousedown', (e) => onMouseDown(e, splitterH));
  splitterVTop.addEventListener('mousedown', (e) => onMouseDown(e, splitterVTop));
  splitterVBottom.addEventListener('mousedown', (e) => onMouseDown(e, splitterVBottom));
}

initSplitters();

// Начальное состояние
renderPropertyPanel(propertyBody, null);
