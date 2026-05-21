export type AgentMessageType =
  | 'log'
  | 'success'
  | 'error'
  | 'canceled'
  | 'question'
  | 'dbstru'
  | 'generation-id'
  | 'loading-issue'
  | 'progress'
  | 'extension-info';

export interface AgentMessage {
  readonly type: AgentMessageType;
  readonly message?: string;
  readonly body?: unknown;
  readonly 'error-type'?: AgentErrorType;
}

export type KnownAgentErrorType =
  | 'UnknownError'
  | 'DesignerNotConnectedToInfoBase'
  | 'DesignerAlreadyConnectedToInfoBase'
  | 'CommandFormatError'
  | 'DBRestructInfo'
  | 'InfoBaseNotFound'
  | 'AdministrationAccessRightRequired'
  | 'ConfigFilesError'
  | 'DesignerAlreadyStarted'
  | 'InfoBaseExclusiveLockRequired'
  | 'LanguageNotFound'
  | 'ExtensionWithDataIsActive'
  | 'ExtensionNotFound';

export type AgentErrorType = KnownAgentErrorType | (string & {});

export interface AgentProgress {
  readonly percent?: number;
  readonly message?: string;
}

export function isTerminalAgentMessage(message: AgentMessage): boolean {
  return message.type === 'success' || message.type === 'error' || message.type === 'canceled';
}

/**
 * Сообщение конфигуратора-агента вида `{type: "error", body: [], error-type: "UnknownError"}`.
 * Это сигнал внутреннего сбоя процесса конфигуратора: следующая команда любого типа
 * также будет падать, помогает только перезапуск процесса 1cv8 /AgentMode.
 */
export function isEmptyUnknownAgentMessage(message: AgentMessage): boolean {
  if (message.type !== 'error') {
    return false;
  }
  const errorType = message['error-type'];
  if (errorType !== 'UnknownError') {
    return false;
  }
  if (Array.isArray(message.body) && message.body.length === 0) {
    return true;
  }
  return message.body === undefined || message.body === null;
}

export function getAgentMessageText(message: AgentMessage): string {
  if (message.type === 'generation-id') {
    return '';
  }
  if (message.type === 'progress') {
    const progress = extractProgress(message.body);
    if (progress) {
      return formatProgress(progress);
    }
  }
  if (message.type === 'dbstru') {
    const text = extractObjectText(message.body, 'message') ?? extractObjectText(message.body, 'info');
    return text ? `Изменение структуры БД: ${text}` : 'Изменение структуры БД';
  }
  if (message.type === 'loading-issue') {
    const text = extractObjectText(message.body, 'message') ?? extractObjectText(message.body, 'info');
    return text ? `Проблема загрузки: ${text}` : 'Проблема загрузки';
  }
  const bodyProgress = extractProgress(message.body);
  if (bodyProgress) {
    return formatProgress(bodyProgress);
  }
  const bodyMessage = extractObjectText(message.body, 'message');
  if (bodyMessage) {
    return bodyMessage;
  }
  if (typeof message.message === 'string' && message.message.trim()) {
    return message.message.trim();
  }
  if (typeof message.body === 'string' && message.body.trim()) {
    return message.body.trim();
  }
  if ((message.type === 'error' || message.type === 'canceled') && Array.isArray(message.body) && message.body.length === 0) {
    return `${message.type === 'error' ? 'Ошибка агента' : 'Операция агента отменена'}: пустой ответ${message['error-type'] ? ` (${message['error-type']})` : ''}`;
  }
  if (message.body && typeof message.body === 'object') {
    return JSON.stringify(message.body);
  }
  if (message.type === 'error' || message.type === 'canceled') {
    return `${message.type === 'error' ? 'Ошибка агента' : 'Операция агента отменена'}${message['error-type'] ? ` (${message['error-type']})` : ''}`;
  }
  return message.type;
}

function extractProgress(value: unknown): AgentProgress | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as { percent?: unknown; message?: unknown };
  if (typeof candidate.percent !== 'number' && typeof candidate.message !== 'string') {
    return null;
  }
  return {
    percent: typeof candidate.percent === 'number' ? candidate.percent : undefined,
    message: typeof candidate.message === 'string' ? candidate.message : undefined,
  };
}

function formatProgress(progress: AgentProgress): string {
  const message = nonEmptyText(progress.message, 'Прогресс операции');
  if (typeof progress.percent !== 'number') {
    return message;
  }
  return `${message}: ${String(Math.round(progress.percent))}%`;
}

function nonEmptyText(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  if (trimmed) {
    return trimmed;
  }
  return fallback;
}

function extractObjectText(value: unknown, key: string): string | null {
  if (!value || typeof value !== 'object' || !(key in value)) {
    return null;
  }
  const text = (value as Record<string, unknown>)[key];
  return typeof text === 'string' && text.trim() ? text.trim() : null;
}
