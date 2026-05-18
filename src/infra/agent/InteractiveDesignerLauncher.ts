import type { AgentOperationHooks, DesignerAgentInfoBaseSession } from './AgentOperationService';

export interface InteractiveDesignerProcess {
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  once(event: 'error', listener: (error: Error) => void): this;
}

export interface InteractiveDesignerLaunchOptions {
  readonly agentSession?: DesignerAgentInfoBaseSession;
  readonly forceAgentDisconnect?: boolean;
  readonly launch: () => InteractiveDesignerProcess;
  readonly hooks?: AgentOperationHooks;
  readonly onMessage?: (message: string) => void;
  readonly onReconnectError?: (error: unknown) => void;
}

type ReconnectOptions = Pick<InteractiveDesignerLaunchOptions, 'hooks' | 'onMessage' | 'onReconnectError'>;

export async function launchInteractiveDesignerWithAgentPause(
  options: InteractiveDesignerLaunchOptions
): Promise<InteractiveDesignerProcess> {
  const agentSession = options.agentSession;
  let shouldReconnect = false;

  if (agentSession && (options.forceAgentDisconnect === true || agentSession.isInfoBaseConnected())) {
    options.onMessage?.('Отключение информационной базы от агента конфигуратора.');
    shouldReconnect = await agentSession.disconnectInfoBase(options.hooks, { force: options.forceAgentDisconnect });
  }

  let process: InteractiveDesignerProcess;
  try {
    process = options.launch();
  } catch (error) {
    if (shouldReconnect) {
      await reconnectAgent(agentSession, options);
    }
    throw error;
  }

  if (shouldReconnect && agentSession) {
    const reconnectHandler = new ReconnectOnceHandler(agentSession, options);
    const reconnectOnce = reconnectHandler.handleTermination.bind(reconnectHandler);
    process.once('exit', reconnectOnce);
    process.once('error', reconnectOnce);
  }

  return process;
}

export class ReconnectOnceHandler {
  private handled = false;

  constructor(
    private readonly agentSession: DesignerAgentInfoBaseSession,
    private readonly options: ReconnectOptions
  ) {}

  handleTermination(): void {
    if (this.handled) {
      return;
    }
    this.handled = true;
    void reconnectAgent(this.agentSession, this.options);
  }
}

async function reconnectAgent(
  agentSession: DesignerAgentInfoBaseSession | undefined,
  options: ReconnectOptions
): Promise<void> {
  if (!agentSession) {
    return;
  }

  try {
    options.onMessage?.('Повторное подключение информационной базы к агенту конфигуратора.');
    await agentSession.reconnectInfoBase(options.hooks);
  } catch (error) {
    options.onReconnectError?.(error);
  }
}
