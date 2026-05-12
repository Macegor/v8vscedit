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
let elementIndex = new Map<number, FormElement>();
let selectedElementId: number | null = null;

// ── DOM-элементы ─────────────────────────────────────────────────────────────

const treeBody = requireElement('tree-body');
const previewBody = requireElement('preview-body');
const propertyBody = requireElement('property-body');
const dataBody = requireElement('data-body');

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
    const data = parseAttributeDragData(
      e.dataTransfer?.getData('text/plain') ?? '{}'
    );
    e.preventDefault();
    e.stopPropagation();
    // Определить target parent из drop position
    const targetEl = asHTMLElement(e.target)?.closest<HTMLElement>('[data-element-id]');
    const parentId = targetEl ? parseInt(targetEl.dataset.elementId ?? '0', 10) : 0;
    vscode.postMessage({
      type: 'createElementWithDataPath',
      parentId,
      elementType: 'InputField',
      elementName: data.name,
      dataPath: data.dataPath,
    });
  } catch {
    return;
  }
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
    `[data-element-id="${String(element.id)}"]`
  );
  if (previewEl) {(previewEl as HTMLElement).classList.add('selected');}

  // Обновить выделение в дереве
  document.querySelectorAll('.tree-node.selected').forEach((el: Element) => {
    (el as HTMLElement).classList.remove('selected');
  });
  const treeEl = treeBody.querySelector(
    `.tree-node[data-element-id="${String(element.id)}"]`
  );
  if (treeEl) {(treeEl as HTMLElement).classList.add('selected');}

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

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  const msg = parseHostMessage(event.data);
  if (!msg) {
    return;
  }

  switch (msg.type) {
    case 'formLoaded': {
      currentModel = msg.model;
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
        const el = elementIndex.get(selectedElementId);
        if (el) {
          onSelectElement(el);
        }
      } else {
        selectedElementId = null;
        renderPropertyPanel(propertyBody, null);
      }
      break;
    }

    case 'error': {
      propertyBody.innerHTML = '';
      const errorEl = document.createElement('div');
      errorEl.className = 'no-selection';
      errorEl.style.color = 'var(--vscode-errorForeground)';
      errorEl.textContent = msg.message;
      propertyBody.appendChild(errorEl);
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
  const tab = asHTMLElement(e.target)?.closest<HTMLElement>('.tab');
  if (!tab) {return;}

  const panel = tab.dataset.panel;
  const tabName = tab.dataset.tab;
  if (!panel || !tabName) {return;}

  // Найти tab-bar и переключить active
  const tabBar = tab.parentElement;
  if (!tabBar) {return;}
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
    if (formTab) {formTab.classList.add('active');}
  }
});

// ── Ресайз сплиттеров ───────────────────────────────────────────────────────

function initSplitters(): void {
  const editor = requireElement('form-editor');
  const splitterH = requireElement('splitter-h');
  const splitterVTop = requireElement('splitter-v-top');
  const splitterVBottom = requireElement('splitter-v-bottom');

  let activeSplitter: HTMLElement | null = null;

  function onMouseDown(e: MouseEvent, splitter: HTMLElement): void {
    e.preventDefault();
    activeSplitter = splitter;
    splitter.classList.add('active');

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = splitter.classList.contains('splitter-h') ? 'row-resize' : 'col-resize';
    document.body.style.userSelect = 'none';
  }

  function onMouseMove(e: MouseEvent): void {
    if (!activeSplitter) {return;}

    if (activeSplitter.classList.contains('splitter-h')) {
      // Horizontal: adjust top row height
      const editorRect = editor.getBoundingClientRect();
      const topHeight = Math.max(100, Math.min(e.clientY - editorRect.top, editorRect.height - 100));
      editor.style.setProperty('--top-height', `${String(topHeight)}px`);
    } else {
      // Vertical: adjust left column width
      const editorRect = editor.getBoundingClientRect();
      const leftWidth = Math.max(150, Math.min(e.clientX - editorRect.left, editorRect.width - 200));
      editor.style.setProperty('--left-width', `${String(leftWidth)}px`);
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

interface AttributeDragData {
  source: 'attribute';
  name: string;
  dataPath: string;
}

type HostMessage =
  | { type: 'formLoaded'; model: FormModel }
  | { type: 'error'; message: string };

function requireElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`DOM element not found: ${id}`);
  }
  return element;
}

function asHTMLElement(value: EventTarget | null): HTMLElement | null {
  return value instanceof HTMLElement ? value : null;
}

function parseAttributeDragData(raw: string): AttributeDragData {
  const value = JSON.parse(raw) as unknown;
  if (!isRecord(value)) {
    throw new Error('Некорректные данные перетаскивания');
  }
  const { source, name, dataPath } = value;
  if (source !== 'attribute' || typeof name !== 'string' || typeof dataPath !== 'string') {
    throw new Error('Некорректные данные реквизита');
  }
  return { source, name, dataPath };
}

function parseHostMessage(value: unknown): HostMessage | null {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return null;
  }
  if (value.type === 'formLoaded' && isFormModel(value.model)) {
    return { type: 'formLoaded', model: value.model };
  }
  if (value.type === 'error' && typeof value.message === 'string') {
    return { type: 'error', message: value.message };
  }
  return null;
}

function isFormModel(value: unknown): value is FormModel {
  return isRecord(value) && isRecord(value.root) &&
    Array.isArray(value.attributes) &&
    Array.isArray(value.commands) &&
    Array.isArray(value.events);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
