/**
 * DTO иконки узла дерева или элемента интерфейса.
 * Зеркалирует хост-сторону InternalIcon.
 */
export interface IconDto {
  readonly kind: 'codicon' | 'metadata' | 'asset' | 'none';
  readonly name?: string;
  readonly lightUri?: string;
  readonly darkUri?: string;
  readonly ariaLabel?: string;
}
