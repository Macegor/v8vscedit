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

export type AgentErrorType =
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
  | 'ExtensionNotFound'
  | string;

export interface AgentProgress {
  readonly percent?: number;
  readonly message?: string;
}

export function isTerminalAgentMessage(message: AgentMessage): boolean {
  return message.type === 'success' || message.type === 'error' || message.type === 'canceled';
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
  if (message.body && typeof message.body === 'object') {
    return JSON.stringify(message.body);
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
  const message = progress.message?.trim() || 'Прогресс операции';
  if (typeof progress.percent !== 'number') {
    return message;
  }
  return `${message}: ${String(Math.round(progress.percent))}%`;
}

function extractObjectText(value: unknown, key: string): string | null {
  if (!value || typeof value !== 'object' || !(key in value)) {
    return null;
  }
  const text = (value as Record<string, unknown>)[key];
  return typeof text === 'string' && text.trim() ? text.trim() : null;
}
