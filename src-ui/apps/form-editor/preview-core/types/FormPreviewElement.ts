/** Элемент формы для предпросмотра (нормализованный, без DTO-зависимости от host) */
export interface FormPreviewElement {
  readonly id: number;
  readonly type: string;
  readonly name: string;
  readonly title?: string;
  readonly dataPath?: string;
  readonly groupDirection?: 'Vertical' | 'Horizontal' | 'AlwaysHorizontal';
  readonly visible: boolean;
  readonly readOnly: boolean;
  readonly children: FormPreviewElement[];
  readonly rawProperties: Record<string, string>;
}
