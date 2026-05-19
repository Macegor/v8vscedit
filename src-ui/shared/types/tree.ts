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

/** Служебная иконка состояния узла: поддержка, хранилище, ограничения */
export interface TreeNodeStateIconDto {
  readonly title: string;
  readonly icon: IconDto;
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
  readonly inlineActions?: TreeNodeActionDto[];
  readonly stateIcons?: TreeNodeStateIconDto[];
  readonly gitStatus?: 'added' | 'modified' | 'deleted';
  readonly defaultCommand?: string;
}
