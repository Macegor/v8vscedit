import type { FormPreviewElement } from '../types/FormPreviewElement';

/**
 * Нормализует layout формы: проставляет default-значения,
 * удаляет пустые группы, упорядочивает детей.
 */
export function normalizeFormLayout(root: FormPreviewElement): FormPreviewElement {
  return normalizeElement(root);

  function normalizeElement(el: FormPreviewElement): FormPreviewElement {
    const children = el.children
      .map(normalizeElement)
      .filter((child) => {
        // Убираем невидимые элементы
        if (!child.visible) return false;
        // Убираем пустые UsualGroup
        if (child.type === 'UsualGroup' && child.children.length === 0) return false;
        return true;
      });

    return {
      ...el,
      visible: el.visible ?? true,
      readOnly: el.readOnly ?? false,
      children,
    };
  }
}
