/**
 * Визуальное превью формы (центральная панель webview).
 * Рендерит иерархию элементов как вложенные flex-контейнеры.
 */

import type { FormElement } from '../FormModel';

let onSelectCallback: ((element: FormElement) => void) | null = null;
let selectedElementId: number | null = null;

export function setOnSelectElement(
  callback: (element: FormElement) => void
): void {
  onSelectCallback = callback;
}

export function setSelectedElementId(id: number | null): void {
  selectedElementId = id;
}

/** Рендер превью формы */
export function renderFormPreview(
  container: HTMLElement,
  root: FormElement
): void {
  container.innerHTML = '';

  const previewDiv = document.createElement('div');
  previewDiv.className = 'preview-container';

  for (const child of root.children) {
    previewDiv.appendChild(renderElement(child));
  }

  container.appendChild(previewDiv);
}

function renderElement(element: FormElement): HTMLElement {
  let el: HTMLElement;

  switch (element.type) {
    case 'UsualGroup':
    case 'ColumnGroup':
      el = renderGroup(element);
      break;
    case 'InputField':
      el = renderInputField(element);
      break;
    case 'LabelField':
    case 'LabelDecoration':
      el = renderLabel(element);
      break;
    case 'Button':
    case 'CommandBarButton':
      el = renderButton(element);
      break;
    case 'Table':
      el = renderTable(element);
      break;
    case 'Pages':
      el = renderPages(element);
      break;
    case 'CheckBoxField':
      el = renderCheckBox(element);
      break;
    case 'AutoCommandBar':
    case 'CommandBar':
      el = renderCommandBar(element);
      break;
    case 'PictureField':
    case 'PictureDecoration':
      el = renderPicture(element);
      break;
    case 'Separator':
      el = renderSeparator();
      break;
    default:
      el = renderGeneric(element);
      break;
  }

  // Общие атрибуты
  el.classList.add('preview-element');
  el.dataset.elementId = String(element.id);

  if (element.id === selectedElementId) {
    el.classList.add('selected');
  }
  if (element.visible === false) {
    el.classList.add('invisible');
  }
  if (element.horizontalStretch) {
    el.classList.add('stretch-h');
  }
  if (element.width) {
    el.style.width = `${element.width}px`;
  }

  // Клик — выбор
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    const prev = document.querySelector('.preview-element.selected');
    if (prev) prev.classList.remove('selected');
    el.classList.add('selected');

    // Также обновить выделение в дереве
    const prevTree = document.querySelector('.tree-node.selected');
    if (prevTree) prevTree.classList.remove('selected');
    const treeNode = document.querySelector(
      `.tree-node[data-element-id="${element.id}"]`
    );
    if (treeNode) treeNode.classList.add('selected');

    onSelectCallback?.(element);
  });

  return el;
}

function renderGroup(element: FormElement): HTMLElement {
  const div = document.createElement('div');

  // Заголовок группы
  if (element.showTitle !== false && element.title) {
    const titleDiv = document.createElement('div');
    titleDiv.className = 'preview-group-title';
    titleDiv.textContent = element.title;
    div.appendChild(titleDiv);
  }

  // Контейнер дочерних элементов
  const groupDiv = document.createElement('div');
  groupDiv.className = 'preview-group';
  if (element.group === 'Horizontal' || element.group === 'AlwaysHorizontal') {
    groupDiv.classList.add('horizontal');
  } else {
    groupDiv.classList.add('vertical');
  }

  for (const child of element.children) {
    groupDiv.appendChild(renderElement(child));
  }

  div.appendChild(groupDiv);
  return div;
}

function renderInputField(element: FormElement): HTMLElement {
  const div = document.createElement('div');
  div.className = 'preview-field';

  const labelText =
    element.title ?? element.dataPath?.split('.').pop() ?? element.name;

  if (element.showTitle !== false) {
    const label = document.createElement('span');
    label.className = 'preview-field-label';
    label.textContent = labelText + ':';
    div.appendChild(label);
  }

  const input = document.createElement('div');
  input.className = 'preview-field-input';
  if (element.readOnly) {
    input.style.opacity = '0.6';
  }
  div.appendChild(input);

  return div;
}

function renderLabel(element: FormElement): HTMLElement {
  const div = document.createElement('div');
  div.className = 'preview-decoration';
  div.textContent =
    element.title ?? element.dataPath?.split('.').pop() ?? element.name;
  return div;
}

function renderButton(element: FormElement): HTMLElement {
  const btn = document.createElement('div');
  btn.className = 'preview-button';
  btn.textContent = element.title ?? element.name;
  return btn;
}

function renderTable(element: FormElement): HTMLElement {
  const div = document.createElement('div');
  div.className = 'preview-table';

  // Заголовок колонок
  const header = document.createElement('div');
  header.className = 'preview-table-header';

  const columns = element.children.filter(
    (c) =>
      c.type === 'InputField' ||
      c.type === 'LabelField' ||
      c.type === 'CheckBoxField'
  );

  if (columns.length === 0) {
    const cell = document.createElement('div');
    cell.className = 'preview-table-cell';
    cell.textContent = element.dataPath ?? element.name;
    header.appendChild(cell);
  } else {
    for (const col of columns) {
      const cell = document.createElement('div');
      cell.className = 'preview-table-cell';
      cell.textContent =
        col.title ?? col.dataPath?.split('.').pop() ?? col.name;
      header.appendChild(cell);
    }
  }

  div.appendChild(header);

  // Тело таблицы (пустое)
  const body = document.createElement('div');
  body.className = 'preview-table-body';
  div.appendChild(body);

  return div;
}

function renderPages(element: FormElement): HTMLElement {
  const div = document.createElement('div');
  div.className = 'preview-pages';

  // Вкладки
  const tabs = document.createElement('div');
  tabs.className = 'preview-pages-tabs';

  const pages = element.children.filter((c) => c.type === 'Page');

  pages.forEach((page, idx) => {
    const tab = document.createElement('div');
    tab.className = 'preview-pages-tab';
    if (idx === 0) tab.classList.add('active');
    tab.textContent = page.title ?? page.name;
    tabs.appendChild(tab);
  });

  div.appendChild(tabs);

  // Содержимое первой вкладки
  const content = document.createElement('div');
  content.className = 'preview-pages-content';
  if (pages.length > 0) {
    for (const child of pages[0].children) {
      content.appendChild(renderElement(child));
    }
  }

  div.appendChild(content);
  return div;
}

function renderCheckBox(element: FormElement): HTMLElement {
  const div = document.createElement('div');
  div.className = 'preview-checkbox';

  const box = document.createElement('div');
  box.className = 'preview-checkbox-box';
  div.appendChild(box);

  const label = document.createElement('span');
  label.className = 'preview-field-label';
  label.textContent =
    element.title ?? element.dataPath?.split('.').pop() ?? element.name;
  div.appendChild(label);

  return div;
}

function renderCommandBar(element: FormElement): HTMLElement {
  const div = document.createElement('div');
  div.style.display = 'flex';
  div.style.gap = '4px';
  div.style.padding = '2px 0';
  div.style.marginBottom = '4px';

  for (const child of element.children) {
    div.appendChild(renderElement(child));
  }

  return div;
}

function renderPicture(element: FormElement): HTMLElement {
  const div = document.createElement('div');
  div.className = 'preview-decoration';
  div.textContent = `[${element.title ?? element.name}]`;
  return div;
}

function renderSeparator(): HTMLElement {
  const hr = document.createElement('hr');
  hr.style.border = 'none';
  hr.style.borderTop = `1px solid var(--vscode-panel-border)`;
  hr.style.margin = '4px 0';
  return hr;
}

function renderGeneric(element: FormElement): HTMLElement {
  const div = document.createElement('div');
  div.className = 'preview-decoration';
  div.textContent = `[${element.type}: ${element.name}]`;
  div.style.fontStyle = 'italic';
  return div;
}
