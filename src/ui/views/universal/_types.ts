/**
 * Типы данных, передаваемые между хостом и Vue-webview универсальной панели.
 * Зеркалируют DTO из src-ui/shared/types/ — дублирование оправдано,
 * так как src/ui/ и src-ui/ живут в разных tsconfig-проектах.
 */

/** Признак принадлежности объекта к основной конфигурации или расширению */
export type OwnershipKind = 'own' | 'borrowed' | 'unknown';

/** DTO иконки */
export interface IconDto {
  readonly kind: 'codicon' | 'metadata' | 'asset' | 'none';
  readonly name?: string;
  readonly lightUri?: string;
  readonly darkUri?: string;
  readonly ariaLabel?: string;
}

/** Действие контекстного меню узла */
export interface TreeNodeActionDto {
  readonly id: string;
  readonly label: string;
  readonly command: string;
}

/** DTO узла дерева метаданных для Vue-webview */
export interface TreeNodeDto {
  readonly id: string;
  readonly key: string;
  readonly label: string;
  readonly description?: string;
  readonly icon?: IconDto;
  readonly kind?: string;
  readonly ownership?: OwnershipKind;
  /** Режим поддержки: none / editable / locked */
  readonly supportMode?: 'none' | 'editable' | 'locked';
  readonly hasChildren: boolean;
  readonly loaded: boolean;
  readonly children?: TreeNodeDto[];
  readonly actions: TreeNodeActionDto[];
}
