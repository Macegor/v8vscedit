import type { FormPreviewElement } from './FormPreviewElement';
import type { FormPreviewMode } from './FormPreviewMode';

/** ViewModel для предпросмотра формы */
export interface FormPreviewViewModel {
  readonly root: FormPreviewElement;
  readonly mode: FormPreviewMode;
  readonly title: string;
}
