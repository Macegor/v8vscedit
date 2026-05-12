/**
 * DTO для редактора форм.
 * Все типы JSON-serializable, без зависимостей от vscode API.
 */

export interface FormElementDto {
  readonly id: number;
  readonly name: string;
  readonly type: string;
  readonly group?: string;
  readonly dataPath?: string;
  readonly title?: string;
  readonly showTitle?: boolean;
  readonly horizontalStretch?: boolean;
  readonly verticalStretch?: boolean;
  readonly width?: number;
  readonly height?: number;
  readonly readOnly?: boolean;
  readonly visible?: boolean;
  readonly children: FormElementDto[];
}

export interface FormAttributeDto {
  readonly id: number;
  readonly name: string;
  readonly valueType: string;
  readonly isMain?: boolean;
  readonly savedData?: boolean;
}

export interface FormCommandDto {
  readonly id: number;
  readonly name: string;
  readonly title?: string;
  readonly action?: string;
  readonly representation?: string;
}

export interface FormEditorStateDto {
  readonly model: FormModelDto;
  readonly selectedElementId?: number;
  readonly previewMode: 'taxi' | 'onec85';
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

export interface FormModelDto {
  readonly root: FormElementDto;
  readonly attributes: FormAttributeDto[];
  readonly commands: FormCommandDto[];
}
