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
  dispose(): Promise<void>;
}

export interface DesignerAgentTransportFactory {
  create(sessionKey: string): Promise<DesignerAgentTransport>;
}
