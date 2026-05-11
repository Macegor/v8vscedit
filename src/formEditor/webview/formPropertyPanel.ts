/**
 * Панель свойств выбранного элемента формы (правая панель webview).
 * Поддерживает редактирование свойств с отправкой изменений в extension host.
 */

import type { FormElement } from '../FormModel';

/** Callback при изменении свойства */
let onPropertyChangeCallback:
  | ((elementId: number, propertyName: string, value: string) => void)
  | null = null;

/** Callback при удалении элемента */
let onDeleteCallback: ((elementId: number) => void) | null = null;

export function setOnPropertyChange(
  callback: (elementId: number, propertyName: string, value: string) => void
): void {
  onPropertyChangeCallback = callback;
}

export function setOnDeleteElement(
  callback: (elementId: number) => void
): void {
  onDeleteCallback = callback;
}

/** Рендер панели свойств */
export function renderPropertyPanel(
  container: HTMLElement,
  element: FormElement | null
): void {
  container.innerHTML = '';

  if (!element) {
    const placeholder = document.createElement('div');
    placeholder.className = 'no-selection';
    placeholder.textContent = 'Выберите элемент формы';
    container.appendChild(placeholder);
    return;
  }

  // Основные свойства (read-only)
  appendPropertyGroup(container, 'Основные', [
    { name: 'Имя', value: element.name, readonly: true },
    { name: 'Тип', value: element.type, readonly: true },
    { name: 'ID', value: String(element.id), readonly: true },
  ]);

  // Данные (editable)
  const dataProps: PropertyItem[] = [];
  if (element.dataPath !== undefined) {
    dataProps.push({
      name: 'Путь к данным',
      value: element.dataPath,
      readonly: true,
    });
  }
  dataProps.push({
    name: 'Заголовок',
    value: element.title ?? '',
    readonly: false,
    xmlProp: 'Title',
    elementId: element.id,
  });
  appendPropertyGroup(container, 'Данные', dataProps);

  // Отображение (editable)
  const displayProps: PropertyItem[] = [];

  displayProps.push({
    name: 'Показывать заголовок',
    value: element.showTitle !== false ? 'true' : 'false',
    type: 'checkbox',
    xmlProp: 'ShowTitle',
    elementId: element.id,
  });

  displayProps.push({
    name: 'Видимость',
    value: element.visible !== false ? 'true' : 'false',
    type: 'checkbox',
    xmlProp: 'Visible',
    elementId: element.id,
  });

  if (element.readOnly !== undefined) {
    displayProps.push({
      name: 'Только чтение',
      value: element.readOnly ? 'true' : 'false',
      type: 'checkbox',
      xmlProp: 'ReadOnly',
      elementId: element.id,
    });
  }

  if (element.group) {
    displayProps.push({
      name: 'Группировка',
      value: element.group,
      type: 'select',
      options: ['Vertical', 'Horizontal', 'AlwaysHorizontal'],
      xmlProp: 'Group',
      elementId: element.id,
    });
  }

  displayProps.push({
    name: 'Растягивание по горизонтали',
    value: element.horizontalStretch ? 'true' : 'false',
    type: 'checkbox',
    xmlProp: 'HorizontalStretch',
    elementId: element.id,
  });

  displayProps.push({
    name: 'Растягивание по вертикали',
    value: element.verticalStretch ? 'true' : 'false',
    type: 'checkbox',
    xmlProp: 'VerticalStretch',
    elementId: element.id,
  });

  displayProps.push({
    name: 'Ширина',
    value: String(element.width ?? 0),
    type: 'number',
    xmlProp: 'Width',
    elementId: element.id,
  });

  displayProps.push({
    name: 'Высота',
    value: String(element.height ?? 0),
    type: 'number',
    xmlProp: 'Height',
    elementId: element.id,
  });

  appendPropertyGroup(container, 'Отображение', displayProps);

  // Прочие свойства (raw, read-only)
  const rawEntries = Object.entries(element.rawProperties);
  if (rawEntries.length > 0) {
    appendPropertyGroup(
      container,
      'Прочие',
      rawEntries.map(([k, v]) => ({ name: k, value: v, readonly: true }))
    );
  }

  // Кнопка удаления
  if (element.id !== 0) {
    const deleteGroup = document.createElement('div');
    deleteGroup.className = 'property-group';
    deleteGroup.style.marginTop = '12px';

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-button';
    deleteBtn.textContent = 'Удалить элемент';
    deleteBtn.addEventListener('click', () => {
      onDeleteCallback?.(element.id);
    });

    deleteGroup.appendChild(deleteBtn);
    container.appendChild(deleteGroup);
  }
}

// ── Типы ────────────────────────────────────────────────────────────────────

interface PropertyItem {
  name: string;
  value: string;
  readonly?: boolean;
  type?: 'text' | 'checkbox' | 'select' | 'number';
  options?: string[];
  xmlProp?: string;
  elementId?: number;
}

// ── Рендер группы свойств ───────────────────────────────────────────────────

function appendPropertyGroup(
  container: HTMLElement,
  title: string,
  props: PropertyItem[]
): void {
  const group = document.createElement('div');
  group.className = 'property-group';

  const titleDiv = document.createElement('div');
  titleDiv.className = 'property-group-title';
  titleDiv.textContent = title;
  group.appendChild(titleDiv);

  for (const prop of props) {
    const row = document.createElement('div');
    row.className = 'property-row';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'property-name';
    nameSpan.textContent = prop.name;
    row.appendChild(nameSpan);

    if (prop.readonly) {
      const valueSpan = document.createElement('span');
      valueSpan.className = 'property-value';
      valueSpan.textContent = prop.value;
      valueSpan.title = prop.value;
      row.appendChild(valueSpan);
    } else {
      row.appendChild(createEditableControl(prop));
    }

    group.appendChild(row);
  }

  container.appendChild(group);
}

function createEditableControl(prop: PropertyItem): HTMLElement {
  const type = prop.type ?? 'text';

  if (type === 'checkbox') {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = prop.value === 'true';
    checkbox.className = 'property-checkbox';
    checkbox.addEventListener('change', () => {
      if (prop.xmlProp && prop.elementId !== undefined) {
        onPropertyChangeCallback?.(
          prop.elementId,
          prop.xmlProp,
          checkbox.checked ? 'true' : 'false'
        );
      }
    });
    return checkbox;
  }

  if (type === 'select' && prop.options) {
    const select = document.createElement('select');
    select.className = 'property-select';
    for (const opt of prop.options) {
      const option = document.createElement('option');
      option.value = opt;
      option.textContent = opt;
      if (opt === prop.value) option.selected = true;
      select.appendChild(option);
    }
    select.addEventListener('change', () => {
      if (prop.xmlProp && prop.elementId !== undefined) {
        onPropertyChangeCallback?.(prop.elementId, prop.xmlProp, select.value);
      }
    });
    return select;
  }

  if (type === 'number') {
    const input = document.createElement('input');
    input.type = 'number';
    input.value = prop.value;
    input.min = '0';
    input.className = 'property-input';
    input.addEventListener('change', () => {
      if (prop.xmlProp && prop.elementId !== undefined) {
        onPropertyChangeCallback?.(prop.elementId, prop.xmlProp, input.value);
      }
    });
    return input;
  }

  // text
  const input = document.createElement('input');
  input.type = 'text';
  input.value = prop.value;
  input.className = 'property-input';
  input.addEventListener('change', () => {
    if (prop.xmlProp && prop.elementId !== undefined) {
      onPropertyChangeCallback?.(prop.elementId, prop.xmlProp, input.value);
    }
  });
  return input;
}
