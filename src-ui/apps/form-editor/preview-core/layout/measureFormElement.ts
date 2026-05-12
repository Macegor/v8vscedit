import type { FormPreviewElement } from '../types/FormPreviewElement';

export interface ElementMetrics {
  readonly preferredWidth: number;
  readonly preferredHeight: number;
  readonly minWidth: number;
  readonly minHeight: number;
}

/**
 * Вычисляет предпочтительные размеры элемента формы.
 * Пока заглушка — всегда возвращает дефолты.
 */
export function measureFormElement(element: FormPreviewElement): ElementMetrics {
  return {
    preferredWidth: 120,
    preferredHeight: 24,
    minWidth: 60,
    minHeight: 20,
  };
}
