/**
 * Drag-and-drop логика для перемещения элементов формы.
 * Использует HTML5 Drag and Drop API.
 */

/** Callback при перемещении элемента */
let onMoveCallback:
  | ((elementId: number, targetParentId: number, insertBeforeId: number | null) => void)
  | null = null;

/** ID перетаскиваемого элемента */
let draggedElementId: number | null = null;

export function setOnMoveElement(
  callback: (
    elementId: number,
    targetParentId: number,
    insertBeforeId: number | null
  ) => void
): void {
  onMoveCallback = callback;
}

/** Инициализировать drag-and-drop на контейнере дерева */
export function initTreeDragDrop(treeContainer: HTMLElement): void {
  treeContainer.addEventListener('dragstart', onDragStart);
  treeContainer.addEventListener('dragover', onDragOver);
  treeContainer.addEventListener('dragleave', onDragLeave);
  treeContainer.addEventListener('drop', onDrop);
  treeContainer.addEventListener('dragend', onDragEnd);
}

/** Инициализировать drag-and-drop на контейнере превью */
export function initPreviewDragDrop(previewContainer: HTMLElement): void {
  previewContainer.addEventListener('dragover', onDragOver);
  previewContainer.addEventListener('dragleave', onDragLeave);
  previewContainer.addEventListener('drop', onDrop);
}

/** Сделать элемент дерева перетаскиваемым */
export function makeTreeNodeDraggable(nodeEl: HTMLElement): void {
  nodeEl.draggable = true;
}

/** Сделать элемент превью drop-целью */
export function makePreviewDropTarget(el: HTMLElement): void {
  el.dataset.dropTarget = 'true';
}

// ── Обработчики ─────────────────────────────────────────────────────────────

function onDragStart(e: DragEvent): void {
  const target = asHTMLElement(e.target)?.closest<HTMLElement>('.tree-node');
  if (!target) {return;}

  const id = target.dataset.elementId;
  if (!id) {return;}

  draggedElementId = parseInt(id, 10);

  if (!e.dataTransfer) {
    return;
  }
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', id);

  // Визуальная обратная связь
  target.classList.add('dragging');
}

function onDragOver(e: DragEvent): void {
  if (draggedElementId === null) {return;}
  e.preventDefault();
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'move';
  }

  // Показать индикатор позиции вставки
  clearDropIndicators();

  const dropTarget = findDropTarget(e);
  if (!dropTarget) {return;}

  const rect = dropTarget.el.getBoundingClientRect();
  const midY = rect.top + rect.height / 2;

  if (e.clientY < midY) {
    dropTarget.el.classList.add('drop-before');
  } else {
    dropTarget.el.classList.add('drop-after');
  }
}

function onDragLeave(e: DragEvent): void {
  const target = asHTMLElement(e.target);
  if (!target) {return;}
  target.classList.remove('drop-before', 'drop-after');
}

function onDrop(e: DragEvent): void {
  e.preventDefault();
  clearDropIndicators();

  if (draggedElementId === null) {return;}

  const dropTarget = findDropTarget(e);
  if (!dropTarget) {return;}

  const targetId = parseInt(dropTarget.el.dataset.elementId ?? '0', 10);
  if (targetId === draggedElementId) {return;}

  const rect = dropTarget.el.getBoundingClientRect();
  const midY = rect.top + rect.height / 2;
  const before = e.clientY < midY;

  // Определить родителя и позицию
  const parentId = getParentElementId(dropTarget.el);
  const insertBeforeId = before ? targetId : getNextSiblingId(dropTarget.el);

  onMoveCallback?.(draggedElementId, parentId, insertBeforeId);
  draggedElementId = null;
}

function onDragEnd(): void {
  draggedElementId = null;
  clearDropIndicators();
  document.querySelectorAll('.dragging').forEach((el) => {
    el.classList.remove('dragging');
  });
}

// ── Утилиты ─────────────────────────────────────────────────────────────────

function findDropTarget(
  e: DragEvent
): { el: HTMLElement } | null {
  const target = asHTMLElement(e.target);
  if (!target) {
    return null;
  }

  // В дереве — ищем .tree-node
  const treeNode = target.closest<HTMLElement>('.tree-node');
  if (treeNode?.dataset.elementId) {
    return { el: treeNode };
  }

  // В превью — ищем .preview-element
  const previewEl = target.closest<HTMLElement>('.preview-element');
  if (previewEl?.dataset.elementId) {
    return { el: previewEl };
  }

  return null;
}

function getParentElementId(el: HTMLElement): number {
  // Для tree-node: идём вверх по DOM до .tree-children → предыдущий .tree-node
  const treeChildren = el.closest('.tree-node')?.parentElement?.closest('.tree-children');
  if (treeChildren) {
    const parentWrapper = treeChildren.parentElement;
    if (parentWrapper) {
      const parentNode = parentWrapper.querySelector<HTMLElement>(':scope > .tree-node');
      if (parentNode?.dataset.elementId) {
        return parseInt(parentNode.dataset.elementId, 10);
      }
    }
  }

  // Для preview-element: ищем ближайший родительский .preview-element
  const previewParent = el.closest('.preview-element')?.parentElement?.closest<HTMLElement>('.preview-element');
  if (previewParent?.dataset.elementId) {
    return parseInt(previewParent.dataset.elementId, 10);
  }

  // Корневой уровень
  return 0;
}

function getNextSiblingId(el: HTMLElement): number | null {
  // Для tree-node
  const treeNode = el.closest('.tree-node');
  if (treeNode) {
    const wrapper = treeNode.parentElement;
    const nextWrapper = wrapper?.nextElementSibling;
    if (nextWrapper) {
      const nextNode = nextWrapper.querySelector<HTMLElement>(':scope > .tree-node');
      if (nextNode?.dataset.elementId) {
        return parseInt(nextNode.dataset.elementId, 10);
      }
    }
  }

  // Для preview-element
  const previewEl = el.closest('.preview-element');
  if (previewEl) {
    const next = asHTMLElement(previewEl.nextElementSibling);
    if (next?.dataset.elementId) {
      return parseInt(next.dataset.elementId, 10);
    }
  }

  return null;
}

function clearDropIndicators(): void {
  document.querySelectorAll('.drop-before, .drop-after').forEach((el) => {
    el.classList.remove('drop-before', 'drop-after');
  });
}

function asHTMLElement(value: EventTarget | Element | null): HTMLElement | null {
  return value instanceof HTMLElement ? value : null;
}
