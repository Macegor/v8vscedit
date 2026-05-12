/**
 * DTO для статуса и состояния загрузки.
 */

export type HostStatusKindDto = 'idle' | 'loading' | 'success' | 'error';

export interface StatusDto {
  readonly kind: HostStatusKindDto;
  readonly message: string;
}

/**
 * Строит StatusDto для отправки в webview.
 */
export function buildStatusDto(kind: HostStatusKindDto, message: string): StatusDto {
  return { kind, message };
}

export function buildLoadingStatus(message?: string): StatusDto {
  return { kind: 'loading', message: message ?? 'Загрузка...' };
}

export function buildSuccessStatus(message?: string): StatusDto {
  return { kind: 'success', message: message ?? 'Готово' };
}

export function buildErrorStatus(message: string): StatusDto {
  return { kind: 'error', message };
}
