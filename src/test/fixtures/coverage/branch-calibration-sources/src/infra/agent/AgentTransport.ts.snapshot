import type { AgentMessage } from '../../domain/agent';

export interface AgentCommandHooks {
  readonly onMessage?: (message: AgentMessage) => void;
  readonly onQuestion?: (message: AgentMessage) => Promise<string | undefined>;
}

export interface AgentCommandResult {
  readonly messages: AgentMessage[];
}

export interface DesignerAgentTransport {
  execute(command: string, hooks?: AgentCommandHooks): Promise<AgentCommandResult>;
  reset?(): Promise<void>;
  dispose(): Promise<void>;
}

export interface DesignerAgentTransportFactory {
  create(sessionKey: string): Promise<DesignerAgentTransport>;
}

export interface ResettableDesignerAgentTransportFactory extends DesignerAgentTransportFactory {
  reset(sessionKey: string): Promise<void>;
}

/**
 * Ошибка выполнения команды агента. Хранит саму команду и финальное сообщение конфигуратора,
 * чтобы верхние слои могли отличить «пустой UnknownError» от обычной ошибки и принять
 * решение о перезапуске процесса конфигуратора.
 */
export class AgentCommandError extends Error {
  constructor(
    message: string,
    public readonly command: string,
    public readonly finalMessage?: AgentMessage
  ) {
    super(message);
    this.name = 'AgentCommandError';
  }
}
