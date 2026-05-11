/**
 * Панель данных формы (правая верхняя панель webview).
 * Три вкладки: Реквизиты, Команды, Параметры.
 *
 * Реквизиты: раскрытие Object → drag колонок на форму (создаёт InputField).
 * События: клик по обработчику → переход в Module.bsl.
 */

import type { FormModel, FormAttribute, FormCommand, FormEvent } from '../FormModel';

type DataTab = 'attributes' | 'commands' | 'parameters';

let activeTab: DataTab = 'attributes';
let currentModel: FormModel | null = null;
let containerRef: HTMLElement | null = null;

const expandedAttributes = new Set<number>();

let onCreateFromAttrCallback:
  | ((parentId: number, elementType: string, name: string, dataPath: string) => void)
  | null = null;

let onGoToHandlerCallback: ((handlerName: string) => void) | null = null;

export function setOnCreateFromAttribute(
  cb: (parentId: number, elementType: string, name: string, dataPath: string) => void
): void {
  onCreateFromAttrCallback = cb;
}

export function setOnGoToHandler(cb: (handlerName: string) => void): void {
  onGoToHandlerCallback = cb;
}

export function renderDataPanel(container: HTMLElement, model: FormModel): void {
  containerRef = container;
  currentModel = model;
  renderActiveTab();
}

export function setActiveDataTab(tab: DataTab): void {
  activeTab = tab;
  if (containerRef && currentModel) {
    renderActiveTab();
  }
}

export function getActiveDataTab(): DataTab {
  return activeTab;
}

function renderActiveTab(): void {
  if (!containerRef || !currentModel) return;
  containerRef.innerHTML = '';

  switch (activeTab) {
    case 'attributes':
      renderAttributesTab(containerRef, currentModel.attributes);
      break;
    case 'commands':
      renderCommandsTab(containerRef, currentModel.commands);
      break;
    case 'parameters':
      renderParametersTab(containerRef, currentModel.events);
      break;
  }
}

function renderAttributesTab(container: HTMLElement, attributes: FormAttribute[]): void {
  if (attributes.length === 0) {
    const placeholder = document.createElement('div');
    placeholder.className = 'tab-placeholder';
    placeholder.textContent = 'Нет реквизитов';
    container.appendChild(placeholder);
    return;
  }

  const header = document.createElement('div');
  header.className = 'data-table-header';
  header.innerHTML = `
    <div class="data-table-cell name">Реквизит</div>
    <div class="data-table-cell used">Исп.</div>
    <div class="data-table-cell type">Тип</div>
  `;
  container.appendChild(header);

  for (const attr of attributes) {
    const hasColumns = attr.columns && attr.columns.length > 0;
    const isExpanded = expandedAttributes.has(attr.id);

    const row = document.createElement('div');
    row.className = 'data-table-row' + (hasColumns ? ' expandable' : '');

    const expandIcon = hasColumns ? (isExpanded ? '▾' : '▸') : '';
    const attrIcon = attr.isMain ? '📄' : '─';

    row.innerHTML = `
      <div class="data-table-cell name">
        <span class="expand-icon">${expandIcon}</span>
        <span class="attr-icon">${attrIcon}</span>
        ${escapeHtml(attr.name)}
      </div>
      <div class="data-table-cell used">
        <input type="checkbox" class="used-checkbox" ${attr.savedData ? 'checked' : ''} tabindex="-1" />
      </div>
      <div class="data-table-cell type">${escapeHtml(attr.valueType)}</div>
    `;

    if (!attr.isMain) {
      row.draggable = true;
      row.title = 'Перетащите на форму';
      row.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData('text/plain', JSON.stringify({
          source: 'attribute', name: attr.name, dataPath: attr.name,
        }));
      });
    }

    if (hasColumns) {
      row.addEventListener('click', () => {
        if (expandedAttributes.has(attr.id)) {
          expandedAttributes.delete(attr.id);
        } else {
          expandedAttributes.add(attr.id);
        }
        renderActiveTab();
      });
    }

    container.appendChild(row);

    if (hasColumns && isExpanded && attr.columns) {
      for (const col of attr.columns) {
        const childRow = document.createElement('div');
        childRow.className = 'data-table-row child-row';
        childRow.draggable = true;

        const dataPath = attr.isMain ? `Object.${col.name}` : `${attr.name}.${col.name}`;
        childRow.title = `Перетащите на форму → ${dataPath}`;

        childRow.innerHTML = `
          <div class="data-table-cell name">
            <span class="expand-icon"></span>
            <span class="attr-icon drag-handle">⠿</span>
            ${escapeHtml(col.name)}
          </div>
          <div class="data-table-cell used"></div>
          <div class="data-table-cell type">${escapeHtml(col.valueType)}</div>
        `;

        childRow.addEventListener('dragstart', (e) => {
          e.dataTransfer?.setData('text/plain', JSON.stringify({
            source: 'attribute', name: col.name, dataPath,
          }));
        });

        childRow.addEventListener('dblclick', () => {
          onCreateFromAttrCallback?.(0, 'InputField', col.name, dataPath);
        });

        container.appendChild(childRow);
      }
    }
  }
}

function renderCommandsTab(container: HTMLElement, commands: FormCommand[]): void {
  if (commands.length === 0) {
    const placeholder = document.createElement('div');
    placeholder.className = 'tab-placeholder';
    placeholder.textContent = 'Нет команд';
    container.appendChild(placeholder);
    return;
  }

  const header = document.createElement('div');
  header.className = 'data-table-header';
  header.innerHTML = `
    <div class="data-table-cell name">Имя</div>
    <div class="data-table-cell title">Заголовок</div>
    <div class="data-table-cell action">Действие</div>
  `;
  container.appendChild(header);

  for (const cmd of commands) {
    const row = document.createElement('div');
    row.className = 'data-table-row';
    row.innerHTML = `
      <div class="data-table-cell name">${escapeHtml(cmd.name)}</div>
      <div class="data-table-cell title">${escapeHtml(cmd.title ?? '')}</div>
      <div class="data-table-cell action">${escapeHtml(cmd.action ?? '')}</div>
    `;
    container.appendChild(row);
  }
}

function renderParametersTab(container: HTMLElement, events: FormEvent[]): void {
  if (events.length === 0) {
    const placeholder = document.createElement('div');
    placeholder.className = 'tab-placeholder';
    placeholder.textContent = 'Нет параметров';
    container.appendChild(placeholder);
    return;
  }

  const header = document.createElement('div');
  header.className = 'data-table-header';
  header.innerHTML = `
    <div class="data-table-cell name">Событие</div>
    <div class="data-table-cell handler">Обработчик</div>
  `;
  container.appendChild(header);

  for (const evt of events) {
    const row = document.createElement('div');
    row.className = 'data-table-row';
    row.innerHTML = `
      <div class="data-table-cell name">${escapeHtml(evt.name)}</div>
      <div class="data-table-cell handler">
        <a class="handler-link" title="Перейти к ${escapeHtml(evt.handler)} в Module.bsl">${escapeHtml(evt.handler)}</a>
      </div>
    `;

    const link = row.querySelector('.handler-link') as HTMLElement;
    if (link) {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onGoToHandlerCallback?.(evt.handler);
      });
    }

    container.appendChild(row);
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
