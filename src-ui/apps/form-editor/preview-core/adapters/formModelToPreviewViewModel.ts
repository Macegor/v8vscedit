import type { FormPreviewElement } from '../types/FormPreviewElement';
import type { FormPreviewViewModel } from '../types/FormPreviewViewModel';
import type { FormPreviewMode } from '../types/FormPreviewMode';

export interface FormModelSource {
  readonly root: {
    readonly id: number;
    readonly name: string;
    readonly type: string;
    readonly title?: string;
    readonly dataPath?: string;
    readonly group?: string;
    readonly visible?: boolean;
    readonly readOnly?: boolean;
    readonly children: readonly unknown[];
    readonly rawProperties?: Record<string, string>;
  };
}

/**
 * Адаптирует модель формы из DTO в FormPreviewViewModel.
 */
export function formModelToPreviewViewModel(
  source: FormModelSource,
  mode: FormPreviewMode,
  title?: string
): FormPreviewViewModel {
  const root = adaptElement(source.root);
  return {
    root,
    mode,
    title: title ?? source.root.title ?? source.root.name,
  };
}

function adaptElement(src: FormModelSource['root']): FormPreviewElement {
  return {
    id: src.id,
    type: src.type,
    name: src.name,
    title: src.title,
    dataPath: src.dataPath,
    groupDirection: src.group as FormPreviewElement['groupDirection'],
    visible: src.visible ?? true,
    readOnly: src.readOnly ?? false,
    children: (src.children ?? []).map((child) => adaptElement(child as FormModelSource['root'])),
    rawProperties: src.rawProperties ?? {},
  };
}
