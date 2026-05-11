/**
 * Дерево элементов формы (левая панель webview).
 */

import type { FormElement } from '../FormModel';

/** Иконки для типов элементов */
const TYPE_ICONS: Record<string, string> = {
  UsualGroup: '📂',
  InputField: '📝',
  LabelField: '🏷️',
  LabelDecoration: '🏷️',
  Button: '🔘',
  Table: '📊',
  Pages: '📑',
  Page: '📄',
  CheckBoxField: '☑️',
  RadioButtonField: '🔘',
  AutoCommandBar: '🔧',
  CommandBar: '🔧',
  CommandBarButton: '▶️',
  PictureField: '🖼️',
  PictureDecoration: '🖼️',
  Separator: '➖',
  ContextMenu: '📋',
};

/** Состояние дерева (раскрытые узлы) */
const expandedNodes = new Set<number>();

/** Текущий выбранный элемент */
let selectedElementId: number | null = null;

/** Callback при выборе элемента */
let onSelectCallback: ((element: FormElement) => void) | null = null;

/** Callback при создании элемента */
let onCreateCallback: ((parentId: number, elementType: string, name: string, insertBeforeId: number | null) => void) | null = null;

/** Callback при удалении элемента */
let onDeleteFromTreeCallback: ((elementId: number) => void) | null = null;

export function setOnSelectElement(
  callback: (element: FormElement) => void
): void {
  onSelectCallback = callback;
}

export function setOnCreateElement(
  callback: (parentId: number, elementType: string, name: string, insertBeforeId: number | null) => void
): void {
  onCreateCallback = callback;
}

export function setOnDeleteFromTree(
  callback: (elementId: number) => void
): void {
  onDeleteFromTreeCallback = callback;
}

export function getSelectedElementId(): number | null {
  return selectedElementId;
}

export function setSelectedElementId(id: number | null): void {
  selectedElementId = id;
}

/** Рендер дерева элементов в контейнер */
export function renderElementTree(
  container: HTMLElement,
  root: FormElement
): void {
  container.innerHTML = '';

  // Корневой узел не показываем, показываем его children
  for (const child of root.children) {
    container.appendChild(renderTreeNode(child, 0));
  }
}

function renderTreeNode(element: FormElement, depth: number): HTMLElement {
  const wrapper = document.createElement('div');

  // Сам узел
  const nodeDiv = document.createElement('div');
  nodeDiv.className = 'tree-node';
  nodeDiv.dataset.elementId = String(element.id);
  nodeDiv.draggable = true;
  if (element.id === selectedElementId) {
    nodeDiv.classList.add('selected');
  }

  // Стрелка раскрытия
  const toggle = document.createElement('span');
  toggle.className = 'toggle';
  if (element.children.length > 0) {
    const expanded = expandedNodes.has(element.id);
    toggle.textContent = expanded ? '▾' : '▸';
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      if (expandedNodes.has(element.id)) {
        expandedNodes.delete(element.id);
      } else {
        expandedNodes.add(element.id);
      }
      // Перерисовать поддерево
      const childrenDiv = wrapper.querySelector(
        ':scope > .tree-children'
      ) as HTMLElement | null;
      if (childrenDiv) {
        childrenDiv.classList.toggle('collapsed');
      }
      toggle.textContent = expandedNodes.has(element.id) ? '▾' : '▸';
    });
  } else {
    toggle.classList.add('empty');
  }
  nodeDiv.appendChild(toggle);

  // Иконка
  const icon = document.createElement('span');
  icon.className = 'icon';
  icon.textContent = TYPE_ICONS[element.type] ?? '◻️';
  nodeDiv.appendChild(icon);

  // Название
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = element.name || element.type;
  nodeDiv.appendChild(label);

  // Клик — выбор
  nodeDiv.addEventListener('click', () => {
    // Снять выделение со старого
    const prev = document.querySelector('.tree-node.selected');
    if (prev) prev.classList.remove('selected');

    selectedElementId = element.id;
    nodeDiv.classList.add('selected');
    onSelectCallback?.(element);
  });

  // Контекстное меню
  nodeDiv.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu(e.clientX, e.clientY, element);
  });

  wrapper.appendChild(nodeDiv);

  // Дочерние элементы
  if (element.children.length > 0) {
    const childrenDiv = document.createElement('div');
    childrenDiv.className = 'tree-children';
    if (!expandedNodes.has(element.id)) {
      childrenDiv.classList.add('collapsed');
    }
    for (const child of element.children) {
      childrenDiv.appendChild(renderTreeNode(child, depth + 1));
    }
    wrapper.appendChild(childrenDiv);
  }

  return wrapper;
}

/** Раскрыть все группы до определённой глубины */
export function expandToDepth(root: FormElement, maxDepth: number): void {
  expandedNodes.clear();
  walkExpand(root, 0, maxDepth);
}

function walkExpand(
  element: FormElement,
  depth: number,
  maxDepth: number
): void {
  if (depth < maxDepth && element.children.length > 0) {
    expandedNodes.add(element.id);
    for (const child of element.children) {
      walkExpand(child, depth + 1, maxDepth);
    }
  }
}

// ── Контекстное меню ────────────────────────────────────────────────────────

/** Элементы доступные для добавления */
const ADDABLE_TYPES = [
  { group: 'Группы', items: [
    { type: 'UsualGroup', label: 'Группа (вертикальная)', groupDir: 'Vertical' },
    { type: 'UsualGroup', label: 'Группа (горизонтальная)', groupDir: 'Horizontal' },
    { type: 'Pages', label: 'Страницы' },
    { type: 'Page', label: 'Страница' },
    { type: 'ColumnGroup', label: 'Группа колонок' },
  ]},
  { group: 'Поля', items: [
    { type: 'InputField', label: 'Поле ввода' },
    { type: 'CheckBoxField', label: 'Флажок' },
    { type: 'RadioButtonField', label: 'Переключатель' },
    { type: 'LabelField', label: 'Поле надписи' },
  ]},
  { group: 'Декорации', items: [
    { type: 'LabelDecoration', label: 'Надпись' },
    { type: 'PictureDecoration', label: 'Картинка' },
    { type: 'Separator', label: 'Разделитель' },
  ]},
  { group: 'Прочие', items: [
    { type: 'Button', label: 'Кнопка' },
    { type: 'Table', label: 'Таблица' },
    { type: 'CommandBar', label: 'Командная панель' },
  ]},
];

let activeContextMenu: HTMLElement | null = null;

function closeContextMenu(): void {
  if (activeContextMenu) {
    activeContextMenu.remove();
    activeContextMenu = null;
  }
}

// Закрытие по клику вне меню
document.addEventListener('click', closeContextMenu);
document.addEventListener('contextmenu', () => closeContextMenu());

function showContextMenu(x: number, y: number, element: FormElement): void {
  closeContextMenu();

  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  // Добавить дочерний элемент (для групп)
  const isContainer = element.type === 'UsualGroup' || element.type === 'ColumnGroup' ||
    element.type === 'Pages' || element.type === 'Page' ||
    element.type === 'CommandBar' || element.type === 'AutoCommandBar' ||
    element.id === 0;

  if (isContainer) {
    const addChildItem = document.createElement('div');
    addChildItem.className = 'context-menu-item';
    addChildItem.textContent = 'Добавить дочерний элемент...';
    addChildItem.addEventListener('click', (e) => {
      e.stopPropagation();
      closeContextMenu();
      showElementPicker(element.id, null);
    });
    menu.appendChild(addChildItem);
  }

  // Добавить элемент после
  if (element.id !== 0) {
    const addAfterItem = document.createElement('div');
    addAfterItem.className = 'context-menu-item';
    addAfterItem.textContent = 'Добавить элемент после...';
    addAfterItem.addEventListener('click', (e) => {
      e.stopPropagation();
      closeContextMenu();
      // parentId: нужно найти parent — используем 0 как fallback
      showElementPicker(0, null);
    });
    menu.appendChild(addAfterItem);
  }

  // Удалить
  if (element.id !== 0) {
    const sep = document.createElement('div');
    sep.className = 'context-menu-separator';
    menu.appendChild(sep);

    const deleteItem = document.createElement('div');
    deleteItem.className = 'context-menu-item context-menu-item-danger';
    deleteItem.textContent = 'Удалить';
    deleteItem.addEventListener('click', (e) => {
      e.stopPropagation();
      closeContextMenu();
      onDeleteFromTreeCallback?.(element.id);
    });
    menu.appendChild(deleteItem);
  }

  // Клампинг позиции чтобы не вылезал за экран
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    menu.style.left = `${window.innerWidth - rect.width - 4}px`;
  }
  if (rect.bottom > window.innerHeight) {
    menu.style.top = `${window.innerHeight - rect.height - 4}px`;
  }

  activeContextMenu = menu;
}

// ── Element Picker ──────────────────────────────────────────────────────────

let nameCounter = 1;

function showElementPicker(parentId: number, insertBeforeId: number | null): void {
  const overlay = document.createElement('div');
  overlay.className = 'picker-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'picker-dialog';

  const title = document.createElement('div');
  title.className = 'picker-title';
  title.textContent = 'Добавить элемент';
  dialog.appendChild(title);

  const list = document.createElement('div');
  list.className = 'picker-list';

  for (const group of ADDABLE_TYPES) {
    const groupTitle = document.createElement('div');
    groupTitle.className = 'picker-group-title';
    groupTitle.textContent = group.group;
    list.appendChild(groupTitle);

    for (const item of group.items) {
      const row = document.createElement('div');
      row.className = 'picker-item';
      row.textContent = `${TYPE_ICONS[item.type] ?? '◻️'} ${item.label}`;
      row.addEventListener('click', () => {
        const name = `Новый${nameCounter++}`;
        onCreateCallback?.(parentId, item.type, name, insertBeforeId);

        // Для группы с направлением — сразу задать свойство Group
        if ('groupDir' in item && item.groupDir) {
          // Отложим — createElement вернёт модель, а Group будет задан отдельно
          // Пока просто создаём элемент
        }

        overlay.remove();
      });
      list.appendChild(row);
    }
  }

  dialog.appendChild(list);

  // Кнопка закрытия
  const closeBtn = document.createElement('div');
  closeBtn.className = 'picker-close';
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', () => overlay.remove());
  dialog.appendChild(closeBtn);

  overlay.appendChild(dialog);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  document.body.appendChild(overlay);
}
