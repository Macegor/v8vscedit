import type { IconDto } from './icon';

/** Признак принадлежности объекта к основной конфигурации или расширению */
export type OwnershipKind = 'own' | 'borrowed' | 'unknown';

/** Режим поддержки объекта */
export type SupportMode = 'none' | 'editable' | 'locked';

/** Действие, доступное для узла дерева */
export interface TreeNodeActionDto {
  readonly id: string;
  readonly label: string;
  readonly icon?: IconDto;
  readonly command: string;
  readonly enabled?: boolean;
}

/**
 * DTO узла дерева метаданных.
 * Передаётся от host к webview для отрисовки.
 */
export interface TreeNodeDto {
  readonly id: string;
  readonly key: string;
  readonly label: string;
  readonly description?: string;
  readonly icon?: IconDto;
  readonly kind?: string;
  readonly ownership?: OwnershipKind;
  readonly supportMode?: SupportMode;
  readonly hasChildren: boolean;
  readonly loaded: boolean;
  readonly children?: TreeNodeDto[];
  readonly actions: TreeNodeActionDto[];
  readonly defaultCommand?: string;
}
